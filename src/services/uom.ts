import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type UomOverviewRow = {
  code: string;
  description: string;
  type: string;
  conversionFactor: number | null;
  usage: string;
};

type RawUomRecord = {
  UOMCode: string | null;
  DescText: string | null;
  UOMType: number | string | null;
  ConversionFactor: number | string | null;
  StockUsage: number | string | bigint | null;
  PurchaseUsage: number | string | bigint | null;
  BomUsage: number | string | bigint | null;
};

function normalize(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return '';
}

function normalizeNumber(value: unknown): number | null {
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

  return null;
}

const UOM_TYPE_MAP: Record<number, string> = {
  0: 'Stock',
  1: 'Purchase',
  2: 'Sales',
  3: 'Manufacturing',
};

function interpretType(value: unknown): string {
  const numeric = normalizeNumber(value);

  if (numeric === null) {
    return 'Unspecified';
  }

  const rounded = Math.trunc(numeric);
  return UOM_TYPE_MAP[rounded] ?? `Type ${rounded}`;
}

function buildUsage(stock: unknown, purchase: unknown, bom: unknown): string {
  const parts: string[] = [];
  const stockCount = normalizeNumber(stock);
  const purchaseCount = normalizeNumber(purchase);
  const bomCount = normalizeNumber(bom);

  if (stockCount && stockCount > 0) {
    parts.push(`Stock (${stockCount})`);
  }

  if (purchaseCount && purchaseCount > 0) {
    parts.push(`Purchase (${purchaseCount})`);
  }

  if (bomCount && bomCount > 0) {
    parts.push(`BOM (${bomCount})`);
  }

  if (parts.length === 0) {
    return 'Not referenced';
  }

  return parts.join(' • ');
}

function mapRecord(record: RawUomRecord): UomOverviewRow {
  return {
    code: normalize(record.UOMCode),
    description: normalize(record.DescText),
    type: interpretType(record.UOMType),
    conversionFactor: normalizeNumber(record.ConversionFactor),
    usage: buildUsage(record.StockUsage, record.PurchaseUsage, record.BomUsage),
  };
}

export async function getUnitsOfMeasure(limit = 100): Promise<UomOverviewRow[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 250) : 100;

  logger.debug('Retrieving units of measure overview', { limit: safeLimit });

  const records = (await prisma.$queryRaw`
    SELECT
      u.UOMCode,
      u.DescText,
      u.UOMType,
      u.ConversionFactor,
      stock.StockUsage,
      purchase.PurchaseUsage,
      bom.BomUsage
    FROM uomcodes u
    LEFT JOIN (
      SELECT pm.StockUOM AS Code, COUNT(*) AS StockUsage
      FROM partmaster pm
      WHERE pm.StockUOM IS NOT NULL AND LENGTH(TRIM(pm.StockUOM)) > 0
      GROUP BY pm.StockUOM
    ) stock ON stock.Code = u.UOMCode
    LEFT JOIN (
      SELECT pm.UOMPurchase AS Code, COUNT(*) AS PurchaseUsage
      FROM partmaster pm
      WHERE pm.UOMPurchase IS NOT NULL AND LENGTH(TRIM(pm.UOMPurchase)) > 0
      GROUP BY pm.UOMPurchase
    ) purchase ON purchase.Code = u.UOMCode
    LEFT JOIN (
      SELECT b.BOMUOMCode AS Code, COUNT(*) AS BomUsage
      FROM bom b
      WHERE b.BOMUOMCode IS NOT NULL AND LENGTH(TRIM(b.BOMUOMCode)) > 0
      GROUP BY b.BOMUOMCode
    ) bom ON bom.Code = u.UOMCode
    ORDER BY u.UOMCode ASC
    LIMIT ${safeLimit}
  `) as RawUomRecord[];

  return records.map(mapRecord);
}
