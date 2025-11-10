import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

type RawBomRecord = {
  Assembly: string | null;
  AssemblyDescription: string | null;
  Component: string | null;
  ComponentDescription: string | null;
  ItemSequence: string | null;
  QuantityPer: number | null;
  EffectiveDate: Date | string | null;
  ObsoleteDate: Date | string | null;
  Notes: string | null;
};

export type BomOverviewRow = {
  assembly: string;
  assemblyDescription: string;
  component: string;
  componentDescription: string;
  sequence: string;
  quantityPer: number | null;
  effectiveDate: string | null;
  obsoleteDate: string | null;
  notes: string;
};

function normalize(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : '';
  }

  return '';
}

function coerceDate(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function mapRecord(record: RawBomRecord): BomOverviewRow {
  return {
    assembly: normalize(record.Assembly).trim(),
    assemblyDescription: normalize(record.AssemblyDescription).trim(),
    component: normalize(record.Component).trim(),
    componentDescription: normalize(record.ComponentDescription).trim(),
    sequence: normalize(record.ItemSequence).trim(),
    quantityPer: typeof record.QuantityPer === 'number' && Number.isFinite(record.QuantityPer)
      ? record.QuantityPer
      : null,
    effectiveDate: coerceDate(record.EffectiveDate),
    obsoleteDate: coerceDate(record.ObsoleteDate),
    notes: normalize(record.Notes).trim(),
  };
}

export async function getBillOfMaterials(limit = 100): Promise<BomOverviewRow[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 200) : 100;

  logger.debug('Fetching bill of materials overview', { limit: safeLimit });

  const records = (await prisma.$queryRaw`
    SELECT
      b.Assembly,
      asm.DescText   AS AssemblyDescription,
      b.Component,
      comp.DescText  AS ComponentDescription,
      b.ItemSequence,
      b.QuantityPer,
      b.EffectiveDate,
      b.ObsoleteDate,
      b.Notes
    FROM bom b
    LEFT JOIN partmaster asm
      ON asm.PartNumber = b.Assembly
    LEFT JOIN partmaster comp
      ON comp.PartNumber = b.Component
    ORDER BY b.Assembly ASC,
      CASE
        WHEN b.ItemSequence REGEXP '^[0-9]+$' THEN CAST(b.ItemSequence AS UNSIGNED)
        ELSE 999999
      END,
      b.Component ASC
    LIMIT ${safeLimit}
  `) as RawBomRecord[];

  return records.map(mapRecord);
}
