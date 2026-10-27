import { Inject, Injectable, Optional } from '@nestjs/common';
import { ASTRO_CLIENT } from './astro-client.interface';
import type { IAstroClient } from './astro-client.interface';
import { AstroChannelRecord } from './astro.types';

const DEFAULT_TTL_MS = 60_000;

export function getAstroListCacheTtlMs(): number {
  const raw = process.env.ASTRO_LIST_CACHE_TTL_MS;
  return raw ? Number(raw) : DEFAULT_TTL_MS;
}

export interface AstroListSnapshot {
  records: AstroChannelRecord[];
  /** When this list was actually fetched from Astro — not when a caller asked for it. */
  fetchedAt: Date;
}

/**
 * Wraps the real IAstroClient with an in-memory, single-flight cache of the
 * last successful channel list, so several REFRESH_CHANNEL commands arriving
 * close together (for the same channel or different ones) share one Astro
 * call instead of each making their own. Only RefreshChannelHandler uses
 * this — `npm run sync` and the seed script call HttpAstroClient (or
 * FixtureAstroClient) directly, since a one-off sync has nothing to share a
 * cache with.
 *
 * The cache lives in this process's memory only — there's no Redis or other
 * shared store behind it. With a single worker process (today's setup)
 * that's exactly "one shared copy for ~60s." If the worker is ever scaled to
 * several instances (which the PRD's scalability NFR explicitly allows),
 * each instance keeps its own independent copy and in-flight request: two
 * REFRESH_CHANNEL commands landing on two different worker processes at the
 * same moment would still each trigger their own Astro call, and each
 * process's `scheduleUpdatedAt` values could differ by up to the cache's TTL.
 * That's an accepted gap, not a bug — a correct fix would need a shared
 * (e.g. Redis-backed) cache/lock, which is deliberately out of scope here
 * (the same reasoning CLAUDE.md already gives for why this cache is kept
 * independent of the Redis response cache).
 */
@Injectable()
export class CachedAstroClient implements IAstroClient {
  private cached?: AstroListSnapshot;
  private inFlight?: Promise<AstroListSnapshot>;

  constructor(
    @Inject(ASTRO_CLIENT) private readonly client: IAstroClient,
    @Optional() private readonly ttlMs: number = getAstroListCacheTtlMs(),
  ) {}

  async fetchChannels(): Promise<AstroChannelRecord[]> {
    return (await this.getSnapshot()).records;
  }

  /** Same data as fetchChannels(), plus the moment it was actually fetched. */
  async getSnapshot(): Promise<AstroListSnapshot> {
    if (this.cached && this.isFresh(this.cached)) {
      return this.cached;
    }
    // Checked and set synchronously (no `await` above this line), so two
    // calls arriving before either's fetch resolves can never both see
    // `inFlight` unset — exactly one of them starts the fetch, and the
    // rest merge into that same in-flight promise.
    if (!this.inFlight) {
      this.inFlight = this.startFetch();
    }
    return this.inFlight;
  }

  private isFresh(snapshot: AstroListSnapshot): boolean {
    return Date.now() - snapshot.fetchedAt.getTime() < this.ttlMs;
  }

  private async startFetch(): Promise<AstroListSnapshot> {
    try {
      const records = await this.client.fetchChannels();
      const snapshot: AstroListSnapshot = { records, fetchedAt: new Date() };
      this.cached = snapshot;
      return snapshot;
    } finally {
      // Cleared whether the fetch succeeded or failed: a failure is never
      // cached (this.cached is only ever set on success, above), and
      // clearing inFlight here means the very next call retries instead of
      // reusing a rejected promise.
      this.inFlight = undefined;
    }
  }
}
