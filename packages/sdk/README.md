# @routely/sdk

Framework-independent browser tracking SDK for Routely experiments: split URL tests (redirects)
and A/B tests (visual changes on the same page).

Vanilla TypeScript, no runtime dependencies, bundled by esbuild into a single IIFE
(`dist/sdk.js`) that is copied into `apps/web/public/sdk/v1/sdk.js` and served from there.
Because installation is a plain script tag, the same snippet works on WordPress, WooCommerce,
React, Next.js and static HTML sites.

## Build

```bash
npm run build --workspace @routely/sdk     # one-off, minified
node build.mjs --watch                     # rebuild + republish on change
```

The main bundle has an **8 kB gzip budget**; the build fails above it. When
`src/editor-agent.ts` exists, a second bundle, `editor-agent.js`, is built and published next to
it with its own 12 kB gzip limit. It is loaded only inside the Routely visual editor, never by
ordinary visitors, so it does not count towards the main budget.

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

## Structure

| File            | Responsibility                                                        |
| --------------- | --------------------------------------------------------------------- |
| `contract.ts`   | Wire types shared with the ingestion API. Type-only, no runtime.      |
| `env.ts`        | Guarded access to storage, cookies and crypto. Never throws.          |
| `identity.ts`   | Anonymous visitor id: layered persistence, cross-origin handoff.      |
| `url.ts`        | Normalisation, EXACT/PREFIX matching, handoff parameters.             |
| `assignment.ts` | Weighted draw across the arms, persisted so it is never repeated.     |
| `redirect.ts`   | The decision, four independent loop guards, `keepParams` carry-over.  |
| `device.ts`     | Desktop / mobile / tablet from the user agent, for device targeting.  |
| `apply.ts`      | Applies an A/B variant's visual changes, bounded and never throwing.  |
| `hit.ts`        | Site-wide page hit, once per URL per UTC day.                         |
| `cloak.ts`      | Lifts the anti-flicker overlay early (`window.__routelyReveal`).      |
| `editor-bridge.ts` | Visual editor handshake; loads `editor-agent.js` only when answered. |
| `config.ts`     | Fetches and caches the published experiment configuration.            |
| `transport.ts`  | `fetch` with a timeout. Resolves `null` on any failure.               |
| `track.ts`      | `sendBeacon` reporting, with a `fetch(keepalive)` fallback.           |
| `index.ts`      | Entry point: options, boot sequence, orchestration.                   |


## Runtime flow

1. Read `data-site-id` from the script tag.
2. Read the handoff parameters, if this page load is the result of a redirect.
3. Resolve the visitor id — adopting a handed-over one only when nothing is stored.
4. Fetch the configuration with `?v=4` (cached per session for the server-supplied TTL); send
   the site-wide page hit while it is in flight.
5. Find an active experiment whose **control** URL matches the normalised current URL.
6. Skip it (no draw, nothing reported) if the device is not targeted or the visitor falls
   outside the traffic allocation.
7. Read the stored assignment, or draw one by weight and persist it.
8. Report the assignment with `sendBeacon`, before any navigation.
9. **Split URL:** control stays; a variant gets `location.replace()` to its URL, carrying the
   handoff (and the visitor's own query and fragment with `keepParams`).
   **A/B test:** everyone stays; a variant's changes are applied as the elements appear, and the
   anti-flicker overlay is held until they are (the snippet's timeout still bounds it).

A page opened by the visual editor (`#_rt_edit=<token>` while framed or opened by another
window) does none of this: it only runs the editor handshake. The protocol is in `contract.ts`.

### Protocol versions

The SDK speaks v4 and still accepts a v3 config, reading each experiment as a split URL test
with all devices and no `keepParams`. Events and hits are sent with `v: 4`; the API accepts
`ACCEPTED_PROTOCOL_VERSIONS` (3 and 4) so installed older bundles keep reporting.

### Loop guards

Four, each sufficient on its own for the case it covers:

1. Only the control URL is a trigger; the variant is never matched.
2. Already on the variant — catches a variant nested under a `PREFIX` control.
3. Arrived by this experiment's own redirect, per the handoff parameters. Works across
   origins, where storage does not.
4. A session counter incremented *before* navigating, capped at one redirect per experiment.

Plus a final check that the target is not the page already displayed.
