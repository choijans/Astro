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
- Command handlers (`AddFavouriteHandler`/`RemoveFavouriteHandler`) call `PrismaService` directly
  instead of going through a repository, since each handler's effect is a single, self-contained
  idempotent write and `PrismaModule` is global — a repository layer here would only forward the
  call without adding anything.

## How I built this


