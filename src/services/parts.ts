import { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type PartSearchResult = {
  partNumber: string;
  description: string;
  revision: string;
  availableQuantity: number;
  location: string;
  stockUom: string;
  status: string;
};

type PartSearchOptions = {
  partNumber: string;
  description: string;
  inStockOnly: boolean;
  limit?: number;
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

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function escapeLikePattern(value: string): string {
  return value.replace(/([%_])/g, '\\$1');
}

type LikePatterns = {
  standard: string | null;
  collapsed: string | null;
};

function createLikePatterns(value: string): LikePatterns | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, ' ');
  const hasLeadingWildcard = normalized.startsWith('*');

  const rawSegments = normalized
    .split('*')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const buildPattern = (segments: string[]): string | null => {
    const cleaned = segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);

    if (cleaned.length === 0) {
      return null;
    }

    let pattern = hasLeadingWildcard ? '%' : '';
    pattern += cleaned.map((segment) => escapeLikePattern(segment)).join('%');

    if (!pattern.endsWith('%')) {
      pattern += '%';
    }

    return pattern;
  };

  if (rawSegments.length === 0) {
    if (!normalized.includes('*')) {
      return null;
    }

    return { standard: '%', collapsed: '%' };
  }

  const standardPattern = buildPattern(rawSegments);

  const collapsedSegments = rawSegments
    .map((segment) => segment.replace(/[-\s]+/g, ''))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const collapsedPattern = buildPattern(collapsedSegments);

  return {
    standard: standardPattern,
    collapsed: collapsedSegments.length > 0 ? collapsedPattern : null,
  };
}

function mapPartResult(record: Record<string, unknown>): PartSearchResult {
  const partNumber = coalesce(record, 'PartNumber', 'partNumber', 'part_number', 'PartNo', 'part_no').trim();
  const description = coalesce(
    record,
    'DescText',
    'Description',
    'description',
    'PartDescription',
    'part_description',
  ).trim();
  const revision = coalesce(record, 'Revision', 'revision', 'Rev', 'rev').trim();
  const stockUom = coalesce(
    record,
    'StockUOM',
    'stockUom',
    'StockUnit',
    'stock_unit',
    'StockingUOM',
    'stocking_uom',
  ).trim();
  const status = coalesce(record, 'ISC', 'Status', 'status', 'PartStatus', 'part_status').trim();
  const locationLabel = coalesce(
    record,
    'LocationDescription',
    'locationDescription',
    'LocationDisplay',
    'locationDisplay',
  ).trim();
  const locationCode = coalesce(record, 'LocationCode', 'locationCode').trim();
  const availableQuantityRaw =
    record['availableQuantity'] ??
    record['AvailableQuantity'] ??
    record['available_quantity'] ??
    record['availablequantity'];
  const availableQuantity = Math.max(0, asNumber(availableQuantityRaw));

  return {
    partNumber,
    description,
    revision,
    availableQuantity,
    location: locationLabel.length > 0 ? locationLabel : locationCode,
    stockUom,
    status,
  };
}

export async function searchParts(options: PartSearchOptions): Promise<PartSearchResult[]> {
  const partNumber = typeof options.partNumber === 'string' ? options.partNumber.trim() : '';
  const description = typeof options.description === 'string' ? options.description.trim() : '';
  const inStockOnly = Boolean(options.inStockOnly);
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) ? options.limit : undefined;

  const whereClauses: Prisma.Sql[] = [];

  if (partNumber.length > 0) {
    const patterns = createLikePatterns(partNumber);

    if (patterns?.standard) {
      const likeClauses: Prisma.Sql[] = [
        Prisma.sql`LOWER(pm.PartNumber) LIKE ${patterns.standard} ESCAPE '\\'`,
      ];

      if (patterns.collapsed) {
        likeClauses.push(
          Prisma.sql`
            REPLACE(REPLACE(LOWER(pm.PartNumber), '-', ''), ' ', '') LIKE ${patterns.collapsed} ESCAPE '\\'
          `,
        );
      }

      whereClauses.push(Prisma.sql`(${Prisma.join(likeClauses, ' OR ')})`);
    }
  }

  if (description.length > 0) {
    const patterns = createLikePatterns(description);

    if (patterns?.standard) {
      const likeClauses: Prisma.Sql[] = [
        Prisma.sql`LOWER(COALESCE(pm.DescText, '')) LIKE ${patterns.standard} ESCAPE '\\'`,
      ];

      if (patterns.collapsed) {
        likeClauses.push(
          Prisma.sql`
            REPLACE(REPLACE(LOWER(COALESCE(pm.DescText, '')), '-', ''), ' ', '') LIKE ${patterns.collapsed} ESCAPE '\\'
          `,
        );
      }

      whereClauses.push(Prisma.sql`(${Prisma.join(likeClauses, ' OR ')})`);
    }
  }

  if (inStockOnly) {
    whereClauses.push(
      Prisma.sql`GREATEST(COALESCE(il.quantityOnHand, 0) - COALESCE(it.quantityAllocated, 0), 0) > 0`,
    );
  }

  const whereClause =
    whereClauses.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(whereClauses, ' AND ')}`
      : Prisma.sql``;

  logger.debug('Executing part search query', {
    partNumberLength: partNumber.length,
    descriptionLength: description.length,
    inStockOnly,
    limit,
  });

  const limitClause = typeof limit === 'number' && limit > 0 ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;

  const results = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      pm.PartNumber,
      pm.DescText,
      pm.Revision,
      pm.StockUOM,
      pm.ISC,
      pm.LocationCode,
      sl.LocationDescription,
      GREATEST(COALESCE(il.quantityOnHand, 0) - COALESCE(it.quantityAllocated, 0), 0) AS availableQuantity
    FROM partmaster pm
    LEFT JOIN (
      SELECT PartNumber, SUM(Quantity) AS quantityOnHand
      FROM inventorylots
      GROUP BY PartNumber
    ) il
      ON il.PartNumber = pm.PartNumber
    LEFT JOIN (
      SELECT PartNumber, SUM(InventoryQuantity) AS quantityAllocated
      FROM inventorytags
      WHERE InventoryQuantity IS NOT NULL
      GROUP BY PartNumber
    ) it
      ON it.PartNumber = pm.PartNumber
    LEFT JOIN (
      SELECT LocationCode, MAX(NULLIF(TRIM(DescText), '')) AS LocationDescription
      FROM stocklocations
      GROUP BY LocationCode
    ) sl
      ON sl.LocationCode = pm.LocationCode
    ${whereClause}
    ORDER BY pm.PartNumber ASC
    ${limitClause}
  `);

  return results.map(mapPartResult);
}
