# Release notes

## v1.0.0 (28 Oct 2026)

First complete submission of the Astro Channel Management Portal: browse channels, view details, manage favourites, and process user commands through a queue that survives short outages.

## What's included

### Channels
- Channel list with search (title, or exact channel number), sorting (channel number, title, ranking, ascending or descending) and filters (category, language, genre). Filters combine with search and sort, and the whole view lives in the URL, so it can be shared and survives a reload.
- Infinite scroll: 24 channels per page, with a stable order (sort field, then channel ID) so no channel repeats or is skipped, even though many channels share a ranking.
- Cards show the logo, title, subtitle, what is on now (highlighted) and what is on next. The API computes these two shows from the stored schedule when the list is requested and never sends the whole schedule.
- Channel details page: logo, title, category, genre and language chips, the schedule (only entries that have not ended, with the current one highlighted), and when the data was last updated.
- Responsive layout from 360px to desktop, with the filters in a dialog (collapsible groups, Reset, Apply).
- Loading, error (with retry) and empty states on every data view.

### Favourites
- Favourite from a card or the details page, with a Favourites page. The heart flips immediately and rolls back with a message if the command fails.
- While a command is still being processed the heart keeps its new state, even if a refetch returns older data. The frontend polls the command's status until it is DONE or FAILED.

### Command queue (the queue challenge)
- `ADD_FAVORITE`, `REMOVE_FAVORITE` and `REFRESH_CHANNEL` all go through one write path (`CommandsService.enqueue`). The favourites routes are thin wrappers over it.
- Every command is saved in PostgreSQL as PENDING before it is queued, then processed by a separate worker process (BullMQ on Redis) with retries and exponential backoff.
- The client-generated command ID is both the idempotency key and the job ID, so a resend or re-enqueue never creates a duplicate.
- Add and remove for the same user and channel are applied in order, using a Postgres advisory lock and a server-assigned sequence number. A command is skipped if a newer one for the same user and channel was already applied.
- `REFRESH_CHANNEL` re-reads one channel from Astro. Concurrent refreshes share one Astro request through a 60-second in-memory copy of the list, and an older snapshot can never overwrite a newer one.
- Recovery sweep: re-enqueues PENDING commands when the API or worker starts, when Redis reconnects, and every 5 seconds. It also recovers commands stuck in PROCESSING (for example if a worker died mid-job).
- Outage test (`npm run test:outage`): submits interleaved commands from two users and stops Redis for 5 seconds (then the worker for 5 seconds). Every command ends DONE, with no duplicate favourites and a final state equal to each user's last command. Latest run: about 6.7 s for the Redis scenario and 5.5 s for the worker scenario.

### Backend platform
- NestJS API with validation (whitelisting), helmet, CORS limited to the configured origins, and one consistent error shape (`statusCode`, `message`, `error`).
- Rate limiting on the three write routes (`POST /commands`, `POST /favourites`, `DELETE /favourites/:channelId`), returning 429 with `Retry-After`.
- `GET /health` checks PostgreSQL and Redis, each with its own timeout, and never exposes connection details.
- Prisma schema and migrations, a seed script that loads a saved copy of Astro's response through the same mapper the live sync uses, and `npm run sync` to pull fresh data.

## Bonus requirements

| Bonus item | Status | Notes |
|---|---|---|
| Queue processing | Done | BullMQ and Redis, separate worker, retries, ordering, recovery sweep |
| Offline recovery | Done | Server side: recovery sweep on start/Redis-reconnect/5s timer, tested by the outage test. Client side: a `localStorage` outbox for favourite toggles only — a network failure (not an HTTP error) queues the command under the UUID it was about to send, with no rollback; the outbox flushes sequentially, single-flight, on app load, the `online` event, the tab becoming visible, and its own 2s→30s backoff retry timer, resending with the same UUIDs so the server's idempotency rule applies |
| Redis caching | Done | Cache-aside on `GET /channels` and `GET /channels/:id`, short TTLs, fails open |
| CI/CD pipeline | Not attempted | |
| AWS serverless components | Not attempted | Out of scope for the time available |
| End-to-end testing | Partial | API-level integration tests run against a real test database and a real Redis. Browser-driven end-to-end tests were not attempted. |

## Testing

| Suite | Tool | Result |
|---|---|---|
| Backend unit | Jest | 127 tests, 21 suites |
| Backend API / integration | Jest and Supertest, against a separate `astro_test` database and a separate test queue | 66 tests, 9 suites |
| Frontend components | Jest and React Testing Library | 115 tests, 17 suites |
| Outage scenario | `npm run test:outage` | Passes (see above) |

Lint exits 0 in both apps. The backend has 19 `no-unsafe-argument` warnings, all in the integration tests (supertest's `any`-typed response body); the frontend has none.

The integration tests refuse to run unless the database name is `astro_test` and the queue is the test queue, so they cannot touch development data.

## Stack and versions

Node 20 (see `.nvmrc`). Every version below was checked against `package.json`/the resolved install.

| Area | Choice |
|---|---|
| Frontend | Next.js 16.4.3, React 19.3, TypeScript, Tailwind CSS, Zustand 5.0.16, TanStack Query 5.104.5 |
| Backend | NestJS 11.2, TypeScript, `@nestjs/throttler` 6.7 |
| Database | PostgreSQL 16 (Docker), Prisma 7.10.1 with the `pg` driver adapter |
| Queue | BullMQ 6.4.2, ioredis 5.11.1, Redis 7 (Docker) |
| Testing | Jest 30, React Testing Library 16, Supertest |

Two version choices were deliberate:
- **Prisma is pinned to 7.10.1.** The npm `latest` tag currently points at an 8.0.0 release candidate, so an unpinned install would silently pick it up.
- **NestJS stays on 11.** Version 12 is new, and the project was on a short timeline, so the proven major was the lower-risk choice.

## Known limitations

- **No authentication.** Identity is an anonymous user ID generated in the browser and sent as `X-User-Id`. Because the rate limiter keys on that ID, a client that invents a new ID per request avoids the limit. A real deployment would use a server-issued identity and add IP-based limiting.
- **Rate-limit counters and the Astro list copy are per process.** Running several API or worker instances would give each its own counters and its own 60-second copy of Astro's list.
- **Schedules go stale between syncs.** The stored schedule is only as fresh as the last sync or refresh. When every stored entry has ended, cards show "Schedule not available" until the channel is refreshed or `npm run sync` runs.
- **The Astro API is undocumented.** The adapter and the saved fixture isolate the app from changes, but a change upstream could break syncing. The app keeps serving stored data if Astro is down.
- **A command already sent to the server and still PENDING/PROCESSING when the page reloads** shows the server's current state until the worker catches up — that part of the pending overlay is held only in memory. A command queued in the offline outbox is the exception: its pending state is rebuilt from `localStorage` on reload.
- **Scroll position is not restored** when returning from a details page. The previous filters are restored.
- **The security audit flags a high-severity advisory in `multer`,** pulled in by `@nestjs/platform-express`. No upstream fix existed at the time of the build, and the app has no file upload endpoints, so it is not reachable.
- **Test-suite noise.** The integration tests print a Node `MaxListenersExceededWarning` and some logged "command not found" lines from jobs that finish after a test's tables were cleared. The tests pass. They run serially (`maxWorkers: 1`) because they share one database, and need `--experimental-vm-modules` because Prisma 7's engine loads dynamically.
- **Running the outage test stops the shared Redis container** for a few seconds, which interrupts a running development session.

## Not attempted

- AWS serverless components.
- Browser-driven end-to-end tests.
- Authentication and user accounts.
- Channel number range filter (`rangeKey`).
- CI/CD pipeline.
- A "what's on now" row above the channel grid.
- Dark mode.

## Development notes

The project was built in small, reviewed steps (one branch per task, merged after each task's checks passed), starting from a written PRD. Claude Code was used as a coding assistant during development. See the "How I built this" section of the README for what was decided and written by the author and what was AI-assisted.
