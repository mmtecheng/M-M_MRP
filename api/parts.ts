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

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method !== 'GET') {
    logger.warn('Unsupported method for parts endpoint', { method });
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const searchTerm = resolveQueryParam(req.query?.search);

  if (searchTerm.trim().length === 0) {
    logger.warn('Rejected part search without search term');
    res.status(400).json({ error: 'Search term is required.' });
    return;
  }

  logger.info('Incoming part search request', {
    searchTermLength: searchTerm.length,
    searchTermPreview: searchTerm.trim().slice(0, 32),
    source: 'vercel-function',
  });

  try {
    const data = await searchParts(searchTerm);
    res.status(200).json({ data });

    logger.info('Part search completed', {
      resultCount: data.length,
      searchTermLength: searchTerm.length,
      source: 'vercel-function',
    });
  } catch (error) {
    logger.error('Part search failed', {
      searchTermLength: searchTerm.length,
      error: serializeError(error),
      source: 'vercel-function',
    });
    res.status(500).json({ error: 'Unable to complete part search.' });
  }
}
