import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { summarizeConnectionString } from './connectionString.js';
import { logger } from './logger.js';

const connectionString = process.env.DATABASE_URL;

if (connectionString) {
  logger.info('Prisma database connection string resolved', summarizeConnectionString(connectionString));
} else {
  logger.warn('DATABASE_URL is not defined; Prisma will use default configuration');
}

const prismaLogLevels: Prisma.LogLevel[] = ['query', 'error', 'warn'];

declare global {
  var prisma: PrismaClient | undefined;
}

const prismaClient =
  global.prisma ??
  new PrismaClient({
    log: prismaLogLevels,
  });

export const prisma =
  prismaClient as PrismaClient<
    Prisma.PrismaClientOptions,
    'query' | 'warn' | 'error'
  >;

prisma.$on('query', (event: Prisma.QueryEvent) => {
  logger.info('Prisma database query executed', {
    query: event.query.slice(0, 200),
    params: event.params.slice(0, 200),
    duration: event.duration,
    target: event.target,
  });
});

prisma.$on('warn', (event: Prisma.LogEvent) => {
  logger.warn('Prisma client warning', {
    message: event.message,
    target: event.target,
  });
});

prisma.$on('error', (event: Prisma.LogEvent) => {
  logger.error('Prisma client error', {
    message: event.message,
    target: event.target,
  });
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
