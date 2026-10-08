# Routely — Architecture & Implementation Plan (Part 0)

A redirect URL testing platform (Mida-inspired). Users compare a **Control URL** against a
**Variant URL**; a tracking SDK consistently buckets each visitor and redirects the Variant
half. The platform reports page views, visible time on page, conversions and conversion rate.

> **Status.** Part 0 was planning only. Part 1 (project foundation) is implemented; sections
> below marked _(built in Part 1)_ describe code that exists today, everything else is still a
> plan. Two naming decisions were settled during Part 1 and are reflected throughout: the
> user-facing noun is **website** (not "site"), and the SDK/API wire contract lives in
> `@routely/sdk/contract` rather than a third `packages/shared` workspace.

---

## 1. Locked stack (confirmed)

| Concern        | Choice                                                        |
| -------------- | ------------------------------------------------------------- |
| App            | Next.js (App Router) + TypeScript, single full-stack project   |
| UI             | Tailwind CSS + shadcn/ui, responsive                           |
| Auth           | Auth.js (NextAuth v5) with Google OAuth                        |
| DB             | PostgreSQL                                                     |
| ORM            | Prisma                                                         |
| SDK            | Standalone vanilla-TS package → single browser IIFE bundle     |
| Deploy         | Contabo VPS, Ubuntu LTS, Docker, Docker Compose, Nginx, Let's Encrypt |

Tooling picked to fit the locked stack (not substitutions):

- **npm workspaces** for the monorepo (pnpm/yarn are not installed on this machine).
- **esbuild** to bundle the SDK to a minified IIFE (build tool only, no framework).
- **Zod** for input validation on every server boundary.
- **Vitest** for unit tests of pure logic (bucketing, URL matching).

---

## 2. Folder structure

Files marked ✓ exist after Part 1; the rest arrive in the part named beside them.

```
routely/
├── package.json                   ✓ npm workspaces root; scripts orchestrate all packages
├── tsconfig.base.json             ✓ strict compiler options shared by every workspace
├── .prettierrc.json               ✓ Prettier + prettier-plugin-tailwindcss
├── .env.example                   ✓
├── docs/                        ✓ ARCHITECTURE.md, DATABASE.md, AUTH.md
├── apps/
│   └── web/                       ✓ Next.js dashboard + API (the only deployed app)
│       ├── next.config.ts         ✓ standalone output, workspace tracing root, transpile SDK
│       ├── components.json        ✓ shadcn/ui config
│       ├── eslint.config.mjs      ✓
│       ├── prisma7.config.ts     ✓ Prisma 7 CLI config (loads apps/web/.env via dotenv)
│       ├── prisma/               ✓ schema.prisma, migrations/, seed.ts, verify.ts
│       ├── public/sdk/v1/sdk.js   ✓ build artifact copied from packages/sdk (gitignored)
│       └── src/
│           ├── env.ts             ✓ Zod-validated environment configuration
│           ├── app/               ✓ routes (see §3)
│           ├── components/
│           │   ├── ui/            ✓ shadcn/ui primitives (generated; excluded from lint)
│           │   ├── layout/        ✓ app shell, sidebar, top bar, user menu
│           │   ├── common/        ✓ page header, empty / error / loading states
│           │   ├── websites/        Part 3
│           │   └── experiments/     Part 4
│           ├── generated/prisma/ ✓ Prisma client output (gitignored, regenerated on build)
│           ├── server/            ✓ server-only code — never imported by client components
│           │   ├── db.ts          ✓ Prisma singleton + PrismaPg driver adapter
│           │   ├── errors.ts      ✓ AppError taxonomy → typed HTTP mapping
│           │   ├── validate.ts    ✓ parseOrThrow — Zod failure → AppError("VALIDATION")
│           │   ├── auth/          ✓ config.ts, index.ts, session.ts (the seam), actions.ts
│           │   ├── repositories/  ✓ website, experiment, visitor, assignment, event, conversion
│           │   ├── services/      ✓ website.service.ts, experiment.service.ts
│           │   │                    (ingest + analytics services: Parts 5–6)
│           │   └── http/            Part 5 — CORS, rate limit, bot filter, beacon parsing
│           ├── proxy.ts          ✓ optimistic auth check (Next 16's renamed middleware)
│           ├── lib/               ✓ routes.ts, url.ts, auth-errors.ts, utils.ts
│           └── validation/        ✓ common.ts, website.ts, experiment.ts, tracking.ts
├── packages/
│   └── sdk/                       ✓ framework-independent tracking SDK
│       ├── build.mjs              ✓ esbuild → dist/sdk.js (IIFE, minified) + publish step
│       └── src/
│           ├── contract.ts        ✓ wire types shared with the API (type-only)
│           ├── index.ts           ✓ entry: options parsing + boot sequence
│           ├── config.ts            Part 5 — fetch/cache experiment config
│           ├── bucket.ts            Part 5 — deterministic FNV-1a hash → CONTROL | VARIANT
│           ├── url.ts               Part 5 — normalization + EXACT/PREFIX matching
│           ├── identity.ts          Part 5 — visitor id storage + cross-domain handoff
│           ├── engagement.ts        Part 5 — visible-time accumulator
│           ├── transport.ts         Part 5 — sendBeacon + fetch(keepalive) fallback
│           └── cloak.ts             Part 5 — anti-flicker with hard timeout
└── infra/
    ├── docker-compose.dev.yml   ✓ local: postgres only
    ├── Dockerfile                   Part 7 — multi-stage build of apps/web (standalone)
    ├── docker-compose.yml           Part 7 — production: web + postgres + nginx + certbot
    ├── nginx/conf.d/routely.conf    app.example.com + cdn.example.com/sdk.js
    └── scripts/{deploy,init-letsencrypt}.sh
```

**Why no `packages/shared`.** Part 0 proposed a third workspace for the SDK/API contract. In
practice a type-only module inside the SDK (`@routely/sdk/contract`, reachable through the
package's `exports` map) gives the same guarantee — one definition, imported by both sides —
without a third package.json, tsconfig and build step. The rule that keeps it honest is
unchanged: `contract.ts` holds types and frozen constants only, never runtime logic.

**Tooling.** npm workspaces (pnpm is not available on the target machine), esbuild for the SDK
bundle, Zod for validation, Prettier with the Tailwind class-sorting plugin.

---

## 3. Route structure

### Dashboard (React Server Components; auth required except `/login` and `/share/[token]`)

The UI is the design prototype's (`RaihanSoft/routely-design`), scoped to a **project** (a
`Website`): `/p/[projectId]/…`. The full route table is in `CLAUDE.md` §4. In short:

| Route | Purpose |
| --- | --- |
| `/` | Remembered project (`rl_project` cookie) → its dashboard; else first project; else `/projects` |
| `/login` | Google sign-in |
| `/projects` | Manage projects |
| `/p/[projectId]` | Dashboard |
| `/p/[projectId]/experiments[/new \| /[id] \| /[id]/edit]` | List, wizard, detail (results/setup/activity), draft editing |
| `/p/[projectId]/metrics`, `/integrations`, `/settings/[tab]` | Metrics & goals (+GTM), Sheets + CDN, project/install/team settings |
| `/share/[token]` | Public read-only results |
| legacy `/get-started`, `/experiments…`, `/websites/[id]`, `/metrics…`, `/integrations` | Redirect into the current project |

Route groups carry no URL segment; they exist so `(app)` can own the authorization boundary
and the dashboard chrome while `(auth)` renders a centred, chrome-free layout.

Every route has a `loading.tsx` where it will fetch data, and the `(app)` group has its own
`error.tsx` so a failure replaces only the page content and leaves the shell interactive.

Mutations use **Server Actions** (Zod-validated, session-checked, `revalidatePath`) that take
one object argument and return `ActionResult<T>`.
Reads happen in Server Components through `src/server/services/*`.

### Public API (`/api/v1/*`, unauthenticated, site-key scoped, CORS `*`)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/config` | GET | Active experiments for `?siteId=<publicKey>`; `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` |
| `/api/v1/events` | POST | Event batch from the SDK; accepts `text/plain` so `navigator.sendBeacon` works |
| `/api/v1/events` | OPTIONS | CORS preflight (only needed for the `fetch` fallback) |
| `/sdk.js` | GET | Rewrite to the static bundle; `Cache-Control: public, max-age=300` (the current bundle is `/sdk/v2/sdk.js`; `/sdk/v1/` keeps serving old installs) |

### Auth

| Endpoint | Purpose |
| --- | --- |
| `/api/auth/[...nextauth]` | ✓ Auth.js handlers (Google), Node runtime |

No separate `api.example.com` service is created. `app.example.com` serves everything;
`cdn.example.com/sdk.js` is an Nginx alias to the same origin's static bundle. This keeps
the MVP to one deployable and avoids needless microservices.

---

## 4. Prisma data model _(built in Part 3)_

The schema is implemented and migrated. `apps/web/prisma/schema.prisma` is the authority;
**[DATABASE.md](DATABASE.md) carries the full table, index and constraint reference** along
with migration and operations procedures. What follows is the shape and the reasoning.

```
User ──< Website ──< Experiment ──< Assignment ──< Event
                │                        │      └──< Conversion
                └──< Visitor ────────────┘
```

Eleven tables: four for the Auth.js adapter (`users`, `accounts`, `sessions`,
`verification_tokens`) and seven for the product (`websites`, `experiments`, `visitors`,
`assignments`, `events`, `conversions`). Every foreign key cascades along the ownership chain,
so deleting a website removes its entire tree.

### Changes from the Part 0 plan

Part 3 introduced two entities the original plan folded into other tables, and the plan's
denormalised counters were dropped as a result:

| Part 0 | Now | Why |
| --- | --- | --- |
| `visitorId` as a bare string on `Assignment` | A `Visitor` table keyed `(websiteId, anonymousId)` | Gives identity resolution one upsert target and one unique constraint, and lets first/last-seen live somewhere sensible |
| `Assignment.convertedAt` | A `Conversion` table with `assignmentId` unique | Idempotency becomes a database constraint rather than a conditional write, and conversion counts need no de-duplication |
| `Assignment.pageviews` / `.visibleMs` counters | Grouped queries over `events` | Counters are a second copy of data that can drift; the covering index makes the grouped read cheap enough not to need them |
| `EventType { PAGEVIEW ENGAGEMENT CONVERSION }` | `EventType { page_view assignment time_on_page conversion }` | Matches the specified taxonomy, and the values are the literal wire strings so no translation layer exists between SDK and column |

### Metric definitions — one source of truth each

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by `variant` |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions | `count(conversions)` grouped by `variant` |
| Conversion rate | conversions ÷ assignments, per arm |

`events` and `conversions` both carry `variant`, so every dashboard query is a grouped read of
a single table served by a covering index — no joins on the aggregation path.

### The three constraints that carry the product's guarantees

| Constraint | Guarantees |
| --- | --- |
| `visitors (websiteId, anonymousId)` | One row per browser per website; concurrent requests converge instead of racing |
| `assignments (experimentId, visitorId)` | **Assignment consistency** — a visitor can never hold both arms |
| `conversions.assignmentId` | **Conversion idempotency** — a reloaded goal page cannot inflate the count |

Pre-aggregated daily rollups remain intentionally out of scope: grouped queries over the
indexed tables are exact and fast at MVP volume, and a rollup would reintroduce exactly the
drift the counters were dropped to avoid.

---

## 5. API / service architecture

### Layering

_(built in Part 3)_

```
Route Handler / Server Action     ← Zod validation, session, HTTP concerns only
        ↓
src/server/services/*.ts          ← business rules; first argument is always actorUserId
        ↓
src/server/repositories/*.ts      ← queries only; ownership-sensitive fns take userId
        ↓
src/server/db.ts                  ← the only PrismaClient in the process
```

Authorization is **structural**, not remembered. Every ownership-sensitive repository function
takes `userId` and folds it into the `where` clause — `where: { …, website: { userId } }` —
and writes use `updateMany`/`deleteMany` so the tenant filter participates in the write itself
rather than relying on a prior read. Anything the actor does not own reports "not found",
never "forbidden", so an id cannot be probed for existence.

`src/server/validate.ts` is the single bridge from a Zod failure to `AppError("VALIDATION")`
with field-level messages, so no service can accidentally act on unvalidated input — the only
value it ever sees is the parsed one.

### Authentication _(built in Part 2)_

Auth.js v5, Google only, Prisma adapter, **database-stored sessions**. Full detail in
**[AUTH.md](AUTH.md)**; the essentials:

`src/server/auth/session.ts` is the only module that knows how a session is obtained. It
exposes `getSession()`, `requireSession()` (redirects to `/login`, for pages and layouts) and
`requireUser()` (throws `AppError("UNAUTHENTICATED")`, for Server Actions and route handlers).
Nothing outside `src/server/auth/` imports `next-auth`, so changing or adding a provider
touches one file.

Sessions live in the `sessions` table rather than a JWT. The cost is a database read per
request; the benefit is revocation — signing out deletes the row and the session is dead
immediately, which no signed token can offer.

Route protection is deliberately two layers:

| Layer | Checks | Security boundary? |
| --- | --- | --- |
| `src/proxy.ts` | Session cookie **presence** | **No** — no database access in that runtime |
| `src/app/(app)/layout.tsx` | Session **validity**, against the database | **Yes** |

The Next.js docs warn against treating proxy as session management, so it is used only for
what it is good at: preserving the intended destination in `?callbackUrl=` (a layout is never
told the request path) and turning away obviously-anonymous requests before rendering.

`trustHost` is enabled for the Nginx reverse proxy, which alone would permit host-header
injection into callback URLs — so `src/env.ts` **requires `AUTH_URL` in production**, giving
Auth.js a canonical origin to build callbacks from. The two settings are only safe together.

### Decision flow (where bucketing happens)

The SDK buckets **locally** from a cacheable config document rather than asking the server
per pageview:

1. Snippet loads `sdk.js` **synchronously in `<head>`**.
2. SDK resolves visitor id (`localStorage` → cookie fallback → new UUID).
3. SDK fetches `/api/v1/config?siteId=…` (cached in `sessionStorage` for its TTL, and
   CDN/`s-maxage` cached server-side).
4. SDK finds an ACTIVE experiment whose `controlUrl` matches the normalized current URL.
5. Bucket = `fnv1a(visitorId + ':' + experimentId) % 100 < variantSplit ? VARIANT : CONTROL`
   — deterministic, so the same visitor always lands in the same arm with no server state.
6. CONTROL → stay. VARIANT → `location.replace(variantUrl + handoff params)`.
7. Pageview / engagement / conversion events are POSTed asynchronously to `/api/v1/events`.

Rationale: no network round-trip stands between page load and the redirect decision, the
config response is fully cacheable, and ingestion is fire-and-forget. Bucketing is not a
security boundary, so client-side evaluation is safe.

**Cross-domain identity handoff.** Control and Variant are frequently different origins, so
the redirect carries `_rt_vid`, `_rt_e` and `_rt_v`. The SDK on the Variant page adopts them,
persists locally, and strips them from the address bar with `history.replaceState`.

**Redirect-loop protection.** Three guards: (a) the Variant URL is never a control trigger,
(b) never redirect when the normalized current URL already equals the normalized Variant URL,
(c) a `sessionStorage` flag `rt.redir.<experimentId>` blocks a second redirect in the session.

**Anti-flicker.** The overlay is created by a second inline script the customer pastes above
the tracking tag, not by the bundle — see `SDK-DEPLOYMENT.md`. It declares a fixed-position
`body::after` overlay, publishes `window.__routelyReveal`, and clears itself after
`routelyTimeout` (1250 ms by default, editable on their page).

The SDK only ends the wait early, calling `__routelyReveal()` once it knows the visitor is
staying. A redirect deliberately does not, because revealing the control page for the duration
of that navigation is the exact flash the script exists to remove. Keeping the timeout in the
pasted script means a blocked or missing bundle can never leave a page hidden.

### Ingestion endpoint

`POST /api/v1/events` accepts a batch:

```jsonc
{ "v": 1, "siteId": "rt_…", "visitorId": "uuid",
  "events": [ { "experimentId": "…", "variant": "VARIANT", "type": "PAGEVIEW",
                "url": "https://…", "visibleMs": 4200, "ts": 1724832000000 } ] }
```

Server-side: Zod validation → site lookup by `publicKey` → bot filter (UA regex) →
per-IP+site rate limit → for each event, `upsert` the `Assignment` and apply the counter
delta plus the `Event` row inside one transaction. `CONVERSION` sets `convertedAt` only when
it is currently null, which makes replays and duplicate beacons idempotent. Client timestamps
are clamped to `[now − 24h, now + 5m]`. The response is always `204` — the SDK never retries.

---

## 6. SDK package

- **Entry:** `packages/sdk/src/index.ts`, bundled by esbuild to `dist/sdk.js` — IIFE, `es2017`,
  minified, no dependencies, no framework assumptions. Target ≤ 5 KB gzipped.
- **Distribution:** the build copies `dist/sdk.js` into `apps/web/public/sdk/v1/sdk.js`;
  Nginx serves it at `cdn.example.com/sdk.js` and `app.example.com/sdk.js`.
- **Install snippet** (one per website, reusable on every page — works identically on
  WordPress/WooCommerce, React, Next.js and plain HTML because it is just a script tag):

```html
<script src="https://cdn.example.com/sdk.js" data-routely-site="rt_abc123"></script>
```

Placed in `<head>`, **not** `async`/`defer`, so the redirect decision precedes first paint.

- **Configuration** is read from the `data-routely-*` attributes on the script tag; the API
  base URL is baked in at build time and overridable via `data-routely-api`.
- **SPA support:** patches `history.pushState`/`replaceState` and listens to `popstate` so
  conversions on client-routed React/Next.js pages are still detected.
- **Visible time:** accumulates only while `document.visibilityState === 'visible'` and the
  window is focused; flushes on `visibilitychange → hidden` and `pagehide` via `sendBeacon`,
  with a 15 s heartbeat as a backstop for browsers that drop the final beacon.
- **Failure mode is always "do nothing":** any error, timeout or missing config leaves the
  visitor on the page they requested. The SDK never blocks rendering beyond its timeout.

---

## 7. Docker deployment structure

```
                      ┌──────────── Nginx (443, TLS via Let's Encrypt) ───────────┐
  app.example.com ───►│ proxy_pass → web:3000                                     │
  cdn.example.com ───►│ /sdk.js → alias of the static bundle, long cache + CORS *  │
                      └───────────────────────────────────────────────────────────┘
                                              │
                                    web (Next.js standalone)
                                              │
                                    postgres:16 (named volume)
```

- `infra/Dockerfile` — multi-stage: deps → `prisma generate` + `next build`
  (`output: 'standalone'`) → slim runtime image running as a non-root user.
- `infra/docker-compose.yml` — services `postgres`, `web`, `nginx`, `certbot`; Postgres is
  **not** published to the host; a healthcheck gates `web` on Postgres readiness.
- `infra/docker-compose.dev.yml` — Postgres only; `next dev` runs on the host.
- Migrations run as `prisma migrate deploy` in the container entrypoint (never `db push` in
  production).
- `infra/scripts/init-letsencrypt.sh` performs the first certificate issuance via the
  webroot challenge; certbot then renews on a timer.

---

## 8. Implementation order

| Part | Deliverable |
| --- | --- |
| 1 ✓ | Monorepo scaffold: npm workspaces, Next.js + TS + Tailwind + shadcn/ui, app shell, route structure, env validation, error/loading/empty states, SDK package location, lint/typecheck/build scripts |
| 3 ✓ | PostgreSQL + Prisma data model, migrations, validation schemas, repository/service layer, dev Postgres via Compose, seed and verification scripts |
| 2 ✓ | Auth.js v5 + Google OAuth on the adapter tables, database sessions, proxy + layout route protection, sign-in/out UI |
| 4a | Websites + experiments UI: forms wired to the services built in Part 3, install-snippet panel |
| 4 | Experiments: schema + service + create/edit UI, URL validation, DRAFT→ACTIVE→PAUSED transitions |
| 5 | SDK package + `/api/v1/config` + `/api/v1/events`: bucketing, redirect, identity handoff, engagement timing, ingestion + `Assignment`/`Event` writes |
| 6 | Results dashboard: Control vs Variant comparison, views/visitors/avg visible time/conversions/conversion rate, time-series chart, empty & no-data states |
| 7 | Production deployment: Dockerfile, Compose, Nginx, Let's Encrypt, env handling, deploy script, runbook |
| 8 | Hardening: rate limiting, bot filtering, unit tests for bucketing/URL matching, error surfaces, final docs |

Each part ends with: files changed, how to test, required environment variables, known
limitations, and a passing `typecheck` + `lint` + `build`.

---

## 9. Environment variables (full set, introduced progressively)

All of them are declared and validated in `apps/web/src/env.ts`; the ones belonging to later
parts are optional there today and become required in the part that introduces them.

| Variable | Required from | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Part 1 ✓ | Public dashboard origin; defaults to `http://localhost:3000` |
| `AUTH_DEV_BYPASS` | Part 1 ✓ | Dev-only placeholder session; forced off when `NODE_ENV=production` |
| `DATABASE_URL` | Part 3 ✓ | Postgres connection string; validated as `postgresql://` |
| `AUTH_SECRET` | Part 2 ✓ | Auth.js session encryption, ≥32 chars (`openssl rand -base64 32`) |
| `AUTH_URL` | Part 2 ✓ | Canonical origin; v5's replacement for `NEXTAUTH_URL`. Required in production |
| `GOOGLE_CLIENT_ID` | Part 2 ✓ | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Part 2 ✓ | Google OAuth client secret |
| `NEXT_PUBLIC_SDK_URL` | Part 5 | SDK script URL shown in the install snippet |
| `ROUTELY_API_BASE` | Part 5 | API origin baked into the SDK bundle at build time |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Part 7 | Compose Postgres service |

---

## 10. Known limitations of this design (accepted for the MVP)

1. **Conversion tracking requires the snippet on the conversion page.** No server-side
   postbacks, no e-commerce webhook integration.
2. **Cross-domain identity is best-effort.** It works via redirect query-param handoff
   (Control → Variant). A conversion page on a *third* unrelated domain reached without that
   handoff will mint a new visitor id and be excluded from the experiment.
3. **Client-side bucketing** means a visitor who clears storage is re-bucketed and counted as
   a new visitor. Assignment is stable per-device, not per-person.
4. **50/50 split only** in the UI, though `variantSplit` is stored as an integer so unequal
   splits need no migration.
5. **No statistical significance testing** — raw rates only. No p-values or confidence
   intervals in the MVP.
6. **Single Control + single Variant** — no multi-variant, no multivariate testing.
7. **Redirect flicker is mitigated, not eliminated** on slow connections; the cloak times out
   at `routelyTimeout` (1250 ms by default) in favour of showing the Control page. A
   configuration request slower than that still produces a visible flash, bounded by however
   much slower it was. Sites that do not paste the anti-flickering script keep the flicker
   entirely.
8. **In-memory rate limiting** (single container). Multi-instance deployment needs a shared
   store.
9. **Bot filtering is user-agent based** — cheap and imperfect; no IP reputation or
   behavioural detection.
10. **No raw-event retention policy** — the `Event` table grows unbounded until a pruning job
    or rollup is added.
