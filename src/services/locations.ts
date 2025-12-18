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
    WITH rooms AS (
      SELECT
        sl.DepartmentCode,
        '' AS DepartmentDescription
      FROM stocklocations sl
      WHERE sl.DepartmentCode IS NOT NULL
        AND LENGTH(TRIM(sl.DepartmentCode)) > 0
      GROUP BY sl.DepartmentCode
    ),
    locations AS (
      SELECT
        sl.DepartmentCode,
        sl.LocationCode,
        MAX(NULLIF(TRIM(sl.DescText), '')) AS LocationDescription
      FROM stocklocations sl
      WHERE sl.DepartmentCode IS NOT NULL
        AND LENGTH(TRIM(sl.DepartmentCode)) > 0
        AND sl.LocationCode IS NOT NULL
        AND LENGTH(TRIM(sl.LocationCode)) > 0
      GROUP BY sl.DepartmentCode, sl.LocationCode
    )
    SELECT
      r.DepartmentCode,
      l.LocationCode,
      l.LocationDescription,
      r.DepartmentDescription
    FROM rooms r
    LEFT JOIN locations l
      ON l.DepartmentCode = r.DepartmentCode
    ORDER BY r.DepartmentCode ASC, l.LocationCode ASC
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
    .filter((entry) => entry.roomCode.length > 0);
}
