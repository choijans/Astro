import 'dotenv/config';
import { FixtureAstroClient } from '../src/astro/fixture-astro-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { SyncService } from '../src/sync/sync.service';

/**
 * Seeds the database from the committed Astro response fixture, through the
 * exact same mapper and upsert code the live `npm run sync` uses.
 */
async function main(): Promise<void> {
  const prisma = new PrismaService();
  const syncService = new SyncService(new FixtureAstroClient(), prisma);

  const result = await syncService.upsertAll();
  await prisma.$disconnect();

  if (!result.ok) {
    console.error('Seed failed:', result.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Seed upserted ${result.upserted} channels.`);
}

main();
