import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import IORedis from 'ioredis';
import { FixtureAstroClient } from '../astro/fixture-astro-client';
import { PrismaService } from '../prisma/prisma.service';
import { assertUsesTestQueue, buildQueueConnectionOptions, getQueueName } from '../queue/queue.config';
import { SyncService } from '../sync/sync.service';

/**
 * Prepares the dedicated astro_test database and the dedicated test Redis
 * database/queue: migrates and seeds Postgres from the committed fixture
 * through the exact same SyncService used for real seeding, then flushes the
 * test Redis database. Redis isn't reset between individual test files the
 * way Postgres is (each file's beforeEach only clears Postgres rows), so a
 * previous run's leftover BullMQ jobs would otherwise be picked up by a later
 * run's worker against commands that no longer exist. Run before the
 * Supertest suite, never against dev.
 */
function assertTargetsTestDatabase(databaseUrl: string | undefined): asserts databaseUrl is string {
  if (!databaseUrl || !databaseUrl.includes('/astro_test')) {
    throw new Error(
      `Refusing to prepare a test database: DATABASE_URL must point at "astro_test", got: ${databaseUrl}`,
    );
  }
}

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.test'), override: true, quiet: true });
  assertTargetsTestDatabase(process.env.DATABASE_URL);
  assertUsesTestQueue();

  console.log(`Preparing test database: ${process.env.DATABASE_URL}`);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });

  const prisma = new PrismaService();
  const syncService = new SyncService(new FixtureAstroClient(), prisma);
  const result = await syncService.upsertAll();
  await prisma.$disconnect();

  if (!result.ok) {
    throw new Error(`Failed to seed test database: ${result.error}`);
  }

  console.log(`Test database ready with ${result.upserted} channels.`);

  console.log(`Flushing test Redis database for queue "${getQueueName()}"`);
  const redis = new IORedis(buildQueueConnectionOptions());
  await redis.flushdb();
  await redis.quit();
  console.log('Test Redis database flushed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
