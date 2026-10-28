import type { RedisOptions } from 'ioredis';
import {
  getRedisDb,
  getRedisUrl,
  parseRedisUrl,
} from '../../queue/queue.config';

const DEFAULT_LIST_TTL_SECONDS = 30;
const DEFAULT_DETAIL_TTL_SECONDS = 60;

/**
 * Every cache command (GET/SET/DEL) gets this ioredis-level timeout, so a
 * slow or wedged connection can never hang a request — it fails fast and the
 * caller (CacheService) treats that the same as any other cache error.
 */
export const CACHE_COMMAND_TIMEOUT_MS = 300;

/** Separates cache keys from BullMQ's own key namespace on the same Redis db. */
export const CACHE_KEY_PREFIX = 'cache:';

export function getCacheEnabled(): boolean {
  return process.env.CACHE_ENABLED !== 'false';
}

export function getListCacheTtlSeconds(): number {
  const raw = process.env.CACHE_LIST_TTL_SECONDS;
  return raw ? Number(raw) : DEFAULT_LIST_TTL_SECONDS;
}

export function getDetailCacheTtlSeconds(): number {
  const raw = process.env.CACHE_DETAIL_TTL_SECONDS;
  return raw ? Number(raw) : DEFAULT_DETAIL_TTL_SECONDS;
}

/**
 * A separate ioredis connection from BullMQ's (own socket, own retry/timeout
 * behaviour), on the same REDIS_URL/db — `keyPrefix` is what actually keeps
 * the two namespaces apart on that shared db.
 *
 * `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` stop ioredis from
 * doing what it does by default while disconnected: queue commands in memory
 * and wait indefinitely for a reconnect. With these set, a command issued
 * while disconnected rejects immediately instead of queuing. `commandTimeout`
 * covers the other case — connected, but slow or stuck — so a cache command
 * can never outlast it either way.
 */
export function buildCacheConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(getRedisUrl()),
    db: getRedisDb(),
    keyPrefix: CACHE_KEY_PREFIX,
    commandTimeout: CACHE_COMMAND_TIMEOUT_MS,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  };
}
