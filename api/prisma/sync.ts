import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';

import { summarizeConnectionString } from '../../src/lib/connectionString.js';
import { logger, serializeError } from '../../src/lib/logger.js';

const EXECUTABLE = 'npx';
const PRISMA_COMMAND = 'prisma';
const PRISMA_DB_PULL_ARGS = ['db', 'pull'];
const PRISMA_GENERATE_ARGS = ['generate'];

type PrismaStepResult = {
  step: string;
  stdout: string;
  stderr: string;
};

let prismaSyncInProgress = false;

async function runPrismaCommand(args: string[], step: string): Promise<PrismaStepResult> {
  logger.info('Starting Prisma command from Vercel function', { step, args });

  const homeDir = process.env.HOME ?? '/tmp';
  const npmCacheDir = process.env.NPM_CONFIG_CACHE ?? process.env.npm_config_cache ?? `${homeDir}/.npm`;
  const npmTmpDir = process.env.NPM_CONFIG_TMP ?? process.env.npm_config_tmp ?? `${homeDir}/tmp`;

  await Promise.all([
    mkdir(homeDir, { recursive: true }).catch(() => undefined),
    mkdir(npmCacheDir, { recursive: true }).catch(() => undefined),
    mkdir(npmTmpDir, { recursive: true }).catch(() => undefined),
  ]);

  const env = {
    ...process.env,
    HOME: homeDir,
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_cache: npmCacheDir,
    NPM_CONFIG_TMP: npmTmpDir,
    npm_config_tmp: npmTmpDir,
  };

  return await new Promise<PrismaStepResult>((resolve, reject) => {
    const child = spawn(EXECUTABLE, [PRISMA_COMMAND, ...args], {
      env,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      logger.error('Failed to start Prisma command from Vercel function', {
        step,
        error: serializeError(error),
      });
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        logger.info('Prisma command completed from Vercel function', { step });
        resolve({ step, stdout, stderr });
        return;
      }

      const commandError = new Error(`Prisma ${step} exited with code ${code ?? 'null'}`);
      logger.error('Prisma command failed from Vercel function', {
        step,
        code,
        stdout: stdout.slice(-1000),
        stderr: stderr.slice(-1000),
      });
      reject(commandError);
    });
  });
}

async function performPrismaSync() {
  const results: PrismaStepResult[] = [];

  results.push(await runPrismaCommand(PRISMA_DB_PULL_ARGS, 'schema introspection'));
  results.push(await runPrismaCommand(PRISMA_GENERATE_ARGS, 'client generation'));

  return results;
}

export default async function handler(req: any, res: any) {
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (method === 'GET') {
    res.status(200).json({ message: 'Prisma sync endpoint ready. Use POST to trigger synchronization.' });
    return;
  }

  if (method !== 'POST') {
    logger.warn('Unsupported method for Prisma sync endpoint', { method });
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  logger.info('Incoming Prisma schema sync request (Vercel function)');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('DATABASE_URL environment variable is not configured for Prisma sync request');
    res.status(500).json({ error: 'DATABASE_URL is not configured on the server.' });
    return;
  }

  logger.info('Prisma sync will use configured database connection string', summarizeConnectionString(databaseUrl));

  if (prismaSyncInProgress) {
    logger.warn('Prisma schema sync request rejected because another sync is running');
    res.status(409).json({ error: 'A Prisma synchronization is already in progress.' });
    return;
  }

  prismaSyncInProgress = true;

  try {
    const steps = await performPrismaSync();
    const responseSteps = steps.map(({ step, stdout, stderr }) => ({
      step,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));

    logger.info('Prisma schema sync completed successfully from Vercel function', {
      stepCount: responseSteps.length,
    });

    res.status(200).json({
      message: 'Prisma schema synchronized successfully.',
      steps: responseSteps,
    });
  } catch (error) {
    logger.error('Prisma schema sync failed from Vercel function', {
      error: serializeError(error),
    });
    res.status(500).json({ error: 'Failed to synchronize Prisma schema.' });
  } finally {
    prismaSyncInProgress = false;
  }
}
