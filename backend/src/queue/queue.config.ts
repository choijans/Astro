import type { RedisOptions } from 'ioredis';

export const DEV_QUEUE_NAME = 'commands';
export const DEV_REDIS_DB = 0;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_JOB_ATTEMPTS = 6;
const DEFAULT_JOB_BACKOFF_MS = 1000;

export function getQueueName(): string {
  return process.env.QUEUE_NAME ?? DEV_QUEUE_NAME;
}

export function getRedisDb(): number {
  const raw = process.env.REDIS_DB;
  return raw ? Number(raw) : DEV_REDIS_DB;
}

export function getWorkerConcurrency(): number {
  const raw = process.env.WORKER_CONCURRENCY;
  return raw ? Number(raw) : DEFAULT_CONCURRENCY;
}

/** 6 attempts with exponential backoff starting at 1000ms (1, 2, 4, 8, 16s —
 * well over 5s) by default. Overridable so the e2e suite's permanent-failure
 * test doesn't have to wait ~31s for the real production schedule. */
export function getJobAttempts(): number {
  const raw = process.env.COMMAND_JOB_ATTEMPTS;
  return raw ? Number(raw) : DEFAULT_JOB_ATTEMPTS;
}

export function getJobBackoffDelayMs(): number {
  const raw = process.env.COMMAND_JOB_BACKOFF_MS;
  return raw ? Number(raw) : DEFAULT_JOB_BACKOFF_MS;
}

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  return url;
}

function parseRedisUrl(url: string): Pick<RedisOptions, 'host' | 'port' | 'username' | 'password'> {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

/**
 * Producer (Queue) connection, per BullMQ's docs: a low maxRetriesPerRequest
 * so an add() on a down Redis fails fast instead of retrying internally for a
 * long time — CommandsService needs that failure quickly to still return 202
 * with the command left PENDING.
 */
export function buildQueueConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(getRedisUrl()),
    db: getRedisDb(),
    maxRetriesPerRequest: 1,
  };
}

/**
 * Worker (consumer) connection. BullMQ throws on construction unless this is
 * exactly null for a Worker: a worker is meant to keep retrying its Redis
 * connection indefinitely rather than give up.
 */
export function buildWorkerConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(getRedisUrl()),
    db: getRedisDb(),
    maxRetriesPerRequest: null,
  };
}

/**
 * Mirrors the astro_test guard: refuses to run the e2e suite against the dev
 * queue name or dev Redis database, so a stray test run can't interleave with
 * (or flush) whatever's running against the dev queue.
 */
export function assertUsesTestQueue(): void {
  if (getQueueName() === DEV_QUEUE_NAME) {
    throw new Error(
      `Refusing to run e2e tests against the dev queue name "${DEV_QUEUE_NAME}". Set QUEUE_NAME in .env.test.`,
    );
  }
  if (getRedisDb() === DEV_REDIS_DB) {
    throw new Error(
      `Refusing to run e2e tests against the dev Redis database (${DEV_REDIS_DB}). Set REDIS_DB in .env.test (e.g. 1).`,
    );
  }
}
