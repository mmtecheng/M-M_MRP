import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type PartSearchResult = {
  partNumber: string;
  description: string;
  revision: string;
  stockUom: string;
  commodityCode: string;
  abcCode: string;
  status: string;
};

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

export async function searchParts(term: string): Promise<PartSearchResult[]> {
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
