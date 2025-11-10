import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type InventorySnapshot = {
  quantityOnHand: number;
  quantityAllocated: number;
  quantityAvailable: number;
  lotCount: number;
  lastReceiptDate: string | null;
};

type AggregateRow = {
  totalQuantity: unknown;
  lotCount: unknown;
  lastReceiptDate: unknown;
};

type TagAggregateRow = {
  totalAllocated: unknown;
};

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

function asDateString(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  logger.debug('Computing inventory snapshot metrics');

  const [lots] = (await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(il.Quantity), 0) AS totalQuantity,
      COUNT(*) AS lotCount,
      MAX(il.DateReceived) AS lastReceiptDate
    FROM inventorylots il
  `) as AggregateRow[];

  const [tags] = (await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(it.InventoryQuantity), 0) AS totalAllocated
    FROM inventorytags it
    WHERE it.InventoryQuantity IS NOT NULL
  `) as TagAggregateRow[];

  const quantityOnHand = asNumber(lots?.totalQuantity ?? 0);
  const quantityAllocated = asNumber(tags?.totalAllocated ?? 0);
  const quantityAvailable = Math.max(0, quantityOnHand - quantityAllocated);

  const snapshot: InventorySnapshot = {
    quantityOnHand,
    quantityAllocated,
    quantityAvailable,
    lotCount: Math.max(0, Math.trunc(asNumber(lots?.lotCount ?? 0))),
    lastReceiptDate: asDateString(lots?.lastReceiptDate ?? null),
  };

  logger.debug('Inventory snapshot prepared', {
    quantityOnHand: snapshot.quantityOnHand,
    quantityAllocated: snapshot.quantityAllocated,
    lotCount: snapshot.lotCount,
  });

  return snapshot;
}
