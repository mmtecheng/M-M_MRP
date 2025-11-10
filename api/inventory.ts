import { logger, serializeError } from '../src/lib/logger.js';
import { getInventorySnapshot } from '../src/services/inventory.js';

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method !== 'GET') {
    logger.warn('Unsupported method for inventory endpoint', { method });
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const data = await getInventorySnapshot();
    res.status(200).json({ data });
  } catch (error) {
    logger.error('Failed to load inventory snapshot', { error: serializeError(error) });
    res.status(500).json({ error: 'Unable to retrieve inventory snapshot.' });
  }
}
