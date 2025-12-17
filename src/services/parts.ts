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

export type PartAttributeDefinition = {
  attributeId: number;
  code: string;
  required: boolean;
};

export type PartTypeDefinition = {
  id: number;
  code: string;
  sheetName: string;
  packageColumn: string;
  attributes: PartAttributeDefinition[];
};

export type PartDetail = {
  partNumber: string;
  description: string;
  revision: string;
  stockUom: string;
  status: string;
  partTypeId: number | null;
  attributes: { attributeId: number; code: string; value: string; required: boolean }[];
};

export type PartUpsertPayload = {
  partNumber: string;
  description?: string;
  revision?: string;
  stockUom?: string;
  status?: string;
  partTypeId?: number;
  attributes?: { attributeId: number; value: string }[];
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

function isAttributeRequired(rule: unknown): boolean {
  if (rule === null || rule === undefined) {
    return false;
  }

  if (typeof rule === 'string') {
    return rule.trim().length > 0;
  }

  return true;
}

export async function searchParts(options: PartSearchOptions): Promise<PartSearchResult[]> {
  const partNumber = typeof options.partNumber === 'string' ? options.partNumber.trim() : '';
  const description = typeof options.description === 'string' ? options.description.trim() : '';
  const inStockOnly = Boolean(options.inStockOnly);
  const requestedLimit =
    typeof options.limit === 'number' && Number.isFinite(options.limit) ? Math.floor(options.limit) : undefined;

  const whereClauses: Prisma.Sql[] = [];

  if (partNumber.length > 0) {
    const normalizedPart = partNumber.replace(/\s+/g, ' ');
    const lowerPart = normalizedPart.toLowerCase();
    const collapsedPart = lowerPart.replace(/[^a-z0-9]/g, '');
    const prefixWildcard = `${lowerPart}%`;
    const containsWildcard = `%${lowerPart}%`;
    const collapsedWildcard = `%${collapsedPart || lowerPart}%`;

    whereClauses.push(
      Prisma.sql`
        (
          LOWER(pm.PartNumber) LIKE ${prefixWildcard}
          OR LOWER(pm.PartNumber) LIKE ${containsWildcard}
          OR REPLACE(REPLACE(LOWER(pm.PartNumber), '-', ''), ' ', '') LIKE ${collapsedWildcard}
        )
      `,
    );
  }

  if (description.length > 0) {
    const normalizedDescription = description.replace(/\s+/g, ' ');
    const lowerDescription = normalizedDescription.toLowerCase();
    const collapsedDescription = lowerDescription.replace(/[^a-z0-9]/g, '');
    const containsDescription = `%${lowerDescription}%`;
    const collapsedDescriptionWildcard = `%${collapsedDescription || lowerDescription}%`;

    whereClauses.push(
      Prisma.sql`
        (
          LOWER(COALESCE(pm.DescText, '')) LIKE ${containsDescription}
          OR REPLACE(REPLACE(LOWER(COALESCE(pm.DescText, '')), '-', ''), ' ', '') LIKE ${collapsedDescriptionWildcard}
        )
      `,
    );
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

  const limit = typeof requestedLimit === 'number' && requestedLimit > 0 ? requestedLimit : undefined;

  logger.debug('Executing part search query', {
    partNumberLength: partNumber.length,
    descriptionLength: description.length,
    inStockOnly,
    limit,
  });

  const limitClause = typeof limit === 'number' ? Prisma.sql`LIMIT ${limit}` : Prisma.sql``;

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

export async function listPartTypes(): Promise<PartTypeDefinition[]> {
  const partTypes = await prisma.part_type.findMany({
    include: {
      attribute_part_type_map: {
        include: { attribute: true },
      },
    },
    orderBy: { part_type_id: 'asc' },
  });

  return partTypes.map((entry) => ({
    id: entry.part_type_id,
    code: entry.code,
    sheetName: entry.sheet_name,
    packageColumn: entry.package_column,
    attributes: entry.attribute_part_type_map
      .filter((mapping) => Boolean(mapping.attribute))
      .map((mapping) => ({
        attributeId: mapping.attribute_ID,
        code: mapping.attribute?.attribute_code ?? String(mapping.attribute_ID),
        required: isAttributeRequired(mapping.attribute?.required_rule),
      })),
  }));
}

function toSafeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getPartDetail(partNumber: string): Promise<PartDetail | null> {
  const trimmed = toSafeString(partNumber);

  if (!trimmed) {
    return null;
  }

  const part = await prisma.partmaster.findUnique({
    where: { PartNumber: trimmed },
    include: {
      part_type: true,
      part_data: {
        include: {
          attribute: true,
        },
      },
    },
  });

  if (!part) {
    return null;
  }

  return {
    partNumber: part.PartNumber,
    description: part.DescText ?? '',
    revision: part.Revision ?? '',
    stockUom: part.StockUOM ?? '',
    status: part.ISC ?? '',
    partTypeId: part.part_type_ID ?? null,
    attributes: part.part_data.map((entry) => ({
      attributeId: entry.attribute_ID,
      code: entry.attribute?.attribute_code ?? String(entry.attribute_ID),
      value: entry.part_data ?? '',
      required: isAttributeRequired(entry.attribute?.required_rule),
    })),
  };
}

async function resolveAttributeDefinitions(partTypeId: number | undefined): Promise<Map<number, PartAttributeDefinition>> {
  if (typeof partTypeId !== 'number' || !Number.isFinite(partTypeId)) {
    return new Map();
  }

  const mappings = await prisma.attribute_part_type_map.findMany({
    where: { part_type_ID: partTypeId },
    include: { attribute: true },
  });

  const definitions = mappings
    .filter((mapping) => Boolean(mapping.attribute))
    .map((mapping) => ({
      attributeId: mapping.attribute_ID,
      code: mapping.attribute?.attribute_code ?? String(mapping.attribute_ID),
      required: isAttributeRequired(mapping.attribute?.required_rule),
    }));

  return new Map(definitions.map((entry) => [entry.attributeId, entry]));
}

function normalizeAttributes(
  attributes: PartUpsertPayload['attributes'],
  definitions: Map<number, PartAttributeDefinition>,
): { attributeId: number; value: string }[] {
  if (!Array.isArray(attributes)) {
    return [];
  }

  const allowedIds = new Set(definitions.keys());

  return attributes
    .map((item) => ({
      attributeId: Number.parseInt(String(item.attributeId), 10),
      value: toSafeString(item.value),
    }))
    .filter((item) => Number.isFinite(item.attributeId) && allowedIds.has(item.attributeId));
}

function assertRequiredAttributes(
  attributes: { attributeId: number; value: string }[],
  definitions: Map<number, PartAttributeDefinition>,
): void {
  const missingRequired: string[] = [];

  for (const definition of definitions.values()) {
    if (!definition.required) {
      continue;
    }

    const match = attributes.find((entry) => entry.attributeId === definition.attributeId);

    if (!match || match.value.length === 0) {
      missingRequired.push(definition.code);
    }
  }

  if (missingRequired.length > 0) {
    throw new Error(`Missing required attributes: ${missingRequired.join(', ')}`);
  }
}

export async function upsertPart(payload: PartUpsertPayload, allowCreate: boolean): Promise<PartDetail> {
  const partNumber = toSafeString(payload.partNumber);

  if (!partNumber) {
    throw new Error('A part number is required.');
  }

  const existingPart = await prisma.partmaster.findUnique({
    where: { PartNumber: partNumber },
    select: { PartMaster_PKey: true, part_type_ID: true },
  });

  const effectivePartTypeId =
    typeof payload.partTypeId === 'number' && Number.isFinite(payload.partTypeId)
      ? payload.partTypeId
      : existingPart?.part_type_ID;

  if (!effectivePartTypeId) {
    if (!existingPart) {
      throw new Error('A Part Type is required to create a part.');
    }

    throw new Error('A Part Type must be selected before editing this part.');
  }

  const attributeDefinitions = await resolveAttributeDefinitions(effectivePartTypeId);
  const normalizedAttributes = normalizeAttributes(payload.attributes, attributeDefinitions);

  if (attributeDefinitions.size > 0) {
    assertRequiredAttributes(normalizedAttributes, attributeDefinitions);
  }

  const baseData = {
    DescText: toSafeString(payload.description) || null,
    Revision: toSafeString(payload.revision) || null,
    StockUOM: toSafeString(payload.stockUom) || null,
    ISC: toSafeString(payload.status) || null,
    part_type_ID: effectivePartTypeId,
  } satisfies Pick<Prisma.partmasterUncheckedCreateInput, 'DescText' | 'Revision' | 'StockUOM' | 'ISC' | 'part_type_ID'>;

  const updateData: Prisma.partmasterUncheckedUpdateInput = { ...baseData };

  if (!existingPart && !allowCreate) {
    throw new Error('Part does not exist.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const partRecord = existingPart
      ? await tx.partmaster.update({ where: { PartNumber: partNumber }, data: updateData })
      : await tx.partmaster.create({
          data: {
            PartNumber: partNumber,
            DateAdded: new Date(),
            ...baseData,
          } satisfies Prisma.partmasterUncheckedCreateInput,
        });

    const partKey = partRecord.PartMaster_PKey;

    await tx.part_data.deleteMany({ where: { PartMaster_PKey: partKey } });

    if (normalizedAttributes.length > 0) {
      await tx.part_data.createMany({
        data: normalizedAttributes.map((entry) => ({
          PartMaster_PKey: partKey,
          attribute_ID: entry.attributeId,
          part_data: entry.value || null,
        })),
      });
    }

    return partRecord;
  });

  return (await getPartDetail(result.PartNumber)) as PartDetail;
}
