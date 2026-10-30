# Routely — Architecture

A split-URL and A/B testing platform (Mida-inspired). A **Split URL** test compares a **Control
URL** against up to four **Variant URLs**: the tracking SDK buckets each visitor and redirects the
variant share. An **A/B test** keeps every visitor on the control URL and applies each variant's
visual changes in the page. Either way the platform reports visitors, page views, visible time on
page, conversions and conversion rate per arm, and — once every arm has enough data — a gated
"chance to beat Control".

> **Status.** This document began as the Part 0 plan. It now describes the system as built through
> the new-design backend (work packages WP0–WP10, October 2026): multi-tenant workspaces with roles,
> email + password sign-in alongside Google, email through Resend, SDK v4 (A/B tests, device
> targeting, site-wide hit, editor bridge), notifications and two daily crons. Where the original
> plan differed, the difference is called out. Two naming decisions settled during Part 1 still
> hold: the code's noun is **website** (the UI says **project**), and the SDK/API wire contract lives
> in `@routely/sdk/contract` rather than a third `packages/shared` workspace.

---

## 1. Locked stack (confirmed)

| Concern        | Choice                                                        |
| -------------- | ------------------------------------------------------------- |
| App            | Next.js (App Router) + TypeScript, single full-stack project   |
| UI             | Tailwind CSS + shadcn/ui, responsive                           |
| Auth           | Auth.js (NextAuth v5) with Google OAuth, database sessions; plus email + password minting the same sessions |
| DB             | PostgreSQL                                                     |
| ORM            | Prisma                                                         |
| SDK            | Standalone vanilla-TS package → single browser IIFE bundle     |
| Deploy         | Contabo VPS, Ubuntu LTS, Docker, Docker Compose, Nginx, Let's Encrypt (not built; production currently runs on Vercel — `docs/DEPLOY-VERCEL.md`) |

Tooling picked to fit the locked stack (not substitutions):

- **npm workspaces** for the monorepo (pnpm/yarn are not installed on this machine).
- **esbuild** to bundle the SDK to a minified IIFE (build tool only, no framework).
- **Zod** for input validation on every server boundary.
- **Vitest** for unit tests of pure logic.
- **Resend over plain `fetch`** for email, and `node:crypto` scrypt for passwords — no SDK or
  hashing package was added for either.

---

## 2. Folder structure

```
routely/
├── package.json                   npm workspaces root; scripts orchestrate all packages
├── tsconfig.base.json             strict compiler options shared by every workspace
├── .prettierrc.json               Prettier + prettier-plugin-tailwindcss (Markdown is not formatted)
├── .env.example
├── vercel.json                    build command + the two daily crons
├── docs/                          ARCHITECTURE, DATABASE, AUTH, SDK-DEPLOYMENT, INTEGRATIONS, DEPLOY-VERCEL
├── apps/
│   └── web/                       Next.js dashboard + API (the only deployed app)
│       ├── next.config.ts         standalone output, /sdk.js rewrite + cache headers, transpile SDK
│       ├── prisma7.config.ts      Prisma 7 CLI config (loads apps/web/.env via dotenv)
│       ├── prisma/                schema.prisma, migrations/, seed.ts (demo workspace), verify.ts
│       ├── scripts/               assert-local-db.mjs, sync-sheets.ts
│       ├── public/sdk/v1/         build artifact copied from packages/sdk (gitignored)
│       └── src/
│           ├── env.ts             Zod-validated environment configuration
│           ├── app/               routes (see §3)
│           ├── components/        one directory per designed screen, plus rt/ (design primitives),
│           │                      layout/, common/, ui/ (shadcn) — see CLAUDE.md §3
│           ├── server/            server-only — never imported by client components
│           │   ├── db.ts          Prisma singleton + PrismaPg driver adapter
│           │   ├── errors.ts      AppError taxonomy → HTTP status (UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404 …)
│           │   ├── validate.ts    parseOrThrow — Zod failure → AppError("VALIDATION")
│           │   ├── auth/          the session seam, Auth.js config, adapter, password sessions, workspace resolution
│           │   ├── email/         resend.ts + templates/
│           │   ├── jobs/          result-ready, tracking-stopped, retention
│           │   ├── repositories/  queries only; access.ts holds the tenant filters
│           │   ├── services/      business rules (§5)
│           │   ├── actions/       Server Actions
│           │   └── http/          rate limit, bot filter, SSRF-safe fetch, viewer time zone
│           ├── lib/               pure, unit-tested modules (verdict, permissions, launch-rules, url …)
│           ├── validation/        Zod schemas per boundary
│           └── proxy.ts           optimistic auth check (Next 16's renamed middleware)
├── packages/
│   └── sdk/                       framework-independent tracking SDK (see SDK-DEPLOYMENT.md)
│       ├── build.mjs              esbuild → dist/sdk.js (8 kB gzip budget) + optional editor-agent.js
│       ├── src/                   contract, identity, url, inclusion, assignment, device, redirect,
│       │                          apply, hit, editor-bridge, conversion, engagement, dedupe, cloak,
│       │                          config, transport, track, index
│       └── test/                  15 suites, no DOM
└── infra/
    ├── docker-compose.dev.yml     local: postgres only
    └── nginx/conf.d/              app.conf, cdn.conf — production reference configs
```

**Why no `packages/shared`.** Part 0 proposed a third workspace for the SDK/API contract. In
practice a type-only module inside the SDK (`@routely/sdk/contract`, reachable through the
package's `exports` map) gives the same guarantee — one definition, imported by both sides —
without a third package.json, tsconfig and build step. The rule that keeps it honest is
unchanged: `contract.ts` holds types and frozen constants only, never runtime logic. It now also
defines the visual editor's message protocol.

**Pure in `lib/`, configured in `server/`.** Anything that reads `env` cannot be imported under
Vitest without a full environment, so logic is split: `lib/secret-box.ts` / `server/crypto.ts`,
`lib/editor-token.ts` / `server/editor-token.ts`, `lib/google-oauth-state.ts` /
`services/google-oauth.service.ts`. The pure half takes its key and clock as arguments.

---

## 3. Route structure

### Pages

| Route | Group | Purpose |
| --- | --- | --- |
| `/` | — | Router: `/dashboard` when signed in, otherwise `/login` |
| `/login`, `/signup`, `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]` | `(auth)` | Google and password sign-in; account flows |
| `/invite/[token]` | — | Accept a team invite (public; the token is the credential) |
| `/dashboard` | `(app)` | Workspace overview |
| `/projects`, `/projects/[projectId]` | `(app)` | Project list; project dashboard |
| `/experiments`, `/experiments/[experimentId]` | `(app)` | Experiment list; results and review |
| `/experiments/new/split-url`, `/experiments/new/ab-test` | `(app)` | The two wizards (`?project=` new, `?id=` resume) |
| `/integrations`, `/settings` | `(app)` | Google Sheets; account, team, notifications |
| `/share/[token]` | — | Public read-only results, `noindex` |
| `/websites/[id]`, `/get-started`, `/metrics`, `/metrics/[id]`, `/experiments/new` | `(app)` | Pre-design pages, now redirects |

Route groups carry no URL segment; they exist so `(app)` can own the authorization boundary
and the dashboard chrome while `(auth)` renders a centred, chrome-free layout. `(app)`'s
`error.tsx` replaces only the page content on a failure. The dashboard, Projects and project
dashboard stream their data behind `<Suspense>` with the design's own loading state as the fallback.

Mutations use **Server Actions** (Zod-validated, session-checked, returning a typed result rather
than throwing to the client). Reads happen in Server Components through `src/server/services/*`.

### Public API (`/api/v1/*`, unauthenticated, site-key scoped, CORS `*`)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/config` | GET | Active experiments for `?siteId=<publicSiteId>&v=4`; v3 document otherwise. `Cache-Control: public, max-age=60, stale-while-revalidate=300` |
| `/api/v1/events` | POST | Event batch from the SDK (`v` 3 or 4); accepts `text/plain` so `navigator.sendBeacon` works |
| `/api/v1/hit` | POST | Site-wide page hit (`text/plain` beacon) — tracking status, visitor counts, page baselines |
| `/sdk.js` | GET | Rewrite to `/sdk/v1/sdk.js`; short cache. `/sdk/v1/*` is served `immutable` |

### Other API routes

| Endpoint | Purpose |
| --- | --- |
| `/api/auth/[...nextauth]` | Auth.js handlers (Google), Node runtime |
| `/api/integrations/google/start` (POST), `/callback` | The Sheets consent flow (separate from sign-in) |
| `/api/editor/token` (POST, JSON) | Visual editor session token |
| `/settings/email/confirm` (GET) | Spends an email-change link |
| `/api/cron/sheets-sync`, `/api/cron/notifications` (GET, bearer `CRON_SECRET`) | Daily at 00:20 and 00:40 UTC |

No separate `api.example.com` service is created. `app.example.com` serves everything;
`cdn.example.com/sdk.js` is an Nginx alias to the same origin's static bundle. This keeps
the product to one deployable and avoids needless microservices.

---

## 4. Data model

`apps/web/prisma/schema.prisma` is the authority; **[DATABASE.md](DATABASE.md) carries the full
table, index and constraint reference**, the hand-written migration and operations procedures.
What follows is the shape and the reasoning.

```
User ──< Membership >── Workspace ──< Website ──< Experiment ──< Assignment ──< Event
                                        │   │         │    │            └──< Conversion
                                        │   │         │    └──< ExperimentVariant
                                        │   │         └──< ExperimentActivity
                                        │   └──< Visitor
                                        └──< WebsiteVisitorDay / PageVisitorDay / TrackingCheck
```

Twenty-four tables. The tenant is the **workspace** (§5.1); everything a customer measures hangs off
a website, and every product foreign key cascades along the chain, so deleting a website removes its
entire tree.

### Changes from the Part 0 plan

| Part 0 | Now | Why |
| --- | --- | --- |
| `visitorId` as a bare string on `Assignment` | A `Visitor` table keyed `(websiteId, anonymousId)` | One upsert target and one unique constraint for identity |
| `Assignment.convertedAt` | A `Conversion` table with `assignmentId` unique | Idempotency is a database constraint, and counts need no de-duplication |
| `Assignment.pageviews` / `.visibleMs` counters | Grouped queries over `events` | Counters are a second copy of data that can drift |
| `EventType { PAGEVIEW ENGAGEMENT CONVERSION }` | `EventType { page_view assignment time_on_page conversion }` | The values are the literal wire strings, so no translation layer exists |
| `variant` as `CONTROL \| VARIANT`, a stored split | `variantId` (NULL = control) and relative per-arm weights | Several variants per test; control is not a redirect target, so it is not a row |
| `Website.userId` | `Website.workspaceId` + `Membership` | Teams: more than one person per account, each with a role |
| Site traffic only through experiments | `website_visitor_days`, `page_visitor_days` | Tracking status, visitor counts and traffic estimates for pages with nothing running |

### Metric definitions — one source of truth each

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by `variantId` |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions | `count(conversions)` grouped by `variantId` |
| Conversion rate | conversions ÷ **assigned** visitors, per arm |
| Site visitors | rows in `website_visitor_days` (per day), distinct `anonymousId` (30 days) |

`events` and `conversions` both carry `variantId`, so every results query is a grouped read of a
single table served by a covering index — no joins on the aggregation path. Pre-aggregated daily
rollups remain intentionally out of scope: they would reintroduce exactly the drift the counters
were dropped to avoid.

---

## 5. Service architecture

### Layering

```
Route Handler / Server Action     ← Zod validation, session, HTTP concerns only
        ↓
src/server/services/*.ts          ← business rules; first argument is always actorUserId
        ↓
src/server/repositories/*.ts      ← queries only; tenant-sensitive fns take userId (+ roles)
        ↓
src/server/db.ts                  ← the only PrismaClient in the process
```

`src/server/validate.ts` is the single bridge from a Zod failure to `AppError("VALIDATION")`
with field-level messages, so no service can accidentally act on unvalidated input — the only
value it ever sees is the parsed one. Rules that need data a schema cannot see (the website's
domain, its other experiments, the actor's role) live in the service.

### 5.1 Tenancy and authorization

Multi-tenant by user decision: anyone can sign up, and every account gets its own workspace as
OWNER (an account created through an invite joins only the inviting workspace). Roles are OWNER,
ADMIN, EDITOR and VIEWER; **`lib/permissions.ts`** is the whole matrix as pure functions, shared by
the server (which enforces it) and the client (which only uses it to decide which controls to
show).

Authorization is **structural**, not remembered. `server/repositories/access.ts` writes the tenant
filter once:

```ts
website: { workspace: { memberships: { some: { userId, role: { in: allowedRoles } } } } }
```

Every tenant-sensitive repository function takes the actor's `userId` and folds that filter into
its `where`; writes use `updateMany`/`deleteMany` so the filter — **including the roles** — is part
of the write itself. Two refusals, deliberately different:

- **Not a member** of the record's workspace → `NOT_FOUND`. An id still cannot be probed for
  existence.
- **A member without the role** → `FORBIDDEN` (403). They can already see the row, so the refusal
  leaks nothing, and the UI can say why. The service checks the role first; the write's role filter
  is the backstop if that check were ever forgotten.

The role that counts is the actor's role **in the record's workspace**, which need not be the
active one. `requireRole(min)` in the session seam is for workspace-level actions only (team,
settings).

### 5.2 Authentication

Full detail in **[AUTH.md](AUTH.md)**. The essentials:

`src/server/auth/session.ts` is the only module the rest of the app uses to learn who is asking.
It exposes `getSession()`, `requireSession()` (redirects, for pages), `requireUser()` (throws
`UNAUTHENTICATED`, for actions and route handlers) and `requireRole(min)`. `SessionUser` carries
`sessionId`, the active `workspaceId` and the actor's `role`, re-resolved from the database on
every request so a removed member or a changed role takes effect immediately.

Sessions live in the `sessions` table rather than a JWT: the cost is a database read per request;
the benefit is revocation — sign-out, "sign out other sessions" and a password reset all delete
rows. Google sign-in goes through Auth.js and its Prisma adapter (wrapped to create the workspace
and record session metadata). **Password sign-in bypasses Auth.js** — its Credentials provider is
JWT-only — and `password-session.ts` writes the same row and `authjs.session-token` cookie itself.

Route protection is two layers: `src/proxy.ts` checks only that a session cookie is **present**
(it has no database), to preserve `?callbackUrl=`; `src/app/(app)/layout.tsx` checks the session is
**valid** and is the security boundary. `trustHost` is enabled for the reverse proxy, which alone
would permit host-header injection — so `src/env.ts` **requires `AUTH_URL` in production**.

### 5.3 Services

| Service | Owns |
| --- | --- |
| `account` | Password sign-in/up, verification, reset, profile and email change, password, sessions list, notification preferences, new-device emails |
| `team` | Team overview, invites (send, resend, revoke, accept), role changes, removal, workspace list and switch |
| `website`, `project`, `dashboard`, `project-dashboard` | Project CRUD with the domain and name rules; the read models of the Projects, Dashboard and project dashboard screens |
| `experiment` | Drafts (lenient autosave), launch rules, launch / pause / resume / end, paused edits, sharing, delete — every transition writes `ExperimentActivity` in the same transaction; launch and resume take a per-website advisory lock |
| `experiment-results` | Experiments list, Results and Review tabs, the public share page |
| `visual-editor` | Issues editor session tokens for an A/B test's stored page |
| `tracking-check`, `pixel` | Is the snippet on a page: SSRF-guarded fetch (`server/http/safe-fetch.ts`) with a "seen recently" fallback; launch requires a passed check ≤ 24 h old for every page a test depends on |
| `ingest` | `/events` and `/hit` — the only writes reachable without a session (§5.4) |
| `analytics` | Grouped per-arm counts, including the Sheets rows |
| `notification` | `notify()` — recipients, preferences, rendering, sending (§5.6) |
| `sheets-sync`, `google-oauth`, `google-sheets` | The Sheets integration ([INTEGRATIONS.md](INTEGRATIONS.md)) |

Pure rules that several screens render live in one `lib/` module each so no screen can drift:
`verdict.ts` (rates, lifts, chance to beat Control, verdict copy — §5.7), `launch-rules.ts`,
`experiment-time.ts`, `visitors.ts`, `pixel-status.ts`, `change-summary.ts`, `sheets-card.ts`.

### 5.4 Decision flow and ingestion

The SDK decides **locally** from a cacheable config document rather than asking the server per
page view:

1. Snippet loads `sdk.js` **synchronously in `<head>`**.
2. SDK resolves the visitor id (`localStorage` → cookie → in-memory), adopting a handed-over id
   after a cross-origin redirect.
3. SDK fetches `/api/v1/config?siteId=…&v=4` (cached in `sessionStorage` for its TTL, and
   `s-maxage`-cacheable server-side) and, meanwhile, sends the site-wide hit.
4. SDK finds an ACTIVE experiment whose control URL matches the normalised current URL.
5. Device targeting, then the traffic-allocation gate (drawn once, persisted), then the arm: the
   stored one, or — for a visitor with none — **chosen by the server** (`POST /api/v1/assign`) and
   persisted in `localStorage` so it is asked once. The server balances against the actual
   assignments (`lib/balance.ts`: each new visitor goes to the arm furthest below its configured
   share, under a per-experiment advisory lock), so small samples follow the split exactly instead
   of a coin's lumps. A failed request means "not entered" for that page load; the browser never
   guesses. (Part 0 planned an FNV-1a hash of the visitor id, then a persisted browser-side random
   draw replaced it; balancing needs the other visitors' counts, which only the server has.)
6. Split URL: control stays, a variant gets `location.replace(variantUrl + handoff params)`.
   A/B test: everyone stays; a variant's visual changes are applied.
7. Assignment, page-view, engagement and conversion events are beaconed to `/api/v1/events`.

Bucketing is not a security boundary, so client-side evaluation is safe — and the server treats
everything the client says as an assertion. `ingest.service.ts`:

- takes the **website** from the public site id, never from a payload field;
- re-checks every **experiment** against that website, and only `ACTIVE` accepts events;
- lets the **stored arm win** over whatever the client claims;
- **normalises URLs** and **clamps timestamps** server-side;
- requires a **pre-existing assignment** for a conversion, on the configured goal URL — other event
  types may create an assignment, a conversion may not;
- for a **hit**, drops a URL off the website's domain and writes only visitor-day rows and
  `Website.lastSeenAt`, never a `Visitor`.

The routes add a bot filter (user-agent), body-size caps and a per-IP-per-site rate limit, and
answer `204` whatever happens (`429` when limited) — the SDK never retries. Cross-domain identity
travels with the redirect as `_rt_vid`, `_rt_e`, `_rt_v`, which the variant page adopts and strips
with `history.replaceState`. Four independent redirect loop guards and the anti-flicker handover are
described in [SDK-DEPLOYMENT.md](SDK-DEPLOYMENT.md).

### 5.5 Background work

Nothing slow runs on a request path:

- **`after()`** — `/api/v1/events` schedules the Sheets refresh and the result-ready check to run
  after the response is sent. A beacon is never slowed or failed by Google or by email.
- **Email** — `sendEmailAfter` / `runAfter` (`server/email/resend.ts`) send after the response and
  never throw; an action's result never depends on Resend being up.
- **Two daily crons** (`vercel.json`), both `GET` with `Authorization: Bearer $CRON_SECRET`, both
  failing closed without it, both returning 200 with per-job summaries:

| Cron | Schedule | Jobs |
| --- | --- | --- |
| `/api/cron/sheets-sync` | 00:20 UTC | Rewrite every attached spreadsheet's tab |
| `/api/cron/notifications` | 00:40 UTC | `server/jobs/result-ready.ts` (backstop for the after-ingestion check), `tracking-stopped.ts` (the only detector of an *absence* of hits), `retention.ts` (delete visitor-day rows older than 400 days) |

The sweeps check a wall-clock budget between items and stop claiming new work before the
function's `maxDuration`; whatever they did not reach, the next run picks up.

### 5.6 Notifications

Four opt-out kinds, each with a default and a role floor (`lib/notifications.ts`):

| Kind | Trigger | Default | Recipients |
| --- | --- | --- | --- |
| A result is ready | every arm of an ACTIVE experiment first passes the `lib/verdict.ts` gate | on | members |
| Tracking stops | a website with a running experiment unseen for 24 h | on | members |
| Google Sheets sync fails | first failure after a success | on | Admins and the Owner |
| An experiment is paused | someone pauses one | off | members, except whoever paused it |

`notify(kind, workspaceId, payload, { excludeUserId, minRole })` is fire-and-forget. It derives
recipients from memberships, preferences and the role floor — a trigger says what happened where,
never who to tell — and only sends to members with a verified email (`emailVerified`, or a linked
Google account). **Sending once is the trigger's job**, by a compare-and-set latch taken before
`notify`: `Experiment.resultReadyAt`, `Website.trackingAlertSentAt`,
`WebsiteSheetTarget.errorNotifiedAt`. So any number of concurrent triggers, on any number of
instances, send one email. RESULT_READY is additionally recorded at most once per experiment by a
partial unique index on `experiment_activities`.

Security emails (verify, reset, email change, password changed, new sign-in) and invites are not
notifications: they cannot be turned off. Eleven templates in all (`server/email/templates/`).

### 5.7 Results claims

The redesigned results show "Chance to beat Control", "Likely better/worse" and "Winner". The user
approved them on 2026-10-19 on conditions, all of which live in **`lib/verdict.ts`** and nowhere
else: P(p_variant > p_control) under Beta(1 + conversions, 1 + non-conversions) posteriors; nothing
named until every arm has 1,000 assigned visitors and 100 conversions; ≥ 0.95 / ≤ 0.05 thresholds;
and a "not proof" note rendered under results. The original plan's "no statistical significance
testing — raw rates only" was replaced by this rule, not extended. With several variants the
winner must also be ≥ 0.95 likely to beat every other variant.

**Choosing a winner** (2026-10-27): an Editor records the version to keep when ending (or after).
The server stores whether it was the recommendation (`winnerBasis`), worked out from the frozen
counts; a manual pick is always labelled a judgement call, never a result. Routely does not serve
the winner — the results page tells the customer what to change on their site.

---

## 6. SDK package

- **Entry:** `packages/sdk/src/index.ts`, bundled by esbuild to `dist/sdk.js` — IIFE, `es2019`,
  minified, no dependencies, no framework assumptions. **8 kB gzip budget, currently 7.63 kB**
  (Part 0 targeted 5 kB; the budget was 6 kB until v4).
- **Distribution:** the build copies `dist/sdk.js` into `apps/web/public/sdk/v1/sdk.js`; the app
  serves it at `/sdk.js`, and the reference Nginx config at `cdn.example.com/sdk.js`.
- **Install snippet** — the same two tags on every platform (WordPress/WooCommerce, Shopify, React,
  Next.js, plain HTML), because it is just a script tag plus an optional inline anti-flicker block:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

Placed in `<head>`, **not** `async`/`defer`, so the redirect decision precedes first paint.

- **Configuration** is read from `data-*` attributes on the script tag (`data-site-id`, `data-api`,
  `data-timeout`, `data-debug`); the API base URL is baked in at build time.
- **Visible time:** accumulates only while the document is visible; flushes deltas on
  `visibilitychange → hidden` and `pagehide` via `sendBeacon`. It is approximate and labelled so.
- **Visual editor bridge:** a `#_rt_edit=<token>` handshake that loads a separate editor agent —
  which is not written yet.
- **Failure mode is always "do nothing":** any error, timeout or missing config leaves the
  visitor on the page they requested. The SDK never blocks rendering beyond its timeout.

Not built from the original plan: SPA route-change tracking (`pushState` patching). Full detail in
[SDK-DEPLOYMENT.md](SDK-DEPLOYMENT.md).

---

## 7. Docker deployment structure (planned, not built)

```
                      ┌──────────── Nginx (443, TLS via Let's Encrypt) ───────────┐
  app.example.com ───►│ proxy_pass → web:3000                                     │
  cdn.example.com ───►│ /sdk.js → alias of the static bundle, long cache + CORS *  │
                      └───────────────────────────────────────────────────────────┘
                                              │
                                    web (Next.js standalone)
                                              │
                                    postgres:17 (named volume)
```

- `infra/Dockerfile` — multi-stage: deps → `prisma generate` + `next build`
  (`output: 'standalone'`) → slim runtime image running as a non-root user.
- `infra/docker-compose.yml` — services `postgres`, `web`, `nginx`, `certbot`; Postgres is
  **not** published to the host; a healthcheck gates `web` on Postgres readiness.
- `infra/docker-compose.dev.yml` — Postgres only; `next dev` runs on the host. **Exists.**
- Migrations run as `prisma migrate deploy` in the container entrypoint (never `db push` in
  production).
- `infra/scripts/init-letsencrypt.sh` performs the first certificate issuance via the
  webroot challenge; certbot then renews on a timer.
- The two crons would need a scheduler on the VPS (e.g. a cron container calling the routes with the
  bearer secret); on Vercel, `vercel.json` provides it.

---

## 8. Implementation history

| Part | Deliverable |
| --- | --- |
| 1 ✓ | Monorepo scaffold, app shell, env validation, SDK package location, lint/typecheck/build scripts |
| 3 ✓ | PostgreSQL + Prisma data model, migrations, validation, repository/service layer, seed and verify |
| 2 ✓ | Auth.js v5 + Google OAuth, database sessions, proxy + layout route protection |
| 4 ✓ | Websites and experiments UI, install snippet, lifecycle |
| 5 ✓ | SDK + config and events endpoints: assignment, redirect, identity handoff, engagement, conversions |
| 6 ✓ | Results dashboard, date ranges, share links; later multi-variant weights and Google Sheets export |
| Design ✓ | The routely-design-main prototype's ten screens, frontend-only on mock data |
| WP0–WP10 ✓ | The new design's backend: workspaces and roles (WP0), email (WP1), password auth and account (WP2), team and invites (WP3), site-wide hit and tracking checks (WP4), SDK v4, projects and dashboards (WP5), experiment lifecycle and wizards (WP6a), results and list (WP6b), visual editor (WP7, except the agent bundle), Sheets per workspace (WP8), notifications and cron (WP9), docs (WP10) |
| 7 | Production Docker deployment — not built |

Each part ended with: files changed, how to test, required environment variables, known
limitations, and a passing `typecheck` + `lint` + `test` + `build`.

---

## 9. Environment variables

All of them are declared and validated in `apps/web/src/env.ts`. Only `AUTH_SECRET`, `AUTH_URL`,
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are required in production; the rest degrade a
feature rather than stopping the server.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | Auth.js session encryption, ≥32 chars; also signs the Sheets OAuth state |
| `AUTH_URL` | Canonical origin; required in production; decides the `__Secure-` session cookie |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in and the Sheets integration |
| `AUTH_DEV_BYPASS` | Dev-only session; forced off when `NODE_ENV=production` |
| `NEXT_PUBLIC_APP_URL` | Public dashboard origin for links in emails and snippets |
| `NEXT_PUBLIC_SDK_URL` | SDK script URL shown in the install snippet |
| `ROUTELY_API_BASE` | API origin baked into the SDK bundle at build time |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Email; without a key, development prints emails and production sends nothing |
| `EDITOR_TOKEN_SECRET` | Visual editor tokens; derived from `AUTH_SECRET` when unset |
| `TOKEN_ENCRYPTION_KEY` | Encrypts Google refresh tokens at rest; without it Sheets is unavailable |
| `CRON_SECRET` | Bearer token for both cron routes; without it they refuse every request |
| `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER` | The Google Picker |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose Postgres service (planned stack) |

---

## 10. Known limitations of this design

1. **Conversion tracking requires the snippet on the conversion page.** No server-side
   postbacks, no e-commerce webhook integration.
2. **Conversions and identity are per-origin.** The assignment lives in `localStorage`; the
   redirect handoff carries identity from control to variant, but a goal page on another origin
   reached without that handoff will not convert.
3. **Assignment is keyed to the browser's anonymous id**, so a visitor who clears storage gets a
   new id and is re-bucketed and counted as a new visitor. A first visit to a tested page costs one
   extra request (`/api/v1/assign`) before the redirect decision, inside the anti-flicker window. Assignment is stable per device, not per person. Device targeting is decided in
   the browser and cannot be verified by the server.
4. **Redirect flicker is mitigated, not eliminated** on slow connections; the cloak times out
   at `routelyTimeout` (3000 ms by default) in favour of showing the Control page. Sites that do
   not paste the anti-flickering script keep the flicker entirely. An A/B variant's overlay is
   bounded the same way.
5. **In-memory rate limiting and throttles** (per process). Multiple instances multiply every
   `rateLimit()` and the result-ready check throttle; the latches and the Sheets refresh throttle
   are database compare-and-sets and are unaffected.
6. **Bot filtering is user-agent based** — cheap and imperfect; no IP reputation or
   behavioural detection.
7. **No retention for experiment data.** `events`, `assignments` and `conversions` grow without
   bound; only the visitor-day tables are pruned (400 days).
8. **Daily crons only.** "Tracking stops" and the result-ready backstop can lag by up to a day,
   more on plans where a daily cron fires anywhere within its hour.
9. **The visual editor cannot edit yet** — the agent bundle is not written (pending the user's
   permission decision).
10. **No workspace rename, ownership transfer, leaving a workspace or account deletion.**
