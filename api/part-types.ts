import { logger, serializeError } from '../src/lib/logger.js';
import { listPartTypes } from '../src/services/parts.js';

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method !== 'GET') {
    logger.warn('Unsupported method for part types endpoint', { method });
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const partTypes = await listPartTypes();
    res.status(200).json({ data: partTypes });
  } catch (error) {
    logger.error('Failed to load part types', { error: serializeError(error) });
    res.status(500).json({ error: 'Unable to retrieve part types.' });
  }
}
