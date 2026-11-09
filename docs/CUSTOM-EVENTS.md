# Custom events and Google Tag Manager

How event tracking and the install check work, and why. For customer-facing
instructions see Help & Guides (`lib/guides.ts`).

## Install verification

**Since 2026-11-09 the dialogs check from the server only** (user decision: no new tab).
`checkInstall` reads the page, once more past any page cache, and the published version of every
GTM container the page loads, and `readServerCheck` (`lib/install-verification.ts`) answers at
once. It verifies when this project's id is in the HTML or in a published container: the same
evidence the launch's tracking check accepts. It cannot tell whether a GTM trigger fires on that
page, or whether the SDK starts; the project's tracking status, from real visitors' hits, shows
that.

**One snippet for `<head>` and Google Tag Manager, as Mida does** (user decisions 2026-11-09).
The dialogs have no GTM tab any more: a GTM user pastes the ordinary install snippet
(`buildInstallSnippet` in `lib/snippet.ts`, anti-flicker block plus tracking tag) into a Custom HTML
tag. GTM strips custom attributes from a script it injects but keeps `src`, so the tag carries the
site id in its URL as well (`sdk.js?key=rt_…`), and the SDK reads it from there when `data-site-id`
is gone (`siteIdOf` in `packages/sdk/src/index.ts`). The dialogs check with method `MANUAL`, which
verifies on this project's id in the page or in a published container. The GTM method's
anti-flicker rule (`antiFlickerPlacement`, `readContainer` `hasAntiFlicker`, `anti_flicker`) is still
in `readServerCheck` for a caller that sends `GTM`; the dialogs no longer do.

The block stands down if a cover exists or already ran, so `<head>` plus GTM covers once. **It covers
even when the page has already appeared, as Mida's does** (user decision 2026-11-09, reversing the
`first-contentful-paint` stand-down added earlier that day after the blink on blinto.co). From Tag
Manager every page carrying the tag shows its first frames, then goes white until the SDK reveals
it (once the config answers) or redirects, at most `routelyTimeout` (3 s). That white is the
intended trade: the visitor never watches the control page during the decision. The `<head>` install
remains the way to hide the first frames too.

**Removed with the GTM tab** (2026-11-09): the GTM-only tag (`buildGtmSnippet`) with its config
prefetch, Split URL control-page hide and `routely_ctl_<site>` memory. Tags customers already
published keep running that code from their containers, and still work. The SDK's `coverPage`
(`cloak.ts`) still keeps a cover up, or puts one up, just before a Split URL redirect.

The browser-run check below is **dormant**: `/api/v1/verify`, the SDK's `verify.ts` and the
`install_verifications` table remain, but nothing issues a token, so no run exists for a signal
to answer. Re-enable it by issuing tokens again, or remove it.

### The browser-run check (dormant)

A server fetch cannot see a tag that Google Tag Manager injects at runtime, so reading HTML can
never confirm a GTM install. It also cannot show that an SDK actually ran. The check therefore
uses three witnesses, and only one of them can pass it.

| Witness         | Source                                                                         | Can say                                                     |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Server          | Page HTML, plus the public `gtm.js?id=GTM-…` for each container the page loads | A tag exists, is unpublished, or holds another project's id |
| Backend signal  | SDK in the customer's browser → `POST /api/v1/verify`                          | **This project's SDK ran and reached Routely**              |
| Browser message | Same SDK → `postMessage` to the window that opened the page                    | The SDK ran, even if its signal never arrived               |

The flow is in `install-verification.service.ts`, the status rules in
`lib/install-verification.ts`:

1. The dashboard opens a tab, then starts a run. The server inspects the page and creates an
   `InstallVerification` row holding the SHA-256 of a random token.
2. The tab goes to `<page>#_rt_verify=<token>`. A fragment never reaches the customer's server or
   logs, and it survives the page cache.
3. The SDK sees the token and reports `loaded`, loads its configuration, and reports `ready` or
   `failed`. It runs no experiment on that load: no arm, no redirect, no events. It still sends
   the normal site-wide hit, which later tracking checks read.
4. The dashboard polls every 2 s. After 25 s, silence becomes an answer.

Ordinary site-wide hits do not count. Any visitor on any page could send one, so a hit says nothing
about the page being checked, and an old tag elsewhere would pass a page that has none.

`loadedAt` and `readyAt` are compare-and-set latches, so repeated or late signals cannot move a run
backwards. The first id in `siteIds` is the one the SDK runs as, so a page with this project's tag
behind another project's is reported as the wrong project: its data goes to the other one.

| Status                   | Means                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| `not_installed`          | No tag in the HTML or a live container, and nothing ran                |
| `waiting`                | Nothing seen yet, still inside the window                              |
| `in_progress`            | A tag or the SDK has been seen, still inside the window                |
| `verified`               | This run's backend signal arrived from this project's SDK              |
| `wrong_site_id`          | Another project's SDK reported, or only another project's id was found |
| `sdk_failed_to_load`     | A tag exists but nothing ran                                           |
| `sdk_not_initialized`    | The SDK started but could not finish, or its tag has no id             |
| `backend_signal_missing` | The browser says the SDK finished, and the signal never arrived        |
| `failed`                 | The page would not load                                                |

### Why the install snippet carries the site id in its URL

GTM re-creates a script pasted into a Custom HTML tag and strips its custom attributes, so
`data-site-id` does not survive there; `src` does, so `?key=` carries the id. `data-site-id` stays
for the page-HTML checks. A site with the snippet in `<head>` and in GTM gets one cover (the
anti-flicker block stands down) and one SDK (it refuses to start twice).

Routely never signs in to GTM and never changes a container.

`inspectPage` treats a live container holding this project's id as the snippet being on the site,
so the wizards' tracking checks pass for GTM installs too. A container is fetched only from
`www.googletagmanager.com`, with an id from a strict pattern and no redirects.
`ROUTELY_GTM_ORIGIN` overrides the host outside production, for testing.

## Custom events

An **`EventDefinition`** belongs to the project and says how to detect an event. A
**`CustomEvent`** is one occurrence. A definition proves nothing: status comes only from rows and
from problems the SDK reported (`lib/events.ts`).

### Detection

Triggers are plain data in the config document (`EventTrigger` in `contract.ts`), never code. The
SDK hands selectors only to `closest()` and `querySelector()`.

- **Click.** One capture-phase listener on `document` for all triggers, using `closest()`, so nested
  elements count and later-rendered buttons are covered. It never prevents or stops anything.
- **Form, `SUBMIT`.** One listener on `window`, the last place an event reaches, because only then
  is `defaultPrevented` final. A cancelled submit counts nothing and reports `form_ajax`.
- **Form, `URL`.** The submit is remembered in `sessionStorage` for 30 minutes and counted on the
  success page. Same origin only.
- **Form, `ELEMENT`.** After a submit, watches up to 15 s for the success element to go from hidden
  to visible. **With no selector** (the default since 2026-11-10, user request): watches the form's
  parent and counts the first new visible line of text there, while nothing in it signals an error
  (`aria-invalid="true"`, a class containing `error` or `invalid`). A best guess: a validation
  message without those signs would count. Tested in headless Edge: a "Thanks" replacing the form
  counts; an error message, or no message, does not.
- **Form, `CALLBACK`.** Listens for a plugin's success event, on the DOM and through jQuery.
- **Code.** `window.routely.track(name, properties?, { id? })`, or Mida-style
  `window.rtq.push(["track", name, properties?, { id? }])` (2026-11-10): commands pushed before the
  SDK loads are sent when it does, later ones at once. The dialog shows the `rtq` form.

`SUBMIT` cannot tell an accepted form from a rejected one, and the UI says so.

### What the event dialog offers (user requests 2026-11-10)

- **Element click**: the chosen element only; the pixel detects the click. (Copyable GTM scripts
  under the element were tried and removed the same day at the user's request.)
- **Form submission**: only **Success page** and **Success message**. `SUBMIT`, `CALLBACK` and the
  developer callback are no longer offered; events saved with them keep working, and editing one
  means choosing one of the two.
- **JavaScript**: one `<script>` snippet (`trackScript`), with the other examples under "More
  examples", showing only the call.
  An element may be chosen (optional): the snippet then becomes a GTM Custom HTML tag (trigger: All
  Pages) that reports clicks on it (`elementTrackScript`). The event stays `CODE`, so the pixel
  never listens for that click; `selector` and `pageUrl` are kept only so the dialog shows them.

### Detected by Google Tag Manager instead (2026-11-10, not in the dialog)

A click or form event has an install method, `EventDefinition.install`: **`MANUAL`** (the default:
the pixel detects it, everything above) or **`GTM`**. The dialog briefly showed the two as cards;
they were removed the same day at the user's request, so every event is saved as `MANUAL` now. The
column, the tag generator and the check below remain, unused by the UI, should the option return.

For `GTM` the dialog generates a Custom HTML tag for that one event (`buildGtmEventSnippet` in
`lib/gtm-event.ts`), from the same trigger data the pixel would get (`formTrigger` →
`toEventTrigger`). It runs the same detection as the SDK, with the same timings and storage keys
(shared in `@routely/sdk/contract`): click by `closest()`, cancelled submits never count, the success
page only within 30 minutes of sending that form in this tab (the SDK's own `routely_sub_` key), the
success message only when it goes from hidden to visible within 15 s, a plugin's success event. It
reads no field values and sends only the event name, through `window.routely.track()`, so the
visitor id, event id, offline queue, server dedupe and attribution are the pixel's. The Routely
tracking script therefore has to be on the page too; until it loads, calls wait in its queue. Plain
ES5, since older containers refuse newer syntax. Trigger: **All Pages**. It runs once per page however
often Tag Manager fires it.

**Never counted twice.** A `GTM` event is left out of the pixel's configuration (`listTriggers`), so
the pixel never listens for it. The reverse — an event switched back to the pixel with its tag still
published — is caught by the tag: it stands down whenever the pixel's cached configuration
(`routely_cfg_<site>`) lists the event, and on a success page it checks that before marking the
submission counted, so the pixel's count is never blocked. Beneath both: one action within 500 ms is
one report, the server stores an event id once, and a visitor converts once per experiment. The tag
also sends nothing through another project's Routely script.

**The check** (`checkEventTag`, a server action): fetches the page and the published GTM containers
it loads, like the install check, and answers in order: page didn't load · no Tag Manager on the page
(a missing container) · container unreadable · this event's tag not published · tag published but no
Routely script on the page or in a container · published. It looks for the tag's unquoted mark
(`__routelyEventTags`) and the event's quoted name, however the container escaped them. It proves the
tag is published, not that it fires: the event's status (an event arriving) shows that.

Tested in real headless Edge with the built SDK and a stand-in API: clicks (a double click once, a
later click again), the pixel and a stale tag together (one event), success message (and none when
it never shows), success page (and none for a direct visit), submit (and none when cancelled).

### Attribution

The browser names no experiment and no arm. For each stored occurrence `ingestCustomEvents` finds
the ACTIVE experiments whose goal is this event, then the visitor's stored assignment in each. A
visitor with none stays in the Library only. No event can create a `Visitor` or an arm.

With an assignment it writes a `conversions` row and an `events` row of type `custom`. That means
the existing conversion rate, Bayesian verdict and winner gate apply unchanged.

### Counting rules

| Number              | Rule                                    | Guaranteed by                               |
| ------------------- | --------------------------------------- | ------------------------------------------- |
| Total events        | Every occurrence                        | `custom_events` rows, `events` rows per arm |
| Converting visitors | One per visitor per experiment          | `conversions.assignmentId` unique           |
| Conversion rate     | Converting visitors ÷ assigned visitors | `lib/verdict.ts`                            |

Repeats: the same event id is stored once (`custom_events (websiteId, eventKey)` unique), which
covers retries, a second SDK and `{ id: "order_123" }`. Identical calls within 500 ms count as one
action. A real repeat later is a new occurrence, so it raises the total and never the conversions.

### Privacy

Properties are flat strings, numbers and booleans, at most 10, 200 characters each. Names suggesting
passwords, cards, emails, phones or personal names are dropped, as are values that look like an
email, card or phone number. Both the SDK and the server apply this, from the same patterns in
`contract.ts`. Form field values are never read.

The filter is a safety net, not a guarantee: it cannot recognise every kind of personal data.

### Selector health

When a definition has a `pageUrl`, the SDK checks that page 3 s after load. A missing element is
reported as `selector_missing` and shows as a Configuration error. Seeing it again, a changed
configuration or a received event clears it. A dynamically rendered element that takes longer than
3 s can be misreported.

## Protocol v5

`goal` may be `null` and the document gains `events`. A v4 bundle would reject a null goal and could
not report the event anyway, so v4 and v3 callers get a document without event-goal experiments:
those visitors are not entered, rather than entered and unable to convert.

## Known limitations

- **Real-site coverage is thin.** Everything above ran in real Chrome against a local site, a local
  stand-in for `gtm.js` and a real Postgres. It has not run against a real published GTM container,
  or on real WordPress, Shopify, React or Next.js sites.
- **The server check proves the code is on the site, not that it runs.** A GTM tag whose trigger
  never fires on the page, a consent tool that holds it back, or a blocked SDK still passes. The
  tracking status on the project shows whether real visitors' pages report.
- **The form plugin events follow each plugin's documentation** and have only been exercised with
  simulated events, not real plugins.
- **`custom_events` has no retention yet**, like other experiment data.
- **Event goals can be forged** by anyone holding a visitor's anonymous id, as URL goals can. A
  conversion still needs a stored assignment.
- **A Google Tag Manager event tag reports no configuration problems.** The pixel's selector check
  (`selector_missing`) and `form_ajax` report don't run for a `GTM` event; its status comes only
  from events arriving. A tag copied before the event was edited keeps the old settings until it is
  copied again. Like the pixel, it does not follow single-page-app route changes.
- **The Library's totals are computed per request** by a grouped count. Fine at current volumes; a
  very busy project may want a time-bounded window.
