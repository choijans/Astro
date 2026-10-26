import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { FixtureAstroClient } from '../astro/fixture-astro-client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';

/**
 * Prepares the dedicated astro_test database: creates/migrates it, then seeds
 * it from the committed fixture through the exact same SyncService used for
 * real seeding. Run before the Supertest suite, never against the dev database.
 */
function assertTargetsTestDatabase(databaseUrl: string | undefined): asserts databaseUrl is string {
  if (!databaseUrl || !databaseUrl.includes('/astro_test')) {
    throw new Error(
      `Refusing to prepare a test database: DATABASE_URL must point at "astro_test", got: ${databaseUrl}`,
    );
  }
}

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.test'), override: true });
  assertTargetsTestDatabase(process.env.DATABASE_URL);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
