/**
 * Kept in its own file, separate from queue.module.ts: the module file
 * imports JobEnqueuerService/RecoverySweepService (to declare them as
 * providers), and those providers import this token via @Inject — if the
 * token lived in queue.module.ts, that would be a circular import between
 * the module and its own providers. On a circular require, whichever file
 * is still mid-load sees the token as `undefined` at the point its
 * decorator runs (decorators evaluate immediately, not lazily), so
 * `@Inject(COMMANDS_QUEUE)` would silently become `@Inject(undefined)` —
 * this bit precisely, surfacing only as a runtime DI resolution failure
 * ("Nest can't resolve dependencies of the JobEnqueuerService (?)"), never
 * as a build or type error.
 */
export const COMMANDS_QUEUE = Symbol('COMMANDS_QUEUE');
