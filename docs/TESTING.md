# Testing

This is the full breakdown of what's tested, where, and how to run or manually verify each piece.
For getting the project running in the first place, see `README.md`'s "Setup" and "Running the
frontend" sections — this document assumes the stack is already up.

## Quick reference

| Command | App | Needs |
|---|---|---|
| `cd backend && npm test` | backend | nothing extra — mocked dependencies |
| `cd backend && npm run test:e2e` | backend | `docker compose up -d` (real test Postgres/Redis) |
| `cd backend && npm run test:outage` | backend | `docker compose up -d` — stops the real, shared Redis container for ~5s twice |
| `cd frontend && npm test` | frontend | nothing extra — mocked `fetch`/API |

Backend unit + e2e + frontend unit is what CI would run. `test:outage` is run manually/separately
because it briefly disrupts a shared container (dev API/worker/manual testing all lose Redis for a
few seconds while it runs).

## Backend unit tests (`backend/src/**/*.spec.ts`)

Mocked dependencies throughout — no Postgres/Redis needed.

| File | Covers |
|---|---|
| `astro/astro-envelope.spec.ts` | Unwrapping Astro's response envelope, `responseCode` handling |
| `astro/astro.mapper.spec.ts` | Mapping a real Astro record to the internal shape, against the saved fixture |
| `astro/cached-astro-client.spec.ts` | The ~60s in-memory Astro-list cache: single-flight collapsing of concurrent fetches, TTL expiry |
| `channels/channels-cache-key.spec.ts` | List/detail cache key normalisation — same filters in a different order match, different filters don't |
| `channels/channels.repository.spec.ts` | Search `q` boundary handling (numeric vs. text, out-of-range integers) |
| `channels/now-next.util.spec.ts` | Computing "now"/"next" from a stored schedule |
| `commands/commands.repository.spec.ts` | Queries behind the recovery sweep: finding PENDING and stale-PROCESSING commands |
| `commands/commands.service.spec.ts` | `enqueue()`'s persist-then-queue path; `getStatus()` |
| `commands/handlers/add-favourite.handler.spec.ts` | Idempotent add, ordering skip-if-superseded |
| `commands/handlers/remove-favourite.handler.spec.ts` | Idempotent remove, ordering skip-if-superseded |
| `commands/handlers/refresh-channel.handler.spec.ts` | Applying a channel update, the no-op-if-already-fresher guard, detail-cache invalidation only when a row is actually written |
| `commands/queue-command-processor.spec.ts` | BullMQ job → handler dispatch |
| `common/app-throttler.guard.spec.ts` | Rate-limit tracker selection (`X-User-Id` vs. IP), the custom 429 exception shape |
| `common/cache/cache.service.spec.ts` | Cache-aside hit/miss/disabled paths, fail-open on a generic error and on a command timeout |
| `favourites/favourites.service.spec.ts` | The favourites read/write path |
| `health/health.service.spec.ts` | All-up, database-down, Redis-down, both-down, and a check that times out without leaking its timer |
| `queue/job-enqueuer.service.spec.ts` | Enqueue failure handling, re-adding a stale job without duplicating it |
| `queue/recovery-sweep.service.spec.ts` | Sweep logic for PENDING and stale-PROCESSING commands |
| `sync/sync.service.spec.ts` | Idempotent upsert from an Astro snapshot |
| `worker/command-worker.service.spec.ts` | Attempt/retry logging, duplicate-delivery and superseded-command skipping |

## Backend integration tests (`backend/test/*.e2e-spec.ts`, `npm run test:e2e`)

Real Postgres (`astro_test`) and real Redis (a dedicated database/queue name, refuses to run
against the dev ones).

| File | Covers |
|---|---|
| `channels.e2e-spec.ts` | `GET /channels` search/sort/filter/pagination, CORS/helmet/whitelist, 400s, 404s |
| `favourites-commands.e2e-spec.ts` | Duplicate command IDs (same UUID twice → one row, one job), parallel identical requests, invalid `X-Command-Id` |
| `now-next.e2e-spec.ts` | `GET /channels` and `GET /favourites` both include now/next and never the full schedule |
| `refresh-channel.e2e-spec.ts` | `REFRESH_CHANNEL` end to end, concurrent refreshes of the same channel collapsing to one Astro call, unknown/missing channel handling |
| `recovery-sweep.e2e-spec.ts` | A command stuck because the queue add failed reaches DONE after a sweep pass, with no duplicate; a stale-PROCESSING command (its BullMQ job gone) is recovered |
| `rate-limit.e2e-spec.ts` | 429 on all three write routes with the standard error shape and `Retry-After`; separate counters per tracker; `GET /channels` never limited |
| `health.e2e-spec.ts` | 200 against the real services, 503 via an overridden `HealthService` (no container stopped), no leaked connection details |
| `cache.e2e-spec.ts` | List/detail MISS then HIT with an identical body, a different query is its own MISS, same filters in a different order still hit, a 404 is never cached, `CACHE_ENABLED=false` sets no header, a cache backend that errors on every call still returns 200, and the full invalidation cycle (detail HIT → `REFRESH_CHANNEL` → MISS with new data → HIT again) |
| `app.e2e-spec.ts` | Smoke test for the root route |

## Backend outage test (`backend/test/outage.outage-spec.ts`, `npm run test:outage`)

The PRD's 5-second outage acceptance test, scripted: submits ~30 interleaved add/remove favourite
commands from 2 users across a few channels, forces a 5-second outage in the middle — once with
the real, shared Redis container stopped, once with the worker process stopped — then asserts
every command ends DONE, no duplicate favourites exist, the final state of each (user, channel)
matches its last command, and the queue holds no duplicate jobs. See `README.md`'s "Outage test"
section for why this is separate from `test:e2e`.

## Frontend tests (`frontend/__tests__/*`, `npm test`)

`fetch` is mocked throughout — no real backend needed.

| File | Covers |
|---|---|
| `api.test.ts` | Error-message extraction (string vs. array), the 429 → fixed message + `Retry-After`, `NetworkError` on a rejected/timed-out fetch, the `X-User-Id` header |
| `poll-command.test.ts` | Polling cadence and timeout; a `NetworkError` while polling counts as "not settled yet", not a failure |
| `outbox.test.ts` | Persistence, insertion order, the 100-entry cap, the 24h expiry, the in-memory fallback when `localStorage` throws on read or write |
| `outbox-flush.test.ts` | Sequential sending with the original UUIDs, single-flight, backoff (2s→30s, reset on success), each per-result outcome (`NetworkError`/429/5xx/400/404/409), a poll timeout after a successful resend, a replayed command the server already knew about |
| `OfflineIndicator.test.tsx` | The queued-count message; the real `online` DOM event driving a sequential flush |
| `pending-favourites-store.test.ts` | The pending-overlay store's reconcile logic |
| `FavouriteButton.test.tsx` | Optimistic flip, rollback on an HTTP error (and that the outbox stays empty), a `NetworkError` queuing instead of rolling back, the 429/FAILED/timeout message rules |
| `RefreshButton.test.tsx` | The refresh flow's pending/error/timeout states |
| `ChannelCard.test.tsx`, `ChannelDetailsPage.test.tsx`, `ChannelsPage.test.tsx`, `FavouritesPage.test.tsx`, `FilterDialog.test.tsx`, `SearchBar.test.tsx`, `BackToChannelsLink.test.tsx`, `useInfiniteScrollSentinel.test.tsx`, `user-id.test.ts` | Search/sort/filter behaviour, loading/error/empty states, infinite scroll, the anonymous user ID |

## Manual verification

Two things are deliberately not automated tests — one because it demonstrates a running system
rather than asserting behaviour (caching), one because the scenario it drives (a real browser
reporting itself offline) can't be produced in jsdom at all (`navigator.onLine` is always `true`
there, which is exactly how the `networkMode: 'always'` bug in Task 11 stayed invisible to every
unit test and was only caught here).

### Redis caching — `X-Cache: MISS` then `HIT`

With the backend running (`npm run start:dev`) and Redis up:

```
curl -s -D - -o /dev/null http://localhost:3001/channels/622 | grep -i x-cache   # MISS
curl -s -D - -o /dev/null http://localhost:3001/channels/622 | grep -i x-cache   # HIT
```

Same thing for the list endpoint with any query string:

```
curl -s -D - -o /dev/null "http://localhost:3001/channels?q=astro&sort=title&order=asc" | grep -i x-cache
curl -s -D - -o /dev/null "http://localhost:3001/channels?q=astro&sort=title&order=asc" | grep -i x-cache
```

(Use a real channel id from your seeded data if `622` doesn't exist locally — `curl -s
"http://localhost:3001/channels?limit=1"` returns one.)

### Offline outbox — a real browser going offline and back

`frontend/scripts/manual-checks/offline-outbox.mjs` drives a real Chromium browser (via
Playwright, installed one-off, not a project dependency) against the running dev stack:

```
cd frontend
npm install --no-save playwright
npx playwright install chromium   # first time only
node scripts/manual-checks/offline-outbox.mjs
```

It asserts: a favourite toggle while offline is not rolled back and is queued; add-then-remove of
the same channel while offline preserves order; the header shows the right queued count; going
back online flushes the outbox and shows "Changes synced"; the result survives a reload. See the
comment at the top of the script for the full list and why it needs a real browser instead of
jsdom.
