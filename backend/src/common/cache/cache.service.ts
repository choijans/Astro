import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { getCacheEnabled } from './cache.config';
import { CACHE_REDIS_CLIENT } from './cache.tokens';

/** The subset of Express's `Response` CacheService needs — kept minimal so
 * this module doesn't depend on `express` just to set one header. */
export interface CacheableResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Fail-open cache-aside on top of a dedicated ioredis connection. Every
 * method here swallows Redis errors (including the command timeout
 * configured in cache.config.ts) and logs a warning instead of throwing —
 * a down or slow cache must never fail or hang a request; it just behaves
 * like an empty cache.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_REDIS_CLIENT) private readonly redis: Redis) {}

  get enabled(): boolean {
    return getCacheEnabled();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (err) {
      this.logger.warn(
        `Cache GET failed for "${key}": ${(err as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Cache SET failed for "${key}": ${(err as Error).message}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(
        `Cache DEL failed for "${key}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Cache-aside for one route. On a hit, returns the cached value and marks
   * the response `X-Cache: HIT`. On a miss, calls `fn`, marks `X-Cache: MISS`,
   * and stores the result for next time. When caching is disabled, `fn` runs
   * straight through and no header is set at all.
   *
   * `fn` itself is never covered by this class's fail-open try/catch — a
   * business error it throws (e.g. a 404 from a missing channel) must
   * propagate normally and is never written to the cache.
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
    res?: CacheableResponse,
  ): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    const cached = await this.get<T>(key);
    if (cached !== null) {
      res?.setHeader('X-Cache', 'HIT');
      return cached;
    }

    const value = await fn();
    res?.setHeader('X-Cache', 'MISS');
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
