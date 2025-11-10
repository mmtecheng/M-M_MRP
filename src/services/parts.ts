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
    description: coalesce(
      record,
      'DescText',
      'Description',
      'description',
      'PartDescription',
      'part_description',
    ),
    revision: coalesce(record, 'Revision', 'revision', 'Rev', 'rev'),
    stockUom: coalesce(record, 'StockUOM', 'stockUom', 'StockUnit', 'stock_unit', 'StockingUOM', 'stocking_uom'),
    commodityCode: coalesce(record, 'CommodityCode', 'commodityCode', 'commodity_code'),
    abcCode: coalesce(record, 'ABCCode', 'abcCode', 'abc_code'),
    status: coalesce(record, 'ISC', 'Status', 'status', 'PartStatus', 'part_status'),
  };
}

export async function searchParts(term: string): Promise<PartSearchResult[]> {
  const trimmed = term.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedTerm = trimmed.replace(/\s+/g, ' ');
  const lowerTerm = normalizedTerm.toLowerCase();
  const alphanumericTerm = lowerTerm.replace(/[^a-z0-9]/g, '');
  const prefixWildcard = `${lowerTerm}%`;
  const containsWildcard = `%${lowerTerm}%`;
  const collapsedWildcard = `%${alphanumericTerm || lowerTerm}%`;

  logger.debug('Executing part search query', {
    searchTermLength: trimmed.length,
    searchTermPreview: trimmed.slice(0, 32),
  });

  const results = (await prisma.$queryRaw`
    SELECT
      pm.PartNumber,
      pm.DescText,
      pm.Revision,
      pm.StockUOM,
      pm.CommodityCode,
      pm.ABCCode,
      pm.ISC
    FROM partmaster pm
    WHERE
      (
        LOWER(pm.PartNumber) LIKE ${prefixWildcard}
        OR LOWER(pm.PartNumber) LIKE ${containsWildcard}
        OR REPLACE(REPLACE(LOWER(pm.PartNumber), '-', ''), ' ', '') LIKE ${collapsedWildcard}
        OR LOWER(COALESCE(pm.DescText, '')) LIKE ${containsWildcard}
        OR REPLACE(REPLACE(LOWER(COALESCE(pm.DescText, '')), '-', ''), ' ', '') LIKE ${collapsedWildcard}
        OR EXISTS (
          SELECT 1
          FROM partxreference px
          WHERE px.PartNumber = pm.PartNumber
            AND (
              LOWER(COALESCE(px.PartXReference, '')) LIKE ${containsWildcard}
              OR REPLACE(REPLACE(LOWER(COALESCE(px.PartXReference, '')), '-', ''), ' ', '') LIKE ${collapsedWildcard}
            )
        )
      )
    ORDER BY pm.PartNumber
    LIMIT 50
  `) as Record<string, unknown>[];

  return results.map(mapPartResult);
}
