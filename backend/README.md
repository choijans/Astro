# Backend

NestJS API and worker for the Astro Channel Management Portal. See the repo root `README.md`
for environment setup and `../docs/prd.md` / `../docs/plan.md` for requirements and the build
plan.

## Commands

- `npm install` — installs dependencies and runs `prisma generate` via `postinstall`
- `npm run start:dev` — run the API in watch mode
- `npx prisma migrate dev` — apply migrations against the Dockerized Postgres (see root README
  for `.env` setup)
- `npm run build` — compile to `dist/`
- `npm test` — run the Jest unit tests
