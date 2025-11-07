import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { logger, serializeError } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

type PartSearchResult = {
  partNumber: string;
  description: string;
  revision: string;
  stockUom: string;
  commodityCode: string;
  abcCode: string;
  status: string;
};

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

function resolveMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function sanitizePath(requestPath: string) {
  const normalized = path.normalize(requestPath);
  const relative = normalized.replace(/^\/+/, '');
  return relative;
}

function normalizeString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  return '';
}

function coalesce(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in record) {
      const candidate = normalizeString(record[key]);
      if (candidate.length > 0) {
        return candidate;
      }
    }
  }

  return '';
}

function mapPartResult(record: Record<string, unknown>): PartSearchResult {
  return {
    partNumber: coalesce(record, 'PartNumber', 'partNumber', 'part_number', 'PartNo', 'part_no'),
    description: coalesce(record, 'Description', 'description', 'PartDescription', 'part_description'),
    revision: coalesce(record, 'Revision', 'revision', 'Rev', 'rev'),
    stockUom: coalesce(record, 'StockUOM', 'stockUom', 'StockUnit', 'stock_unit', 'StockingUOM', 'stocking_uom'),
    commodityCode: coalesce(record, 'CommodityCode', 'commodityCode', 'commodity_code'),
    abcCode: coalesce(record, 'ABCCode', 'abcCode', 'abc_code'),
    status: coalesce(record, 'Status', 'status', 'PartStatus', 'part_status'),
  };
}

async function searchParts(term: string): Promise<PartSearchResult[]> {
  const trimmed = term.trim();
  if (!trimmed) {
    return [];
  }

  const prefixWildcard = `${trimmed}%`;
  const containsWildcard = `%${trimmed}%`;

  logger.debug('Executing part search query', {
    searchTermLength: trimmed.length,
    searchTermPreview: trimmed.slice(0, 32),
  });

  const results = (await prisma.$queryRaw`
    SELECT
      PartNumber,
      Description,
      Revision,
      StockUOM,
      CommodityCode,
      ABCCode,
      Status
    FROM PartMaster
    WHERE PartNumber LIKE ${prefixWildcard} OR Description LIKE ${containsWildcard}
    ORDER BY PartNumber
    LIMIT 25
  `) as Record<string, unknown>[];

  return results.map(mapPartResult);
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

  if (req.method === 'GET' && normalizedPath === '/api/parts') {
    await handlePartSearch(req, res, url.searchParams.get('search') ?? '');
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
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
