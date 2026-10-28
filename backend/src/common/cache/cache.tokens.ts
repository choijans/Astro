/**
 * Own file, same rationale as queue.tokens.ts / health.tokens.ts: avoids a
 * circular import between cache.module.ts (which provides this) and
 * cache.service.ts (which @Inject()s it).
 */
export const CACHE_REDIS_CLIENT = Symbol('CACHE_REDIS_CLIENT');
