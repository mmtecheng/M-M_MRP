import os from 'node:os';
import process from 'node:process';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue };

type LogContext = Record<string, unknown>;

const SERVICE_NAME = process.env.VERCEL_SERVICE_NAME ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'mm-mrp-service';
const ENVIRONMENT = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
const HOSTNAME = os.hostname();

function serializeValue(value: unknown): LogValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? '',
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue) as LogValue[];
  }

  if (typeof value === 'object') {
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, serializeValue(nestedValue)]),
      );
    } catch (error) {
      return {
        message: 'Failed to serialize context object',
        error: serializeValue(error),
      };
    }
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return { message: 'Unsupported log value type', type: typeof value };
}

function serializeContext(context?: LogContext) {
  if (!context) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, serializeValue(value)]),
  );
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE_NAME,
    environment: ENVIRONMENT,
    hostname: HOSTNAME,
    context: serializeContext(context),
  };

  const payload = JSON.stringify(entry);

  switch (level) {
    case 'debug':
      console.debug(payload);
      break;
    case 'info':
      console.info(payload);
      break;
    case 'warn':
      console.warn(payload);
      break;
    case 'error':
    default:
      console.error(payload);
      break;
  }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit('debug', message, context);
  },
  info(message: string, context?: LogContext) {
    emit('info', message, context);
  },
  warn(message: string, context?: LogContext) {
    emit('warn', message, context);
  },
  error(message: string, context?: LogContext) {
    emit('error', message, context);
  },
};

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? '',
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error === 'object' && error !== null) {
    return Object.fromEntries(
      Object.entries(error as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, serializeValue(value)]),
    );
  }

  return { message: String(error) };
}
