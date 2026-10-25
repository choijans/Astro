import { Inject, Injectable, Logger } from '@nestjs/common';
import { ASTRO_CLIENT } from '../astro/astro-client.interface';
import type { IAstroClient } from '../astro/astro-client.interface';
import { mapAstroChannel } from '../astro/astro.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { SyncResult } from './sync-result';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(ASTRO_CLIENT) private readonly astroClient: IAstroClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Idempotent upsert of every channel Astro currently returns. Never deletes a
   * channel that's missing from this response, and never overwrites createdAt.
   * Fails gracefully (logs, returns ok: false) instead of throwing if Astro is down.
   */
  async upsertAll(): Promise<SyncResult> {
    let records;
    try {
      records = await this.astroClient.fetchChannels();
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Astro sync failed: ${message}`);
      return { ok: false, upserted: 0, error: message };
    }

    const syncedAt = new Date();
    const mapped = records.map((record) => mapAstroChannel(record, syncedAt));

    await this.prisma.$transaction(
      mapped.map((channel) =>
        this.prisma.channel.upsert({
          where: { id: channel.id },
          create: channel,
          update: {
            title: channel.title,
            subtitle: channel.subtitle,
            stbNumber: channel.stbNumber,
            imageUrl: channel.imageUrl,
            category: channel.category,
            genres: channel.genres,
            languages: channel.languages,
            rangeKey: channel.rangeKey,
            ranking: channel.ranking,
            schedule: channel.schedule,
            scheduleUpdatedAt: channel.scheduleUpdatedAt,
            // createdAt is intentionally omitted so it's never overwritten.
          },
        }),
      ),
    );

    return { ok: true, upserted: mapped.length };
  }
}
