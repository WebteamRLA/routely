# Tracking SDK — build, hosting and deployment

How `packages/sdk` becomes `https://cdn.example.com/sdk.js`.

---

## 1. What the SDK is

A single, dependency-free browser bundle. No npm package for customers to install, no module
graph, no build step on their side — installation is one tag:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

The install screen pairs it with a short inline anti-flickering script above it, which is
optional and covered in §5. Everything below concerns the bundle itself.

That is what makes it framework-independent: it asks nothing of the host page beyond a
`<script>` element, so the same file runs on WordPress, WooCommerce, React, Next.js, Shopify
and hand-written HTML.

| Property | Value |
| --- | --- |
| Language | Vanilla TypeScript, no framework, no runtime dependencies |
| Output | One IIFE file, `dist/sdk.js`, plus a source map |
| Target | ES2019 |
| Size budget | **8 kB gzipped — the build fails if exceeded** (6 kB until v4; raised by the user, decision D3) |
| Current size | 20.94 kB raw · 7.63 kB gzip · 6.89 kB brotli (`npm run sdk:build`, 2026-10-22) |
| Wire protocol | v4 (`SDK_PROTOCOL_VERSION`); a v3 server is still understood |

### What it does today

1. Reads `data-site-id` from its own `<script>` tag.
2. If the URL carries `#_rt_edit=<token>` and the page was framed or opened by another window,
   hands over to the visual editor bridge (§7) and does nothing else.
3. Resolves an anonymous visitor id, persisting it across visits and across the redirect.
4. Fetches `/api/v1/config?siteId=…&v=4` and caches it for the server-supplied TTL — and, while
   that request is in flight, sends the **site-wide page hit** (§6).
5. Records a conversion when the page matches an experiment's goal URL **and** the visitor
   already holds an assignment for it.
6. Matches the normalised current URL against each active experiment's control URL.
7. Skips the experiment — no draw, nothing reported, page revealed — if the device is not targeted,
   or the visitor falls outside the traffic allocation (a decision drawn once and persisted).
8. Reads the visitor's stored assignment, or draws one by the arms' weights and persists it.
9. Reports the assignment and page view to `/api/v1/events` with `sendBeacon`.
10. **Split URL:** redirects variant visitors to the variant URL (carrying their own query string
    and fragment when `keepParams` is on), or leaves control visitors in place.
    **A/B test:** keeps everyone on the page and applies the variant's visual changes (§6).
11. Measures approximate visible time on the page and reports it incrementally.
12. Exposes the result on `window.routely` for debugging.

---

## Conversions

A conversion is a visitor who was **in** an experiment reaching the page that experiment counts
as success — a thank-you or order-confirmation page. Both conditions are required, and the
second is what makes the number mean anything: someone who reaches `/thank-you` without ever
having been bucketed did not convert *in this experiment*, and counting them would credit the
test for traffic it never touched.

### Once per assignment, enforced three times

| Layer | Catches |
| --- | --- |
| In-instance guard | A second copy of the SDK on the same page load |
| `localStorage` marker (never expires) | A refresh, a return visit tomorrow, a second tab |
| **`conversions.assignmentId` unique constraint** | Everything else, including a forged request |

The database constraint is the only one that actually guarantees it — the client is precisely
what cannot be trusted to have asked once. The marker lives in `localStorage` rather than
`sessionStorage` because a conversion is once per assignment for the life of the experiment,
not once per session.

### Server-side validation

Three checks, each closing a way the headline number could be moved by a crafted request:

1. **The URL must match the experiment's configured goal.** Otherwise the URL is whatever the
   client says it is, and a conversion could be booked from anywhere.
2. **The assignment must already exist.** Every other event type may create one — that is the
   point of an `assignment` event — but a conversion arrives later, by which time the
   assignment has had a full page load to reach the server. Creating one here would let a
   forged request invent a visitor, choose their arm, and convert them.
3. **The stored arm wins.** A payload claiming the other side does not move the visitor.

### Known limitation: cross-origin goals

The assignment lives in `localStorage`, which is per-origin. A conversion page on a **different
origin** from where the visitor was assigned will not see their assignment, and the conversion
is not recorded. The redirect handoff carries identity from control to variant, but no such
handoff exists for an arbitrary later navigation.

In practice most setups keep control, variant and goal on one origin, where this does not
arise. A test spanning `acme.com` and `shop.acme.com` will under-count conversions on the
other origin.

---

## Time on page is approximate — and cannot be otherwise

This deserves stating plainly, because the number looks precise and is not.

**A browser will not tell a script how long a person looked at a page.** What it exposes is
whether the *document* is visible, which is a far weaker signal. The SDK measures document
visibility — starting a timer when the page is visible, pausing on `visibilitychange` to
hidden, resuming when visible again — and calls the result engaged time because that is the
closest honest approximation available.

### What inflates it

- A tab left open on a monitor nobody is looking at counts every second as engaged.
- On most browsers a tab that is visible but sitting *behind* another window still counts.
- A person who walks away mid-article is indistinguishable from one reading slowly.

### What deflates it

- Time after the last beacon is lost. A crash, a force-quit, or a browser that drops the final
  `sendBeacon` truncates the measurement silently — and that is more likely on slow devices.
- A visitor who never triggers a lifecycle event contributes only what was already flushed.
- Storage or network being blocked drops reports entirely.

### Why it is still worth measuring

Both arms are measured **the same way**, so the bias is shared and largely cancels in the
comparison. "The variant held attention 40% longer than the control" is a defensible reading.
"Visitors spend 25 seconds on this page" is not, and neither is comparing the figure against
one from another analytics tool that measures something different.

### How it is measured

| Decision | Reasoning |
| --- | --- |
| `visibilitychange`, not `blur`/`focus` | Clicking devtools or a second monitor should not read as leaving the page |
| `pagehide`, not `beforeunload` | `beforeunload` disqualifies the page from the back/forward cache, slowing navigation for the customer's visitors |
| `performance.now()`, not `Date.now()` | Monotonic: an NTP correction or time-zone change cannot show up as an eleven-hour read |
| Reported as **deltas**, not a running total | A dropped final beacon costs the tail rather than the entire measurement |
| Flushes below 1s are held back | Flicking between tabs would otherwise generate a request per switch |
| A single interval is capped at 6 hours | A laptop that slept with the tab open is not a reader |
| Finalisation is idempotent | `pagehide` and `visibilitychange` can both fire during one teardown |

The control page is deliberately **not** measured when the visitor is about to be redirected:
they are there for milliseconds, and counting it would drag the control arm's average down for
a reason unrelated to the page.

### Aggregation

`avgVisibleMs` is total reported visible time divided by **page views**, per arm — page views
being the unit the measurement is actually taken in. Any interface showing it must label it as
approximate.

### What it never does

- **Carry a secret.** The only credential-shaped value it knows is the public site id, which
  is visible in page source by design and permits nothing beyond recording activity for one
  website. No database URL, no `AUTH_SECRET`, no OAuth credentials — none of these exist in
  the bundle, and the build would have to import server code to include them.
- **Send cookies.** The config request uses `credentials: "omit"`, so the customer's cookies
  are never attached, and the CDN origin has no cookies of its own.
- **Break the page.** Every failure path — storage denied, network blocked, malformed
  response, timeout — ends with the SDK doing nothing. Nothing throws into the host page.
- **Block the page.** The tag loads synchronously (so a future redirect can be decided before
  paint), but the work is asynchronous and never gates rendering.

---

## 2. Anonymous visitor identity

A random v4 UUID, derived from nothing about the person — no IP, no user agent, no
fingerprint. It answers one question: *have I seen this browser on this site before?*

Storage is layered, and the id is written back to **every** available layer whenever it is
read. That heals the common asymmetry where a cookie survives but `localStorage` was cleared,
so a visitor is not re-bucketed just because one mechanism was dropped.

| Order | Mechanism | Why |
| --- | --- | --- |
| 1 | `localStorage` | Survives restarts; not sent with every HTTP request |
| 2 | Cookie (`SameSite=Lax`, `Secure` on HTTPS, 1 year) | Works where storage is denied |
| 3 | In-memory | Last resort — the visitor is new each page load, but the SDK still runs |

Availability is established with a **read-write probe**, not a truthiness check: Safari in
private browsing exposes `localStorage` and then throws on the first write, so an object that
merely exists proves nothing.

A stored value that does not match the ingestion API's format is discarded and replaced.
Storage is shared with the host page, which may write anything under any key.

---

## 3. Building

```bash
npm run sdk:build                          # production: minified, size-checked
node packages/sdk/build.mjs --watch        # rebuild + republish on change
npm run test --workspace @routely/sdk      # 192 unit tests in 15 files (2026-10-22), no real DOM
```

`ROUTELY_API_BASE` is baked into the bundle at build time and defaults to
`http://localhost:3000`. **It must be set for production builds**, because it is the origin
every installed snippet will call:

```bash
ROUTELY_API_BASE=https://app.example.com npm run sdk:build
```

The build writes:

```
packages/sdk/dist/sdk.js                  the artifact
apps/web/public/sdk/v1/sdk.js             published copy, served by the app at /sdk.js
apps/web/public/sdk/v1/sdk.js.map
apps/web/public/sdk/v1/editor-agent.js    only when src/editor-agent.ts exists — it does not yet
apps/web/public/sdk/v1/build.json         apiBase, target and sizes of this build
```

The size budget is enforced, not advisory — the build exits non-zero when the gzipped bundle
exceeds 8 kB. This runs on every page of every customer site, so growth should be a deliberate
decision rather than a drift nobody noticed. At 7.63 kB there is little headroom left.

The visual editor agent is a **second entry point** with its own 12 kB gzip ceiling. It is loaded
only inside the Routely editor, never by an ordinary visitor, so it does not count against the main
budget. `build.mjs` builds it only when `src/editor-agent.ts` exists and otherwise prints
`editor-agent.js: no src/editor-agent.ts — not built`. Writing it is waiting on the user's permission
decision (§7).

Tests run in plain Node with no DOM. That is possible because the browser-dependent parts are
reached through injectable interfaces (and a small `test/fake-dom.ts` for `apply.ts` and the boot sequence), which keeps
the run fast and avoids a jsdom dependency in a package whose whole point is having none.
`url.test.ts` mirrors `apps/web/src/lib/url.test.ts` — the normalisation is duplicated on purpose,
so change both together.

---

## 4. Hosting assumptions

Two hostnames, deliberately separate:

| Host | Serves | Why separate |
| --- | --- | --- |
| `app.example.com` | Dashboard + API (Next.js container) | Session-bearing, dynamic, never cached |
| `cdn.example.com` | `sdk.js` only, from nginx directly | Must stay up while the app deploys; no Node in the request path; **no cookies** |

Splitting them matters for a reason beyond performance: the dashboard's session cookies are
scoped to `app.example.com`, so they are never sent with an SDK request from a customer's
site.

### Caching

| Path | Cache-Control | Reasoning |
| --- | --- | --- |
| `/sdk.js` | `max-age=300, stale-while-revalidate=86400` | A moving pointer. A bad bundle must not be stuck in browser caches. |
| `/v1/*` | `max-age=31536000, immutable` | The version is in the path, so the bytes never change. |
| `*.map` | `max-age=3600` | Useful for debugging an install; contains no secret — the bundle is public. |

All three send `Access-Control-Allow-Origin: *`. A classic `<script>` tag does not need CORS,
but this makes the bundle usable from a module import or a `fetch` too.

### Compose

The SDK is a static file, so nginx serves it from a volume rather than proxying to the app:

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - sdk-assets:/srv/sdk:ro           # cdn.example.com document root
      - certbot-conf:/etc/letsencrypt:ro
      - certbot-www:/var/www/certbot:ro
    depends_on: [web]

  web:
    build: { context: .., dockerfile: infra/Dockerfile }
    expose: ["3000"]
    volumes:
      - sdk-assets:/app/apps/web/public/sdk   # the build writes here; nginx reads it
    env_file: [.env]
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  sdk-assets:
  certbot-conf:
  certbot-www:
```

The `sdk-assets` volume is the handoff: the web image's build step produces the bundle into
`public/sdk`, and nginx serves the same directory read-only as `/srv/sdk`. `cdn.example.com/sdk.js`
resolves to `/srv/sdk/v1/sdk.js` via `try_files`.

### Deploying a new bundle

```bash
# On the VPS
git pull
ROUTELY_API_BASE=https://app.example.com docker compose build web
docker compose up -d web              # repopulates the sdk-assets volume
curl -sI https://cdn.example.com/sdk.js | grep -iE 'HTTP|cache-control|access-control'
```

No nginx restart is needed — it serves whatever is in the volume.

### Rolling back

Because `/sdk.js` is only cached for five minutes, redeploying the previous image restores the
old bundle for effectively all traffic within that window. That short TTL is the entire reason
the moving pointer and the immutable versioned path are kept separate.

---

## 5. Configuration reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `ROUTELY_API_BASE` | SDK build | Baked into the bundle; the origin installed snippets call |
| `NEXT_PUBLIC_SDK_URL` | Dashboard runtime | The URL rendered into the install snippet |

These are two halves of one decision and must agree: the snippet points at
`NEXT_PUBLIC_SDK_URL`, and the bundle served there calls `ROUTELY_API_BASE`.

Per-site overrides, for debugging one installation without rebuilding:

| Attribute | Default | Purpose |
| --- | --- | --- |
| `data-site-id` | _required_ | Public site id |
| `data-api` | build-time value | Override the API origin |
| `data-timeout` | `3000` | Config request timeout, in ms |
| `data-debug` | `false` | Log decisions to the console |

### The anti-flickering script

A redirect test has an unavoidable race. The tag is synchronous, so the SDK runs before the
page paints — but the *decision* needs the experiment configuration, and that is a network
request. While it is in flight the browser carries on parsing and paints the control page, so
a visitor bound for the variant sees the wrong page for as long as the request took. On a warm
connection that is a flash; on a cold serverless start it was measured at about a second.

The fix is to hide the page until the decision is made. **That overlay is created by a second
inline script the customer pastes above the tag, not by the bundle.** The install screen shows
both blocks together and they are copied as one.

```html
<!-- Routely anti-flickering script -->
<script>
var routelyTimeout = 1250;
!function(d,w,i,t){ /* … creates #routely-cloak, publishes w.__routelyReveal, clears after t */ }
(document,window,"routely-cloak",routelyTimeout);
</script>

<!-- Routely tracking script (place in <head>) -->
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

The SDK's only involvement is ending the wait early: it calls `window.__routelyReveal()` the
moment it knows the visitor is staying. A redirect deliberately does *not* call it — the page
is being replaced, and revealing the control page for the duration of that navigation is the
exact flash the script exists to remove.

| Visitor | When the SDK lifts the overlay |
| --- | --- |
| Control, excluded by traffic allocation, untargeted device, no matching experiment, no config | Immediately, once the decision is known |
| Split-URL variant | Never — the page is being replaced |
| A/B variant with changes | Once its changes are applied, or when it stops waiting for elements that have not appeared (§6) |
| Visual editor session | Immediately — the editor needs to see the page |

In every case the snippet's own `routelyTimeout` still bounds the wait: the SDK can lift the overlay
earlier, never hold it longer. The default is 1250 ms (`DEFAULT_ANTI_FLICKER_MS`); the design's
snippet used 2 s and a different markup, and the real one was kept (decision D10).

Three reasons it lives in the page rather than the bundle:

1. **It runs earlier than any bundle can.** There is no network request in front of an inline
   script, so it takes effect at parse time even when the CDN is slow.
2. **The timings belong to the customer.** `routelyTimeout` and the `#fff` background are plain
   values at the top of the script on their own page. A dark site, or a site on slow hosting,
   is a one-character edit — not a redeploy of ours, and not one number baked into a bundle
   that every customer shares.
3. **It lifts even if the SDK never arrives.** The timeout belongs to the pasted script, so a
   blocked, failed, or missing bundle cannot leave a page hidden. This is the failure that
   actually matters: a cloak that never lifts is a blank site, which is far worse than the
   flicker it replaces.

Installing the anti-flickering script is optional. Omit it and the tracking still works
exactly as before — you simply keep the flicker.

**Implementation notes.** Every declaration is `!important`, because the customer's own
stylesheets are linked *after* this element in document order and would otherwise win on equal
specificity. The overlay is a `position:fixed` `body::after` rather than styles applied to
`body` itself — Mida's published snippet sets `position:relative;overflow:hidden` on the body,
which mutates the host layout and can reflow visibly when it is undone; a fixed pseudo-element
covers the viewport regardless of document height and the host box model never participates.

**Verified in headless Chrome** against the snippet the dashboard actually generates: with the
config held at 900 ms the overlay is painting at 300 ms and 600 ms and is *never* lifted, the
visitor going straight to the variant; with no matching experiment the SDK lifts it at 904 ms,
as soon as the configuration lands; and **with the tracking script removed entirely the snippet
lifts itself at exactly 1250 ms.** (Measured before v4; the A/B hold has not been re-measured
the same way.)

---

## 6. Protocol v4: A/B tests, device targeting and the site-wide hit

### The configuration document

`GET /api/v1/config?siteId=rt_…&v=4` returns only **ACTIVE** experiments — the mechanism behind every
lifecycle guarantee: a draft never reaches a browser, and pausing takes effect as caches expire.
`Cache-Control: public, max-age=60, stale-while-revalidate=300`; the SDK also caches it in
`sessionStorage` for the server's `ttl` (60 s).

```jsonc
{ "v": 4, "siteId": "rt_…", "ttl": 60,
  "experiments": [{
    "id": "…", "kind": "split_url" | "ab_test",
    "devices": ["mobile"],              // [] = every device
    "keepParams": true,                 // split_url only
    "control": { "url": "https://…", "match": "EXACT" | "PREFIX" },
    "controlWeight": 50,
    "variants": [
      { "id": "…", "weight": 50, "url": "https://…" },                         // split_url
      { "id": "…", "weight": 50, "changes": [                                  // ab_test
          { "selector": "#hero h1", "kind": "heading", "fingerprint": { "tag": "h1" },
            "set": { "text": "…", "backgroundColor": "#1F3D2B", "src": "https://…", "alt": "…" } } ] }
    ],
    "goal": { "url": "https://…", "match": "EXACT" },
    "trafficAllocation": 100 }] }
```

**Older bundles.** An installed v3 bundle sends no `v`. Anything other than `v=4` gets a **v3
document that omits every A/B test and every device-targeted experiment**: a v3 bundle would read an
A/B test as a redirect to a variant with no URL, and would show a device-targeted test to every
device. The SDK, in turn, reads a v3 document as v4 with every new field at its default
(`split_url`, all devices, no `keepParams`). `/api/v1/events` accepts batches with `v` 3 or 4 — the
batch shape did not change.

The route accepts stored variant `changes` either as a bare array or as the stored
`{ schemaVersion: 1, changes }` envelope, and projects each change to the fields above — the stored
`id`, `label` and `original` are not sent to visitors.

### Device targeting is decided in the browser

`device.ts` classifies the browser from the **user agent**, not the viewport (a touch laptop, a
narrow window and a phone in landscape all sit on the wrong side of any width threshold):

1. **Tablet** — an iPad user agent; iPadOS 13+ (reports `Macintosh`, told apart by
   `maxTouchPoints > 1`); Android without the `Mobile` token.
2. **Mobile** — `navigator.userAgentData.mobile` where offered, else `Mobi` / `iPhone` / `iPod` /
   `Android … Mobile`.
3. **Desktop** — everything else, including anything unrecognised.

The check runs **before** the inclusion gate and the draw: a visitor on an untargeted device is
never entered, consumes no draw, and nothing is reported for them. **The server cannot verify
this** — ingestion only ever sees visitors the SDK let in. A modified client could enter itself
into a test it was excluded from, exactly as it could forge any other event; that moves no metric
for anyone but itself.

### Visual changes (A/B tests)

An `ab_test` visitor stays on the control page. Inclusion, the weighted draw, reporting, visible
time and conversions work exactly as on a split-URL control page; none of the redirect loop guards
apply because nothing navigates. A variant visitor's changes are applied by `apply.ts`:

- **As elements appear.** The SDK runs in `<head>`, before `<body>` exists, so it applies once
  immediately, again on every DOM mutation, and a last time one second after `DOMContentLoaded`;
  anything still missing is given up on. Hard stop at 10 s regardless.
- **Guarded against hydration.** For 2 s after that, a change the page reverts (a framework
  re-rendering server text) is re-applied, at most 5 times per change, so the SDK can never fight a
  page in a loop.
- **Only ever data.** Text is set with `textContent` (or `value` on an `<input>`), never
  `innerHTML`; a colour must be `#rgb`, `#rrggbb`, `rgb()` or `rgba()`; an image must be an absolute
  `http(s)` URL. A selector that does not parse, or now resolves to a different tag than the change
  was authored against (`fingerprint.tag`), is skipped. Nothing throws.
- **The overlay is held** until the changes are in place (§5), so the visitor never sees the
  original first.

The server validates the same values when a draft is saved (`validation/visual-change.ts`: at most
50 changes per variant, `https:` images only, the same colour forms, text up to 2,000 characters),
so the browser's checks are a second line, not the only one. A stale assignment to a variant id no
longer in the experiment is treated as control.

### The site-wide hit

```
POST /api/v1/hit     (text/plain, via sendBeacon)
{ "v": 4, "siteId": "rt_…", "anonymousId": "…", "url": "https://…", "ts": 1729500000000 }
```

Every other report is about an experiment. This one is about the website: "this browser saw this
page today", on every page carrying the snippet, whether or not anything is being tested. It is
what feeds tracking status, daily visitors and sparklines, "Visitors · 30 days", page traffic
estimates in the wizards, and the "seen" fallback for tracking checks on sites that inject the
snippet through a tag manager. It is sent while the config request is in flight and independently
of it, so a site with no running experiment — or an API that cannot answer the config — still
reports that the snippet is installed.

- **Client dedupe.** At most once per normalised URL per UTC day per browser, remembered in
  `localStorage` (`routely_hits`, up to 200 URL hashes, discarded the next day). It only saves
  requests; it is not what makes the counts correct.
- **Server.** The route drops bots, bodies over 4 KB and malformed JSON, rate-limits 120 a minute
  per site and IP (per process), and always answers 204 (429 when limited) — a beacon can neither
  retry nor act on an error. `ingest.service.recordHit` takes the website from the site id, normalises
  the URL again, **drops a URL that is not on the website's domain**, clamps the timestamp, and
  inserts one `website_visitor_days` and one `page_visitor_days` row with `ON CONFLICT DO NOTHING`.
  It never creates a `Visitor` — those are experiment participants only.
- **Tracking status** is derived from `Website.lastSeenAt`, bumped by a compare-and-set at most once
  a minute; a website not seen for 24 hours (`TRACKING_ACTIVE_MS`) stops reading as active, and with
  an experiment running there, the daily cron sends "Tracking stops" once per outage.

---

## 7. The visual editor bridge

The visual editor shows the customer's **real page**, not a copy (decision D4 — no server-side
proxy). That needs the snippet installed on the page, and the bridge is the part of the main bundle
that answers the editor. The protocol is defined in `contract.ts` (`EDITOR_PROTOCOL_VERSION = 1`).

```
Routely app (/experiments/new/ab-test)                     Customer page (SDK installed)
──────────────────────────────────────                     ────────────────────────────
POST /api/editor/token  → token
open page#_rt_edit=<token> in an iframe
  (or window.open popup, never noopener) ──────────────►  SDK sees the token, does nothing else
                                                           (no hit, config, assignment, events),
                                                           reveals the page
                         ◄──── routely:hello {token,url}   posted to parent/opener, targetOrigin
                                                           = the app origin; repeated every
                                                           500 ms, up to 20 times
check origin = page origin, source = the window
it opened, token = the one it issued
routely:init {token} ─────────────────────────────────►   accepted only from the app origin,
                                                           from that window, with that token
                                                           → loads <app>/sdk/v1/editor-agent.js
                         ◄──── routely:ready / hover / select / applied   (the agent)
routely:preview / mode / highlight ───────────────────►
```

**What makes it safe is the origin, not the token** — anyone can type a fragment. `hello` is
addressed to the app origin, so if whatever framed the page is not Routely the browser discards it
unread; `init` is accepted only from the app origin and the exact window `hello` went to. Opened
directly in a tab (no parent, no opener) the fragment is ignored and the SDK runs normally. The
token itself (`rte1.<payload>.<HMAC>`, 30 minutes, bound to experiment, website, user and page
origin; key `EDITOR_TOKEN_SECRET` or one derived from `AUTH_SECRET`) **grants no data access**:
changes are saved through the signed-in draft autosave, never through the page.

`POST /api/editor/token` requires a session and EDITOR or above on the experiment's workspace,
insists on a JSON body and refuses `Sec-Fetch-Site: cross-site` (so another site cannot mint one in
a signed-in user's name), and allows 30 a minute per user. The page it opens is the experiment's
**stored** control URL, which must be on the project's domain — never a URL from the request.

**Frame first, popup second.** A frame cannot tell "this site forbids framing"
(`X-Frame-Options` / `frame-ancestors`) from "the snippet is not here". The editor waits 4 s after
the frame's `load` (20 s at most) for a hello, then offers the popup; framing rules do not apply
there, so a popup that stays silent means the snippet is not installed, and only then does the
editor say so. A hello answered but no `ready` within 8 s is `agent_missing`.

**The agent** (`packages/sdk/src/editor-agent.ts`, built to `/sdk/v1/editor-agent.js`, served
`no-cache`) posts `ready`, outlines the element under the pointer, reports a clicked element as an
`ElementDescriptor` (selector verified to resolve back to it), blocks clicks, submits and other
navigation, and answers each `preview` by restoring its snapshots and running `applyChange` — the same
code visitors get — then `applied`. Every inbound message must come from the app origin, from the
window it said hello to, and carry the token.

**Sites that forbid framing** (`X-Frame-Options`, or CSP `frame-ancestors` without the Routely origin)
are reloaded in the frame through the page proxy (`/api/editor/proxy`), which serves a copy with this
app's snippet. The copy is served with `Content-Security-Policy: sandbox allow-scripts` (and the frame
is `sandbox="allow-scripts"`), so it has an opaque origin: the customer's scripts get no cookies, no
storage and no same-origin access to the dashboard, although the copy comes from the dashboard's own
host. Its messages arrive with origin `"null"` and the editor answers it with `targetOrigin "*"`,
always to that one frame. `EDITOR_PROXY_ORIGIN` optionally moves the proxy to a separate host. The
popup is now only the last resort, for a page the proxy cannot fetch either. A site can opt in to the in-screen editor by sending
`Content-Security-Policy: frame-ancestors 'self' <routely origin>`; browsers ignore
`X-Frame-Options` when `frame-ancestors` is present, so the old header can stay.

---

## 8. Known limitations

1. **Identity is per-origin.** A visitor on `www.acme.com` and `shop.acme.com` is two
   visitors, because `localStorage` is origin-scoped and the cookie is host-only. Cross-origin
   continuity arrives with the redirect handoff.
2. **No integrity hash in the snippet.** `/sdk.js` changes on deploy, so a fixed
   `integrity` attribute would break every install. Adding SRI would mean pinning customers to
   a versioned URL and giving up the ability to ship a fix centrally.
3. **`Math.random` is the last-resort id source** on browsers without `crypto`. Acceptable only
   because the value identifies nothing and grants nothing; a collision costs one miscounted
   visitor.
4. **The bundle is not pre-compressed at build time.** `gzip_static` is enabled, so dropping
   `.br`/`.gz` artifacts alongside it later requires no config change.
5. **No CDN in front of nginx.** Fine at this scale; a real CDN would sit in front of
   `cdn.example.com` and honour the same cache headers.
6. **The 8 kB budget is nearly spent** (7.63 kB). The next feature in the main bundle will need a
   trade-off or another budget decision; editor work belongs in the agent bundle.
7. **The editor agent is unwritten** (§7), so the visual editor cannot select elements on a real
   page yet.
8. **`editor-agent.js` will live under `/sdk/v1/`, which `next.config.ts` serves as
   `immutable` for a year** (correct for a versioned path, wrong for a file that changes in place).
   Give the agent a versioned or hashed filename — or a short cache rule — before it ships, or an
   updated agent will not reach editors who cached the old one.
9. **The popup fallback needs `window.opener`.** A customer page sending
   `Cross-Origin-Opener-Policy: same-origin` severs it, so a site that both forbids framing and sets
   COOP cannot be edited. (Follows from the browser's COOP rules; not tried against a real site.)
10. **Visual changes are bounded in time.** A client-rendered element that appears more than a
    second after `DOMContentLoaded`, or a re-render after the 2 s guard window, shows the original.
    A change whose selector no longer matches the site's markup is skipped silently (visible only in
    `window.routely.applied`, and in the console with `data-debug`).
11. **Device targeting, like every browser-side decision, can be forged** by a modified client; it
    only moves that client's own numbers.
12. **The hit's dedupe and rate limit are per browser and per process.** Neither affects
    correctness — the primary keys do — only how many requests reach the database.
