import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Command, Prisma } from '../../../generated/prisma/client';
import { CommandType } from '../../../generated/prisma/client';
import { CachedAstroClient } from '../../astro/cached-astro-client';
import { mapAstroChannel } from '../../astro/astro.mapper';
import { buildChannelDetailCacheKey } from '../../channels/channels-cache-key';
import { CacheService } from '../../common/cache/cache.service';
import { ICommandHandler } from '../command-handler.interface';

@Injectable()
export class RefreshChannelHandler implements ICommandHandler {
  readonly type = CommandType.REFRESH_CHANNEL;

  constructor(
    private readonly cachedAstroClient: CachedAstroClient,
    private readonly cache: CacheService,
  ) {}

  /**
   * Updates only `command.channelId`'s row — never any other channel's, and
   * never `createdAt`. `scheduleUpdatedAt` is the cache snapshot's own fetch
   * time, not "now": several commands sharing one cached fetch must all end
   * up with the exact same scheduleUpdatedAt, not each other's processing time.
   *
   * A channel id absent from Astro's current list is a permanent failure —
   * retrying with the same (or even a freshly re-fetched) list won't change
   * that within this one command's lifetime, so this throws
   * UnrecoverableError to skip BullMQ's retry/backoff entirely. Any other
   * failure (a network error, timeout or bad responseCode, all surfaced as
   * AstroApiError from the client) is left to propagate normally and goes
   * through the worker's regular retry path.
   *
   * The write is conditional on `scheduleUpdatedAt` being older than this
   * snapshot's own fetch time: REFRESH_CHANNEL has no seq-based ordering
   * (PRD §9 rule 4), so a command carrying an older snapshot could otherwise
   * run after — and clobber — one that already applied a newer snapshot (e.g.
   * a command delayed long enough to be picked up by the recovery sweep).
   * `updateMany` with that condition never throws when no row matches, so a
   * channel that's already at least as fresh as this snapshot is a no-op —
   * correctly treated as success, not a failure.
   */
  async handle(command: Command, tx: Prisma.TransactionClient): Promise<void> {
    const { records, fetchedAt } = await this.cachedAstroClient.getSnapshot();
    const record = records.find((r) => r.id === command.channelId);
    if (!record) {
      throw new UnrecoverableError(
        `Channel ${command.channelId} is no longer present in Astro's channel list`,
      );
    }

    const mapped = mapAstroChannel(record, fetchedAt);
    const { count } = await tx.channel.updateMany({
      where: { id: command.channelId, scheduleUpdatedAt: { lt: fetchedAt } },
      data: {
        title: mapped.title,
        subtitle: mapped.subtitle,
        stbNumber: mapped.stbNumber,
        imageUrl: mapped.imageUrl,
        category: mapped.category,
        genres: mapped.genres,
        languages: mapped.languages,
        rangeKey: mapped.rangeKey,
        ranking: mapped.ranking,
        schedule: mapped.schedule,
        scheduleUpdatedAt: mapped.scheduleUpdatedAt,
        // createdAt is intentionally omitted, same as SyncService.upsertAll.
      },
    });

    // Only when a row was actually written — a no-op (an already-newer
    // snapshot already applied) leaves the cached detail correctly in place.
    if (count > 0) {
      await this.cache.del(buildChannelDetailCacheKey(command.channelId));
    }
  }
}
