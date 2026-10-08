# Database — schema, migrations and operations

PostgreSQL 17 accessed exclusively through Prisma 7. This document covers the schema, the
commands you need day to day, local setup, and how migrations are applied in production.

---

## 1. Schema summary

Four tables belong to Auth.js; the rest are the product, including the project-level tables added for the design rebuild (domains, metrics, metric hits, members, experiment activity) and the Sheets integration tables (see INTEGRATIONS.md).

### Ownership chain

```
User ──< Website ──< Experiment ──< Assignment ──< Event
                │                        │      └──< Conversion
                └──< Visitor ────────────┘
```

Every foreign key cascades along this chain, so deleting a user removes their websites, and
deleting a website removes its experiments, visitors, assignments, events and conversions.

### Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Account. Shape fixed by the Auth.js Prisma adapter. | `email` unique |
| `accounts`, `sessions`, `verification_tokens` | Auth.js adapter storage. | — |
| `websites` | A customer property; owns experiments and visitors. | `publicKey` unique |
| `experiments` | One redirect test: control, variant, goal, split, status. | `websiteId` |
| `visitors` | One browser, per website, by the SDK's opaque id. | `(websiteId, anonymousId)` unique |
| `assignments` | Binds a visitor to one arm of one experiment. | `(experimentId, visitorId)` unique |
| `events` | Append-only activity log. | `type`, `variant`, `occurredAt` |
| `conversions` | Completed goals, de-duplicated per goal. | `(assignmentId, goalKey)` unique |
| `website_domains` | A project's extra domains (the primary stays `websites.domain`). | `(websiteId, domain)` unique |
| `metrics` | A project's measurable actions: custom events (`key`) and page visits (`url`). `page_view` is the system metric. | `(websiteId, key)` unique |
| `metric_hits` | One row per received custom event or matching page visit, for "last received", 24h counts and the GTM test event. | `(metricId, occurredAt)` |
| `project_members` | Team members — a **service seam**: stored and shown, grants no access. | `(websiteId, email)` unique |
| `experiment_activities` | Activity timeline (created, launched, paused, resumed, ended, edited, duplicated). | `(experimentId, createdAt)` |

### Enums

| Enum | Values |
| --- | --- |
| `ExperimentStatus` | `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED` (shown as Completed / Winner) |
| `ExperimentType` | `SPLIT_URL`, `AB` |
| `CountingMode` | `UNIQUE`, `ALL` |
| `MetricKind` | `CUSTOM_EVENT`, `PAGE_VISIT` |
| `InstallMethod` | `MANUAL`, `GTM` |
| `MemberRole` | `EDITOR`, `VIEWER` (the owner is `websites.userId`) |
| `UrlMatchType` | `EXACT`, `PREFIX` |
| `Variant` | `CONTROL`, `VARIANT` |
| `EventType` | `page_view`, `assignment`, `time_on_page`, `conversion` |

`EventType` values are the literal strings the SDK sends on the wire, so an ingested value is
stored verbatim with no translation table between the browser and the column.

### Two design rules

**One source of truth per metric.** Nothing is denormalised into a counter column that could
drift from the rows it summarises:

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by `variant` |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions (unique) | `count(conversions)` for one `goalKey`, grouped by `variant` |
| Conversions (all) | `count(events)` where `type = 'conversion'` and `goalKey` matches |
| Conversion rate | conversions ÷ assignments, per arm |

Conversions live in their own table rather than as a filtered event scan precisely because
the unique constraint makes the count already de-duplicated — no `DISTINCT` needed.

**Aggregation never needs a join.** `events` and `conversions` both carry `variant`, so every
dashboard query is a grouped read of one table served by a covering index.

### Unique constraints

| Constraint | Guarantees |
| --- | --- |
| `websites.publicKey` | The public site identifier in the install snippet is globally unique. |
| `visitors (websiteId, anonymousId)` | One row per browser per website; concurrent requests from the same browser converge instead of racing to insert. |
| `assignments (experimentId, visitorId)` | **Assignment consistency** — a visitor can never hold both arms of an experiment. |
| `conversions (assignmentId, goalKey)` | **Conversion idempotency** — a reloaded thank-you page or a duplicate beacon cannot inflate any goal's count. `goalKey` is `"url"` for a URL goal or the metric id. |
| `accounts (provider, providerAccountId)`, `sessions.sessionToken` | Required by Auth.js. |

Experiments have a primary goal and optional secondary goals, so the conversion key is
`(assignmentId, goalKey)` — the extension this section anticipated when there was one goal.

### Indexes

| Table | Index | Serves |
| --- | --- | --- |
| `websites` | `(userId, createdAt)` | Dashboard website list, newest first |
| `experiments` | `(websiteId, status)` | SDK config endpoint: active experiments for a website |
| `experiments` | `(websiteId, createdAt)` | Website detail page experiment list |
| `visitors` | `(websiteId, lastSeenAt)` | Recent-visitor queries and retention sweeps |
| `assignments` | `(experimentId, variant)` | Visitor counts per arm — index-only |
| `assignments` | `(experimentId, assignedAt)`, `(visitorId)` | Time-bounded counts; visitor history |
| `events` | `(experimentId, type, variant, occurredAt)` | **Primary dashboard aggregation** |
| `events` | `(experimentId, occurredAt)` | Time-series charts |
| `events` | `(websiteId, createdAt)` | Website activity; retention pruning |
| `events` | `(assignmentId)`, `(visitorId)` | Per-visitor drill-down |
| `conversions` | `(experimentId, variant)` | Conversion counts per arm — index-only |
| `conversions` | `(experimentId, occurredAt)`, `(visitorId)` | Time-bounded counts; visitor history |

---

## 2. Application layer

```
Server Action / Route Handler   ← HTTP and session concerns only
        ↓
src/server/services/*.ts        ← business rules; first argument is always actorUserId
        ↓
src/server/repositories/*.ts    ← queries only; ownership-sensitive functions take userId
        ↓
src/server/db.ts                ← the only PrismaClient in the process
```

| Module | Responsibility |
| --- | --- |
| `src/server/db.ts` | Prisma singleton with the `PrismaPg` driver adapter, cached across dev hot reloads. |
| `src/server/validate.ts` | `parseOrThrow` — the single bridge from a Zod failure to `AppError("VALIDATION")` with field-level messages. |
| `src/validation/common.ts` | Shared primitives: ids, public keys, absolute URLs, domains, names, split, date range. |
| `src/validation/website.ts` | Create / update website. |
| `src/validation/experiment.ts` | Create / update / status change, plus the URL cross-field rules. |
| `src/validation/tracking.ts` | Public ingestion payloads, batch limits and client-clock clamping. |
| `src/lib/url.ts` | URL normalisation and `EXACT`/`PREFIX` matching, shared by validation and (from Part 5) ingestion. |

**Authorization is structural.** Every ownership-sensitive repository function takes `userId`
and folds it into the `where` clause, and writes use `updateMany`/`deleteMany` so the tenant
filter participates in the write itself rather than relying on a prior read. Anything the
actor does not own reports "not found", never "forbidden", so an id cannot be probed for
existence.

Two validation rules worth knowing about:

- `absoluteUrlSchema` rejects any scheme other than `http:`/`https:`. Experiment URLs end up
  in a `location.replace()` call in a visitor's browser, so an unchecked `javascript:` URL
  there would be a cross-site scripting vector.
- `createExperimentSchema` rejects control ≡ variant, conversion ≡ control and
  conversion ≡ variant. Each looks valid field-by-field but produces an experiment that
  cannot yield a meaningful result.

---

## 3. Commands

All commands run from the repository root.

| Command | Effect |
| --- | --- |
| `npm run db:up` | Start the local Postgres container |
| `npm run db:down` | Stop it (data is preserved in the named volume) |
| `npm run db:migrate` | Create and apply a migration from schema changes (development) |
| `npm run db:deploy` | Apply pending migrations without generating any (production) |
| `npm run db:status` | Show which migrations are applied and which are pending |
| `npm run db:generate` | Regenerate the Prisma client into `apps/web/src/generated/prisma` |
| `npm run db:reset` | Drop, recreate, re-migrate and re-seed — **destroys all data** |
| `npm run db:seed` | Insert deterministic sample data (idempotent) |
| `npm run db:verify` | Run the data-model smoke test against the live database |
| `npm run db:studio` | Open Prisma Studio |

Naming a migration: `npm run db:migrate -- --name add_experiment_notes`.

> The generated client is **not** committed — `.gitignore` excludes
> `apps/web/src/generated/`. `npm run typecheck` and `npm run build` both run
> `prisma generate` first, so a fresh clone needs no extra step.

---

## 4. Local development setup

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

The seed creates `dev@routely.local` with one website (`rt_0000…00ab`), one active
experiment, 80 visitors, 80 assignments, 251 events and 11 conversions — 4/40 on control and
7/40 on variant, so the two arms have visibly different conversion rates.

To start over: `npm run db:down` then `docker volume rm routely-dev_postgres-data`, or
`npm run db:reset` to keep the container and wipe only the data.

---

## 5. Production migration process (Docker / Contabo)

### The rule

Production runs **`prisma migrate deploy`** and nothing else. `migrate dev` compares the
database against the schema and will offer to drop data to reconcile a difference; `db push`
skips migration history entirely. Neither belongs anywhere near production.

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

Renaming a column in one step drops and recreates it, losing every value. Check the generated
SQL in `apps/web/prisma/migrations/*/migration.sql` before committing — it is the artefact
that runs in production, not the schema file.

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

## 6. Known limitations

1. **No retention policy.** `events` grows without bound.
   `deleteEventsBefore()` exists and the `(websiteId, createdAt)` index supports it, but
   nothing schedules a sweep yet.
2. **No pre-aggregated rollups.** Metrics are computed with grouped queries at read time —
   exact, and fast at MVP volume. A daily rollup table is the scale-out step when a single
   experiment's event count makes grouped scans too slow.
3. **One conversion per assignment.** Repeat purchases are counted once. Revenue and
   multi-goal tracking would need a `goals` table and a wider unique constraint.
4. **Visitors are per-website and per-device.** Clearing browser storage produces a new
   visitor. Assignment is stable per device, not per person.
5. **`db:verify` is a smoke test, not a test suite.** It writes to the configured database and
   cleans up after itself; unit tests arrive with the ingestion logic in Part 5.
6. **Auth.js tables exist but are unused** until authentication is implemented.
