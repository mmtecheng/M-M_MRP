import { spawn } from 'node:child_process';
import process from 'node:process';

import { logger, serializeError } from '../lib/logger.js';

const PRISMA_COMMAND = 'prisma';
const PRISMA_DB_PULL_ARGS = ['db', 'pull'];
const PRISMA_GENERATE_ARGS = ['generate'];
const EXECUTABLE = 'npx';

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

  try {
    await runCommand(PRISMA_DB_PULL_ARGS, 'schema introspection');
    await runCommand(PRISMA_GENERATE_ARGS, 'client generation');

    logger.info('Prisma schema synchronization finished successfully.');
  } catch (error) {
    logger.error('Failed to synchronize Prisma schema', { error: serializeError(error) });
    process.exitCode = 1;
  }
}

void main();
