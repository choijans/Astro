# Astro Channel Management Portal

Full Stack Engineering Technical Assessment — browse Astro channels, view details, manage
favourites, and process queued commands (add/remove favourite, refresh channel).

Status: repo scaffolding in progress. See `docs/prd.md` for the product requirements and
`docs/plan.md` for the build plan.

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

## How I built this


