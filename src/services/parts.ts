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
  hasBom: boolean;
};

export type PartAttributeDefinition = {
  attributeId: number;
  code: string;
  dataType: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  requiredRule: string | null;
};

export type PartTypeDefinition = {
  id: number;
  code: string;
  sheetName: string;
  packageColumn: string;
  packageOptions: PackageOption[];
  attributes: PartAttributeDefinition[];
};

export type PartDetail = {
  partNumber: string;
  description: string;
  revision: string;
  stockUom: string;
  status: string;
  partTypeId: number | null;
  attributes: { attributeId: number; code: string; value: string; required: boolean; requiredRule: string | null }[];
};

type PackageMasterColumn =
  | 'resistors'
  | 'capacitors'
  | 'inductors_magnetic_components'
  | 'diodes'
  | 'leds_optoelectronics'
  | 'transistors'
  | 'linear_ics'
  | 'power_ics'
  | 'logic_ics'
  | 'interface_communication_ics'
  | 'memory_devices'
  | 'microcontrollers_mcus'
  | 'microprocessors_mpus'
  | 'dsps_fpgas_asics_socs'
  | 'sensors_environmental'
  | 'sensors_motion_position'
  | 'sensors_electrical'
  | 'sensors_force_flow_specialized'
  | 'electromechanical_relays'
  | 'switches'
  | 'connectors_board_level'
  | 'connectors_wire_level'
  | 'connectors_i_o'
  | 'wire_cable'
  | 'cable_assemblies'
  | 'fuses_protection'
  | 'batteries'
  | 'battery_holders_accessories'
  | 'power_modules_supplies'
  | 'fans_blowers'
  | 'fan_accessories'
  | 'heat_management'
  | 'crystals_oscillators'
  | 'antennas'
  | 'rf_modules'
  | 'audio_components'
  | 'displays'
  | 'pcbs_bare_boards'
  | 'pcb_assemblies_dev_boards'
  | 'mechanical_hardware'
  | 'enclosures'
  | 'labels_markers'
  | 'tools'
  | 'cleaning_chemicals'
  | 'motors_actuators'
  | 'light_sources';

export type PackageOption = {
  id: number;
  name: string;
};

const PACKAGE_MASTER_COLUMNS: PackageMasterColumn[] = [
  'resistors',
  'capacitors',
  'inductors_magnetic_components',
  'diodes',
  'leds_optoelectronics',
  'transistors',
  'linear_ics',
  'power_ics',
  'logic_ics',
  'interface_communication_ics',
  'memory_devices',
  'microcontrollers_mcus',
  'microprocessors_mpus',
  'dsps_fpgas_asics_socs',
  'sensors_environmental',
  'sensors_motion_position',
  'sensors_electrical',
  'sensors_force_flow_specialized',
  'electromechanical_relays',
  'switches',
  'connectors_board_level',
  'connectors_wire_level',
  'connectors_i_o',
  'wire_cable',
  'cable_assemblies',
  'fuses_protection',
  'batteries',
  'battery_holders_accessories',
  'power_modules_supplies',
  'fans_blowers',
  'fan_accessories',
  'heat_management',
  'crystals_oscillators',
  'antennas',
  'rf_modules',
  'audio_components',
  'displays',
  'pcbs_bare_boards',
  'pcb_assemblies_dev_boards',
  'mechanical_hardware',
  'enclosures',
  'labels_markers',
  'tools',
  'cleaning_chemicals',
  'motors_actuators',
  'light_sources',
];

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
  const hasBomRaw = record['hasBom'];
  const hasBom = (() => {
    if (typeof hasBomRaw === 'boolean') {
      return hasBomRaw;
    }

    if (typeof hasBomRaw === 'number') {
      return hasBomRaw > 0;
    }

    if (typeof hasBomRaw === 'bigint') {
      return hasBomRaw > 0;
    }

    if (typeof hasBomRaw === 'string') {
      const normalized = hasBomRaw.trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
    }

    return false;
  })();

  return {
    partNumber,
    description,
    revision,
    availableQuantity,
    location: locationLabel.length > 0 ? locationLabel : locationCode,
    stockUom,
    status,
    hasBom,
  };
}

function normalizeAttributeCode(code: unknown): string {
  return normalizeString(code).toLowerCase().replace(/_\d+$/, '');
}

function evaluateRequirement(rule: unknown, subtypeValue: string): { required: boolean; visible: boolean } {
  const normalizedRule = typeof rule === 'string' ? rule.trim().toLowerCase() : '';

  if (!normalizedRule) {
    return { required: false, visible: true };
  }

  if (normalizedRule === 'yes') {
    return { required: true, visible: true };
  }

  if (normalizedRule === 'no') {
    return { required: false, visible: true };
  }

  const matches = Array.from(normalizedRule.matchAll(/'([^']+)'/g)).map((match) => match[1]?.trim().toLowerCase());
  const normalizedSubtype = subtypeValue.trim().toLowerCase();

  if (matches.length > 0 && normalizedSubtype) {
    const hasMatch = matches.some((entry) => entry === normalizedSubtype);
    return { required: hasMatch, visible: hasMatch };
  }

  return { required: false, visible: true };
}

function toNullableNumber(value: unknown): number | null {
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

function normalizeIdentifier(value: unknown): string {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function resolvePackageColumn(partType: { packageColumn?: string | null; code?: string | null }): PackageMasterColumn | null {
  const candidates = [normalizeIdentifier(partType.packageColumn), normalizeIdentifier(partType.code)];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const match = PACKAGE_MASTER_COLUMNS.find((column) => column.toLowerCase() === candidate);
    if (match) {
      return match;
    }
  }

  return null;
}

async function listPackageOptions(partType: { packageColumn?: string | null; code?: string | null }): Promise<PackageOption[]> {
  const column = resolvePackageColumn(partType);

  if (!column) {
    return [];
  }

  try {
    const packages = await prisma.$queryRaw<{ package_id: number; package_name: string }[]>(Prisma.sql`
      SELECT package_id, package_name
      FROM package_master
      WHERE ${Prisma.raw(`\`${column}\``)} = TRUE
      ORDER BY package_name ASC
    `);

    return packages
      .map((entry) => ({ id: asNumber(entry.package_id), name: normalizeString(entry.package_name) }))
      .filter((entry) => entry.id > 0 && entry.name.length > 0);
  } catch (error) {
    logger.error('Failed to load package options for part type', {
      partTypeCode: partType.code,
      packageColumn: partType.packageColumn,
      error,
    });

    return [];
  }
}

function findSubtypeValue(
  attributes: { attributeId: number; value: string }[],
  definitions: Map<number, PartAttributeDefinition>,
): string {
  for (const definition of definitions.values()) {
    if (normalizeAttributeCode(definition.code) !== 'subtype') {
      continue;
    }

    const match = attributes.find((entry) => entry.attributeId === definition.attributeId);
    if (match && typeof match.value === 'string') {
      return match.value.trim();
    }
  }

  return '';
}

type AttributeConstraint =
  | { kind: 'enum'; options: string[] }
  | { kind: 'int' }
  | { kind: 'double' }
  | { kind: 'text' };

function parseAttributeConstraint(dataType: string | null): AttributeConstraint {
  if (!dataType) {
    return { kind: 'text' };
  }

  const enumMatch = dataType.match(/^enum\s*\((.*)\)$/i);

  if (enumMatch) {
    const options = Array.from(enumMatch[1].matchAll(/'([^']+)'/g)).map((match) => match[1]?.trim()).filter(Boolean) as string[];
    return { kind: 'enum', options };
  }

  if (/^int\b/i.test(dataType)) {
    return { kind: 'int' };
  }

  if (/^double\b/i.test(dataType)) {
    return { kind: 'double' };
  }

  return { kind: 'text' };
}

function validateAttributeValue(definition: PartAttributeDefinition, rawValue: unknown): string {
  const value = toSafeString(rawValue);

  if (!value) {
    return '';
  }

  const constraint = parseAttributeConstraint(definition.dataType);
  const label = definition.code || `Attribute ${definition.attributeId}`;
  const min = definition.minValue;
  const max = definition.maxValue;

  if (constraint.kind === 'enum') {
    if (constraint.options.length > 0) {
      const matches = constraint.options.some((option) => option.toLowerCase() === value.toLowerCase());
      if (!matches) {
        throw new Error(`"${label}" must be one of: ${constraint.options.join(', ')}`);
      }
    }

    return value;
  }

  if (constraint.kind === 'int') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      throw new Error(`"${label}" must be a whole number.`);
    }

    if (min !== null && parsed < min) {
      throw new Error(`"${label}" must be greater than or equal to ${min}.`);
    }

    if (max !== null && parsed > max) {
      throw new Error(`"${label}" must be less than or equal to ${max}.`);
    }

    return parsed.toString();
  }

  if (constraint.kind === 'double') {
    const parsed = Number.parseFloat(value);

    if (Number.isNaN(parsed)) {
      throw new Error(`"${label}" must be a number.`);
    }

    if (min !== null && parsed < min) {
      throw new Error(`"${label}" must be greater than or equal to ${min}.`);
    }

    if (max !== null && parsed > max) {
      throw new Error(`"${label}" must be less than or equal to ${max}.`);
    }

    return parsed.toString();
  }

  return value;
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
      EXISTS (SELECT 1 FROM bom b WHERE b.Assembly = pm.PartNumber LIMIT 1) AS hasBom,
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

  const withPackages = await Promise.all(
    partTypes.map(async (entry) => ({
      id: entry.part_type_id,
      code: entry.code,
      sheetName: entry.sheet_name,
      packageColumn: entry.package_column,
      packageOptions: await listPackageOptions({ packageColumn: entry.package_column, code: entry.code }),
      attributes: entry.attribute_part_type_map
        .filter((mapping) => Boolean(mapping.attribute))
        .map((mapping) => ({
          attributeId: mapping.attribute_ID,
          code: mapping.attribute?.attribute_code ?? String(mapping.attribute_ID),
          dataType: mapping.attribute?.data_type ?? null,
          minValue: toNullableNumber(mapping.attribute?.min_value),
          maxValue: toNullableNumber(mapping.attribute?.max_value),
          unit: mapping.attribute?.unit ?? null,
          requiredRule: mapping.attribute?.required_rule ?? null,
        })),
    })),
  );

  return withPackages;
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

  const attributeDetails = (part.part_data ?? []).map((entry) => ({
    attributeId: entry.attribute_ID,
    code: normalizeString(entry.attribute?.attribute_code) || String(entry.attribute_ID),
    value: normalizeString(entry.part_data),
    requiredRule: entry.attribute?.required_rule ?? null,
  }));

  const subtypeValue =
    attributeDetails.find((attribute) => normalizeAttributeCode(attribute.code) === 'subtype')?.value ?? '';

  const attributes = attributeDetails.map((entry) => ({
    ...entry,
    required: evaluateRequirement(entry.requiredRule, subtypeValue).required,
  }));

  return {
    partNumber: part.PartNumber,
    description: normalizeString(part.DescText),
    revision: normalizeString(part.Revision),
    stockUom: normalizeString(part.StockUOM),
    status: normalizeString(part.ISC),
    partTypeId: typeof part.part_type_ID === 'number' ? part.part_type_ID : null,
    attributes,
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
      dataType: mapping.attribute?.data_type ?? null,
      minValue: toNullableNumber(mapping.attribute?.min_value),
      maxValue: toNullableNumber(mapping.attribute?.max_value),
      unit: mapping.attribute?.unit ?? null,
      requiredRule: mapping.attribute?.required_rule ?? null,
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
    .map((item) => {
      const attributeId = Number.parseInt(String(item.attributeId), 10);
      const definition = definitions.get(attributeId);

      if (!Number.isFinite(attributeId) || !allowedIds.has(attributeId) || !definition) {
        return null;
      }

      const value = validateAttributeValue(definition, item.value);
      return { attributeId, value };
    })
    .filter((item): item is { attributeId: number; value: string } => Boolean(item));
}

function assertRequiredAttributes(
  attributes: { attributeId: number; value: string }[],
  definitions: Map<number, PartAttributeDefinition>,
): void {
  const subtypeValue = findSubtypeValue(attributes, definitions);
  const missingRequired: string[] = [];

  for (const definition of definitions.values()) {
    const requirement = evaluateRequirement(definition.requiredRule, subtypeValue);
    if (!requirement.required) continue;

    const match = attributes.find((entry) => entry.attributeId === definition.attributeId);
    if (!match || match.value.trim().length === 0) {
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
