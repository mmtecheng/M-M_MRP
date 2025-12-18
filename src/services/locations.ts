import { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export type LocationOption = {
  roomCode: string;
  roomDescription: string;
  roomDisplay: string;
  locationCode: string;
  locationDescription: string;
  locationDisplay: string;
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

  const records = await prisma.$queryRaw<
    { DepartmentCode: unknown; LocationCode: unknown; LocationDescription: unknown; DepartmentDescription: unknown }[]
  >(Prisma.sql`
    SELECT
      sl.DepartmentCode,
      sl.LocationCode,
      MAX(NULLIF(TRIM(sl.DescText), '')) AS LocationDescription,
      MAX(NULLIF(TRIM(dc.DescText), '')) AS DepartmentDescription
    FROM stocklocations
    sl
    LEFT JOIN departmentcodes dc
      ON dc.DepartmentCode = sl.DepartmentCode
    WHERE sl.DepartmentCode IS NOT NULL
      AND LENGTH(TRIM(sl.DepartmentCode)) > 0
      AND sl.LocationCode IS NOT NULL
      AND LENGTH(TRIM(sl.LocationCode)) > 0
    GROUP BY sl.DepartmentCode, sl.LocationCode
    ORDER BY sl.DepartmentCode ASC, sl.LocationCode ASC
    LIMIT ${safeLimit}
  `);

  return records
    .map((entry) => {
      const roomCode = normalize(entry.DepartmentCode);
      const locationCode = normalize(entry.LocationCode);
      const roomDescription = normalize(entry.DepartmentDescription);
      const locationDescription = normalize(entry.LocationDescription);
      const roomDisplay = roomDescription ? `${roomCode} — ${roomDescription}` : roomCode;
      const locationDisplay = locationDescription ? `${locationCode} — ${locationDescription}` : locationCode;

      return {
        roomCode,
        roomDescription,
        roomDisplay,
        locationCode,
        locationDescription,
        locationDisplay,
      };
    })
    .filter((entry) => entry.roomCode.length > 0 && entry.locationCode.length > 0);
}
