import { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type LocationOption = {
  code: string;
  description: string;
  display: string;
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

export async function listLocations(limit = 500): Promise<LocationOption[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 5000) : 500;

  logger.debug('Loading stock locations', { limit: safeLimit });

  const records = await prisma.$queryRaw<{ LocationCode: unknown; Description: unknown }[]>(Prisma.sql`
    SELECT
      LocationCode,
      MAX(NULLIF(TRIM(DescText), '')) AS Description
    FROM stocklocations
    WHERE LocationCode IS NOT NULL AND LENGTH(TRIM(LocationCode)) > 0
    GROUP BY LocationCode
    ORDER BY LocationCode ASC
    LIMIT ${safeLimit}
  `);

  return records
    .map((entry) => {
      const code = normalize(entry.LocationCode);
      const description = normalize(entry.Description);
      const display = description ? `${code} — ${description}` : code;

      return { code, description, display };
    })
    .filter((entry) => entry.code.length > 0);
}
