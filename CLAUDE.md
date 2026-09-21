# Routely — context for Claude

Read this before changing anything. It covers what the project is, the decisions that are
already settled, the invariants that must not be broken, and the things that will otherwise
cost you an hour to rediscover.

Claude Code loads this file automatically. It is also readable on its own if you are pasting
context into a fresh session.

---

## 1. What this is

A **redirect URL testing platform** — an A/B testing tool where the two variations are two
different URLs, not two versions of one page.

```
                    ┌─ 50% ─► /pricing      (control — visitor stays)
visitor ─► /pricing ┤                                                  ─► /thank-you = conversion
                    └─ 50% ─► /pricing-v2   (variant — redirected)
```

A customer adds a **website**, installs one tracking snippet on it, then creates
**experiments**. Each experiment has a control URL, a variant URL and a conversion URL. The
SDK on the customer's pages decides which arm each visitor is in, redirects the variant half,
and reports page views, visible time and conversions back.

Modelled on [Mida](https://mida.so). The user (`rakibul@blinto.co`) built this over a series
of numbered "Parts", each with its own spec.

---

## 2. Locked stack — do not substitute

The user declared this stack locked in the very first message. **Do not swap any of it** for a
different framework, ORM, database, auth provider or deployment approach without being asked.

| Concern | Choice | Version |
| --- | --- | --- |
| App | Next.js App Router + TypeScript, **one** full-stack project | `next@16.3.3`, `react@19.2.8` |
| UI | Tailwind CSS + shadcn/ui | `tailwindcss@4.3.3` |
| Auth | Auth.js + Google OAuth | `next-auth@5.0.0-beta.32` |
| Database | PostgreSQL | `postgres:17-alpine` |
| ORM | Prisma | `prisma@7.10.0` + `@prisma/adapter-pg` |
| SDK | Standalone vanilla TypeScript → one browser bundle | esbuild `0.28.2` |
| Deploy | Contabo VPS, Ubuntu, Docker, Compose, Nginx, Let's Encrypt | not built yet |

Additions made for tooling (not substitutions): **npm workspaces** (pnpm is not installed on
this machine), **Zod** for validation, **Vitest** for tests, **tsx** for CLI scripts.

### Two pins that look wrong but are deliberate

- **`prisma@7.10.0`, not `latest`.** `latest` resolves to `8.0.0-rc.x` — a release candidate —
  while `@prisma/client` has no matching 8 release. 7.10.0 is the stable pair.
- **`next-auth@5.0.0-beta.32`, pinned exactly.** The `latest` tag is v4, which cannot call
  `auth()` in Server Components and therefore cannot protect App Router routes the way this app
  is structured. v5 is beta by version number but is what the App Router ecosystem runs on.
  Beta releases have shipped breaking changes, hence the exact pin.

---

## 3. Repository map

```
routely/
├── apps/web/                 Next.js dashboard + public API — the only deployable
│   ├── prisma/               schema.prisma, migrations/, seed.ts, verify.ts
│   ├── prisma7.config.ts     Prisma 7 CLI config (loads apps/web/.env via dotenv)
│   └── src/
│       ├── app/              routes (see §4)
│       ├── components/
│       │   ├── ui/           shadcn/ui primitives — generated, excluded from lint
│       │   ├── layout/       app shell, sidebar, top bar, brand, user menu
│       │   ├── common/       page header, empty/error/loading states, field, step, code block
│       │   ├── auth/         Google button, login illustration
│       │   ├── websites/     form, card, install snippet, copy value, delete dialog
│       │   └── experiments/  form, results, arm results, status controls, lift badge, filters
│       ├── server/           server-only; never imported by a client component
│       │   ├── db.ts         the single PrismaClient (+ PrismaPg adapter)
│       │   ├── errors.ts     AppError taxonomy → HTTP status mapping
│       │   ├── validate.ts   parseOrThrow — the only Zod → AppError bridge
│       │   ├── auth/         config.ts, index.ts, session.ts (the seam), actions.ts
│       │   ├── repositories/ website, experiment, visitor, assignment, event, conversion
│       │   ├── services/     website, experiment, ingest, analytics
│       │   ├── actions/      Server Actions: website, experiment, share, types
│       │   └── http/         rate-limit.ts, bot-filter.ts
│       ├── validation/       Zod schemas: common, website, experiment, tracking
│       ├── lib/              routes, url, format, date-range, snippet, form-state, auth-errors
│       ├── generated/prisma/ Prisma client output — GITIGNORED, regenerated on build
│       └── proxy.ts          Next 16's renamed middleware (optimistic auth check only)
├── packages/sdk/             the tracking SDK — vanilla TS, zero dependencies
│   ├── build.mjs             esbuild → dist/sdk.js, size-budgeted, publishes to apps/web/public
│   ├── src/                  see §6
│   └── test/                 8 suites, no DOM required
├── infra/
│   ├── docker-compose.dev.yml    Postgres only (the app runs on the host)
│   └── nginx/conf.d/             app.conf, cdn.conf — production reference configs
└── docs/                     ARCHITECTURE, DATABASE, AUTH, SDK-DEPLOYMENT
```

**Read the docs in `docs/` before large changes.** They carry the reasoning, not just the
shape — particularly `SDK-DEPLOYMENT.md`, which explains why time-on-page is approximate and
must be labelled as such wherever it appears.

---

## 4. Routes

| Route | Group | Notes |
| --- | --- | --- |
| `/` | — | Routes to `/dashboard` or `/login` |
| `/login` | `(auth)` | Google sign-in, centred layout |
| `/dashboard` | `(app)` | Website list |
| `/websites/new`, `/websites/[websiteId]` | `(app)` | Create; detail with install snippet + settings |
| `/experiments` | `(app)` | All experiments: status tabs, search, lift column |
| `/experiments/new`, `/experiments/[experimentId]` | `(app)` | Create; detail with results, status, edit, share |
| `/share/[token]` | — | **Public**, read-only results. No session. `noindex` |
| `/api/auth/[...nextauth]` | — | Auth.js handlers, Node runtime |
| `/api/v1/config` | — | **Public.** Active experiments for a site id |
| `/api/v1/events` | — | **Public.** Event ingestion |

Route groups carry no URL segment. `(app)` owns the authorization boundary and the dashboard
chrome; `(auth)` is chrome-free.

The user's naming is **website**, not "site". `/experiments/[id]/edit` does not exist — editing
is inline on the detail page, matching the website settings pattern.

---

## 5. Architecture decisions already settled

Do not undo these without a reason. Each was chosen against a specific alternative.

### Authorization is structural, not remembered

Every ownership-sensitive repository function takes `userId` and folds it into the `where`
clause. Writes use `updateMany`/`deleteMany` so the tenant filter participates in the write
itself rather than relying on a prior read. **Anything the actor does not own reports
"not found", never "forbidden"** — so an id cannot be probed for existence.

Server Actions re-establish the actor from the session and never trust an id in the form body.
A Server Action is a public HTTP endpoint.

### The session seam

`src/server/auth/session.ts` is the **only** module that knows how a session is obtained.
Nothing else imports `next-auth`. It exposes:

- `getSession()` — nullable
- `requireSession()` — redirects to `/login` (pages and layouts)
- `requireUser()` — throws `AppError("UNAUTHENTICATED")` (actions and route handlers)

### Two layers of route protection, one boundary

| Layer | Checks | Security boundary? |
| --- | --- | --- |
| `src/proxy.ts` | Session cookie **presence** | **No** — no database in that runtime |
| `(app)/layout.tsx` | Session **validity**, against the database | **Yes** |

Proxy exists only to preserve the destination in `?callbackUrl=` (a layout is never told the
request path) and to reject obviously-anonymous requests before rendering. The Next.js docs
warn against treating proxy as session management.

### Database sessions, not JWT

Costs one DB read per request; buys **revocation** — signing out deletes the row and the
session is dead immediately, which no signed token can offer.

### `trustHost: true` **and** a required `AUTH_URL`

Only safe as a pair. Nginx delivers the Host via `X-Forwarded-Host` and Auth.js will not trust
it without `trustHost` — but `trustHost` alone permits host-header injection into callback
URLs. `env.ts` therefore requires `AUTH_URL` in production so callbacks are built from a
canonical origin.

### Service ↔ repository split

```
Route Handler / Server Action   HTTP + session only
        ↓
services/*.ts                   business rules; first argument is always actorUserId
        ↓
repositories/*.ts               queries only; ownership-sensitive fns take userId
        ↓
server/db.ts                    the only PrismaClient in the process
```

Rules that need data a Zod schema cannot see live in the **service**, not the schema — the
same-site rule needs the website's domain; the conflict rule needs the website's other
experiments.

### Metrics have one source of truth each

Nothing is denormalised into a counter column that could drift:

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by variant |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions | `count(conversions)` grouped by variant |
| Conversion rate | conversions ÷ **assigned** visitors |

`events` and `conversions` both carry `variant`, so **aggregation never needs a join**.

Conversion rate uses assigned visitors as the denominator, not visitors who loaded a page:
everyone bucketed had the opportunity to convert, and the smaller denominator would inflate the
rate for whichever arm loses more visitors before rendering — exactly what a redirect test
measures.

---

## 6. Data model invariants

These constraints carry the product's guarantees. **Do not weaken them.**

| Constraint | Guarantees |
| --- | --- |
| `websites.publicSiteId` unique | The public identifier in the snippet is globally unique |
| `visitors (websiteId, anonymousId)` unique | One row per browser per website; concurrent requests converge |
| `assignments (experimentId, visitorId)` unique | **A visitor can never hold both arms** |
| `conversions.assignmentId` unique | **A refresh cannot inflate the conversion count** |
| `experiments.shareToken` unique | Safe to look up a public results page by token alone |

Enum values: `ExperimentStatus` (DRAFT/ACTIVE/PAUSED/ARCHIVED), `UrlMatchType` (EXACT/PREFIX),
`Variant` (CONTROL/VARIANT), `EventType` (`page_view`, `assignment`, `time_on_page`,
`conversion` — lowercase, because the user specified those names and they are the literal wire
strings the SDK sends, so no translation layer exists).

Application-level rules enforced in `experiment.service.ts`:

- **Same-site rule.** Control, variant *and* conversion URLs must be on the website's domain or
  a subdomain. `isSameSite` is dot-anchored so `evil-acme.com` and `acme.com.evil.test` are both
  rejected. (The conversion URL was included beyond the original spec: a goal on another domain
  could never record anything, so allowing it would only create silent duds.)
- **One active experiment per control URL.** Checked at create, at edit, and **again on
  publish** — another experiment may have been activated in between. Comparison uses normalised
  URLs and accounts for PREFIX overlap.
- **URLs are fixed once an experiment has started.** Visitors are already bucketed against the
  old configuration.
- **Traffic is split by weight, across any number of variants.** `Experiment.controlWeight` and
  each `ExperimentVariant.weight` are *relative* numbers normalised at draw time, kept separate
  from `trafficAllocation` so neither can drift from the other. `lib/traffic.ts` composes the
  two into percentages of total traffic for display, and `applyShare` is what the editor uses to
  set one of those percentages exactly while keeping the set at 100.

### Ingestion never trusts client-supplied ownership

`ingest.service.ts` — the only write path reachable without a session:

- The **website** comes from the public site id, never from a payload field
- Every **experiment** is re-checked against that website; only `ACTIVE` accepts events
- The **stored arm wins** over whatever the client claims
- **URLs are normalised server-side** — a URL over the network is an assertion, not a fact
- **Timestamps are clamped** (browser clocks are routinely hours off)
- **A conversion requires a pre-existing assignment** and must be on the configured goal URL.
  Other event types may *create* an assignment; a conversion may not — otherwise a forged
  request could invent a visitor, choose their arm, and convert them.

---

## 7. The SDK

`packages/sdk` — vanilla TypeScript, **zero runtime dependencies**, one IIFE bundle.
Currently **~4.7 kB gzipped against a 6 kB budget the build enforces** (it exits non-zero if
exceeded). Installation is two script tags — an inline anti-flickering block and the tracking
tag — pasted into `<head>`. The same pair works on every platform, which is what makes it
framework-independent:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

In `<head>`, no `async`/`defer`, so the redirect decision precedes first paint.

| Module | Responsibility |
| --- | --- |
| `contract.ts` | Wire types shared with the API. Type-only, no runtime |
| `env.ts` | Guarded storage/cookie/crypto access. **Never throws** |
| `identity.ts` | Anonymous visitor id; layered persistence; cross-origin handoff |
| `url.ts` | Normalisation, EXACT/PREFIX matching, handoff params |
| `assignment.ts` | Random 50/50 draw, persisted so it never repeats |
| `redirect.ts` | The decision, and four independent loop guards |
| `conversion.ts` | Goal matching and once-per-assignment claiming |
| `engagement.ts` | Visible-time accumulator (`performance.now()`, delta reporting) |
| `dedupe.ts` | Page-view guard against repeated SDK initialisation |
| `cloak.ts` | Calls `window.__routelyReveal` — the overlay itself lives in the install snippet |
| `config.ts` / `transport.ts` / `track.ts` | Fetch + cache config; timeouts; `sendBeacon` |
| `index.ts` | Options, boot sequence, orchestration |

### Three properties that govern every change here

1. **It never breaks the page.** Every failure path — no storage, no network, malformed
   response, blocked request — ends with the SDK doing nothing. Nothing throws into the host
   page; no promise is left to reject unhandled.
2. **It never blocks the page.** Loaded synchronously so a redirect can precede paint, but the
   work is async and never gates rendering.
3. **It carries no secret.** The only credential-shaped value is the public site id, visible in
   page source by design.

### Four redirect loop guards

Each sufficient on its own for the case it covers:

1. Only the **control** URL is a trigger; the variant is never matched
2. Already on the variant — catches a variant nested under a `PREFIX` control
3. Arrived by this experiment's own redirect (handoff params) — works across origins
4. A session counter incremented **before** navigating, capped at one redirect

Plus a final check that the target is not the page already displayed. `location.replace()`, not
`assign`, so Back does not bounce.

### `lib/url.ts` is duplicated on purpose

`apps/web/src/lib/url.ts` and `packages/sdk/src/url.ts` implement the same normalisation. The
SDK cannot import from the app, and a shared package would add a module graph to a bundle whose
whole point is being one small file. **Both have mirrored test suites — change both together.**

### Time on page is approximate, and must be labelled so

The browser reports *document visibility*, not attention. A tab open on a monitor nobody is
watching counts; time after the last beacon is lost. It is meaningful **as a comparison between
two arms** (shared bias cancels), never as a session-duration figure. See
`docs/SDK-DEPLOYMENT.md`.

### No statistical significance claims

The results UI says which arm is *currently* ahead and states plainly that it is **not proof**.
A leader is suppressed below 30 assigned visitors per arm; lift is suppressed below 60 total.
Computing a p-value is easy; choosing one correctly is not, and a test read whenever the
numbers look good is wrong regardless of the statistics behind it. Do not add a significance
claim without being asked.

---

## 8. Commands

```bash
npm install
cp .env.example apps/web/.env      # BOTH Next.js and the Prisma CLI read apps/web/.env
npm run db:up                      # Postgres in Docker
npm run db:migrate
npm run db:seed                    # optional; idempotent
npm run dev                        # http://localhost:3000

npm run check                      # typecheck + lint + format:check + tests — run before finishing
npm run build                      # builds the SDK first, then the app
npm run db:verify                  # 16-check data-model smoke test against live Postgres
npm run sdk:build                  # size-budgeted SDK build
```

**Local and production are configured independently and need no switching.** `apps/web/.env`
holds local values only; production values live in the Vercel project's environment variables,
and `.vercelignore` keeps every `.env` off the build machine. `env.ts` derives `AUTH_URL` and
`NEXT_PUBLIC_APP_URL` from `VERCEL_PROJECT_PRODUCTION_URL` when they are unset, so a deployment
cannot inherit a localhost value.

`db:reset` and `db:seed` run `scripts/assert-local-db.mjs` first, which aborts unless
`DATABASE_URL` resolves to a local host. `.env` did once point at production Neon — with a
duplicate `DATABASE_URL` line, so the local one *looked* right while the second silently won —
which aimed a command that drops every table at production data. `db:deploy` is deliberately
**not** guarded: that is how Vercel applies migrations during `vercel-build`.

Tests: **129** — 100 in the SDK, 29 in the app. Both run under Vitest in a Node environment.

---

## 9. Gotchas that will cost you time

Every one of these was hit at least once during the build.

**Restart `npm run dev` after any `prisma generate`.** `db.ts` caches the client on
`globalThis` across hot reloads (correct for connection pooling), so a regenerated client is
**not** picked up. Symptom: `The column X does not exist in the current database` or
`PrismaClientValidationError` on a field you just added. This bit the build three separate
times.

**Prisma cannot rename a column.** Its diff sees a drop plus an add and recreates the column
empty. Three migrations here are hand-written `ALTER TABLE ... RENAME COLUMN`. Check
`prisma/migrations/*/migration.sql` before committing any migration — that file is what runs in
production, not the schema.

**`server-only` throws under Vitest.** `apps/web/vitest.config.mts` aliases it to the package's
own `empty.js`. Do not remove that alias, and do not weaken the guard in the app build.

**Next.js 16 renamed things.** Middleware is now `proxy.ts`. `PageProps<'/route'>` and
`LayoutProps<'/route'>` are generated globals — this codebase uses explicit prop types instead,
so `tsc --noEmit` works without a prior build. The `eslint` key in `next.config.ts` no longer
exists. Bundled docs are at `node_modules/next/dist/docs/`.

**`useActionState` uses a different progressive-enhancement encoding** than a bare Server Action
form: `$ACTION_REF_n` / `$ACTION_n:0` / `$ACTION_KEY`, not `$ACTION_ID_<hex>`. Matters if you
write a harness that replays forms.

**Prettier reflows JSX text.** A `python .replace()` against text you wrote earlier will
silently no-op after formatting. **Always `assert old in s` before replacing.** Two edits were
lost this way and only caught by lint reporting unused imports.

**`notFound()` inside `(app)` returns HTTP 200, not 404.** `loading.tsx` creates a Suspense
boundary that flushes the shell and commits the status before `notFound()` runs. The not-found
*page* renders correctly and no data leaks — only the status code is wrong. Verify
authorization by asserting on content, not on `=== 404`.

**React splits `{value} text` into separate text nodes.** `grep "50 / 50"` fails on markup that
renders correctly. Use a tolerant pattern when asserting against HTML.

**`vm` contexts have no `URL`.** It is a Web API, not an ECMAScript built-in. Supply it when
running the SDK bundle in a sandbox.

**Do not `pkill -f "next dev"`.** The pattern matches the wrapper shell running the command and
kills your own process. Use `pkill -f "[n]ext-server"`.

---

## 10. How verification is done here

The user expects each part to be verified against a **running server and a real database**, not
by assertion. The pattern used throughout:

1. Seed fixtures with a throwaway `prisma/_setupN.ts` script
2. Drive the real HTTP surface — find each form in the rendered page and replay its hidden
   fields exactly as a browser with JavaScript disabled would
3. Assert on rendered content and on database rows
4. **Delete the fixtures and the scratch scripts afterwards**
5. Run `npm run check` and `npm run build`

Two-user authorization checks are standard: create a second user, replay the first user's form
with the second user's session, and confirm nothing changed.

**Report failures honestly, including your own harness bugs.** Several "failures" during the
build were bad assertions rather than bad code — say so rather than quietly fixing the test.

---

## 11. Build status

Working: Google sign-in · website CRUD · install snippet · experiment create/edit/publish/pause
· the SDK (assignment, loop-safe redirect, page views, visible time, conversions) · public
config and ingestion endpoints with rate limiting and bot filtering · results dashboard · date
ranges · relative change · public share links · experiments list.

**Not built:** the production Docker Compose stack and Dockerfile (only `docker-compose.dev.yml`
and reference Nginx configs exist) · statistical significance · click / custom-JS / form goals ·
multi-variant tests · SPA route-change tracking · event retention policy.

Known limitations are listed at the end of each `docs/*.md`. The most significant:

- **Rate limiting is per-process** — multiple containers multiply the effective limit
- **Conversions are per-origin** — the assignment lives in `localStorage`, so a goal page on a
  different origin from where the visitor was assigned will not convert
- **Redirect flicker is bounded, not eliminated** — the pasted anti-flickering script lifts
  after `routelyTimeout` (1250 ms), so a config request slower than that still flashes the
  control page. Sites that skip that script keep the flicker entirely
- **One redirect per tab session**, not per visitor

---

## 12. Working style the user expects

- **Verify, do not assert.** Run it against real infrastructure and show the output.
- **Explain the reasoning behind a decision**, especially where an obvious alternative was
  rejected — and say which alternative and why.
- **Flag deviations from the spec explicitly** rather than silently doing something different.
  Several parts deviated for good reasons; each was called out and offered for reversal.
- **Report what failed**, including mistakes in your own test harness.
- **Do not over-build.** Each part had a scope, and "do not implement X yet" was honoured.
- Finish with: files changed, how to test, environment variables, and known limitations.
