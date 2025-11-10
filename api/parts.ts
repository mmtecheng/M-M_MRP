import { logger, serializeError } from '../src/lib/logger.js';
import { searchParts } from '../src/services/parts.js';

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

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method !== 'GET') {
    logger.warn('Unsupported method for parts endpoint', { method });
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const partNumber = resolveQueryParam(req.query?.partNumber).trim();
  const description = resolveQueryParam(req.query?.description).trim();
  const inStockOnly = parseBooleanFlag(req.query?.inStock);

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
    source: 'vercel-function',
  });

  try {
    const data = await searchParts({
      partNumber,
      description,
      inStockOnly,
    });
    res.status(200).json({ data });

    logger.info('Part search completed', {
      resultCount: data.length,
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      source: 'vercel-function',
    });
  } catch (error) {
    logger.error('Part search failed', {
      partNumberLength: partNumber.length,
      descriptionLength: description.length,
      inStockOnly,
      error: serializeError(error),
      source: 'vercel-function',
    });
    res.status(500).json({ error: 'Unable to complete part search.' });
  }
}
