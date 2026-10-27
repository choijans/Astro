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

- **Goal:** the `REFRESH_CHANNEL` handler keeps an **in-memory**, ~60-second cached copy of the
  Astro channel list — independent of the Redis response cache built in Task 13, so refresh
  collapsing still works even if that task is cut — so concurrent refresh requests for the same
  channel make one Astro call; once it resolves, every pending `REFRESH_CHANNEL` command for that
  channel is marked DONE, even across different users. Wire the frontend Refresh button (built in
  Task 8) to actually dispatch `REFRESH_CHANNEL`.
- **Files:** `backend/src/commands/handlers/refresh-channel.handler.ts`,
  `backend/src/astro/astro-list-cache.ts` (in-process memory, not Redis),
  `frontend/components/RefreshButton` (wiring)
- **Done when:** two users refreshing the same channel within the 60s window produce one Astro
  call and both commands end DONE; clicking Refresh in the UI visibly updates the channel.
- **Tests:** collapsing/caching unit test (concurrent refresh → one Astro call, N commands DONE).
- **Commit:** `feat(backend): add REFRESH_CHANNEL collapsing and wire the Refresh button`
- **Time:** ~2 hrs.

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
