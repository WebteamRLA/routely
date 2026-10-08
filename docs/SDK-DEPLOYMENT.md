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
| Size budget | **7.5 kB gzipped — the build fails if exceeded** (6 kB before protocol v4) |
| Current size | 19.15 kB raw · 7.22 kB gzip · 6.54 kB brotli |
| Served at | `/sdk.js` → `/sdk/v2/sdk.js` (the build copies the same file to `/sdk/v1/`) |

**Why the budget moved.** Protocol v4 added A/B element changes (with a `MutationObserver`
wait), page/audience/device/condition targeting, crawler skipping, preview links, winner
redirects and the `track()` API with its pre-load queue — about 2 kB gzip of the 7.22. The
budget was raised only to 7.5 kB, leaving ~280 B for fixes rather than features.

### What it does today (protocol v4)

1. Reads `data-site-id` from its own `<script>` tag; installs `window.routely` (with
   `track`) **synchronously**, then replays anything queued before it loaded.
2. Resolves an anonymous visitor id, persisting it across visits and across the redirect.
3. Fetches `/api/v1/config?v=4&siteId=…` and caches it for the server-supplied TTL.
4. Skips everything for a crawler user agent (compact copy of `server/http/bot-filter.ts`):
   search engines always see the control, and nothing is reported.
5. A completed Split URL test with *keep winner* is served `locked`: the visitor is sent to the
   winner every visit, with no assignment and no events.
6. For each running experiment whose **page rule** matches the current URL: if the visitor has
   no stored arm, the entry gates apply — audience (new/returning: did a visitor id exist before
   this load), device (UA, refined by viewport on touch screens), conditions on query / `utm_*`
   / referrer read from the **raw** URL with ALL/ANY logic, then the persisted coverage draw. An
   assigned visitor keeps their arm regardless of the gates.
7. Redirect tests: unchanged decision and four loop guards (below). A/B tests: the arm's
   changes are applied — `text` → `textContent`, `bg` → `background-color !important`, `image` →
   `<img src>` (dropping `srcset`) or `background-image` — to the **first element matching the
   selector list** (`querySelector`), re-applied by a `MutationObserver` as the page parses; the
   page is revealed when every change has found its element, at `DOMContentLoaded`, or after
   1.5 s. A selector that throws is a non-match.
8. Reports, in **one beacon**: each experiment's `assignment` (once) and `page_view`, then a
   site-level `page` event for every page view. A visitor being **redirected** sends only the
   assignment from the control page — they never see it — and the **variant page** then records
   that arm's `page_view` and visible time: a redirect test's variant URL is treated as part of
   the experiment for a visitor who already holds (or was handed) that arm, even though the
   page rule only describes the entry page.
9. Measures approximate visible time and reports it per experiment.
10. `routely.track(key)` sends a `track` event. The server records a `MetricHit` for a matching
    custom-event metric and derives conversions (below).

**Preview links** — `?routely_preview=<experimentId>:<position>` — fetch the config with
`&preview=<id>` (served whatever the experiment's status, never cached), force that arm, apply
it (or redirect, carrying the flag), and **store and send nothing**, `track()` included.

### Wire contract (v4)

```jsonc
// GET /api/v1/config?v=4&siteId=rt_…[&preview=<experimentId>]
{ "v": 4, "siteId": "rt_…", "ttl": 60, "experiments": [
  { "id": "…", "type": "redirect" | "ab",
    "targeting": { "match": "exact|contains|starts|wildcard|regex|EXACT|PREFIX", "pattern": "…",
                   "audience": "all|new|returning", "devices": ["desktop","tablet","mobile"],
                   "logic": "all|any", "conditions": [{ "field", "key", "op", "value" }] },
    "coverage": 100,
    "arms": [ { "position": 0, "variantId": null, "weight": 50, "url": "…" /* redirect */ },
              { "position": 1, "variantId": "…", "weight": 50, "changes": [{ "selector", "prop": "text|bg|image", "value" }] /* ab */ } ],
    "preview": true /* only on the experiment a preview link asked for */ },
  { "id": "…", "type": "redirect", "locked": true, "targeting": { … }, "target": "https://…/winner" } ] }

// POST /api/v1/events  (text/plain JSON, sendBeacon)
{ "v": 4, "siteId": "rt_…", "visitorId": "…", "events": [
  { "type": "assignment|page_view|time_on_page", "experimentId", "variantId", "url", "ts", "durationMs?" },
  { "type": "page", "url", "ts" },
  { "type": "track", "key", "url", "ts" } ] }
```

- Uppercase `EXACT`/`PREFIX` page rules are served for experiments with **no stored
  targeting**, so they keep the normalised-URL semantics (query-sensitive EXACT, boundary PREFIX)
  they were created with. Lowercase modes are the targeting step's (`lib/targeting.ts`
  `matches`, mirrored in `packages/sdk/src/targeting.ts` and checked by
  `lib/targeting-mirror.test.ts`).
- **Location is resolved by the config endpoint**, from `x-vercel-ip-country`, else
  `cf-ipcountry`. An experiment the visitor's country fails is omitted. **An unknown country
  is included** (self-hosted without a geo header, local dev): failing closed would silently
  switch geo-targeted tests off wherever geo is unavailable. A response that depends on the
  country is sent `Cache-Control: private` with `Vary` on both headers.
- **v3 compatibility.** Without `v=4` the endpoint answers in the v3 shape (running Split URL
  tests only; targeting ignored; a metric goal is published as an empty URL that never
  matches), and ingestion accepts v3 batches including their `conversion` events. That keeps
  bundles cached from the immutable `/sdk/v1/` path working.
- A v4 bundle never sends `conversion` — the v4 schema rejects it.

---

## Conversions

A conversion is a visitor who was **in** an experiment meeting that experiment's goal. Both
conditions are required: someone who reaches `/thank-you` without ever having been bucketed did
not convert *in this experiment*.

Since v4 the browser does not claim conversions — the **server derives them**. For every `page`
and `track` event it loads the visitor's **existing** assignments in running experiments of
that website and, for each primary or secondary goal the event meets, records:

| Goal | Met by |
| --- | --- |
| URL goal (`goalKey: "url"`) | a `page` event on `conversionUrl` (normalised; PREFIX needs a path boundary) |
| Page-visit metric (`goalKey: <metricId>`) | a `page` event matching the metric's URL; the system `page_view` metric matches every page |
| Custom-event metric (`goalKey: <metricId>`) | a `track` event with exactly that key |

Each occurrence writes a `Conversion` row — **unique per `(assignmentId, goalKey)`**, so a
refresh cannot inflate counting mode UNIQUE — and an `Event` of type `conversion` with the
`goalKey`, which counting mode ALL counts (a repeat within 5 s on the same URL is dropped as a
double-initialisation burst). The same events record a `MetricHit` per matching metric.

### Server-side guarantees

1. **The assignment must already exist.** A `page`/`track` event never creates a visitor or an
   assignment; a forged request cannot invent a visitor, choose their arm and convert them.
2. **Only running experiments of the reporting website** are considered.
3. **The stored arm wins** — the conversion carries the assignment's arm, not anything sent.
4. **URLs are normalised and timestamps clamped** exactly as for experiment events.

### Known limitation: cross-origin goals

The visitor id lives in per-origin storage. A goal page on a **different origin** from where the
visitor was assigned reports a different visitor id, so no assignment is found and no
conversion recorded. The redirect handoff carries identity from control to variant only.

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
npm run test --workspace @routely/sdk      # 20 unit tests, no DOM required
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
apps/web/public/sdk/v1/build.json         apiBase, target and sizes of this build
```

The size budget is enforced, not advisory — the build exits non-zero when the gzipped bundle
exceeds 6 kB. This runs on every page of every customer site, so growth should be a deliberate
decision rather than a drift nobody noticed.

Tests run in plain Node with no DOM. That is possible because the browser-dependent parts are
reached through injectable interfaces, which keeps the run fast and avoids a jsdom dependency
in a package whose whole point is having none.

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
lifts itself at exactly 1250 ms.**

---

## 6. Known limitations

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
6. **A/B changes are applied during a bounded window.** The observer re-applies for 1.5 s, so
   a single-page app that re-renders an element later (or navigates client-side) can revert a
   change; SPA route-change tracking is not built.
7. **A `page` event is sent on every page of an installed site**, not only experiment pages —
   page-visit metrics and URL goals need it. It is one beacon per page load, deduplicated per
   URL for 5 s against double initialisation.
8. **Bot detection is user-agent only**, in the SDK as on the server: a crawler that lies about
   itself is treated as a visitor.
