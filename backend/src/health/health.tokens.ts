/** Own file for the same reason queue.tokens.ts exists: avoids a circular
 * import between health.module.ts and anything that needs to inject this
 * token without importing the module itself. */
export const HEALTH_REDIS_CLIENT = Symbol('HEALTH_REDIS_CLIENT');
