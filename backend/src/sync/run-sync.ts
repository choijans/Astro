import 'dotenv/config';
import { HttpAstroClient } from '../astro/astro-client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

/** Entry point for `npm run sync`: pulls fresh data from the live Astro endpoint. */
async function main(): Promise<void> {
  const prisma = new PrismaService();
  const syncService = new SyncService(new HttpAstroClient(), prisma);

  const result = await syncService.upsertAll();
  await prisma.$disconnect();

  if (!result.ok) {
    console.error('Sync failed:', result.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Sync upserted ${result.upserted} channels.`);
}

main();
