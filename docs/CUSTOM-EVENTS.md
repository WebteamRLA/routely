# Custom events and Google Tag Manager

How event tracking and the browser-run install check work, and why. For customer-facing
instructions see Help & Guides (`lib/guides.ts`).

## Install verification

A server fetch cannot see a tag that Google Tag Manager injects at runtime, so reading HTML can
never confirm a GTM install. It also cannot show that an SDK actually ran. The check therefore
uses three witnesses, and only one of them can pass it.

| Witness | Source | Can say |
| --- | --- | --- |
| Server | Page HTML, plus the public `gtm.js?id=GTM-…` for each container the page loads | A tag exists, is unpublished, or holds another project's id |
| Backend signal | SDK in the customer's browser → `POST /api/v1/verify` | **This project's SDK ran and reached Routely** |
| Browser message | Same SDK → `postMessage` to the window that opened the page | The SDK ran, even if its signal never arrived |

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

| Status | Means |
| --- | --- |
| `not_installed` | No tag in the HTML or a live container, and nothing ran |
| `waiting` | Nothing seen yet, still inside the window |
| `in_progress` | A tag or the SDK has been seen, still inside the window |
| `verified` | This run's backend signal arrived from this project's SDK |
| `wrong_site_id` | Another project's SDK reported, or only another project's id was found |
| `sdk_failed_to_load` | A tag exists but nothing ran |
| `sdk_not_initialized` | The SDK started but could not finish, or its tag has no id |
| `backend_signal_missing` | The browser says the SDK finished, and the signal never arrived |
| `failed` | The page would not load |

### Why the GTM snippet builds its own script element

GTM re-creates a pasted `<script src>`, and we did not want to rely on which attributes survive.
`setAttribute` is plain DOM. The snippet also stands down if a Routely tag is already on the page,
and the SDK refuses to start twice for the case it cannot see.

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
  to visible.
- **Form, `CALLBACK`.** Listens for a plugin's success event, on the DOM and through jQuery.
- **Code.** `window.routely.track(name, properties?, { id? })`.

`SUBMIT` cannot tell an accepted form from a rejected one, and the UI says so.

### Attribution

The browser names no experiment and no arm. For each stored occurrence `ingestCustomEvents` finds
the ACTIVE experiments whose goal is this event, then the visitor's stored assignment in each. A
visitor with none stays in the Library only. No event can create a `Visitor` or an arm.

With an assignment it writes a `conversions` row and an `events` row of type `custom`. That means
the existing conversion rate, Bayesian verdict and winner gate apply unchanged.

### Counting rules

| Number | Rule | Guaranteed by |
| --- | --- | --- |
| Total events | Every occurrence | `custom_events` rows, `events` rows per arm |
| Converting visitors | One per visitor per experiment | `conversions.assignmentId` unique |
| Conversion rate | Converting visitors ÷ assigned visitors | `lib/verdict.ts` |

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
- **Browser-based verification needs a tab.** A blocked pop-up falls back to a link. A page that
  strips the fragment before the SDK reads it (a redirect to a client-side router, say) cannot be
  verified, and reads as the SDK not running.
- **The form plugin events follow each plugin's documentation** and have only been exercised with
  simulated events, not real plugins.
- **`custom_events` has no retention yet**, like other experiment data.
- **Event goals can be forged** by anyone holding a visitor's anonymous id, as URL goals can. A
  conversion still needs a stored assignment.
- **The Library's totals are computed per request** by a grouped count. Fine at current volumes; a
  very busy project may want a time-bounded window.
