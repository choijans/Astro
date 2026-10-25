# CLAUDE.md

## Stack
NestJS + Prisma/PostgreSQL (API + worker), Next.js + Zustand + TanStack Query (frontend),
BullMQ + Redis (queue/cache), Docker Compose for Postgres+Redis only (apps run via `npm run dev`).

## Decided design points
- Infinite scroll, 24/page, stable order = sort field then channel id.
- Search: channel number matches exactly; title matches a case-insensitive "contains".
- Worker is a separate process; one handler class per command type.
- Commands use sequence-number ordering; `REFRESH_CHANNEL` targets exactly one channel.
- `/favourites` is a thin wrapper over the same write path as `/commands`.
- Global CORS (env-configured origin), helmet, and a `ValidationPipe` whitelist are wired in
  the Channels API task, not bundled with later security/caching work.

## Audit fixes (see docs/plan.md for full task detail)
- Favourites writes go through `CommandsService.enqueue(...)` only — one write path, two routes.
- `commands` has an explicit `channel_id` column + index on `(user_id, channel_id, type, seq)`.
- Recovery sweep runs on API/worker start, on Redis reconnect, and on a 5-10s timer.
- The command's client UUID is also the BullMQ job ID, so re-enqueuing can't duplicate a job.
- The ~60s Astro-list cache that collapses concurrent `REFRESH_CHANNEL` requests is in-memory
  and independent of the Redis response cache, so refresh still collapses even if caching is cut.
- A frontend command outbox (localStorage, resend with the same UUID on reconnect) reconciles
  command status after submission.
- Ingest drops `isAstroFirstExclusive`/`isAstroGoExclusive`/`isRadioExclusive` and ignores
  `linearContent`; `stbNumber` is cast to integer; "last updated" is our sync time, not Astro's.
- Cut order if short on time: CI workflow → Redis caching → range filter.

## Repo layout
`/frontend`, `/backend`, `docker-compose.yml`, `.env.example`, `README.md`,
`docs/architecture/`, `RELEASE_NOTES.md`, `docs/{prd,plan}.md`.

## Commands (placeholders until each app exists)
- `docker compose up -d` — Postgres + Redis
- `cd backend && npm run dev` / `npm test` / `npx prisma migrate dev` / `npx prisma db seed`
- `cd frontend && npm run dev` / `npm test`

## Working rules
- Work on one task from `docs/plan.md` at a time.
- Stop at that task's "done when" check and wait for explicit OK before starting the next.
- Write tests together with the code, not after.
- Keep each task's changes small and focused; the user commits them.
- Never guess Astro API fields or response shape — check the real response (saved fixture).
- Treat `docs/prd.md` as the single source of truth.
- If the PRD appears to conflict with the original assessment brief (a PDF kept outside the
  repo), ask me.

## Git workflow
- Never run `git commit`, `git merge`, `git push`, `git rebase`, `git reset`, or anything else
  that changes history or a remote — the user handles all commits, merges and pushes.
- Read-only git commands (`status`, `diff`, `log`) are fine; create a branch named
  `task-<number>-<short-name>` at the start of a task.
- At a task's "done when" check, stop. Show `git status` and a summary of the changes, and give
  the commit message from `docs/plan.md` for the user to use.
- Do not start the next task until the user says so.
