import { Prisma } from '@prisma/client';

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
  ComponentLocationCode: string | null;
  ComponentLocationDescription: string | null;
  AvailableQuantity: Prisma.Decimal | number | string | null;
};

export type BomOverviewRow = {
  assembly: string;
  assemblyDescription: string;
  component: string;
  componentDescription: string;
  componentLocation: string;
  availableQuantity: number | null;
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

function coerceNumber(value: unknown): number | null {
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

  if (value instanceof Prisma.Decimal) {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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
  const locationDescription = normalize(record.ComponentLocationDescription).trim();
  const locationCode = normalize(record.ComponentLocationCode).trim();
  const availableQuantity = coerceNumber(record.AvailableQuantity);

  return {
    assembly: normalize(record.Assembly).trim(),
    assemblyDescription: normalize(record.AssemblyDescription).trim(),
    component: normalize(record.Component).trim(),
    componentDescription: normalize(record.ComponentDescription).trim(),
    componentLocation: locationDescription.length > 0 ? locationDescription : locationCode,
    availableQuantity: typeof availableQuantity === 'number' ? availableQuantity : null,
    quantityPer: typeof record.QuantityPer === 'number' && Number.isFinite(record.QuantityPer)
      ? record.QuantityPer
      : null,
    effectiveDate: coerceDate(record.EffectiveDate),
    obsoleteDate: coerceDate(record.ObsoleteDate),
    notes: normalize(record.Notes).trim(),
  };
}

type BomQueryOptions = {
  limit?: number;
  assembly?: string;
};

export async function getBillOfMaterials(options: BomQueryOptions = {}): Promise<BomOverviewRow[]> {
  const sanitizedAssembly = typeof options.assembly === 'string' ? options.assembly.trim() : '';
  const requestedLimit = options.limit;
  const defaultLimit = sanitizedAssembly.length > 0 ? 200 : 100;
  const safeLimit =
    Number.isFinite(requestedLimit) && (requestedLimit as number) > 0
      ? Math.min(Math.trunc(requestedLimit as number), 200)
      : defaultLimit;

  logger.debug('Fetching bill of materials overview', {
    limit: safeLimit,
    assembly: sanitizedAssembly || undefined,
  });

  const bomRows = await prisma.bom.findMany({
    where: sanitizedAssembly.length > 0 ? { Assembly: sanitizedAssembly } : undefined,
    include: {
      assembly_partmaster: { select: { DescText: true } },
      partmaster_bom_ComponentTopartmaster: { select: { DescText: true, LocationCode: true } },
    },
    take: safeLimit,
  });

  const componentPartNumbers = Array.from(
    new Set(
      bomRows
        .map((entry) => normalize(entry.Component).trim())
        .filter((component) => component.length > 0),
    ),
  );

  const componentLocations = Array.from(
    new Set(
      bomRows
        .map((entry) => normalize(entry.partmaster_bom_ComponentTopartmaster?.LocationCode).trim())
        .filter((location) => location.length > 0),
    ),
  );

  const [onHand, allocated, locations] = await Promise.all([
    componentPartNumbers.length
      ? prisma.inventorylots.groupBy({
          by: ['PartNumber'],
          where: { PartNumber: { in: componentPartNumbers } },
          _sum: { Quantity: true },
        })
      : Promise.resolve([]),
    componentPartNumbers.length
      ? prisma.inventorytags.groupBy({
          by: ['PartNumber'],
          where: { PartNumber: { in: componentPartNumbers }, InventoryQuantity: { not: null } },
          _sum: { InventoryQuantity: true },
        })
      : Promise.resolve([]),
    componentLocations.length
      ? prisma.stocklocations.findMany({
          where: { LocationCode: { in: componentLocations } },
          select: { LocationCode: true, DescText: true },
        })
      : Promise.resolve([]),
  ]);

  const onHandMap = new Map<string, number>();
  onHand.forEach((entry) => {
    const quantity = coerceNumber(entry._sum?.Quantity);
    const partNumber = normalize(entry.PartNumber).trim();

    if (typeof quantity === 'number' && partNumber.length > 0) {
      onHandMap.set(partNumber, quantity);
    }
  });

  const allocatedMap = new Map<string, number>();
  allocated.forEach((entry) => {
    const quantity = coerceNumber(entry._sum?.InventoryQuantity);
    const partNumber = normalize(entry.PartNumber).trim();

    if (typeof quantity === 'number' && partNumber.length > 0) {
      allocatedMap.set(partNumber, quantity);
    }
  });

  const locationMap = new Map<string, string>();
  locations.forEach((entry) => {
    const description = normalize(entry.DescText).trim();
    if (description.length > 0) {
      locationMap.set(entry.LocationCode, description);
    }
  });

  const sortedRows = [...bomRows].sort((a, b) => {
    const assemblyComparison = normalize(a.Assembly).localeCompare(normalize(b.Assembly));
    if (assemblyComparison !== 0) {
      return assemblyComparison;
    }

    const seqA = coerceNumber(a.ItemSequence);
    const seqB = coerceNumber(b.ItemSequence);

    if (seqA !== null && seqB !== null && seqA !== seqB) {
      return seqA - seqB;
    }

    return normalize(a.Component).localeCompare(normalize(b.Component));
  });

  return sortedRows.map((record) => {
    const component = normalize(record.Component).trim();
    const onHandQuantity = onHandMap.get(component) ?? 0;
    const allocatedQuantity = allocatedMap.get(component) ?? 0;
    const availableQuantity = Math.max(onHandQuantity - allocatedQuantity, 0);
    const locationCode = normalize(record.partmaster_bom_ComponentTopartmaster?.LocationCode).trim();
    const locationDescription = locationCode.length > 0 ? locationMap.get(locationCode) ?? '' : '';

    return mapRecord({
      Assembly: record.Assembly,
      AssemblyDescription: record.assembly_partmaster?.DescText ?? null,
      Component: record.Component,
      ComponentDescription: record.partmaster_bom_ComponentTopartmaster?.DescText ?? null,
      ItemSequence: record.ItemSequence ?? null,
      QuantityPer: record.QuantityPer ?? null,
      EffectiveDate: record.EffectiveDate ?? null,
      ObsoleteDate: record.ObsoleteDate ?? null,
      Notes: record.Notes ?? null,
      ComponentLocationCode: locationCode || null,
      ComponentLocationDescription: locationDescription || null,
      AvailableQuantity: availableQuantity,
    });
  });
}
