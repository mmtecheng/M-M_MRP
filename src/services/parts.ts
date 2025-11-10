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

type WildcardQuery = {
  segments: string[];
  hasLeadingWildcard: boolean;
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

function parseWildcardQuery(value: string): WildcardQuery | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, ' ');
  const hasLeadingWildcard = normalized.startsWith('*');
  const segments = normalized
    .split('*')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  return { segments, hasLeadingWildcard };
}

function buildLikePattern(
  segments: string[],
  hasLeadingWildcard: boolean,
  transform: (segment: string) => string,
): string | null {
  const transformed = segments
    .map((segment) => transform(segment))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (transformed.length === 0) {
    return null;
  }

  let pattern = hasLeadingWildcard ? '%' : '';
  pattern += transformed.map((segment) => escapeLikePattern(segment)).join('%');

  if (!pattern.endsWith('%')) {
    pattern += '%';
  }

  return pattern;
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
    const parsed = parseWildcardQuery(partNumber);

    if (parsed) {
      const likeClauses: Prisma.Sql[] = [];
      const standardPattern = buildLikePattern(parsed.segments, parsed.hasLeadingWildcard, (segment) => segment);
      const collapsedPattern = buildLikePattern(
        parsed.segments,
        parsed.hasLeadingWildcard,
        (segment) => segment.replace(/[-\s]+/g, ''),
      );

      if (standardPattern) {
        likeClauses.push(Prisma.sql`LOWER(pm.PartNumber) LIKE ${standardPattern} ESCAPE '\\'`);
      }

      if (collapsedPattern) {
        likeClauses.push(
          Prisma.sql`
            REPLACE(REPLACE(LOWER(pm.PartNumber), '-', ''), ' ', '') LIKE ${collapsedPattern} ESCAPE '\\'
          `,
        );
      }

      if (likeClauses.length > 0) {
        whereClauses.push(Prisma.sql`(${Prisma.join(likeClauses, ' OR ')})`);
      }
    }
  }

  if (description.length > 0) {
    const parsed = parseWildcardQuery(description);

    if (parsed) {
      const likeClauses: Prisma.Sql[] = [];
      const standardPattern = buildLikePattern(parsed.segments, parsed.hasLeadingWildcard, (segment) => segment);
      const collapsedPattern = buildLikePattern(
        parsed.segments,
        parsed.hasLeadingWildcard,
        (segment) => segment.replace(/[-\s]+/g, ''),
      );

      if (standardPattern) {
        likeClauses.push(Prisma.sql`LOWER(COALESCE(pm.DescText, '')) LIKE ${standardPattern} ESCAPE '\\'`);
      }

      if (collapsedPattern) {
        likeClauses.push(
          Prisma.sql`
            REPLACE(REPLACE(LOWER(COALESCE(pm.DescText, '')), '-', ''), ' ', '') LIKE ${collapsedPattern} ESCAPE '\\'
          `,
        );
      }

      if (likeClauses.length > 0) {
        whereClauses.push(Prisma.sql`(${Prisma.join(likeClauses, ' OR ')})`);
      }
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

  const limitClause = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;

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
