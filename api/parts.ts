import { Readable } from 'node:stream';

import { logger, serializeError } from '../src/lib/logger.js';
import { searchParts, upsertPart } from '../src/services/parts.js';

type RequestBody = Record<string, unknown> | null;

function resolveQueryParam(value: unknown): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

function parseBooleanFlag(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => parseBooleanFlag(item));
  }

  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function resolvePartResultLimit(value: unknown): number | undefined {
  const rawLimit = resolveQueryParam(value).trim();

  if (rawLimit.length === 0) {
    return 100;
  }

  const normalized = rawLimit.toLowerCase();

  if (['all', 'false', '0', 'off', 'no'].includes(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 100;
  }

  return parsed;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

async function readJsonBody(req: any): Promise<RequestBody> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }

  if (!(req instanceof Readable)) {
    return null;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const totalLength = chunks.reduce((sum, buffer) => sum + buffer.length, 0);
    if (totalLength > 1_000_000) {
      throw new Error('Request body is too large.');
    }
  }

  if (chunks.length === 0) {
    return null;
  }

  const payload = Buffer.concat(chunks).toString('utf8').trim();

  if (payload.length === 0) {
    return null;
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch (error) {
    logger.warn('Failed to parse JSON payload for parts endpoint', { error: serializeError(error) });
    throw new Error('Invalid JSON payload.');
  }
}

function normalizeAttributes(raw: unknown): { attributeId: number; value: string }[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.map((entry, index) => {
    const attributeId = parseNumeric((entry as Record<string, unknown>)?.['attributeId']);

    if (typeof attributeId !== 'number') {
      throw new Error(`Attribute at index ${index} is missing a valid attributeId.`);
    }

    const value = typeof (entry as Record<string, unknown>)?.['value'] === 'string'
      ? ((entry as Record<string, unknown>)['value'] as string)
      : '';

    return { attributeId, value };
  });
}

function buildPartPayload(body: RequestBody) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body is required.');
  }

  const partNumber = typeof body['partNumber'] === 'string' ? body['partNumber'] : '';

  return {
    partNumber,
    description: typeof body['description'] === 'string' ? body['description'] : undefined,
    revision: typeof body['revision'] === 'string' ? body['revision'] : undefined,
    stockUom: typeof body['stockUom'] === 'string' ? body['stockUom'] : undefined,
    status: typeof body['status'] === 'string' ? body['status'] : undefined,
    partTypeId: parseNumeric(body['partTypeId']),
    attributes: normalizeAttributes(body['attributes']),
  };
}

function mapSaveErrorToStatus(error: unknown): { status: number; message: string } {
  let status = 500;
  let message = 'Unable to save part.';

  if (error instanceof Error) {
    message = error.message;

    if (/missing required/i.test(error.message)) {
      status = 400;
    } else if (/attribute .*missing/i.test(error.message)) {
      status = 400;
    } else if (/does not exist/i.test(error.message)) {
      status = 404;
    } else if (/required/i.test(error.message)) {
      status = 400;
    }
  }

  return { status, message };
}

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const payload = buildPartPayload(body);
      const result = await upsertPart(payload, true);
      res.status(201).json({ data: result });
    } catch (error) {
      logger.error('Failed to create part from Vercel function', { error: serializeError(error) });
      const { status, message } = mapSaveErrorToStatus(error);
      res.status(status).json({ error: message });
    }
    return;
  }

  if (method !== 'GET') {
    logger.warn('Unsupported method for parts endpoint', { method });
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const partNumber = resolveQueryParam(req.query?.partNumber).trim();
  const description = resolveQueryParam(req.query?.description).trim();
  const inStockOnly = parseBooleanFlag(req.query?.inStock);
  const limit = resolvePartResultLimit(req.query?.limit);

  if (partNumber.length === 0 && description.length === 0 && !inStockOnly) {
    logger.warn('Rejected part search without filters', { source: 'vercel-function' });
    res
      .status(400)
      .json({ error: 'Provide a part number, description, or enable the In Stock filter.' });
    return;
  }

  logger.info('Incoming part search request', {
    partNumberLength: partNumber.length,
    descriptionLength: description.length,
    inStockOnly,
    limit,
    source: 'vercel-function',
  });

  try {
    const data = await searchParts({
      partNumber,
      description,
      inStockOnly,
      limit,
    });
    res.status(200).json({ data });

    logger.info('Part search completed', {
      resultCount: data.length,
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      limit,
      source: 'vercel-function',
    });
  } catch (error) {
    logger.error('Part search failed', {
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      limit,
      error: serializeError(error),
      source: 'vercel-function',
    });
    res.status(500).json({ error: 'Unable to complete part search.' });
  }
}
