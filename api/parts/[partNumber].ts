import { Readable } from 'node:stream';

import { logger, serializeError } from '../../src/lib/logger.js';
import { getPartDetail, upsertPart } from '../../src/services/parts.js';

type RequestBody = Record<string, unknown> | null;

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

function resolvePartNumber(param: unknown): string {
  if (Array.isArray(param)) {
    return typeof param[0] === 'string' ? decodeURIComponent(param[0]) : '';
  }

  return typeof param === 'string' ? decodeURIComponent(param) : '';
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
    logger.warn('Failed to parse JSON payload for part detail endpoint', { error: serializeError(error) });
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

function buildPartPayload(partNumber: string, body: RequestBody) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body is required.');
  }

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
  const partNumber = resolvePartNumber(req.query?.partNumber);

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, PUT, OPTIONS');
    res.status(204).end();
    return;
  }

  if (!partNumber) {
    res.status(400).json({ error: 'A part number is required.' });
    return;
  }

  if (method === 'GET') {
    try {
      const detail = await getPartDetail(partNumber);
      if (!detail) {
        res.status(404).json({ error: 'Part not found.' });
        return;
      }

      res.status(200).json({ data: detail });
    } catch (error) {
      logger.error('Failed to load part detail from Vercel function', {
        partNumber,
        error: serializeError(error),
      });
      res.status(500).json({ error: 'Unable to retrieve part detail.' });
    }
    return;
  }

  if (method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const payload = buildPartPayload(partNumber, body);
      const result = await upsertPart(payload, false);
      res.status(200).json({ data: result });
    } catch (error) {
      logger.error('Failed to update part from Vercel function', {
        partNumber,
        error: serializeError(error),
      });
      const { status, message } = mapSaveErrorToStatus(error);
      res.status(status).json({ error: message });
    }
    return;
  }

  logger.warn('Unsupported method for part detail endpoint', { method, partNumber });
  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Method Not Allowed' });
}
