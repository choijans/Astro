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
- **Note:** verified the default Nest error shape is `{statusCode, message, error}` and left it
  as-is — `message` is a string for most errors but an array of strings for `ValidationPipe`
  failures; both are valid, but Task 7's frontend error handler must accept both. Also: `q` is
  capped at 100 characters, and a numeric `q` outside Postgres's `integer` range (e.g.
  `99999999999999`) is treated as non-numeric rather than passed to Postgres — it previously
  caused a 500.

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

## 7. Backend now/next show + frontend scaffold and channel list

Two parts, kept as two commits on one branch so Part A can be reviewed/committed on its own.

### Part A — `now`/`next` show on list items (backend)

- **Goal:** `GET /channels` and `GET /favourites` items each gain `now` and `next`
  (`{title, start, end}` or `null`), computed from the stored `schedule` at request time —
  `now` is the entry with `start <= clock() < end`; `next` is the first entry starting at or
  after `now.end` (or after `clock()` if there's no `now`). Both `null` if nothing in the stored
  schedule qualifies. The full `schedule` is still never included. One shared mapping function
  backs both endpoints; the clock is injectable so tests are deterministic.
- **Files:** `backend/src/channels/channel-schedule.util.ts` (or similar shared mapper),
  `backend/src/channels/channels.repository.ts`, `backend/src/favourites/favourites.repository.ts`,
  a `Clock`/`CLOCK` injectable.
- **Done when:** unit tests cover inside-a-show, between-shows, last-item, all-in-the-past and
  empty-schedule cases; e2e tests with the clock fixed inside the fixture's schedule window
  confirm `now`/`next` are present and `schedule` is absent; all existing tests still pass.
- **Tests:** unit (schedule computation) + e2e (fixed clock against real seeded data).
- **Commit:** `feat(backend): add now and next show to channel list items`

### Part B — frontend scaffold + channel list

- **Goal:** Next.js app (App Router, TypeScript, Tailwind, Jest + RTL), TanStack Query +
  Zustand, URL-synced search/sort/filter (URL is the single source of truth — not duplicated
  into Zustand), infinite scroll against `GET /channels`, filter dialog (native `<dialog>`),
  responsive grid, loading/error/empty states. Cards render the `subtitle` string exactly as the
  API returns it — never assume a `"CH "` prefix — plus the new Now/Next rows from Part A. No
  category on the card (superseded FR-1's older card description — see Task 7 note). On first
  load, generate an anonymous user ID, persist it in `localStorage`, attach it as `X-User-Id` on
  every API request.
- **Files:** `frontend/app/page.tsx`, `frontend/components/ChannelCard`, `SearchBar`,
  `SortControl`, `FilterDialog`, `frontend/lib/api.ts` (adds `X-User-Id`),
  `frontend/lib/user-id.ts`, `frontend/store/*`
- **Done when:** the real 167 seeded channels render with Now/Next, scroll loads more,
  search/sort/filter update the URL and results, layout holds at 360px/~800px/desktop; every
  request carries a stable `X-User-Id` that survives a reload.
- **Tests:** RTL tests for debounce, sort change, the filter dialog's stage/Apply/Reset/X/Escape
  behavior, filter combination, the three UI states, a card rendering the non-"CH" subtitle and
  null Now/Next, the infinite-scroll sentinel, the user id being created once and reused, and the
  error handler accepting both string and array `message`.
- **Commit:** `feat(frontend): add channel listing with search, sort, filter, infinite scroll and anonymous user id`
- **Time:** ~8 hrs (6 original + ~2 for Part A and the dialog/Now-Next work).
- **Note:** the backend's error shape is `{statusCode, message, error}`, but `message` is a
  plain string for most errors and an **array of strings** for `ValidationPipe` failures — this
  is standard Nest behavior, left as-is (see Task 5 notes). The frontend's error handler must
  accept both forms when rendering an error message.
- **Note:** PRD FR-1 still lists "category" as a card field; this task's explicit instructions
  (no category, Now/Next instead) supersede it — FR-1's wording needs updating on next PRD
  re-export, not done here.

## 8. Channel details page + favourites UI

- **Goal:** `/channels/:id` route (schedule, logo, category, languages, genres, last-updated, a
  Refresh button — UI only, not yet wired to a real command; wiring happens in Task 10),
  not-found page, favourite toggle on card and detail with optimistic update + rollback,
  dedicated Favourites view.
- **Files:** `frontend/app/channels/[id]/page.tsx`, `frontend/app/favourites/page.tsx`,
  `frontend/components/{FavouriteButton,ChannelDetailsPage,ChannelDetailsSkeleton,
  FavouritesPage,NotFoundChannel,BackToChannelsLink,ChannelLogo,HeartIcon,SiteHeader}`,
  `frontend/hooks/{useFavouritesQuery,useToggleFavourite,useChannelQuery}.ts`,
  `frontend/lib/schedule.ts`
- **Done when:** toggling favourite updates instantly and survives reload; a forced failed
  mutation visibly rolls back; the Refresh button renders but doesn't dispatch anything yet.
- **Tests:** RTL coverage for `FavouriteButton` (optimistic flip, unique command UUID per click,
  rollback on HTTP error, rollback on a `FAILED` command status, in-flight clicks ignored,
  keyboard operability, no navigation on click), `FavouritesPage` (shows only favourites, empty
  state, error state, optimistic removal with rollback), and `ChannelDetailsPage` (chips, schedule
  filtering/highlighting, "Schedule not available", disabled Refresh, 404 vs. bad-id vs. other
  errors).
- **Known caveat (manual verification, not a Task 8 regression):** `lib/api.ts`'s `apiFetch` has no
  client-side request timeout. In one manual outage test, killing the backend mid-connection left
  a pooled keep-alive socket that never produced a network error, so the optimistic favourite
  stayed flipped indefinitely with no rollback or status message — a real "any HTTP error" never
  arrived because the browser's `fetch` never settled. A fresh connection (no pooled socket) fails
  fast (~tens of ms–2s) and rolls back correctly, which is what the RTL tests exercise via mocked
  rejections. Flagged for a future task if a request timeout is wanted; out of Task 8's scope as
  specified.
- **Back to channels:** uses `router.back()` (falling back to `router.push('/')` if there's no
  history), so the list's previous search/sort/filter URL is restored via browser history. Scroll
  position is not restored.
- **Commit:** `feat(frontend): add channel details page and favourite toggle with rollback`
- **Time:** ~3 hrs.

## 9. Queue, worker and command handlers

- **Goal (Part A, backend):** move `CommandsService` from the synchronous resolution built in
  Task 6 onto BullMQ: `enqueue()` persists the command as PENDING, then adds a job (named after
  the command type, `jobId` = the command UUID, payload = only the command id — the worker
  reloads the row, the database stays the source of truth) behind the same `ICommandProcessor`
  interface. A queue-add failure (Redis down) is logged and still returns 202 PENDING; an
  idempotent replay of a still-PENDING command retries the job add (safe via `jobId`), but a
  DONE/FAILED command is never re-added. A separate worker process (`src/worker.ts`,
  `NestFactory.createApplicationContext`) with its own `WorkerModule`, graceful shutdown on
  SIGINT/SIGTERM, concurrency from env (default 5), 6 retries with exponential backoff from 1s,
  and bounded `removeOnComplete`/`removeOnFail`. The job processor loads the command row, skips
  duplicate delivery of a DONE/FAILED command, marks PROCESSING, runs the handler, marks DONE (or
  PENDING-then-rethrow mid-retry / FAILED on the last attempt). `ADD_FAVORITE`/`REMOVE_FAVORITE`
  for the same (user, channel) are applied in seq order: a `pg_advisory_xact_lock`-guarded
  transaction makes the "is this superseded by an already-applied higher-seq command" check and
  the handler's write atomic. `REFRESH_CHANNEL`, the recovery sweep, caching, rate limiting and
  `/health` are explicitly out of scope here.
- **Goal (Part B, frontend):** the 202 response is now PENDING, not DONE, so after a favourite
  toggle the optimistic state is kept and `GET /commands/:id` is polled (~500ms, up to ~15s)
  until DONE (then favourites is refetched) or FAILED (then rolled back, message shown); an HTTP
  error still rolls back immediately. While a channel's command is pending, a small per-channel
  "pending desired state" UI overlay (not the favourites cache) keeps the heart showing the
  intended state even through a refetch that returns stale data. A polling timeout stops polling,
  leaves the heart as-is, and shows a quiet "Still syncing" message, letting the normal refetch
  reconcile later. This absorbed the status-reconciliation half of what Task 11 originally
  planned — Task 11 keeps only the outbox, the request timeout and offline handling.
- **Files:** `backend/src/commands/handlers/*` (updated to take a `Prisma.TransactionClient`),
  `backend/src/commands/queue-command-processor.ts`, `backend/src/worker/*`, `backend/src/queue/*`,
  `backend/src/worker.ts`, `backend/tsconfig.worker.json` (separate build output so the worker's
  dev build can't collide with the API's `nest start --watch`), `backend/src/commands/commands.service.ts`,
  `backend/src/commands/commands.repository.ts`, `backend/src/commands/command-handler.interface.ts`,
  `backend/src/commands/commands.module.ts` (updated), `backend/src/scripts/prepare-test-db.ts`
  (also flushes the test Redis database), `backend/test/e2e-helpers.ts`, `backend/test/now-next.e2e-spec.ts`
  (updated to poll), `frontend/hooks/useToggleFavourite.ts`, `frontend/lib/poll-command.ts`,
  `frontend/store/pending-favourites-store.ts`, `frontend/components/FavouriteButton.tsx` (updated)
- **Done when:** enqueuing the same UUID twice produces one BullMQ job; two conflicting commands
  for the same (user, channel) resolve to the later one by sequence number; a favourite goes
  PENDING then DONE with the worker running, stays PENDING with it stopped (heart stays flipped),
  and is processed once the worker starts.
- **Tests:** job-id-dedup test (same UUID enqueued twice → one job); queue-add-failure-leaves-
  PENDING test; processor unit tests (success; retries then succeeds; attempts exhausted → FAILED;
  duplicate DONE delivery skipped; superseded command skipped); e2e against real Docker Redis
  (202 → polled DONE; duplicate command id; concurrent add/remove ends correct; ~50-command
  interleaved stress test; failing queue leaves PENDING); RTL tests for the polling/overlay/
  timeout behavior.
- **Commit:** `feat(backend): move commands onto BullMQ with per-handler ordering` (backend),
  `feat(frontend): poll command status after a favourite toggle` (frontend, separate commit)
- **Found and fixed (pre-existing bug):** `package.json`'s `start:prod` script pointed at
  `node dist/main`, the wrong compiled path, since before this task — the real output lands at
  `dist/src/main.js` (same reason `seed`/`sync`/`start:worker` all use `dist/src/...`). Fixed to
  `node dist/src/main.js` and smoke-tested; it's a script a reviewer might actually try, unlike an
  unrelated script that's merely present.
- **Time:** ~5 hrs.

## 10a. Recovery sweep and outage test

- **Goal:** `RecoverySweepService` finds commands still PENDING (oldest seq first, in batches —
  env `SWEEP_BATCH_SIZE`, default 200), skipping anything created within the last 2 seconds (so a
  request still mid-enqueue isn't raced), and re-adds each through the same job-add path used for
  a fresh command (job id = command UUID, so re-adding an already-queued/active job is a no-op).
  Never touches DONE, FAILED or PROCESSING commands; never throws (a queue/Redis error is logged,
  the next pass tries again); passes never overlap. Triggers: the worker runs a pass on start, on
  every Redis reconnect (its Queue connection's `ready` event, skipping the very first one), and
  on an interval (env `SWEEP_INTERVAL_MS`, default 5000); the API runs one pass on start only
  (both get this via `RecoverySweepService`'s own `OnModuleInit`, since `QueueModule` is in both
  processes' dependency graph — the worker's interval/reconnect wiring is the only
  worker-specific addition). A scripted outage acceptance test (`npm run test:outage`, separate
  from `test:e2e` because it stops the real Docker Redis container) runs two scenarios — a 5s
  Redis outage and a 5s worker outage — each with ~30 interleaved add/remove commands from 2
  users, and asserts every command ends DONE, no duplicate favourites, correct final state per
  (user, channel), and no duplicate jobs.
- **Explained, not built (needs a decision before implementing):** a command stuck in PROCESSING
  when its worker dies is only recovered via BullMQ's own stalled-job detection (default
  `stalledInterval` ~30s) — slower than the 5-10s target, and *not* recovered at all if the
  underlying job record is also lost (the sweep deliberately excludes PROCESSING, and a lost job
  gives the stalled-check nothing to find). Redis's container does persist the named volume with
  RDB snapshots on its default config, so an ordinary `docker compose stop/start` (as used by the
  outage test) survives; only a harder crash before a snapshot, or removing the volume, loses
  queued state — and for anything still PENDING in Postgres, the sweep recovers it regardless,
  since it never depends on prior Redis state. The gap is specifically the PROCESSING window.
  Proposed fix (not implemented): track when a command most recently entered PROCESSING, and have
  the sweep also re-enqueue one stuck well past a stalled-job's own recovery window — re-running
  an idempotent handler is safe. Needs a schema column; left for a follow-up decision.
  **Empirically confirmed, not just theoretical:** the outage test's scenario (a) hit exactly this
  path twice (a job's lock was lost mid-reconnect — "Missing lock for job ... moveToFinished") and
  relied on BullMQ's stalled-job recovery to resolve it; one run recovered in 7.8s, another took
  60.4s — right at the test's own 60s give-up threshold. Both runs still passed, but the margin
  was thin enough that this is a live flakiness risk, not a hypothetical one.
- **Files:** `backend/src/queue/recovery-sweep.service.ts`, `backend/src/queue/job-enqueuer.service.ts`
  (shared add-job path, used by both `QueueCommandProcessor` and the sweep), `backend/src/queue/queue.module.ts`
  (updated), `backend/src/queue/queue.config.ts` (updated), `backend/src/worker/worker-sweep-scheduler.service.ts`,
  `backend/src/worker/worker.module.ts` (updated), `backend/src/commands/commands.repository.ts` (updated),
  `backend/src/commands/queue-command-processor.ts` (updated to use the shared enqueuer),
  `backend/test/outage.outage-spec.ts`, `backend/test/jest-outage.json`
- **Done when:** `npm test`, `npm run test:e2e` (twice) and `npm run test:outage` all pass; `npm run build`
  is clean.
- **Tests:** unit tests for the sweep (PENDING only, seq order, batch size, 2s grace, skips
  DONE/FAILED/PROCESSING, swallows queue errors, never overlaps); an e2e test forcing the queue
  add to fail, confirming PENDING persists, then a sweep pass reaches DONE, and a second pass
  doesn't duplicate the job or favourite; the two outage scenarios above.
- **Commit:** `feat(backend): add recovery sweep and outage test`
- **Time:** ~4 hrs.

### Follow-up: stale-PROCESSING recovery (implemented)

Closes the gap named above in "Explained, not built." `commands` gained a nullable
`processingStartedAt` column (new migration, the `20261025054039_init` migration was left
untouched), set by `markProcessing` and cleared by every path that leaves PROCESSING (`markDone`,
`markFailed`, `markPendingForRetry`, and the two `tx.command.update` DONE writes inside
`CommandWorkerService.applyOrdered`). The sweep now also finds PROCESSING commands whose
`processingStartedAt` is older than `PROCESSING_STALE_MS` (env, default 45000) and recovers them —
but only after `JobEnqueuerService.prepareStaleJobForReenqueue` confirms BullMQ doesn't still show
an active/waiting/delayed/prioritized/waiting-children job for that id (left alone if so); a
leftover completed/failed/unknown job is removed first, since BullMQ silently ignores an `add()`
for a jobId still on record. Only then is the command reset to PENDING and re-added through the
normal `enqueue()` path — never by re-adding against a still-PROCESSING row directly. The worker's
`lockDuration`/`stalledInterval` were also shortened from BullMQ's 30s/30s defaults to 5s/5s
(`maxStalledCount` left at BullMQ's default of 1), cutting the same-process stalled-recovery window
that produced the 7.8s/60.4s readings above to about 10s worst case; `PROCESSING_STALE_MS`'s
default is set well above that window so BullMQ's own recovery gets first chance, with the sweep as
the backstop for the case BullMQ can't help with at all — a worker process that's gone for good, or
a job that exceeded `maxStalledCount` and was moved to BullMQ's own "failed" bookkeeping without
ever calling our processor again.
- **Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/<new>/migration.sql`,
  `backend/src/commands/commands.repository.ts` (updated), `backend/src/worker/command-worker.service.ts`
  (updated), `backend/src/queue/queue.config.ts` (updated), `backend/src/queue/job-enqueuer.service.ts`
  (updated), `backend/src/queue/recovery-sweep.service.ts` (updated)
- **Tests:** unit tests for the new sweep rules (stale PROCESSING recovered; fresh PROCESSING left
  alone; a leftover failed job removed before re-add; an active job left alone); an e2e test leaving
  a command in PROCESSING with its BullMQ job record deleted, confirming the sweep brings it to DONE.
- **Also in this follow-up:** `npm run lint` split into a check-only `lint` and a fixing `lint:fix`
  (the existing `lint` had `--fix` baked in, which reformatted ~35-40 unrelated files the first time
  it was run during Task 10a — reverted, and structurally prevented going forward); `start:prod` was
  already fixed to `node dist/src/main.js` during Task 9's own follow-up check (confirmed still
  correct, not re-done).
- **Commit:** `fix(backend): recover commands stuck in PROCESSING`

## 10b. REFRESH_CHANNEL collapsing and Refresh button wiring

- **Goal (Part A, backend):** `POST /commands` accepts `REFRESH_CHANNEL` through the same
  `CommandsService.enqueue()` path as the other two types (channel-existence 404 check, persist
  PENDING, enqueue with `jobId` = the command UUID) — the earlier 400 "not supported yet" guard is
  removed. `RefreshChannelHandler` fetches the channel list via `CachedAstroClient`, finds the
  record for the command's `channelId`, maps it with the existing `mapAstroChannel`, and updates
  only that channel's row (never `createdAt`); `scheduleUpdatedAt` is the cache snapshot's own
  fetch time, not the command's processing time, so several commands sharing one cached fetch all
  agree on the same value. `CachedAstroClient` wraps the real `IAstroClient` behind `ASTRO_CLIENT`:
  an in-memory, single-flight cache of the last successful list for `ASTRO_LIST_CACHE_TTL_MS`
  (default 60000) — concurrent calls while the cache is stale merge into one HTTP call, a call
  within the TTL makes none, and a failure is never cached. Only `RefreshChannelHandler` uses it,
  via a new `AstroModule` (first real NestJS-DI registration of `ASTRO_CLIENT` — `npm run sync` and
  the seed script keep constructing `HttpAstroClient`/`FixtureAstroClient` by hand); it's wired into
  `WorkerModule` only, since the API process never talks to Astro. `REFRESH_CHANNEL` is explicitly
  excluded from the per-(user, channel) ordering/supersede check: it collapses per channel across
  every user via the cache instead, and every user's own command must still independently reach
  DONE (PRD §9 rule 4), so there's no "supersede and skip" outcome to protect — re-running the
  idempotent handler is always safe regardless of order. A channel id missing from Astro's current
  list is a permanent failure (`BullMQ`'s `UnrecoverableError`, thrown from the handler and treated
  as final by the worker regardless of attempts left) — retrying within the same command's lifetime
  can't fix it. A transient failure (network, timeout, bad `responseCode`, all surfaced as
  `AstroApiError`) is left to propagate and goes through the normal retry/backoff path.
- **Explained, as asked:** the cache lives in one process's memory, nothing shared (no Redis). With
  today's single worker process that's exactly "one shared ~60s copy." If the worker is ever scaled
  to several instances, each keeps its own independent copy and in-flight request — two
  `REFRESH_CHANNEL` commands landing on two different worker processes at the same moment would
  still each trigger their own Astro call, and their `scheduleUpdatedAt` values could differ by up
  to the TTL. That's an accepted gap: a real fix needs a shared cache/lock (Redis), which is
  deliberately out of scope here, same reasoning as keeping this cache independent of the Redis
  response cache.
- **Goal (Part B, frontend, separate commit):** the Refresh button on `/channels/:id` is enabled.
  Click sends `POST /commands { id: crypto.randomUUID(), type: 'REFRESH_CHANNEL', channelId }`,
  then polls `GET /commands/:id` with the same `pollUntilSettled` favourites already use (not
  copied). No optimistic change: while pending the button is disabled, shows "Refreshing…" and sets
  `aria-busy`; a second click while pending is ignored. On DONE, the channel detail query and every
  channel list query are invalidated so the schedule and "Schedule updated" time refresh. On FAILED
  or an HTTP error, a small non-blocking `role="status"` message appears and the button re-enables.
  On a poll timeout, a quiet "Still refreshing…" message appears, polling stops, and the button
  re-enables — same shape as `FavouriteButton`'s own timeout handling.
- **Files:** `backend/src/commands/commands.service.ts` (updated), `backend/src/astro/cached-astro-client.ts`,
  `backend/src/astro/astro.module.ts`, `backend/src/astro/astro-client.ts` (updated — `@Optional()`
  on `HttpAstroClient`'s `timeoutMs` param so it resolves under Nest's DI container for the first
  time), `backend/src/commands/handlers/refresh-channel.handler.ts`,
  `backend/src/worker/worker.module.ts` (updated), `backend/src/worker/command-worker.service.ts`
  (updated — `UnrecoverableError` handling), `frontend/hooks/useRefreshChannel.ts`,
  `frontend/components/RefreshButton.tsx`, `frontend/components/ChannelDetailsPage.tsx` (updated),
  `frontend/lib/api.ts` (updated — `createCommand`)
- **Done when:** `POST /commands` with `REFRESH_CHANNEL` returns 202 PENDING and ends DONE once the
  worker runs it; two users refreshing the same channel at once produce one Astro call and both
  commands end DONE; a channel missing from Astro's list ends FAILED with no retries; pressing
  Refresh in the UI visibly updates the "Schedule updated" time.
- **Tests:** unit — handler updates only the target row, `scheduleUpdatedAt` equals the fetch time,
  a missing channel fails without retries, a transient failure retries and later succeeds,
  `CachedAstroClient`'s single-flight/TTL/failure-not-cached/fetch-time-exposed behavior, the
  worker's `UnrecoverableError` short-circuit. E2E (test DB/queue, fake Astro client, nothing calls
  the real Astro): 202 → worker → updated detail with a newer `scheduleUpdatedAt`; two concurrent
  refreshes of one channel → one fake-client call, both DONE; unknown channel → 404; missing-from-
  list channel → FAILED with `attempts === 1`; another channel's row is untouched. RTL — click sends
  the right request and starts polling; disabled + `aria-busy` while pending; DONE refetches and
  shows new data; FAILED and HTTP-error both show the message and re-enable the button; a second
  click while pending is ignored; timeout shows "Still refreshing…".
- **Commit:** `feat(backend): add REFRESH_CHANNEL command with shared Astro fetch` (backend),
  `feat(frontend): wire channel refresh button` (frontend, separate commit)
- **Time:** ~4 hrs.

## 11. Frontend command outbox, request timeout and offline handling

- **Goal:** a `localStorage` outbox holds commands the API couldn't accept, resending them with
  the same client UUID (generated in Task 7) once the connection returns. `lib/api.ts`'s
  `apiFetch` gets a client-side request timeout (`AbortSignal.timeout(...)` or equivalent) — Task
  8 found that a dead connection can leave `fetch` never settling at all, so no HTTP error ever
  arrives to roll an optimistic update back; a timeout turns that into a real, handleable error.
  Offline handling (e.g. `navigator.onLine` / `online`/`offline` events) decides when to flush the
  outbox. PENDING → DONE/FAILED status reconciliation itself was moved into Task 9's polling, so
  it isn't repeated here.
- **Files:** `frontend/lib/outbox.ts`, `frontend/lib/api.ts` (request timeout), `frontend/store/*`
  (offline/online state), pending-state UI indicators for outbox items
- **Done when:** submitting a command while the API is unreachable queues it in `localStorage`;
  reconnecting resends it with the same UUID and no duplicate is created; a hung request times out
  and rolls back instead of leaving the UI stuck.
- **Tests:** unit test for outbox persistence and resend-with-same-UUID; a test asserting a
  timed-out request rolls back; an online/offline transition test for outbox flushing.
- **Commit:** `feat(frontend): add offline command outbox and request timeout`
- **Time:** ~2.5 hrs.

## 12. Rate limiting + health endpoint

- **Goal (Part A, backend):** `@nestjs/throttler@^6.7.1` (current stable; peer-compatible with
  `@nestjs/common`/`core@^11` and `reflect-metadata@^0.2.2`, both already pinned), applied via a
  custom `AppThrottlerGuard` with `@UseGuards` on exactly the three write-endpoint handlers
  (`POST /commands`, `POST /favourites`, `DELETE /favourites/:channelId`) — never as a global
  `APP_GUARD`, so reads and `/health` are never limited. Limit/window come from env
  (`RATE_LIMIT_MAX` default 60, `RATE_LIMIT_TTL_MS` default 60000, both milliseconds for the TTL).
  The tracking key is `X-User-Id` when it's a syntactically valid UUID, else the connecting IP —
  see `AppThrottlerGuard`'s own doc comment for the one-paragraph trade-off (a client that rotates
  its UUID per request gets an unlimited budget; IP tracking is unreliable behind an untrusted
  proxy). `AppThrottlerGuard.throwThrottlingException` replaces the library's default
  `ThrottlerException` (which renders as `{statusCode, message}` only) with a plain `HttpException`
  carrying the full `{statusCode, message, error}` shape every other error in this app uses; the
  base guard already sets `Retry-After` (and the `X-RateLimit-*` headers) before that's thrown.
  `GET /health` is hand-written (no `@nestjs/terminus`): `HealthService` runs a Postgres
  `SELECT 1` and a Redis `ping` in parallel, each wrapped in its own 2-second timeout
  (`HEALTH_CHECK_TIMEOUT_MS`) that clears its fallback timer on whichever side wins, so a hanging
  dependency can't hang the endpoint or leak timers. `HealthController` returns `200
  {status:"ok", checks:{database,redis}}` when both are "up", or throws
  `ServiceUnavailableException({status:"error", checks})` (passing an object makes it the entire
  body, no extra wrapper) otherwise. The real error (which can carry a hostname or connection
  string) is only ever logged, never returned.
- **Goal (Part B, frontend, separate commit):** `apiFetch` special-cases a `429` response before
  trying to parse its body: throws `ApiError('Too many requests. Please wait a moment and try
  again.', 429, retryAfterSeconds?)`, reading `Retry-After` if the header is present. Fixed a real
  bug found while doing this: `RefreshButton` was showing a hardcoded generic message for every
  error (including a 429) instead of the real one — now matches `FavouriteButton`'s existing
  pattern (`instanceof Error ? error.message : ...`), so both surfaces show the actual 429 message.
- **Files:** `backend/src/common/rate-limit.config.ts`, `backend/src/common/app-throttler.guard.ts`
  (+ `.spec.ts`), `backend/src/health/*` (`health.module.ts`, `health.controller.ts`,
  `health.service.ts` + `.spec.ts`, `health.tokens.ts`), `backend/src/app.module.ts` (updated —
  registers `ThrottlerModule.forRoot` and imports `HealthModule`), `backend/src/commands/commands.controller.ts`
  / `backend/src/favourites/favourites.controller.ts` (updated — `@UseGuards(AppThrottlerGuard)`
  on the three write handlers only), `frontend/lib/api.ts` (updated), `frontend/components/RefreshButton.tsx`
  (updated — error-message fix).
- **Done when:** the three named write endpoints hit 429 (standard error shape, `Retry-After`
  header) under rapid repeat calls from one tracker; a second tracker is unaffected; the window
  resets; `GET /channels` is never limited even well above the threshold; `/health` returns 200
  normally and 503 (naming the down check) with a dependency failing.
- **Tests:** unit — `AppThrottlerGuard`'s tracker selection and custom exception shape;
  `HealthService` with all up, database down, Redis down, both down, and a check that times out
  (and doesn't leak its fallback timer when it doesn't). E2E — each of the three routes 429s after
  the limit (small limit/window via `overrideProvider(getOptionsToken())`, not env — ES imports are
  hoisted above any same-file `process.env` assignment, so the real fix is overriding the provider
  directly); two different users/trackers have separate counters; the window resets; `GET /channels`
  never limited; `/health` 200 against the real Postgres/Redis and 503 via an overridden
  `HealthService` provider (no container ever stopped); the 503 body never leaks a connection
  string or hostname. RTL — the 429 client error and one favourite toggle failing with 429.
- **Explicitly not built (per instructions):** caching, structured logging, the range filter, the
  offline outbox.
- **Commit:** `feat(backend): add rate limiting and health check` (backend),
  `feat(frontend): show a message when rate limited` (frontend, separate commit)
- **Time:** ~3 hrs.

## 13. Redis response caching

- **Goal:** cache-aside for `GET /channels` and `GET /channels/:id` only — neither response
  carries per-user data, so both are safe to share across every caller. `CacheService` sits on its
  own ioredis connection, separate from BullMQ's (own socket, `cache:` key prefix, same
  `REDIS_URL`/`REDIS_DB` from env — not a separate database). List keys are built from the
  validated DTO's own fields in a fixed order (defaults already applied by `ValidationPipe`), so
  the same filters in a different query-string order hit the same entry
  (`CACHE_LIST_TTL_SECONDS`, default 30); detail keys are per channel id
  (`CACHE_DETAIL_TTL_SECONDS`, default 60). List items carry `now`/`next` computed at request
  time, so a cached list can show a show that already ended, by up to the TTL — accepted
  staleness, documented in the README, not a bug. Detail invalidation is exact: `RefreshChannelHandler`
  deletes the one channel's detail key, but only once its `updateMany` actually affects a row (a
  no-op — an already-fresher snapshot already applied — correctly leaves the cached detail alone).
  `npm run sync` does not invalidate anything; also accepted and documented. Fail open throughout:
  every `CacheService` method (`get`/`set`/`del`) swallows a Redis error and logs a warning instead
  of throwing, and the connection itself is configured so a cache command can never hang a request
  — `commandTimeout: 300` (ioredis's own per-command timeout) covers a slow/stuck connection, and
  `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` stop ioredis from doing what it does by
  default while disconnected (queue commands in memory and wait indefinitely for a reconnect) —
  without these, a down cache could still hang a request even with `commandTimeout` set, since a
  queued command is never actually sent for that timeout to apply to. `CACHE_ENABLED` (default
  true) gates everything; a cached route sets `X-Cache: HIT`/`MISS`, omitted entirely when
  disabled. A cache hit's body is byte-identical to a miss's: `CacheService` stores
  `JSON.stringify`'d values and returns `JSON.parse`'d plain objects on a hit, so Nest's own
  `res.json()` serializes both paths through the same Date-to-ISO-string conversion.
- **Files:** `backend/src/common/cache/*` (`cache.config.ts`, `cache.tokens.ts`, `cache.service.ts`
  + `.spec.ts`, `cache.module.ts`), `backend/src/channels/channels-cache-key.ts` (+ `.spec.ts`),
  `backend/src/channels/channels.controller.ts` / `channels.module.ts` (updated),
  `backend/src/commands/handlers/refresh-channel.handler.ts` (updated — cache invalidation) +
  `.spec.ts` (updated), `backend/src/worker/worker.module.ts` (updated — imports `CacheModule`),
  `backend/src/queue/queue.config.ts` (updated — `getRedisUrl`/`parseRedisUrl` exported for reuse).
- **Done when:** repeated `GET /channels`/`GET /channels/:id` are served from cache within the TTL
  window with an identical body and `X-Cache: HIT`; a refreshed channel's detail cache is
  invalidated immediately; a cache failure never fails or hangs a request.
- **Tests:** unit — key normalisation (same filters in a different order match, different filters
  don't); `CacheService` get/set/del, `wrap`'s hit/miss/disabled/business-error paths, and fail-open
  on both a generic error and a command-timeout error; `RefreshChannelHandler` deletes the detail
  key only when a row was actually written. E2E (real test Redis, `CACHE_ENABLED` flipped to `true`
  for the file and restored after, since env vars are process-global across the single-worker e2e
  run) — list MISS then HIT with an equal body; a different query is its own MISS; the same filters
  in a different parameter order still hit; detail MISS then HIT; a 404 sets no header;
  `CACHE_ENABLED=false` sets no header; a cache backend that errors on every call still returns 200
  from the database (`overrideProvider(CACHE_REDIS_CLIENT)`); detail HIT → `REFRESH_CHANNEL`
  completes → next GET is a MISS showing the new data → the one after that is a HIT again (the
  mutated row is restored in `afterAll` so later e2e files, which share the same suite-wide seeded
  fixture data, aren't affected).
- **Commit:** `feat(backend): add Redis response caching`
- **Time:** ~2 hrs.

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
