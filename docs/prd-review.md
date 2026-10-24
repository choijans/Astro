# PRD Audit — Astro Channel Management Portal

Audit of `docs/prd.md` against `docs/brief.md`, done before any scaffolding (24 Oct 2026).

## 1. VERIFY — real API vs. PRD's Assumptions (§3)

The PRD's Assumptions section (§3) describes the data source only generically ("Astro's public
content API list endpoint") without an actual URL. The real endpoint, found via browser devtools
on `https://www.astro.com.my/content`:

```
GET https://contenthub-api.eco.astro.com.my/api/v2/search-linear?channelGuide=true&platform=acm&channelOrderBy=stbNumber,asc
```

Fetched live: 200 OK, no auth required, 167 channel records.

**Confirmed matches:** every field the PRD lists (`id, title, subtitle, imageUrl, detailUrl,
stbNumber, category, genreKey[], languageKey[], rangeKey, ranking, currentSchedule[]`) is present
on every one of the 167 records. `stbNumber` is a string (`"100"`), consistent with the PRD's
`channels.stb_number` integer column (needs a cast on ingest). Schedule timestamps already arrive
as `2026-10-24T22:00:00+08:00` — ISO 8601 with the MYT offset baked in, so FR-5's "display in MYT"
needs no timezone conversion, just formatting. No API key/auth was needed, confirming the "no
secrets" NFR is achievable for this call.

**Mismatches / gaps found, not currently in the PRD:**

| # | Finding | Why it matters |
| --- | --- | --- |
| 1 | Response is wrapped: `{ responseCode, responseMessage, response: { channels: { data, pagination }, linearContent: { data, pagination } } }`. The PRD's Assumptions describe a flat list of channel objects. | The adapter must unwrap `response.channels.data` and check `responseCode`, not assume a bare array. |
| 2 | The query string (`channelGuide=true&platform=acm&channelOrderBy=stbNumber,asc`) is required to get this shape — undocumented in the PRD. | Must be hardcoded in `AstroClient`; no fallback behavior was tested without it. |
| 3 | ~26% of records (44/167) carry one of three extra boolean flags not in the PRD's field list: `isAstroFirstExclusive` (16), `isAstroGoExclusive` (2), `isRadioExclusive` (26). | Needs an explicit decision: drop on ingest, or model and surface as a badge. |
| 4 | 2 of 167 records break the assumed `"CH <stbNumber>"` subtitle pattern — both `isAstroGoExclusive`, `subtitle: "Astro GO Channel"` (stbNumbers 521, 522). | FR-1/FR-2 implicitly assume subtitle always encodes the channel number for display; these two don't. UI must render whatever subtitle string it's given rather than assuming the `"CH "` prefix. |
| 5 | `ranking` has ties (162 distinct values across 167 records; one value shared by 6 channels, almost certainly a default for "unranked"). | This *validates* FR-1's "sort field, then ID" tie-break — it's load-bearing, not a nice-to-have. |
| 6 | 15 duplicate `title` values exist across distinct channels/ids. | Search-by-title legitimately returns multiple cards for the same title; not a bug. |
| 7 | `genreKey[]` and `languageKey[]` are arrays in shape but always length 1 in the real data (167/167). | No PRD change needed — current data won't exercise true multi-genre/multi-language filtering even though the schema supports it. |
| 8 | A second top-level collection, `linearContent`, exists (empty in this response, separate pagination block). | Out of scope for Channels — the adapter should explicitly ignore it rather than silently depend on it being empty. |
| 9 | The endpoint returns **all 167 channels in one page** (`limit: 500, totalPages: 1`) — there is no upstream pagination to handle. | De-risks FR-8 (sync): one fetch, no page-walking logic needed. Milestone 0 ("inspect Astro data... 2-3 hrs") is effectively already done. |
| 10 | Astro supplies no per-record "last updated" timestamp. | Confirms `schedule_updated_at` / FR-5's "last-updated time" must be *our* sync time, not an Astro-native field. |
| 11 | `rangeKey` values found: `0_199, 200_299, ... 800_899` (8 buckets, matching `stbNumber` ranges). | Captured in the data model but **no functional requirement uses it**. The real Astro content site likely uses these as range tabs — flagged as an open question, not assumed. |

## 2. TRACEABILITY — brief requirements vs. PRD coverage

| Brief item | PRD coverage | Status |
| --- | --- | --- |
| Channel listing with search and sorting | FR-1, FR-2, FR-3 | Covered |
| Channel details page | FR-5 | Covered |
| Responsive UI | FR-9 | Covered |
| State management | §6 architecture (Zustand) | Covered |
| Backend APIs for Channels and Favourites | §8 API spec | Covered |
| Database integration | §7 data model | Covered |
| Unit testing | §10 testing strategy | Covered |
| README and architecture diagram | §11 repo layout | Covered (artifacts pending — build plan task 12) |
| Queue processing (bonus) | FR-7, §9 | Covered |
| Offline recovery (bonus) | FR-6, §9 rule 7 | Covered |
| Redis caching (bonus) | NFR Performance, §6 | Covered |
| CI/CD pipeline (bonus) | §10 "CI if time allows"; cut line drops it first | Partial — explicitly deprioritized |
| AWS serverless (bonus) | Explicit non-goal | Covered as a documented cut |
| End-to-end testing (bonus) | Cut line drops it first; only an outage test is planned | Partial — should be named "not attempted," not implied |
| ADD/REMOVE_FAVORITE, REFRESH_CHANNEL (queue challenge) | FR-7, §9 | Covered |
| Multiple users (queue challenge) | `commands.user_id`, §9 rule 4 | Covered |
| 5-second outage recovery (queue challenge) | §9 interpretation + acceptance test | Covered, see sweep-interval risk below |
| Performance/caching, SOLID, security, scalability (NFRs) | §5 | Covered |
| Architecture diagram (Frontend/Backend/DB/Queue/Astro) | §6 ASCII diagram | Covered conceptually; formal diagram pending (task 12) |
| Source repo, apps, DB scripts, unit tests, README, diagram, release notes (submission checklist) | §11 table | Covered — repo itself initialized in task 1 |
| UI/UX reference site (visual reference only) | Non-goals explicitly exclude copying Astro's UI | Covered, correctly interpreted |

No brief item is fully missing from the PRD. The two "Partial" bonus items are deliberate,
documented scope cuts, not oversights.

## 3. REVIEW — strict senior-interviewer pass

| Objective | Score | Reasoning |
| --- | --- | --- |
| Frontend Engineering | 8/10 | Infinite scroll, search/sort/filter, responsive, state, offline outbox, UI states all specified; light on component architecture and on filter-change-mid-scroll behaviour. |
| Backend Engineering | 8/10 | Clear module boundaries, SOLID called out, worker as separate process, idempotent handlers; no mention of transactional persist-then-enqueue semantics or correlation-ID logging. |
| API Design | 7/10 | Clean, consistent error shape, sensible 202 usage; but `/favourites` and `/commands` are two write paths to the same effect with no stated relationship. |
| Database Design | 7/10 | Normalized, sensible read indexes; no index/column supports the per-(user,channel) ordering and refresh-collapsing rules the worker needs. |
| Testing and Quality | 8/10 | Good layer coverage; no explicit plan for testing `AstroClient` against the real envelope shape. |
| System Design | 8/10 | Strongest section — clear flows, 7 numbered recovery rules, explicit acceptance test. Cache-invalidation granularity under-specified. |
| Documentation & Communication | 8/10 | Well-structured, tables, risks, milestones; architecture diagram still ASCII-in-markdown, not a real artifact yet. |

**Contradictions:**
- §8 defines `POST/DELETE /favourites` as wrappers that enqueue `ADD_FAVORITE`/`REMOVE_FAVORITE`, *and* a generic `POST /commands` that accepts "all three types," including those same two, with no stated relationship between the two surfaces.
- §9 rule 4 (per-user, per-channel ordering) and rule 7 (cross-user collapsing of `REFRESH_CHANNEL`) are two different dedup scopes stated back to back without distinguishing them.

**Ambiguities:**
- Rate limiting is scoped to "write endpoints" without naming which ones.
- The recovery sweep's timer interval is unspecified — if coarse (e.g. 60s), the stated 5-second recovery bound can't be met for the Redis-down-at-enqueue-time case.
- "Invalidated when a channel is refreshed" only clearly covers the detail cache key; the list endpoint is cached per filter/sort/page combination, which can't realistically be invalidated key-by-key.

**Risks (beyond PRD §13):**
- Coarse recovery-sweep interval directly threatens the queue challenge's named acceptance bar.
- `commands.payload` being jsonb-only (no extracted `channel_id`) makes ordering/collapsing queries slow and awkward.
- `rangeKey` is captured but unused — a plausible missed requirement from the reference site's UX.

**Over-scoped for 3-5 days:** the milestone table already sums close to 5 days before counting the "5 unfamiliar tools" risk it names itself. Milestone 0 ("inspect Astro data, 2-3 hrs") is now effectively done via this audit — bank that as time saved.

**Missing:** none — gaps found are within the PRD's detail (cache granularity, sweep timing, commands schema, dual write path), not missing requirements.

## 4. DECISIONS

Pre-decided stack and design choices (NestJS, Prisma/PostgreSQL, Next.js, Zustand+TanStack Query,
BullMQ/Redis, Docker Compose for Postgres+Redis only, infinite scroll, search on title+channel
number, separate worker process, sequence-number ordering, `REFRESH_CHANNEL` for one channel) —
no flaws found; kept as-is.

Fixes applied going forward:
1. **Single write path** — `/favourites` controller calls the same `CommandsService.enqueue(...)` as `/commands`; one code path, two routes.
2. **Extend `commands`** with an explicit `channel_id` column plus an index on `(user_id, channel_id, type, seq)`.
3. **Recovery sweep** — on API/worker start, on Redis reconnect, and a short periodic backstop (5-10s), not a bare unspecified timer.
4. **List-cache TTL** — short TTL (30-60s) for list/query caches instead of precise invalidation; exact-key invalidation stays for the detail cache.
5. **Drop the three undocumented exclusive flags** on ingest; revisit as a badge only if time remains.
6. **Ignore `linearContent`** entirely in the adapter.
7. **Bank this verification** into the seed fixture and PRD §3 so Milestone 0 isn't redone.

Open question: whether to add a `rangeKey`-based filter/tab as a new FR — currently assumed **out
of scope** pending confirmation.

## 5. Build plan

See the 12-task build plan tracked in the engineering plan for this assessment (repo init →
Docker Compose → Prisma/seed → Astro adapter/sync → Channels API → Favourites/Commands →
frontend list → details/favourites UI → BullMQ worker/recovery → caching/health/security →
test/CI closeout → README/diagram/release notes).
