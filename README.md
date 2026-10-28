# Astro Channel Management Portal

Full Stack Engineering Technical Assessment — browse Astro channels, view details, manage
favourites, and process queued commands (add/remove favourite, refresh channel).

Status: backend and frontend are implemented through rate limiting, health checks, Redis caching
and the offline command outbox (see `docs/plan.md` for the full task list and what's left). See
`docs/prd.md` for the product requirements, `docs/architecture/architecture.md` for the
architecture diagram, `docs/TESTING.md` for the full testing breakdown, and `RELEASE_NOTES.md` for
what shipped.

## Setup (backend, so far)

1. Copy environment variables: `cp .env.example backend/.env`. `DATABASE_URL` points at host
   port **5433**, not the default 5432 — this avoids colliding with a local Postgres install.
2. Start Postgres and Redis: `docker compose up -d`
3. Install dependencies and apply migrations:
   ```
   cd backend
   npm install
   npx prisma migrate dev
   ```

Seeding/sync: `npm run seed` loads the committed fixture; `npm run sync` pulls fresh data from
the live Astro endpoint. Both are idempotent upserts.

## Calling the API — the `X-User-Id` header

Every write route (`POST /commands`, `POST /favourites`, `DELETE /favourites/:channelId`) and
`GET /favourites` require an `X-User-Id` header whose value is a UUID — this is how the API tells
one user's favourites and commands apart; there's no login. The frontend generates one with
`crypto.randomUUID()` on first load and stores it in `localStorage`, so this only matters if
you're calling the API directly (curl/Postman) rather than through the UI, e.g.:

```
curl -X POST http://localhost:3001/favourites \
  -H "Content-Type: application/json" \
  -H "X-User-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{"channelId": 100}'
```

A missing or non-UUID header on these routes gets a `400`. `GET /channels` and `GET /health` don't
need it.

## Running the worker

Favourite/command processing happens on a separate worker process, not inline in the API. Run
both, in two terminals:

```
# terminal 1
cd backend && npm run start:dev

# terminal 2
cd backend && npm run start:worker:dev
```

`POST /favourites` (and `POST /commands`) return `202` with the command `PENDING` immediately —
the actual add/remove happens once the worker picks the job up. **Without the worker running,
every command stays `PENDING` forever**; starting the worker afterward processes whatever's
still pending. `npm run start:worker` is the same thing without `--watch`, for a one-off run.

Redis (from `docker compose up -d`) is required for the worker and for the e2e test suite —
`npm run test:e2e` starts its own worker instance against a dedicated test queue name and Redis
database (`QUEUE_NAME`/`REDIS_DB` in `.env.test`), separate from dev's, so the two never interleave.

A recovery sweep re-enqueues any command still `PENDING` in Postgres (oldest first): the API and
worker both run one pass on start, and the worker also runs one on an interval (`SWEEP_INTERVAL_MS`,
default 5s) and whenever its Redis connection comes back after a disconnect. This is what recovers
a command whose job never made it to Redis in the first place (Redis was down at enqueue time).

## Refreshing a channel

The Refresh button on a channel's details page queues a `REFRESH_CHANNEL` command: the worker
fetches Astro's current channel list and updates that one channel's row (schedule and the other
mapped fields). **The worker must be running** for a refresh to ever complete — same as favourites,
it's processed asynchronously, not inline in the API request.

**It isn't instant.** The button shows "Refreshing…" while `POST /commands` returns 202 and the
frontend polls `GET /commands/:id` every ~500ms for the worker to mark it DONE — usually under a
couple of seconds, longer the first time in a while if it has to fetch Astro live rather than reuse
the 60-second cached list below. If polling runs a full ~15s without a DONE, the button gives up
and shows "Still refreshing…" instead of hanging forever; the command itself isn't dead; it's still
running server-side and will finish, the UI just stopped waiting for it.

Several refreshes arriving close together share one Astro call instead of each making their own:
the worker keeps an in-memory copy of the last successful list for about 60 seconds
(`ASTRO_LIST_CACHE_TTL_MS`), and concurrent requests for a stale copy merge into a single fetch. A
channel id that's no longer in Astro's list fails immediately with no retries, since re-fetching
won't change that. This cache is per worker process — `npm run sync` and the seed script always
fetch fresh, and scaling the worker to several instances means each instance keeps its own copy
rather than sharing one.

## Outage test

`npm run test:outage` is a scripted version of the PRD's outage acceptance test: it submits ~30
interleaved add/remove favourite commands from 2 users across a few channels, forces a 5-second
outage in the middle (once with Redis stopped, once with the worker stopped), then asserts every
command ends `DONE`, no duplicate favourites exist, the final state of each (user, channel) matches
its last command, and the queue holds no duplicate jobs.

```
cd backend && npm run test:outage
```

**It's separate from `npm run test:e2e`** because the Redis-outage scenario runs
`docker compose stop redis` / `start redis` against the **real, shared** Redis container — the
same one `docker compose up -d` starts for local dev. Running it stops Redis for a few seconds,
which will interrupt anything you have running against it at the time (the dev API, the dev
worker, a manual test). It still uses the dedicated test queue name and Redis database, and
refuses to run against the dev ones (same guard as `test:e2e`) — the outage itself is at the
container level, so it affects dev and test connections alike while it's down.

## Rate limiting and health

`POST /commands`, `POST /favourites` and `DELETE /favourites/:channelId` are rate limited — 60
requests per 60 seconds per tracker by default (`RATE_LIMIT_MAX` / `RATE_LIMIT_TTL_MS`). No other
route is limited: reads and `/health` always go through. The tracker is the caller's `X-User-Id`
when it's a valid UUID, falling back to the connecting IP otherwise; see the comment on
`AppThrottlerGuard` for the trade-off that choice makes. A limited request gets `429` in the same
`{ statusCode, message, error }` shape every other error uses, plus a `Retry-After` header.
**Counters are kept in memory, per process** — restarting the API resets them, and (if the API is
ever run as more than one instance) each instance would track independently rather than sharing
one budget.

`GET /health` checks Postgres (`SELECT 1`) and Redis (`ping`), each with its own 2-second timeout
(`HEALTH_CHECK_TIMEOUT_MS`) so one hanging dependency can't hang the endpoint. `200` with
`{ status: "ok", checks: { database: "up", redis: "up" } }` when both are reachable, `503` naming
which one isn't otherwise. The response never includes the underlying error, a hostname or a
connection string — only ever "up" or "down" per check; the real failure is logged instead.

## Caching

`GET /channels` and `GET /channels/:id` are cached in Redis, cache-aside, on a separate ioredis
connection from BullMQ's (own socket, `cache:` key prefix, same `REDIS_URL`/`REDIS_DB`). Neither
response contains per-user data — no favourite flag, no user id — so both are safe to share across
every caller. A response carries `X-Cache: HIT` or `MISS`; the header is omitted entirely when
caching is disabled.

- **List** (`GET /channels`): keyed from the filters/sort/page/limit actually applied (defaults
  included, in a fixed order — the same query with its parameters in a different order hits the
  same entry), TTL `CACHE_LIST_TTL_SECONDS` (default 30s). List items carry `now`/`next`, computed
  at request time — **a cached list can show a show that already ended, by up to the TTL**. This
  is accepted staleness, not a bug.
- **Detail** (`GET /channels/:id`): keyed per channel id, TTL `CACHE_DETAIL_TTL_SECONDS` (default
  60s). Invalidated immediately — the specific channel's key is deleted — the moment a
  `REFRESH_CHANNEL` command actually writes a new schedule for it. `npm run sync` does **not**
  invalidate anything; a channel updated that way stays cached until its TTL expires. This is
  accepted staleness too: `sync` is a bulk, infrequent operation, and precise invalidation across
  every list-cache key a channel might appear in isn't realistic (the list cache expires by TTL
  instead, which is why its own TTL is comparatively short).
- **Fail open**: a down, slow or erroring cache never fails or hangs a request — it's treated as a
  miss, logged as a warning, and the response comes from the database instead. Every cache command
  has its own 300ms timeout, and the connection is configured not to queue commands while
  disconnected, so a cache outage can only ever cost up to that 300ms, never longer.
- **Env vars**: `CACHE_ENABLED` (default `true`), `CACHE_LIST_TTL_SECONDS` (default 30),
  `CACHE_DETAIL_TTL_SECONDS` (default 60).

## Running the frontend

1. Copy the frontend values from `.env.example` into `frontend/.env.local` (just
   `NEXT_PUBLIC_API_URL=http://localhost:3001`).
2. Make sure the backend is running (see above) with `CORS_ORIGIN=http://localhost:3000` in
   `backend/.env` — the frontend runs on port 3000 by default, and a mismatched origin means
   every request gets silently blocked by CORS.
3. Install and run:
   ```
   cd frontend
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Working offline

Every request from the frontend aborts after `NEXT_PUBLIC_REQUEST_TIMEOUT_MS` (default 10000ms) and
is treated the same as any other network failure — the server gave no answer at all, as opposed to
answering with an HTTP error. A favourite toggle that fails this way is **not** rolled back: the
heart stays in its new state and the command is queued in an outbox (`localStorage`, capped at 100
entries, each expiring after 24 hours) under the same command UUID that was about to be sent. A
small indicator in the header shows how many changes are waiting.

The outbox is flushed — one entry at a time, oldest first, same UUIDs — on page load, when the
browser fires its `online` event, when the tab becomes visible again, and on its own retry timer
(starts at 2s, doubles up to 30s, resets after a successful send) for as long as it isn't empty.
`navigator.onLine` is never trusted to decide anything — it's unreliable — only used as one of
several triggers to attempt a flush. A command the server already knew about (e.g. the first
attempt actually got through before the response was lost) just settles immediately, since the
same UUID is reused and the backend's idempotency rule treats it as the existing command. A command
that can never succeed (400, 404 or 409 on resend) is dropped with a one-line message rather than
retried forever; a 429 or 5xx is kept and retried.

This only covers favourite toggles (`ADD_FAVORITE`/`REMOVE_FAVORITE`) — `REFRESH_CHANNEL` is never
queued this way.

## API notes

- Errors are always `{statusCode, message, error}`, but `message` is a **string** for most
  errors (e.g. 404s) and an **array of strings** for `ValidationPipe` failures (standard Nest
  behavior). Any client reading error responses — including the frontend's error handler — must
  accept both.
- Command handlers (`AddFavouriteHandler`/`RemoveFavouriteHandler`) write through the
  `Prisma.TransactionClient` the worker passes into `handle()`, not an injected `PrismaService`.
  The worker runs each ADD_FAVORITE/REMOVE_FAVORITE inside a `pg_advisory_xact_lock`-guarded
  transaction (locked on a key derived from `(userId, channelId)`) so the "is this command
  superseded by an already-applied, higher-seq command for the same channel" check and the
  handler's actual write happen atomically — two jobs for the same (user, channel) can't both
  pass the check before either commits.

## Testing

| Command | Where | What it checks |
| --- | --- | --- |
| `cd backend && npm test` | backend | Unit tests (services, guards, handlers, mappers) |
| `cd backend && npm run test:e2e` | backend | Supertest against a real Postgres/Redis test instance — channels, favourites, commands, rate limiting, health, caching |
| `cd backend && npm run test:outage` | backend | Scripted outage acceptance test (see "Outage test" above) — separate because it stops the real, shared Redis container |
| `cd frontend && npm test` | frontend | RTL/Jest component and hook tests |

Backend unit + e2e + frontend unit is what CI would run; `test:outage` is run manually since it
briefly stops a shared container (see "Outage test" above for why).

See `docs/TESTING.md` for a full file-by-file breakdown of what each suite covers, plus the two
manual verification procedures (a curl demo of Redis caching, and a Playwright script for the
offline outbox) that aren't automated tests.