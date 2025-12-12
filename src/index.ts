import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { summarizeConnectionString } from './lib/connectionString.js';
import { logger, serializeError } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { getBillOfMaterials } from './services/bom.js';
import { getInventorySnapshot } from './services/inventory.js';
import { searchParts } from './services/parts.js';
import { getUnitsOfMeasure } from './services/uom.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? '3000', 10);

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const PRISMA_EXECUTABLE = 'npx';
const PRISMA_COMMAND = 'prisma';
const PRISMA_DB_PULL_ARGS = ['db', 'pull'];
const PRISMA_GENERATE_ARGS = ['generate'];
const PRISMA_SCHEMA_PATH = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
const TEMP_SCHEMA_DIR = path.join('/tmp', 'prisma-sync');
const TEMP_SCHEMA_PATH = path.join(TEMP_SCHEMA_DIR, 'schema.prisma');

type PrismaStepResult = {
  step: string;
  stdout: string;
  stderr: string;
};

let prismaSyncInProgress = false;

async function runPrismaCommand(
  args: string[],
  step: string,
  schemaPath: string,
): Promise<PrismaStepResult> {
  logger.info('Starting Prisma command', { step, args });

  const homeDir = process.env.HOME ?? '/tmp';
  const npmCacheDir = process.env.NPM_CONFIG_CACHE ?? process.env.npm_config_cache ?? `${homeDir}/.npm`;
  const npmTmpDir = process.env.NPM_CONFIG_TMP ?? process.env.npm_config_tmp ?? `${homeDir}/tmp`;

  await Promise.all([
    mkdir(homeDir, { recursive: true }).catch(() => undefined),
    mkdir(npmCacheDir, { recursive: true }).catch(() => undefined),
    mkdir(npmTmpDir, { recursive: true }).catch(() => undefined),
  ]);

  const env = {
    ...process.env,
    HOME: homeDir,
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_cache: npmCacheDir,
    NPM_CONFIG_TMP: npmTmpDir,
    npm_config_tmp: npmTmpDir,
  };

  return await new Promise<PrismaStepResult>((resolve, reject) => {
    const prismaArgs = [PRISMA_COMMAND, ...args, '--schema', schemaPath];

    const child = spawn(PRISMA_EXECUTABLE, prismaArgs, {
      env,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      logger.error('Failed to start Prisma command', { step, error: serializeError(error) });
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        logger.info('Prisma command completed', { step });
        resolve({ step, stdout, stderr });
        return;
      }

      const commandError = new Error(`Prisma ${step} exited with code ${code ?? 'null'}`);
      logger.error('Prisma command failed', {
        step,
        code,
        stdout: stdout.slice(-1000),
        stderr: stderr.slice(-1000),
      });
      reject(commandError);
    });
  });
}

async function prepareTemporarySchema(): Promise<string> {
  await mkdir(TEMP_SCHEMA_DIR, { recursive: true });
  await copyFile(PRISMA_SCHEMA_PATH, TEMP_SCHEMA_PATH);
  return TEMP_SCHEMA_PATH;
}

async function performPrismaSync(schemaPath: string) {
  const results: PrismaStepResult[] = [];

  results.push(await runPrismaCommand(PRISMA_DB_PULL_ARGS, 'schema introspection', schemaPath));
  results.push(await runPrismaCommand(PRISMA_GENERATE_ARGS, 'client generation', schemaPath));

  return results;
}

async function handlePrismaSyncRequest(res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!process.env.DATABASE_URL) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'DATABASE_URL is not configured on the server.' }));
    return;
  }

  logger.info(
    'Prisma sync will use configured database connection string (server runtime)',
    summarizeConnectionString(process.env.DATABASE_URL),
  );

  if (prismaSyncInProgress) {
    res.statusCode = 409;
    res.end(JSON.stringify({ error: 'A Prisma synchronization is already in progress.' }));
    return;
  }

  prismaSyncInProgress = true;

  try {
    const schemaPath = await prepareTemporarySchema();
    logger.info('Prisma schema sync will use temporary schema copy', { schemaPath });

    const steps = await performPrismaSync(schemaPath);
    const updatedSchema = await readFile(schemaPath, 'utf8').catch(() => null);
    const responseSteps = steps.map(({ step, stdout, stderr }) => ({
      step,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        message: 'Prisma schema synchronized successfully.',
        steps: responseSteps,
        schemaPath,
        schema: updatedSchema ?? undefined,
      }),
    );

    logger.info('Prisma schema synchronization finished successfully');
  } catch (error) {
    logger.error('Prisma schema synchronization failed', { error: serializeError(error) });
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Failed to synchronize Prisma schema. Check server logs for details.' }));
  } finally {
    prismaSyncInProgress = false;
  }
}

function resolveMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function sanitizePath(requestPath: string) {
  const normalized = path.normalize(requestPath);
  const relative = normalized.replace(/^\/+/, '');
  return relative;
}

function parseBooleanFlag(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function resolvePartResultLimit(rawLimit: string | null): number | undefined {
  if (!rawLimit) {
    return 100;
  }

  const normalized = rawLimit.trim().toLowerCase();

  if (
    normalized === 'all' ||
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'off' ||
    normalized === 'no'
  ) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 100;
  }

  return parsed;
}

type PartSearchFilters = {
  partNumber: string;
  description: string;
  inStockOnly: boolean;
  limit: number | undefined;
};

async function handlePartSearch(
  req: IncomingMessage,
  res: ServerResponse,
  filters: PartSearchFilters,
) {
  const partNumber = filters.partNumber.trim();
  const description = filters.description.trim();
  const inStockOnly = filters.inStockOnly;
  const limit = filters.limit;

  if (partNumber.length === 0 && description.length === 0 && !inStockOnly) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({ error: 'Provide a part number, description, or enable the In Stock filter.' }),
    );
    return;
  }

  logger.info('Incoming part search request', {
    partNumberLength: partNumber.length,
    descriptionLength: description.length,
    inStockOnly,
    limit,
  });

  try {
    const data = await searchParts({
      partNumber,
      description,
      inStockOnly,
      limit,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ data }));

    logger.info('Part search completed', {
      resultCount: data.length,
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      limit,
    });
  } catch (error) {
    logger.error('Part search failed', {
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      limit,
      error: serializeError(error),
    });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unable to complete part search.' }));
  }
}

function parseLimit(rawLimit: string | null): number | undefined {
  if (!rawLimit) {
    return undefined;
  }

  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

async function handleBillOfMaterials(
  res: ServerResponse,
  limit: number | undefined,
  assembly: string | null,
) {
  try {
    const data = await getBillOfMaterials({
      limit,
      assembly: assembly?.trim() || undefined,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ data }));
  } catch (error) {
    logger.error('Bill of materials request failed', { error: serializeError(error) });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unable to retrieve bill of materials.' }));
  }
}

async function handleInventoryOverview(res: ServerResponse) {
  try {
    const data = await getInventorySnapshot();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ data }));
  } catch (error) {
    logger.error('Inventory snapshot request failed', { error: serializeError(error) });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unable to retrieve inventory snapshot.' }));
  }
}

async function handleUnitsOfMeasure(res: ServerResponse, limit: number | undefined) {
  try {
    const data = await getUnitsOfMeasure(limit);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ data }));
  } catch (error) {
    logger.error('Units of measure request failed', { error: serializeError(error) });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unable to retrieve units of measure.' }));
  }
}

async function serveStaticAsset(res: ServerResponse, filePath: string) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      throw Object.assign(new Error('Directory access is not allowed'), { code: 'EISDIR' });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', resolveMimeType(filePath));
    const stream = createReadStream(filePath);
    stream.on('error', (streamError) => {
      logger.error('Streaming error while serving asset', {
        filePath,
        error: serializeError(streamError),
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      } else {
        res.destroy(streamError as Error);
      }
    });
    stream.pipe(res);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    if (nodeError.code === 'EISDIR') {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    logger.error('Failed to serve asset', {
      filePath,
      error: serializeError(error),
    });
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

async function requestHandler(req: IncomingMessage, res: ServerResponse) {
  if (!req.url || !req.method) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  logger.debug('Incoming request received', {
    method: req.method,
    url: req.url,
    pathname: url.pathname,
  });

  const normalizedPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');

  if (req.method === 'POST' && normalizedPath === '/api/prisma/sync') {
    await handlePrismaSyncRequest(res);
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/api/parts') {
    await handlePartSearch(req, res, {
      partNumber: url.searchParams.get('partNumber') ?? '',
      description: url.searchParams.get('description') ?? '',
      inStockOnly: parseBooleanFlag(url.searchParams.get('inStock')),
      limit: resolvePartResultLimit(url.searchParams.get('limit')),
    });
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/api/bom') {
    await handleBillOfMaterials(
      res,
      parseLimit(url.searchParams.get('limit')),
      url.searchParams.get('assembly'),
    );
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/api/inventory') {
    await handleInventoryOverview(res);
    return;
  }

  if (req.method === 'GET' && normalizedPath === '/api/uom') {
    await handleUnitsOfMeasure(res, parseLimit(url.searchParams.get('limit')));
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    res.end('Method Not Allowed');
    return;
  }

  const requestedPath = normalizedPath === '/' ? '/index.html' : normalizedPath;
  const safePath = sanitizePath(requestedPath);
  const absolutePath = path.join(PUBLIC_DIR, safePath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  await serveStaticAsset(res, absolutePath);
}

const server = createServer((req, res) => {
  void requestHandler(req, res);
});

async function bootstrap() {
  await prisma.$connect();
  logger.info('Prisma connection established');

  server.listen(DEFAULT_PORT, () => {
    logger.info('Server listening', { port: DEFAULT_PORT });
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to start server', { error: serializeError(error) });
  process.exit(1);
});

async function shutdown() {
  logger.info('Shutting down server');
  server.close(() => {
    void prisma.$disconnect().finally(() => {
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
