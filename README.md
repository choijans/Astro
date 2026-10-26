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

Frontend setup will be added here once `/frontend` exists. Seeding/sync instructions will be
added once Task 4 lands.

## API notes

- Errors are always `{statusCode, message, error}`, but `message` is a **string** for most
  errors (e.g. 404s) and an **array of strings** for `ValidationPipe` failures (standard Nest
  behavior). Any client reading error responses — including the frontend's error handler — must
  accept both.

## How I built this


