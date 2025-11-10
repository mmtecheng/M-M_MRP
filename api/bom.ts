import { logger, serializeError } from '../src/lib/logger.js';
import { getBillOfMaterials } from '../src/services/bom.js';

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method !== 'GET') {
    logger.warn('Unsupported method for BOM endpoint', { method });
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const rawLimit = Array.isArray(req.query?.limit) ? req.query?.limit[0] : req.query?.limit;
  const limit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : undefined;
  const rawAssembly = Array.isArray(req.query?.assembly) ? req.query?.assembly[0] : req.query?.assembly;
  const assembly = typeof rawAssembly === 'string' ? rawAssembly.trim() : undefined;

  try {
    const data = await getBillOfMaterials({ limit, assembly });
    res.status(200).json({ data });
  } catch (error) {
    logger.error('Failed to load bill of materials', { error: serializeError(error) });
    res.status(500).json({ error: 'Unable to retrieve bill of materials.' });
  }
}
