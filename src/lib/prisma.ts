import { PrismaClient } from '@prisma/client';

import { logger } from './logger.js';

const connectionString = process.env.DATABASE_URL;

if (connectionString) {
  logger.info('Prisma database connection string resolved', {
    connectionString,
  });
} else {
  logger.warn('DATABASE_URL is not defined; Prisma will use default configuration');
}

type PrismaQueryEvent = {
  query: string;
  params: string;
  duration: number;
  target: string;
};

type PrismaLogEvent = {
  message: string;
  target: string;
};

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ??
  new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

prisma.$on('query', (event: PrismaQueryEvent) => {
  logger.debug('Prisma query executed', {
    query: event.query.slice(0, 200),
    params: event.params.slice(0, 200),
    duration: event.duration,
    target: event.target,
  });
});

prisma.$on('warn', (event: PrismaLogEvent) => {
  logger.warn('Prisma client warning', {
    message: event.message,
    target: event.target,
  });
});

prisma.$on('error', (event: PrismaLogEvent) => {
  logger.error('Prisma client error', {
    message: event.message,
    target: event.target,
  });
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
