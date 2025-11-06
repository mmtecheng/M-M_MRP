import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { logger, serializeError } from '../lib/logger.js';

const PRISMA_COMMAND = 'prisma';
const PRISMA_DB_PULL_ARGS = ['db', 'pull'];
const PRISMA_GENERATE_ARGS = ['generate'];
const EXECUTABLE = 'npx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'prisma', 'schema.prisma');

type SchemaSnapshot = {
  readonly exists: boolean;
  readonly hash: string | null;
  readonly modelNames: string[];
};

async function loadSchemaSnapshot(): Promise<SchemaSnapshot> {
  if (!existsSync(SCHEMA_PATH)) {
    return { exists: false, hash: null, modelNames: [] };
  }

  const contents = await readFile(SCHEMA_PATH, 'utf-8');
  const hash = createHash('sha256').update(contents).digest('hex');
  const modelNames = Array.from(contents.matchAll(/^model\s+(\w+)/gm), (match) => match[1]).sort();

  return { exists: true, hash, modelNames };
}

function summarizeSchemaChange(before: SchemaSnapshot, after: SchemaSnapshot) {
  const schemaRelativePath = relative(PROJECT_ROOT, SCHEMA_PATH);

  if (!after.exists) {
    logger.warn('Prisma introspection completed but no schema.prisma file was found afterwards.', {
      schemaPath: schemaRelativePath,
    });
    return;
  }

  if (!before.exists) {
    logger.info('Prisma introspection created a new schema.prisma file.', {
      schemaPath: schemaRelativePath,
      modelCount: after.modelNames.length,
      models: after.modelNames,
    });
    return;
  }

  if (before.hash === after.hash) {
    logger.info('Prisma introspection reported no schema changes.', {
      schemaPath: schemaRelativePath,
      modelCount: after.modelNames.length,
    });
    return;
  }

  const addedModels = after.modelNames.filter((name) => !before.modelNames.includes(name));
  const removedModels = before.modelNames.filter((name) => !after.modelNames.includes(name));

  logger.info('Prisma introspection updated schema.prisma.', {
    schemaPath: schemaRelativePath,
    modelCount: after.modelNames.length,
    addedModels,
    removedModels,
  });
}

type PrismaModule = {
  Prisma?: {
    ModelName?: Record<string, string>;
    dmmf?: {
      datamodel?: {
        models?: Array<{ name: string }>;
      };
    };
  };
};

async function verifyGeneratedClient(schemaModelNames: string[]) {
  try {
    const prismaModule = (await import('@prisma/client')) as PrismaModule;
    const modelEnum = prismaModule.Prisma?.ModelName ?? {};
    const dmmfModels = prismaModule.Prisma?.dmmf?.datamodel?.models ?? [];
    const clientModels = Object.values(modelEnum);
    const fallbackModels = dmmfModels.map((model) => model.name);
    const generatedModels = clientModels.length > 0 ? clientModels : fallbackModels;

    const missingModels = schemaModelNames.filter((name) => !generatedModels.includes(name));
    const extraModels = generatedModels.filter((name) => !schemaModelNames.includes(name));

    logger.info('Verified generated Prisma client can be imported.', {
      generatedModelCount: generatedModels.length,
      generatedModels,
      missingModels,
      extraModels,
    });

    if (missingModels.length > 0 || extraModels.length > 0) {
      logger.warn('Discrepancies detected between schema.prisma models and generated client.', {
        missingModels,
        extraModels,
      });
    }
  } catch (error) {
    logger.error('Unable to import generated Prisma client after running prisma generate.', {
      error: serializeError(error),
    });
    throw error;
  }
}

async function runCommand(args: string[], step: string) {
  logger.info(`Starting Prisma ${step}`, { args });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(EXECUTABLE, [PRISMA_COMMAND, ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Prisma ${step} exited with code ${code}`));
      }
    });
  });

  logger.info(`Completed Prisma ${step}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is not set. Prisma introspection requires a database connection string.');
    process.exitCode = 1;
    return;
  }

  const schemaBefore = await loadSchemaSnapshot();

  try {
    await runCommand(PRISMA_DB_PULL_ARGS, 'schema introspection');
    const schemaAfter = await loadSchemaSnapshot();
    summarizeSchemaChange(schemaBefore, schemaAfter);

    await runCommand(PRISMA_GENERATE_ARGS, 'client generation');

    await verifyGeneratedClient(schemaAfter.modelNames);

    logger.info('Prisma schema synchronization finished successfully.');
  } catch (error) {
    logger.error('Failed to synchronize Prisma schema', { error: serializeError(error) });
    process.exitCode = 1;
  }
}

void main();
