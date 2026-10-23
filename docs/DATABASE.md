# Database — schema, migrations and operations

PostgreSQL 17 accessed exclusively through Prisma 7. This document covers the schema, the
commands you need day to day, local setup, and how migrations are applied in production.

`apps/web/prisma/schema.prisma` is the authority; its comments carry the reasoning field by field.
This page is the map.

---

## 1. Schema summary

Twenty-four tables in five groups:

| Group | Tables |
| --- | --- |
| Auth.js adapter | `users`, `accounts`, `sessions`, `verification_tokens` |
| Account | `email_change_requests`, `password_reset_tokens`, `notification_preferences`, `known_sign_in_devices` |
| Tenancy | `workspaces`, `memberships`, `workspace_invites` |
| Product | `websites`, `website_visitor_days`, `page_visitor_days`, `tracking_checks`, `experiments`, `experiment_variants`, `experiment_activities`, `visitors`, `assignments`, `events`, `conversions` |
| Integrations | `sheets_connections`, `website_sheet_targets` |

### Ownership chain

```
User ──< Membership >── Workspace ──< Website ──< Experiment ──< Assignment ──< Event
                            │            │   │         │    └──< ExperimentVariant
                            │            │   │         └──< ExperimentActivity      └──< Conversion
                            │            │   ├──< Visitor (one per browser; experiment participants only)
                            │            │   ├──< WebsiteVisitorDay / PageVisitorDay (site-wide hits)
                            │            │   ├──< TrackingCheck
                            │            │   └── WebsiteSheetTarget
                            │            └── (createdById → User, display only)
                            ├──< WorkspaceInvite
                            └── SheetsConnection
```

The tenant is the **workspace**. A website belongs to exactly one (`websites.workspaceId`); a user
reaches it only through a `Membership` whose `role` decides what they may change. Every foreign key
on the product side cascades along this chain, so deleting a workspace removes its websites, and
deleting a website removes its experiments, visitors, visitor-day rows, checks, assignments, events,
conversions and Sheets destination. References to a *user* that are display-only (`createdById`,
`invitedById`, `connectedById`, `ExperimentActivity.actorId`) are `ON DELETE SET NULL`, so deleting a
person never deletes a workspace's data.

### Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Account. Shape fixed by the Auth.js Prisma adapter, plus `passwordHash` (`scrypt$N$r$p$salt$hash`), `passwordChangedAt`, `currentWorkspaceId` (deliberately not a foreign key), `disabledAt`. | `email` unique |
| `accounts`, `verification_tokens` | Auth.js adapter storage. `verification_tokens` also holds email-verification tokens (`identifier = "verify-email:<userId>"`). | — |
| `sessions` | One row per signed-in device — Google *and* password sessions. Extra columns `createdAt`, `lastSeenAt`, `userAgent`, `city`, `country` for "Where you're signed in". | `sessionToken` unique |
| `email_change_requests`, `password_reset_tokens` | Single-use emailed tokens, stored as SHA-256 only. | `tokenHash` unique |
| `notification_preferences` | An explicit opt-in/out per `(userId, kind)`; no row = the kind's default. | PK `(userId, kind)` |
| `known_sign_in_devices` | `sha256(browser|os|country)` a user has signed in from; drives the new-sign-in email. | PK `(userId, fingerprintHash)` |
| `workspaces` | The tenant. "{First}’s workspace" by default. | — |
| `memberships` | A user's role in a workspace; `lastActiveAt` for the Team tab. | `(workspaceId, userId)` unique; one OWNER (partial index) |
| `workspace_invites` | Emailed invitation: lowercased `email`, `role` (never OWNER), `tokenHash`, 7-day `expiresAt`, `acceptedAt`/`revokedAt`. | `tokenHash` unique; one pending per `(workspaceId, email)` (partial index) |
| `websites` | A project: `domain`, `protocol`, `publicSiteId`, `pixelVerifiedAt`, `colorIndex`, `lastSeenAt` (last site-wide hit), `trackingAlertSentAt` (latch). | `publicSiteId` unique; `(workspaceId, domain)` unique; name unique per workspace, case-insensitive |
| `website_visitor_days` | One row per website × UTC day × browser that loaded any page with the snippet. | PK `(websiteId, day, anonymousId)` |
| `page_visitor_days` | The same per normalised URL — page traffic baselines, and the "seen" fallback for tracking checks. | PK `(websiteId, urlKey, day, anonymousId)` |
| `tracking_checks` | The last snippet check per URL of a website (`OK`/`MISSING`/`ERROR`, `method` "html" or "seen"). | `(websiteId, urlKey)` unique |
| `experiments` | One test: `type`, control and goal URLs (nullable while DRAFT), `controlWeight`, `trafficAllocation`, `targetDevices`, `keepQueryParams`, `wizardStep`, lifecycle timestamps, `resultReadyAt` (latch), `shareToken`. | `shareToken` unique |
| `experiment_variants` | One arm other than control: `position`, `name`, `colorIndex`, `weight`, and `url` (SPLIT_URL) or `changes` JSON (AB_TEST). | `(experimentId, position)` index |
| `experiment_activities` | The experiment's history, written in the same transaction as the change. `actorId` null for system entries. | one RESULT_READY per experiment (partial index) |
| `visitors` | One browser, per website, by the SDK's opaque id — **experiment participants only**; a site-wide hit never creates one. | `(websiteId, anonymousId)` unique |
| `assignments` | Binds a visitor to one arm of one experiment. `variantId` NULL = control. | `(experimentId, visitorId)` unique |
| `events` | Append-only activity log; carries `variantId`. | `type`, `variantId`, `occurredAt` |
| `conversions` | Completed goals, de-duplicated; carries `variantId`. | `assignmentId` unique |
| `sheets_connections` | The workspace's Google grant: encrypted tokens, `connectedById` (the only member who may open the Picker), `googleEmail`/`googleName`/`googlePicture`, `status`. | `workspaceId` unique |
| `website_sheet_targets` | Where one website's results are written: spreadsheet id, owned tab, `rowCount`, `refreshedAt` (throttle), `lastError`, `errorNotifiedAt` (latch). | `websiteId` unique |

### Enums

| Enum | Values |
| --- | --- |
| `ExperimentStatus` | `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED` (renamed in place from `ARCHIVED`) |
| `ExperimentType` | `SPLIT_URL`, `AB_TEST` |
| `DeviceType` | `DESKTOP`, `MOBILE`, `TABLET` — an empty `targetDevices` means every device |
| `MemberRole` | `OWNER`, `ADMIN`, `EDITOR`, `VIEWER` |
| `ExperimentActivityType` | `CREATED`, `LAUNCHED`, `PAUSED`, `RESUMED`, `ENDED`, `EDITED`, `RESULT_READY` |
| `NotificationKind` | `RESULT_READY`, `TRACKING_STOPPED`, `SHEETS_SYNC_FAILED`, `EXPERIMENT_PAUSED` |
| `TrackingCheckResult` | `OK`, `MISSING`, `ERROR` |
| `UrlMatchType` | `EXACT`, `PREFIX` |
| `SiteProtocol` | `HTTPS`, `HTTP` |
| `PrimaryMetric` | `CONVERSION_RATE`, `TIME_ON_PAGE`, `PAGE_VIEWS` |
| `SheetsConnectionStatus` | `CONNECTED`, `NEEDS_RECONNECT` |
| `EventType` | `page_view`, `assignment`, `time_on_page`, `conversion` |

`EventType` values are the literal strings the SDK sends on the wire, so an ingested value is
stored verbatim with no translation table between the browser and the column.

**There is no `Variant` enum.** An arm is identified by `variantId`: `NULL` is control, otherwise
the `experiment_variants` row the visitor was assigned. Control is deliberately not a variant row —
it is not a redirect target, and a row would duplicate `controlUrl` as a second source of truth.

### Two design rules

**One source of truth per metric.** Nothing is denormalised into a counter column that could
drift from the rows it summarises:

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by `variantId` |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions | `count(conversions)` grouped by `variantId` |
| Conversion rate | conversions ÷ assignments, per arm |
| Site visitors on a day | `count(website_visitor_days)` for that day |
| Visitors · 30 days | distinct `anonymousId` in `website_visitor_days` over 30 days |
| Tracking status | `websites.lastSeenAt` (a freshness timestamp, not a metric) |

Conversions live in their own table rather than as a filtered event scan precisely because
the unique constraint makes the count already de-duplicated — no `DISTINCT` needed. The visitor-day
tables are rows rather than counters for the same reason: a repeat hit is `ON CONFLICT DO NOTHING`
against the primary key, so the count cannot drift from what was recorded.

**Aggregation never needs a join.** `events` and `conversions` both carry `variantId`, so every
results query is a grouped read of one table served by a covering index.

### Unique constraints

| Constraint | Guarantees |
| --- | --- |
| `websites.publicSiteId` | The public site identifier in the install snippet is globally unique. |
| `visitors (websiteId, anonymousId)` | One row per browser per website; concurrent requests from the same browser converge instead of racing to insert. |
| `assignments (experimentId, visitorId)` | **Assignment consistency** — a visitor can never hold two arms of an experiment. |
| `conversions.assignmentId` | **Conversion idempotency** — a reloaded thank-you page or a duplicate beacon cannot inflate the count. |
| `experiments.shareToken` | A public results page can be looked up by token alone. |
| `memberships (workspaceId, userId)` | One role per person per workspace. |
| `memberships_one_owner` *(partial, hand-written)* | At most one OWNER per workspace. "At least one" is a service rule. |
| `workspace_invites_pending` *(partial, hand-written)* | At most one pending invite per address per workspace; accepted and revoked invites are history. |
| `experiment_activities_result_once` *(partial, hand-written)* | RESULT_READY is recorded at most once per experiment. |
| `websites (workspaceId, domain)`, `websites_ws_name_ci` *(expression, hand-written)* | One project per domain, and project names unique ignoring case, per workspace. |
| `website_visitor_days`, `page_visitor_days` primary keys | A browser counts once per site — and once per page — per UTC day. |
| `tracking_checks (websiteId, urlKey)` | One latest check per URL. |
| `sheets_connections.workspaceId`, `website_sheet_targets.websiteId` | One Google grant per workspace; one spreadsheet per website. |
| `*.tokenHash` | Emailed tokens are found by hash; the raw token exists only in the link. |
| `accounts (provider, providerAccountId)`, `sessions.sessionToken` | Required by Auth.js. |

The MVP has one goal per experiment, so assignment identity is the whole conversion key. A
multi-goal model would extend that constraint to `(assignmentId, goalId)`.

### Compare-and-set columns

Several columns are written only by `updateMany` / raw `UPDATE` with the previously read value (or
a staleness bound) in the `where` clause, so any number of concurrent writers produce one effect.
Never replace one with a read-then-write.

| Column | Purpose |
| --- | --- |
| `experiments.resultReadyAt` | RESULT_READY latch — one activity row and one email |
| `websites.trackingAlertSentAt` | "Tracking stops" latch, once per outage |
| `website_sheet_targets.errorNotifiedAt` | "Sheets sync fails" latch, once per failure streak |
| `website_sheet_targets.refreshedAt` | Sheets refresh throttle (10 s per website) |
| `websites.lastSeenAt` | Last site-wide hit, written at most once a minute (raw SQL, so `updatedAt` keeps meaning "edited") |
| `sessions.lastSeenAt`, `memberships.lastActiveAt` | Activity stamps, at most once per 5 minutes |
| `password_reset_tokens.usedAt`, `email_change_requests.consumedAt` | A link is spent exactly once |

### Indexes

| Table | Index | Serves |
| --- | --- | --- |
| `websites` | `(workspaceId, createdAt)` | A workspace's projects, newest first |
| `memberships` | `(userId)` | "My workspaces"; the session seam's membership lookup |
| `workspace_invites` | `(workspaceId)`, `(email)` | Team tab; invite lookup at sign-up |
| `experiments` | `(websiteId, status)` | SDK config endpoint: active experiments for a website |
| `experiments` | `(websiteId, createdAt)` | A project's experiment list |
| `experiment_variants` | `(experimentId, position)` | Arms in draw and display order |
| `experiment_activities` | `(experimentId, createdAt)` | The Review tab's activity list |
| `page_visitor_days` | `(websiteId, urlKey, day)` | A page's traffic baseline and "seen" check |
| `visitors` | `(websiteId, lastSeenAt)` | Recent-visitor queries |
| `assignments` | `(experimentId, variantId)` | Visitor counts per arm — index-only |
| `assignments` | `(experimentId, assignedAt)`, `(visitorId)` | Time-bounded counts; visitor history |
| `events` | `(experimentId, type, variantId, occurredAt)` | **Primary results aggregation** |
| `events` | `(experimentId, occurredAt)` | Time-series charts |
| `events` | `(websiteId, createdAt)` | Website activity; retention pruning |
| `events` | `(assignmentId)`, `(visitorId)` | Per-visitor drill-down |
| `conversions` | `(experimentId, variantId)` | Conversion counts per arm — index-only |
| `conversions` | `(experimentId, occurredAt)`, `(visitorId)` | Time-bounded counts; visitor history |

---

## 2. Application layer

```
Server Action / Route Handler   ← HTTP and session concerns only
        ↓
src/server/services/*.ts        ← business rules; first argument is always actorUserId
        ↓
src/server/repositories/*.ts    ← queries only; tenant-sensitive functions take userId (+ roles)
        ↓
src/server/db.ts                ← the only PrismaClient in the process
```

| Module | Responsibility |
| --- | --- |
| `src/server/db.ts` | Prisma singleton with the `PrismaPg` driver adapter, cached across dev hot reloads. |
| `src/server/repositories/access.ts` | The tenant filters — `workspaceAccess`, `websiteAccess`, `experimentAccess` — the one place "this user may see / change this row" is written. |
| `src/server/validate.ts` | `parseOrThrow` — the single bridge from a Zod failure to `AppError("VALIDATION")` with field-level messages. |
| `src/validation/*.ts` | `common`, `account`, `website`, `experiment` (lenient draft vs strict launch), `visual-change` (`{ schemaVersion: 1, changes }`, ≤ 50 per variant), `editor`, `integration`, `tracking` (public payloads, batch limits, clock clamping). |
| `src/lib/url.ts` | URL normalisation and `EXACT`/`PREFIX` matching, shared by validation and ingestion (mirrored in the SDK). |

**Authorization is structural.** Every tenant-sensitive repository function takes the actor's
`userId` and folds a **membership** filter — plus the allowed **roles** for a write — into the
`where` clause, and writes use `updateMany`/`deleteMany` so the filter participates in the write
itself rather than relying on a prior read. A **non-member** matches nothing and gets "not found",
so an id cannot be probed for existence; a **member without the role** gets "forbidden" (403) from
the service, which checks the role first — and the write's own role filter still matches nothing if
that check were forgotten.

Two validation rules worth knowing about:

- `absoluteUrlSchema` rejects any scheme other than `http:`/`https:`. Experiment URLs end up
  in a `location.replace()` call in a visitor's browser, so an unchecked `javascript:` URL
  there would be a cross-site scripting vector. A visual change's image `src` is stricter still:
  `https:` only (`validation/visual-change.ts`; the SDK re-checks and accepts `http:` too).
- Control ≡ variant, two variants on one URL, and a goal page equal to a tested page are refused.
  Each looks valid field-by-field but produces an experiment that cannot yield a meaningful result.
  Drafts are saved leniently (any step may be incomplete), so for the wizards these rules are
  launch rules, in `lib/launch-rules.ts` (`setupIssues`), alongside the same-site rule; the
  pre-design `createExperimentSchema` in `validation/experiment.ts` still carries them too.

---

## 3. Migrations

Fifteen migrations in `apps/web/prisma/migrations/`. Most are generated; the ones that rename a
column were hand-edited, because Prisma's diff turns a rename into a drop plus an add and loses
every value.

### `20261019120000_workspaces_and_new_design`

The new design's whole schema delta, generated by `prisma migrate diff` and then corrected by hand.
Read its header before touching it. What Prisma would have done, and what the file does instead:

| Prisma's diff | Hand-written instead |
| --- | --- |
| Recreate `ExperimentStatus` and cast `ARCHIVED` rows to a value that no longer exists | `ALTER TYPE … RENAME VALUE 'ARCHIVED' TO 'COMPLETED'` — every row keeps its meaning |
| Drop `stoppedAt`, add an empty `endedAt` | `RENAME COLUMN "stoppedAt" TO "endedAt"` |
| Add NOT NULL `workspaceId` to non-empty tables (fails) and drop `userId` (loses who owned what) | Add `workspaceId` nullable → create one workspace ("{First}’s workspace") and OWNER membership per existing user → set `currentWorkspaceId` → move each user's websites and Sheets grant into it (recording them as `createdById` / `connectedById`) → only then `SET NOT NULL` and drop `userId` |
| Add a NOT NULL `name` to `experiment_variants` with no value | Add nullable, backfill "Variant A", "Variant B" … from `position` (and colour slots cycling 1–4), then `SET NOT NULL` |
| — | Set every experiment's `createdById` to its website's owner, and reconstruct `ExperimentActivity` (CREATED, LAUNCHED, ENDED) from the timestamps that already existed |
| — | Make project names unique per workspace ignoring case: later duplicates get a ` (2)` suffix. Duplicate **domains** in one account cannot be renamed safely, so the migration stops with a readable error naming them |
| — | The four partial / expression unique indexes (`memberships_one_owner`, `workspace_invites_pending`, `experiment_activities_result_once`, `websites_ws_name_ci`), which `schema.prisma` cannot express |

**Those four indexes exist only in this migration.** Nothing in `schema.prisma` mentions them, so
read every future generated `migration.sql` for a `DROP INDEX` of one before committing (whether
Prisma 7.10 emits one has not been checked), and never use `db push`, which would not create them.

Generated ids in the data migration are `'c' || 24 hex chars of gen_random_uuid()` — cuid-shaped,
not real cuids; nothing parses them.

---

## 4. Commands

All commands run from the repository root.

| Command | Effect |
| --- | --- |
| `npm run db:up` | Start the local Postgres container |
| `npm run db:down` | Stop it (data is preserved in the named volume) |
| `npm run db:migrate` | Create and apply a migration from schema changes (development) |
| `npm run db:deploy` | Apply pending migrations without generating any (production) |
| `npm run db:status` | Show which migrations are applied and which are pending |
| `npm run db:generate` | Regenerate the Prisma client into `apps/web/src/generated/prisma` |
| `npm run db:reset` | Drop, recreate, re-migrate and re-seed — **destroys all data**; refuses a non-local `DATABASE_URL` |
| `npm run db:seed` | Write the design's demo workspace (idempotent); refuses a non-local `DATABASE_URL` |
| `npm run db:verify` | Run the 26-check data-model smoke test against the live database |
| `npm run db:studio` | Open Prisma Studio |

Naming a migration: `npm run db:migrate -- --name add_experiment_notes`.

> The generated client is **not** committed — `.gitignore` excludes
> `apps/web/src/generated/`. `npm run typecheck` and `npm run build` both run
> `prisma generate` first, so a fresh clone needs no extra step. After any `prisma generate`,
> restart `npm run dev` — the dev client is cached on `globalThis`.

---

## 5. Local development setup

```bash
# 1. Install dependencies
npm install

# 2. Configure the environment (apps/web/.env is read by BOTH Next.js and the Prisma CLI)
cp .env.example apps/web/.env

# 3. Start Postgres
npm run db:up

# 4. Apply migrations and generate the client
npm run db:migrate

# 5. Optional: sample data, then confirm the model behaves
npm run db:seed
npm run db:verify

# 6. Run the app
npm run dev          # http://localhost:3000
```

**One local database per branch.** The `new-design` branch's `apps/web/.env` points at
`routely_design`; the `routely` database in the same container belongs to the older branch, and
`.env.example` still names it. Change the database name in your `.env` before migrating, or the
workspace migration will run against the other branch's data.

### The demo seed

`npm run db:seed` builds the design prototype's **"Fernwood Group"** workspace as real rows: five
members (Alex Morgan, Owner; Jamie Lee, Admin; Priya Shah and Marcus Webb, Editors; Dana Ortiz,
Viewer), a pending invite, extra signed-in sessions, three projects (Fernwood Supply, Fernwood
Journal, Kestrel Outdoor), all seventeen experiments with variants, visual changes, activity and
per-arm visitors and conversions, 90 days of site visitors behind every sparkline, and page traffic
behind the wizards' estimates.

Every demo account's password is **`fernwood-demo-2026`** (printed at the end of each run), e.g.
`alex@fernwoodsupply.com`.

The prototype is pinned to Tuesday Oct 13, 2026, 09:30 UTC. The seed replays that timeline shifted
by `now − DESIGN_NOW`, so at the moment it runs every relative reading — day numbers, "4 min ago",
invite expiry — is the design's; run it again to bring them back. Every row has a fixed `demo_…` id
or natural key, identity rows are upserted and generated traffic is deleted and rewritten in one
transaction; nothing outside the demo workspace is read or written. Like `verify.ts`, it builds its
own Prisma client and imports nothing from `src/`, restating the two pure rules it needs (the
password hash format and `normalizeUrl`).

### `db:verify`

26 checks against the live database, each creating and cleaning up its own rows: tenant filters
(a non-member and another workspace's filter see nothing; a Viewer's role-filtered write changes
nothing), one owner per workspace, pending-invite uniqueness, visitor-day primary keys, RESULT_READY
once, visitor identity, assignment consistency, conversion idempotency, and grouped aggregation.
It is a smoke test, not a test suite — the unit tests are `npm run test`.

To start over: `npm run db:down` then `docker volume rm routely-dev_postgres-data`, or
`npm run db:reset` to keep the container and wipe only the data.

---

## 6. Production migration process (Docker / Contabo)

> Production currently runs on Vercel, where `vercel-build` runs `db:deploy` before the build
> (see `docs/DEPLOY-VERCEL.md`). The Docker procedure below is the reference for the Contabo stack,
> which is not built yet. The rule is the same either way.

### The rule

Production runs **`prisma migrate deploy`** and nothing else. `migrate dev` compares the
database against the schema and will offer to drop data to reconcile a difference; `db push`
skips migration history entirely (and would not create the hand-written partial indexes).
Neither belongs anywhere near production.

### Where it runs

Migrations execute in the web container's entrypoint, before the server starts:

```sh
#!/bin/sh
set -e
npx prisma migrate deploy        # exits non-zero on failure, so the container never
node server.js                   # starts against a database it cannot use
```

Because the app image already contains `prisma` and the migration files, this needs no extra
tooling on the VPS. With a single web container there is no concurrency concern; if the stack
is later scaled out, migrations move to a one-shot `migrate` service that the `web` service
depends on, so only one process ever applies them.

### Deploy sequence

```bash
# On the VPS, in the repository directory
git pull

# 1. Back up first — this is the only step that cannot be undone later
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > "backups/routely-$(date +%Y%m%d-%H%M%S).dump"

# 2. Build the new image
docker compose build web

# 3. Check what is about to be applied
docker compose run --rm web npx prisma migrate status

# 4. Recreate the web container — the entrypoint applies migrations, then serves
docker compose up -d web

# 5. Confirm
docker compose logs --tail=50 web
docker compose run --rm web npx prisma migrate status
```

**Before applying `20261019120000` to a database with real data**, check for two websites of one
account sharing a domain — the migration stops on them by design — and expect the first
notifications cron afterwards to announce every already-qualifying ACTIVE experiment at once
(`resultReadyAt` starts null for all of them).

### Restoring

```bash
docker compose stop web
docker compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/<file>.dump
docker compose start web
```

### Writing migrations safely

Prisma generates the SQL but not the strategy. For a change that would break the running
version of the app, use the expand/contract pattern across two deploys:

1. **Expand** — add the new column as nullable or with a default, deploy, backfill.
2. **Contract** — once no running code reads the old shape, make it `NOT NULL` and drop the
   old column in a second migration.

Renaming a column (or an enum value) in one step drops and recreates it, losing every value.
Check the generated SQL in `apps/web/prisma/migrations/*/migration.sql` before committing — it is
the artefact that runs in production, not the schema file.

### If a migration fails

`migrate deploy` stops at the first failure and marks that migration failed; the container
exits and the previous image keeps serving. Fix forward:

```bash
docker compose run --rm web npx prisma migrate status          # identify the failed migration
docker compose run --rm web npx prisma migrate resolve --rolled-back <migration_name>
# correct the migration SQL, rebuild, redeploy
```

Use `--applied` instead of `--rolled-back` only when the migration's changes did land and
Prisma simply failed to record them.

### Environment

The web container needs `DATABASE_URL` pointing at the `postgres` service on the compose
network (`postgres:5432`, not `localhost`). The database port is deliberately **not**
published to the host in the production compose file; reach it with
`docker compose exec postgres psql …`.

---

## 7. Known limitations

1. **Retention covers only the visitor-day tables.** The notifications cron deletes
   `website_visitor_days` and `page_visitor_days` rows older than 400 days. `events`,
   `assignments` and `conversions` — the customer's results — grow without bound;
   `deleteEventsBefore()` exists and the `(websiteId, createdAt)` index supports it, but nothing
   schedules it.
2. **The visitor-day prune filters on `day` alone,** which no index leads with, so it scans both
   tables. Fine at current volume; an index on `day` (or partitioning by month) is the step when it
   is not.
3. **No pre-aggregated rollups.** Metrics are computed with grouped queries at read time —
   exact, and fast at MVP volume. A daily rollup table is the scale-out step when a single
   experiment's event count makes grouped scans too slow.
4. **One conversion per assignment.** Repeat purchases are counted once. Revenue and
   multi-goal tracking would need a `goals` table and a wider unique constraint.
5. **Visitors are per-website and per-device.** Clearing browser storage produces a new
   visitor. Assignment is stable per device, not per person.
6. **"At least one owner" is not a database constraint.** The partial index allows at most one;
   that every workspace keeps its owner is enforced by the services (the Owner cannot be removed or
   demoted, and ownership is never granted by invitation).
7. **`db:verify` is a smoke test, not a test suite.** It writes to the configured database and
   cleans up after itself.
