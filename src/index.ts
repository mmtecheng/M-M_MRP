import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { summarizeConnectionString } from './lib/connectionString.js';
import { logger, serializeError } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { searchParts } from './services/parts.js';
import type { PartSearchResult } from './services/parts.js';

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

type PrismaStepResult = {
  step: string;
  stdout: string;
  stderr: string;
};

let prismaSyncInProgress = false;

async function runPrismaCommand(args: string[], step: string): Promise<PrismaStepResult> {
  logger.info('Starting Prisma command', { step, args });

  return await new Promise<PrismaStepResult>((resolve, reject) => {
    const child = spawn(PRISMA_EXECUTABLE, [PRISMA_COMMAND, ...args], {
      env: process.env,
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

async function performPrismaSync() {
  const results: PrismaStepResult[] = [];

  results.push(await runPrismaCommand(PRISMA_DB_PULL_ARGS, 'schema introspection'));
  results.push(await runPrismaCommand(PRISMA_GENERATE_ARGS, 'client generation'));

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
    const steps = await performPrismaSync();
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

async function handlePartSearch(req: IncomingMessage, res: ServerResponse, searchTerm: string) {
  if (searchTerm.trim().length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Search term is required.' }));
    return;
  }

  logger.info('Incoming part search request', {
    searchTermLength: searchTerm.length,
    searchTermPreview: searchTerm.trim().slice(0, 32),
  });

  try {
    const data = await searchParts(searchTerm);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ data }));

    logger.info('Part search completed', {
      resultCount: data.length,
      searchTermLength: searchTerm.length,
    });
  } catch (error) {
    logger.error('Part search failed', {
      searchTermLength: searchTerm.length,
      error: serializeError(error),
    });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unable to complete part search.' }));
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
    await handlePartSearch(req, res, url.searchParams.get('search') ?? '');
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
