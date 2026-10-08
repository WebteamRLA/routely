# @routely/sdk

Framework-independent browser tracking SDK for Routely experiments — Split URL (redirect) and
A/B (element changes) — with targeting, custom events (`routely.track(key)`) and preview links.
Protocol v4; see `docs/SDK-DEPLOYMENT.md` for the wire contract.

Vanilla TypeScript, no runtime dependencies, bundled by esbuild into a single IIFE
(`dist/sdk.js`) that is copied into `apps/web/public/sdk/v2/sdk.js` (and `/sdk/v1/` for pages
that reference the old path) and served from there.
Because installation is a plain script tag, the same snippet works on WordPress, WooCommerce,
React, Next.js and static HTML sites.

## Build

```bash
npm run build --workspace @routely/sdk     # one-off, minified
node build.mjs --watch                     # rebuild + republish on change
```

`ROUTELY_API_BASE` is baked into the bundle at build time (default `http://localhost:3000`)
and can be overridden per-site with `data-api`.

## Snippet

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

Load it synchronously in `<head>` — no `async`/`defer` — so the redirect decision happens
before first paint.

| Attribute            | Default          | Purpose                                     |
| -------------------- | ---------------- | ------------------------------------------- |
| `data-site-id`       | _required_       | Public site id — identifies a **website**   |
| `data-api`           | build-time value | Override the API origin                     |
| `data-cloak`         | `true`           | Hide the page until the decision is made    |
| `data-cloak-timeout` | `1500`           | Hard ceiling, in ms, on how long it hides   |
| `data-debug`         | `false`          | Log decisions to the console                |

One snippet serves every experiment on a website: `data-site-id` identifies the website, and
which experiments are running is resolved at runtime. Adding, pausing or deleting an
experiment never requires re-installing the snippet.

## Public API

```js
routely.track("signup");                                   // after the snippet
(window.routely = window.routely || []).push(["track", "signup"]); // anywhere, even before it
```

The install snippet's inline block starts the queue and gives it a `track` that queues, so
`routely.track()` is safe from the moment the `<head>` block has run.

## Structure

| File            | Responsibility                                                        |
| --------------- | --------------------------------------------------------------------- |
| `contract.ts`   | Wire types shared with the API (v4, plus the v3 shapes still served). |
| `env.ts`        | Guarded access to storage, cookies and crypto. Never throws.          |
| `identity.ts`   | Anonymous visitor id: layered persistence, cross-origin handoff.      |
| `url.ts`        | Normalisation, EXACT/PREFIX matching, handoff parameters.             |
| `targeting.ts`  | Page rule (mirror of the app's matcher), device, audience, conditions, bot UA. |
| `inclusion.ts`  | Persisted coverage draw.                                              |
| `assignment.ts` | Weighted arm draw, persisted so it is never repeated.                 |
| `redirect.ts`   | The redirect decision, and four independent loop guards.              |
| `changes.ts`    | Applies A/B changes as elements appear; bounded wait before reveal.   |
| `preview.ts`    | `?routely_preview=<experimentId>:<position>` parsing.                 |
| `api.ts`        | `track` key validation and the pre-load queue.                        |
| `config.ts`     | Fetches and caches the published experiment configuration.            |
| `transport.ts`  | `fetch` with a timeout. Resolves `null` on any failure.               |
| `track.ts`      | `sendBeacon` reporting, with a `fetch(keepalive)` fallback.           |
| `index.ts`      | Entry point: options, boot sequence, orchestration.                   |

## Runtime flow

See `docs/SDK-DEPLOYMENT.md` → "What it does today".

### Loop guards (redirect tests)

Four, each sufficient on its own for the case it covers:

1. Only the experiment's page rule is a trigger; a variant is never one in its own right.
2. Already on a variant — catches a variant covered by a broad page rule.
3. Arrived by this experiment's own redirect, per the handoff parameters. Works across
   origins, where storage does not.
4. A session counter incremented *before* navigating, capped at one redirect per experiment.

Plus a final check that the target is not the page already displayed. A completed test's
winner redirect uses a different guard — never to the current page, and never twice within
10 s for the same experiment — because it applies on every visit.
