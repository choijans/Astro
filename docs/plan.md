# Build Plan — Astro Channel Management Portal

Ordered tasks derived from `docs/prd.md` (the single source of truth — re-exported and
maintained by the user; this plan doesn't edit it). Work one task at a time; stop at its
"done when" check and wait for approval before starting the next.

**Total:** roughly 39 hours (~5 days) across Tasks 1-12, 14 and 16. Tasks 13 (caching), 15 (CI
workflow) and 17 (range filter) are cuttable extras — cut in this order if time is short:
**1) CI workflow (Task 15) → 2) caching (Task 13) → 3) range filter (Task 17)**.

## 1. Repo bootstrap — NEXT

- **Goal:** git repo with base layout; `.gitignore` and `.env.example` (placeholders only, no
  real secrets) covering backend (`DATABASE_URL`, `REDIS_URL`, ports) and frontend
  (`NEXT_PUBLIC_API_URL`), plus the CORS origin allow-list (`CORS_ORIGIN`); an `.nvmrc` pinning
  the Node version; a README stub that already includes an empty `## How I built this` heading
  (filled in by the user later).
- **Files:** `.gitignore`, `.env.example`, `.nvmrc`, `README.md`, `frontend/.gitkeep`,
  `backend/.gitkeep`
- **Done when:** `git log` shows the initial commit; `.env.example` lists `DATABASE_URL`,
  `REDIS_URL`, app ports, `NEXT_PUBLIC_API_URL` and `CORS_ORIGIN` as placeholders only;
  `README.md` has an empty "How I built this" heading; `git status` clean; GitHub `origin` set
  (not pushed).
- **Tests:** none (infra).
- **Commit:** `chore: initialize repository`
- **Time:** ~1 hr (mostly done already — only `.env.example`, `.nvmrc` and the README placeholder
  remain).

## 2. Docker Compose + env skeleton

- **Goal:** `docker-compose.yml` for `postgres:16` (host port 5433) and `redis:7` with
  healthchecks and named volumes; fill in the matching variables in `.env.example`.
- **Files:** `docker-compose.yml`, `.env.example`
- **Done when:** `docker compose up -d` brings both services up healthy; `psql`/`redis-cli`
  connect on the mapped ports.
- **Tests:** manual smoke check.
- **Commit:** `chore: add docker compose for postgres and redis`
- **Time:** ~1 hr.
- **Status: DONE.** `docker compose up -d` brought both services up healthy (`0.0.0.0:5433->5432`
  for Postgres); `psql -U postgres -d astro -c "select 1;"` and `redis-cli ping` both succeeded;
  a marker row written before `docker compose down` was still present after `docker compose up -d`,
  confirming the named volumes persist data across a restart.

## 3. Backend scaffold + Prisma schema/migration

- **Goal:** NestJS scaffold; Prisma schema per PRD §7 plus an explicit `channel_id` column on
  `commands` and an index on `(user_id, channel_id, type, seq)`; initial migration. Seeding moves
  to Task 4, so it shares the same mapper as the live sync.
- **Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`
- **Done when:** `prisma migrate dev` runs clean against the Dockerized Postgres; the generated
  client matches the schema (channels, favourites, commands, including the extra column/index).
- **Tests:** none (schema only — validated by a clean migration run; data-level tests move to
  Task 4).
- **Commit:** `feat(backend): add prisma schema and migration`
- **Time:** ~1.5 hrs.

## 4. AstroClient adapter + shared mapper + seed + sync service

- **Goal:** `AstroClient` hits the verified endpoint with the hardcoded query string
  (`channelGuide=true&platform=acm&channelOrderBy=stbNumber,asc`), unwraps
  `response.channels.data`, checks `responseCode`, and ignores `linearContent` entirely. One
  mapper casts `stbNumber` to an integer, drops `isAstroFirstExclusive`/`isAstroGoExclusive`/
  `isRadioExclusive`, and sets `schedule_updated_at` to our own sync time (Astro supplies none).
  The same mapper backs both `prisma/seed.ts` and `SyncService.upsertAll()`, sharing one fixture
  file between seeding and tests. Sync is idempotent, fails gracefully if Astro is down, and never
  deletes a channel just because it's missing from a given response — missing channels are left
  in place. An `npm run sync` script triggers it on demand.
- **Files:** `backend/src/astro/astro-client.ts`, `backend/src/astro/astro.mapper.ts`,
  `backend/src/sync/sync.service.ts`, `backend/prisma/seed.ts`,
  `backend/test/fixtures/astro-response.json`, `backend/package.json` (sync script)
- **Done when:** `npm run sync` and `prisma db seed` (same mapper) insert/upsert the 167
  channels; rerunning either leaves the row count unchanged; a channel absent from a later fetch
  stays in the database; a mocked Astro failure logs cleanly without crashing.
- **Tests:** unit test loading the fixture and asserting the mapped output — including the two
  "Astro GO Channel" records, whose subtitle passes through unmodified, never assumed to start
  with "CH "; upsert idempotency; a "missing from response is retained" test; failure handling.
- **Commit:** `feat(backend): add Astro client, shared mapper, seed and sync service`
- **Time:** ~3 hrs.

## 5. Channels API: list, detail, filters + global security middleware

- **Goal:** wire global NestJS setup — `helmet`, CORS restricted to an env-configured origin
  (`CORS_ORIGIN`), and a global `ValidationPipe` with whitelist (strip unknown properties). Then
  `GET /channels` (search/sort/filter/pagination), `GET /channels/:id`, `GET /channels/filters`.
  Search: the channel-number term matches exactly; the title term matches "contains" — both
  case-insensitive. Numeric `stbNumber` sort with a stable tie-break — sort field, then channel
  id — so infinite-scroll pages never repeat or skip a row.
- **Files:** `backend/src/main.ts`, `backend/src/channels/*`
- **Done when:** a cross-origin request from outside `CORS_ORIGIN` is blocked; an unexpected
  body/query field is stripped by the whitelist; `curl` against the seeded DB returns correct
  paginated/sorted/filtered results; bad params → 400; unknown id → 404.
- **Tests:** Supertest for CORS/helmet headers and whitelist stripping; search tests ("100" exact
  match on channel number, a partial title string as a contains-match, both case-insensitive);
  sort asc/desc with tie-break; filter combinations; validation errors; 404.
- **Commit:** `feat(backend): add channels list, detail and filters endpoints with global security middleware`
- **Time:** ~5 hrs.

## 6. Favourites + Commands foundation (synchronous, pre-queue)

- **Goal:** `commands` table + `CommandsService` (persist PENDING, resolve synchronously for
  now); `Favourites` controller is a thin wrapper calling the same `CommandsService.enqueue(...)`
  used by `POST /commands` — one write path, two routes; `GET /favourites`; `X-User-Id` handling;
  idempotent add/remove.
- **Files:** `backend/src/commands/*`, `backend/src/favourites/*`
- **Done when:** `POST /favourites` → `GET /favourites` reflects it; resubmitting the same client
  UUID doesn't create a duplicate row; removing a non-favourite still succeeds.
- **Tests:** Supertest for the three endpoints; unit tests for handler idempotency and the shared
  enqueue path.
- **Commit:** `feat(backend): add favourites and synchronous commands foundation`
- **Time:** ~3 hrs.

## 7. Frontend scaffold + channel list + anonymous user id

- **Goal:** Next.js app, TanStack Query + Zustand, URL-synced search/sort/filter, infinite scroll
  against `GET /channels`, responsive layout with a filter drawer, loading/error/empty states.
  Cards render the `subtitle` string exactly as the API returns it — never assume a `"CH "`
  prefix (two real channels don't have one). On first load, generate an anonymous user ID,
  persist it in `localStorage`, and attach it as `X-User-Id` on every API request from here on.
- **Files:** `frontend/app/(channels)/page.tsx`, `frontend/components/ChannelCard`, `SearchBar`,
  `SortControl`, `FilterDrawer`, `frontend/lib/api.ts` (adds `X-User-Id`),
  `frontend/lib/user-id.ts`, `frontend/store/*`
- **Done when:** the real 167 seeded channels render, scroll loads more, search/sort/filter
  update the URL and results, layout holds at 360px width; every request carries a stable
  `X-User-Id` that survives a reload.
- **Tests:** RTL tests for debounce, sort change, filter combination, the three UI states, a card
  rendering the non-"CH" subtitle unmodified, and a test asserting the same user id is reused
  across reloads/requests.
- **Commit:** `feat(frontend): add channel listing with search, sort, filter, infinite scroll and anonymous user id`
- **Time:** ~6 hrs.

## 8. Channel details page + favourites UI

- **Goal:** `/channels/:id` route (schedule, logo, category, languages, genres, last-updated, a
  Refresh button — UI only, not yet wired to a real command; wiring happens in Task 10),
  not-found page, favourite toggle on card and detail with optimistic update + rollback,
  dedicated Favourites view.
- **Files:** `frontend/app/channels/[id]/page.tsx`, `frontend/app/favourites/page.tsx`,
  `frontend/components/FavouriteButton`, `frontend/components/RefreshButton` (UI only)
- **Done when:** toggling favourite updates instantly and survives reload; a forced failed
  mutation visibly rolls back; the Refresh button renders but doesn't dispatch anything yet.
- **Tests:** RTL test forcing a failed mutation and asserting rollback; favourites-view filtering
  test.
- **Commit:** `feat(frontend): add channel details page and favourite toggle with rollback`
- **Time:** ~3 hrs.

## 9. Queue, worker and command handlers

- **Goal:** move `CommandsService` from the synchronous resolution built in Task 6 onto BullMQ:
  enqueue a job using the command's own client-generated UUID as the BullMQ job ID, so
  re-enqueuing (from the recovery sweep or a resent request) can't create a duplicate job.
  Separate worker entrypoint, one handler class per command type. `ADD_FAVORITE`/
  `REMOVE_FAVORITE` handlers apply per-(user, channel) ordering by sequence number, so a stale
  add-after-remove or remove-after-add is skipped.
- **Files:** `backend/src/commands/handlers/*`, `backend/src/worker/*`, `backend/src/queue/*`,
  `backend/src/commands/commands.service.ts` (updated)
- **Done when:** enqueuing the same UUID twice produces one BullMQ job; two conflicting commands
  for the same (user, channel) resolve to the later one by sequence number.
- **Tests:** job-id-dedup test (same UUID enqueued twice → one job); per-(user, channel) ordering
  unit tests for the favourite handlers.
- **Commit:** `feat(backend): move commands onto BullMQ with per-handler ordering`
- **Time:** ~3 hrs.

## 10. Recovery sweep, REFRESH_CHANNEL and outage test

- **Goal:** recovery sweep runs on API/worker start, on Redis reconnect, and on a 5-10 second
  periodic backstop, re-enqueuing PENDING commands. The `REFRESH_CHANNEL` handler keeps an
  **in-memory**, ~60-second cached copy of the Astro channel list — independent of the Redis
  response cache built in Task 13, so refresh collapsing still works even if that task is cut —
  so concurrent refresh requests for the same channel make one Astro call; once it resolves,
  every pending `REFRESH_CHANNEL` command for that channel is marked DONE, even across different
  users. Wire the frontend Refresh button (built in Task 8) to actually dispatch
  `REFRESH_CHANNEL`.
- **Files:** `backend/src/commands/handlers/refresh-channel.handler.ts`,
  `backend/src/worker/recovery-sweep.ts`, `backend/src/astro/astro-list-cache.ts` (in-process
  memory, not Redis), `frontend/components/RefreshButton` (wiring)
- **Done when:** the PRD §9 outage acceptance test passes manually (stop Redis for 5s mid-batch
  across 2 simulated users, restore, all commands end DONE, no duplicate favourites); two users
  refreshing the same channel within the 60s window produce one Astro call and both commands end
  DONE; clicking Refresh in the UI visibly updates the channel.
- **Tests:** collapsing/caching unit test (concurrent refresh → one Astro call, N commands DONE);
  a scripted outage/integration test.
- **Commit:** `feat(backend): add recovery sweep and REFRESH_CHANNEL collapsing`
- **Time:** ~3.5 hrs.

## 11. Frontend command outbox + status reconciliation

- **Goal:** a `localStorage` outbox holds commands the API couldn't accept, resending them with
  the same client UUID (generated in Task 7) once the connection returns. After any command is
  submitted, the UI tracks its 202/PENDING state and reconciles it against the real state on the
  next read (poll `GET /commands/:id` or refetch the affected query).
- **Files:** `frontend/lib/outbox.ts`, `frontend/hooks/useCommandStatus.ts`, `frontend/store/*`,
  pending-state UI indicators
- **Done when:** submitting a command while the API is unreachable queues it in `localStorage`;
  reconnecting resends it with the same UUID and no duplicate is created; a submitted command
  visibly shows pending-then-resolved state in the UI.
- **Tests:** unit test for outbox persistence and resend-with-same-UUID; a test asserting the UI
  reflects PENDING → DONE reconciliation.
- **Commit:** `feat(frontend): add offline command outbox and status reconciliation`
- **Time:** ~3 hrs.

## 12. Rate limiting + health endpoint

- **Goal:** rate limiting on exactly `POST /commands`, `POST /favourites`, and
  `DELETE /favourites/:channelId`; `/health` checking DB and Redis connectivity.
- **Files:** `backend/src/health/*`, `backend/src/main.ts` (rate limiter config)
- **Done when:** the three named write endpoints hit 429 under rapid repeat calls, other
  endpoints don't; `/health` returns 200 normally and 503 with DB or Redis down.
- **Tests:** Supertest for `/health` both states; a 429-threshold test scoped to exactly those
  three routes.
- **Commit:** `feat(backend): add rate limiting and health endpoint`
- **Time:** ~1.5 hrs.

## 13. Redis response caching — cuttable (2nd to cut)

- **Goal:** cache-aside for `GET /channels` (30-60s TTL — list cache keys are combinatorial and
  can't be precisely invalidated) and `GET /channels/:id` (exact-key invalidation on refresh).
- **Files:** `backend/src/common/cache/*`
- **Done when:** repeated `GET /channels` is served from cache within the TTL window; a
  refreshed channel's detail cache is invalidated immediately.
- **Tests:** unit test for cache-aside/TTL logic and detail-cache invalidation on refresh.
- **Commit:** `feat(backend): add Redis response caching`
- **Time:** ~2 hrs. **Cuttable — cut 2nd if short on time.**

## 14. Close test gaps

- **Goal:** fill remaining unit/integration gaps in both apps so the suites match what the PRD's
  testing strategy (§10) promises; confirm strict TypeScript and lint pass clean. Mandatory —
  not part of the cuttable set below.
- **Files:** assorted test files in `backend/` and `frontend/`
- **Done when:** `npm test` passes clean in both `/frontend` and `/backend`, with no known gap
  left against the PRD's testing-strategy table.
- **Tests:** this task is the tests.
- **Commit:** `test: close remaining testing gaps`
- **Time:** ~1.5 hrs.

## 15. CI workflow — cuttable (1st to cut)

- **Goal:** GitHub Actions workflow running `npm test` in both apps on push.
- **Files:** `.github/workflows/ci.yml`
- **Done when:** CI is green on push for both apps.
- **Tests:** none — this wraps the suites from Task 14.
- **Commit:** `ci: add github actions workflow`
- **Time:** ~1.5 hrs. **Cuttable — cut 1st if short on time.**

## 16. README, architecture diagram, release notes

- **Goal:** finish `README.md` (setup/run/test/design decisions/assumptions/scope cuts,
  fresh-clone verified) on top of the Task 1 stub; a real architecture diagram in
  `docs/architecture` (Frontend/Backend/DB/Queue/Astro); `RELEASE_NOTES.md`. README must
  explicitly list what was **not attempted** — end-to-end tests, AWS/serverless — not just what
  shipped.
- **Files:** `README.md`, `docs/architecture/*`, `RELEASE_NOTES.md`
- **Done when:** a reviewer following only `README.md` from a fresh clone (`git clone` →
  `docker compose up` → two `npm run dev`) sees the app working end-to-end; the README's
  "not attempted" section names end-to-end tests and AWS explicitly.
- **Tests:** manual fresh-clone run-through.
- **Commit:** `docs: add README, architecture diagram and release notes`
- **Time:** ~3 hrs.

## 17. (Optional) Channel range filter — rangeKey — cuttable (3rd to cut)

- **Goal:** add `rangeKey` as a first-class filter: a `range` query param on `GET /channels`, the
  available ranges returned by `GET /channels/filters`, and a range control in the UI alongside
  category/language/genre.
- **Files:** `backend/src/channels/*` (query param + filters endpoint), a new frontend range
  control component
- **Done when:** `GET /channels?range=200_299` returns only that bucket; `GET /channels/filters`
  lists all 8 ranges; the UI control filters the list and updates the URL like the other filters.
- **Tests:** Supertest for the range query param and filters listing; RTL test for the range
  control combined with existing filters.
- **Commit:** `feat: add channel range filter (rangeKey)`
- **Time:** ~2.5 hrs. **Cuttable — attempt last, only if Tasks 1-16 are done and time remains.**
- **Note:** you re-export `docs/prd.md` yourself to record this decision; no PRD edits happen
  here.
