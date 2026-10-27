# Authentication

Two ways in — **Google** through Auth.js v5, and **email + password** handled by Routely itself —
both ending in the same thing: a row in `sessions` and the `authjs.session-token` cookie. Behind
the session sit the workspace tenancy model (every account belongs to at least one workspace) and
the single-use email tokens for verification, password reset, email change and invites.

---

## 1. How it fits together

```
Google
/login ──form action──► signInWithGoogle() ──► Auth.js ──► accounts.google.com
                                                                │
                                   /api/auth/callback/google ◄──┘
                                                │
                RoutelyAdapter: users + accounts + workspace/membership + sessions rows
                                                │
                                     redirect to callbackUrl

Email + password
/login ──form action──► signInWithPasswordAction() ──► account.authenticatePassword()
                                                │
                       startPasswordSession(): sessions row + authjs.session-token cookie
                                                │
                                     redirect to callbackUrl

Every later request: auth() reads the cookie → sessions row → session seam → workspace + role
```

| File | Responsibility |
| --- | --- |
| `src/server/auth/config.ts` | The `NextAuthConfig`: adapter, Google provider, database strategy, callbacks |
| `src/server/auth/index.ts` | `NextAuth(config)` → `handlers`, `auth`, `signIn`, `signOut` |
| `src/server/auth/session.ts` | **The seam.** The only module the rest of the app imports |
| `src/server/auth/adapter.ts` | The Prisma adapter plus a workspace on `createUser` and session metadata on `createSession` |
| `src/server/auth/password-session.ts` | Mints the session row and cookie for password sign-in, exactly as Auth.js would |
| `src/server/auth/workspace.ts` | `createPersonalWorkspace`, `resolveActiveMembership`, `findRole` |
| `src/server/auth/invite-cookie.ts` | The cookie that carries an invite through Google sign-in |
| `src/server/auth/actions.ts` | Server Actions for Google sign-in and sign-out |
| `src/server/actions/account.actions.ts` | Password sign-in, sign-up, reset, profile, password, sessions, notifications |
| `src/server/services/account.service.ts` | Every account rule: hashing, tokens, rate limits, security emails |
| `src/lib/password.ts` | scrypt hashing — pure, no configuration, unit-tested |
| `src/app/api/auth/[...nextauth]/route.ts` | Mounts the Auth.js handlers on the Node runtime |
| `src/proxy.ts` | Optimistic cookie check; preserves the intended destination |
| `src/lib/auth-errors.ts` | Maps Auth.js error codes to messages a person can act on |

Nothing outside `src/server/auth/` imports `next-auth`. Pages and layouts call
`requireSession()`; Server Actions and route handlers call `requireUser()`, or `requireRole(min)`
for workspace-level actions. `SessionUser` is `{ id, name, email, image, sessionId, workspaceId,
role }`.

---

## 2. Design decisions

### Database sessions, not JWT

`session.strategy` is `"database"`, so a session is a row in `sessions` and the cookie holds
only its token.

The cost is one database read per request. The benefit is **revocation**: signing out deletes
the row and the session is dead immediately, whereas a signed JWT stays valid until it expires
no matter what the server does — there is no way to log someone out of a stolen token. For a
dashboard that already queries Postgres on every page, that read is effectively free. It is also
what makes Settings → "Where you're signed in" possible: each row is a device that can be revoked,
and a password reset deletes them all.

`maxAge` is 30 days (`SESSION_MAX_AGE_SECONDS`) and `updateAge` 24 hours, so a browsing session
refreshes its expiry at most once a day rather than writing on every page view.

### Password sign-in mints the session itself

Auth.js's Credentials provider only works with **JWT** sessions — which would give up everything
the previous section is for. So password sign-in does not go through Auth.js at all.
`startPasswordSession(userId)` writes the `sessions` row the Prisma adapter would have written and
sets the cookie Auth.js reads; from the next request on, `auth()` resolves it exactly like a Google
session and nothing downstream can tell the difference. Matching Auth.js precisely is the whole job
of that module:

| | Value | Matches |
| --- | --- | --- |
| Token | `crypto.randomUUID()` | Auth.js's default `generateSessionToken` |
| Expiry | now + `SESSION_MAX_AGE_SECONDS` (30 days) | the `session.maxAge` `config.ts` passes |
| Cookie name | `authjs.session-token`, or `__Secure-authjs.session-token` when the origin is https | `@auth/core`'s `defaultCookies(useSecureCookies)` |
| Attributes | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` with the `__Secure-` name | the same |

"Is the origin https" is decided the way Auth.js decides it: from `AUTH_URL` when set, otherwise
the request (`X-Forwarded-Proto` behind a proxy). **If Auth.js changes its cookie name or token
format, this module must follow** — a mismatch would sign every password user in to a cookie
nothing reads. A cookie already on the request is retired (its row deleted) before the new one is
set, so signing in again does not leave orphan rows in the sessions list.

Signing out is the same for both kinds: `signOutAction` calls Auth.js `signOut`, which deletes the
row the cookie names.

### Every account has a workspace

The adapter's `createUser` creates the user **and** a workspace in one transaction, so an account
can never exist without one: normally "{First}’s workspace" with the user as OWNER, set as
`currentWorkspaceId`. Password sign-up does the same in `account.service.signUp`.

The exception is signing up **through a valid invite addressed to this email**: the account joins
only the inviting workspace, which avoids an orphan personal workspace. For password sign-up the
invite token arrives as a form field (`/signup?invite=<token>`). For Google, `/invite/[token]` sets
the `routely-invite` cookie (15 minutes) before starting Google sign-in, and `createUser` consumes
it — re-validating the invite and requiring the Google address to be the invited one. An invite that
has lost a race (revoked or accepted a moment ago) falls back to a personal workspace rather than
failing the sign-up.

The session seam resolves the active workspace on **every request**
(`resolveActiveMembership`): `currentWorkspaceId` if the user is still a member there, otherwise the
oldest membership (which becomes current), otherwise — removed from everything — a fresh personal
workspace, created under a per-user advisory lock so two first requests cannot create two. Removing
a member or changing a role therefore takes effect on their very next request.

### Passwords

`lib/password.ts` uses **scrypt from `node:crypto`** — memory-hard, built into Node, no dependency
(bcrypt and argon2 would each be a package). Cost N = 2^15, r = 8, p = 1 (~32 MiB, ~50–100 ms),
16-byte salt, 32-byte key, input normalised to NFKC. The stored form carries its own parameters —
`scrypt$N$r$p$<salt>$<hash>` — so the cost can be raised later and old hashes still verify;
`needsRehash` upgrades one quietly at the next successful sign-in. Verification bounds the
parameters it will accept, so a corrupt row cannot make one request allocate gigabytes.

Passwords are 8–128 characters. A failed sign-in always says the same thing ("That email and
password don’t match.") and does the same work — an unknown address and a Google-only account with
no password verify against a dummy hash, and a disabled account is refused only after its real hash
is checked, so neither the message nor the timing reveals which addresses have accounts.

A Google-only account can add a password from Settings, or by "Forgot password" — the reset link
is sent to Google-only accounts too.

### Single-use email tokens

Every emailed token is **32 random bytes** (base64url). Only its **SHA-256** is stored, so a read of
the database cannot be replayed into a reset or a takeover. Consumption is a compare-and-set on
"not yet used", so a link clicked twice — or prefetched by a mail scanner and then clicked by its
owner — is spent exactly once.

| Token | Table | Lifetime | On use |
| --- | --- | --- | --- |
| Email verification link | `verification_tokens` (Auth.js's table, `identifier = "verify-email:<userId>"`, so it can never collide with an Auth.js email-provider token) | 24 h | `/verify-email/[token]` only checks it on arrival; its **button** (`verifyLinkAction`) spends it, sets `emailVerified` and signs the account in — a mail scanner's prefetch cannot use it up. A new email replaces the old link |
| Email verification code | `email_verification_codes` (one row per user, SHA-256 of `<userId>:<code>`) | 24 h, **5 guesses** | Six digits, sent in the same email as the link and typed on `/verify-email`. Each guess claims an attempt (guarded increment) *before* comparing, so concurrent guesses cannot exceed five. Verifying by either one voids the other |
| Password reset | `password_reset_tokens` | 1 h | `/reset-password/[token]` sets the password, marks the address verified, voids every other reset link and **deletes every session** of the account; "Your password was changed" is emailed |
| Email change | `email_change_requests` | 24 h | `GET /settings/email/confirm?token=` switches `users.email` (re-checking nobody took it meanwhile), marks it verified and tells the **old** address. Needs no session — the token proves the new inbox. A later request supersedes an earlier one |
| Invite | `workspace_invites` | 7 days | `/invite/[token]`; accepting sets the membership, makes it current and sets `emailVerified` when the invite's address is the account's. At most one *pending* invite per (workspace, email) — a partial unique index |

Changing the email does not change it: `users.email` changes only when the link sent to the new
address is followed. A changed password (from Settings) keeps other sessions signed in — the
design's choice, made safe by the sessions list and the security email; a **reset** is what signs
everything out.

### Verified email

"Verified" means `emailVerified` is set **or** the account has a linked Google account (Google
proved the inbox at sign-in; Google sign-ups are also stamped `emailVerified` by the adapter). The
same rule is used by the `(app)` layout, by `team.service` (only a verified member can send
invites) and by `notification.service` (only verified members receive notifications).

**A password account does not open until its address is verified** (user request, 2026-10-27).
Sign-up creates the account and workspace but **no session**: it emails a six-digit code and a link,
sets the `routely-verify` cookie and lands on `/verify-email`. The code or the link signs the account
in. A password sign-in to an unverified account does the same (a fresh code, unless one went out in
the last minute). The `routely-verify` cookie (`server/auth/verify-cookie.ts`, HMAC over the user id
and a 24 h expiry, key derived from `AUTH_SECRET`) is what lets a browser type a code — the page never
takes the account from the URL or the form, so someone who only knows an address has nowhere to guess.
Sign-up through a valid invite skips all this (the invite proved the inbox). A session from before
codes existed, on an unverified account, is redirected to `/verify-email` by the `(app)` layout, which
then offers "Send a code".

### Rate limits

All in memory, per process (`server/http/rate-limit.ts`) — see the limitations. The invite limit is
the exception: it counts rows, so it holds across instances.

| Action | Limit |
| --- | --- |
| Password sign-in | 10 per 15 min per (IP, email) **and** 50 per 15 min per IP |
| Sign-up | 10 per hour per IP |
| Forgot password | 20 per hour per IP; 3 per 15 min per address, **silently** (the page says the same either way) |
| Resend verification code / email-change link | 1 a minute **and** 5 a day per account; a sign-in to an unverified account re-sends at most once a minute |
| Start an email change | 5 a day per account |
| Change password | 10 per 15 min per account |
| Invites | 10 addresses per batch; 50 a day per workspace (database count) |
| Editor tokens | 30 a minute per user |

The IP is the first `X-Forwarded-For` entry (`clientAddress`), else `X-Real-IP`.

### Disabled accounts

`User.disabledAt` closes an account without deleting it: password sign-in refuses it with the
generic failure, the Auth.js `signIn` callback refuses it (→ `?error=AccessDenied`), and the
`session` callback drops an existing session for it. Nothing in the UI sets it yet.

### "New sign-in to Routely"

Both sign-in paths call `noteSignIn`, which records the (browser, OS, country) combination as a
SHA-256 in `known_sign_in_devices` and emails the account when it has signed in before but never
from that combination. The very first sign-in is recorded silently. Session rows carry `userAgent`,
`city` and `country` (from `x-vercel-ip-*`, display only, never an access decision, no raw IP
stored) and a `lastSeenAt` refreshed by a 5-minute throttled compare-and-set.

### `trustHost: true` plus a required `AUTH_URL`

The app runs behind Nginx, where the request Host arrives via `X-Forwarded-Host`. Auth.js will
not trust that header unless `trustHost` is set, and without it OAuth callbacks break entirely
behind the proxy.

On its own, trusting the header would allow host-header injection into the callback URL. The
mitigation is the second half of the pair: `src/env.ts` **requires `AUTH_URL` when
`NODE_ENV=production`**. With a canonical origin configured, Auth.js builds callback URLs from
it rather than from the request, and the header can no longer influence where a user lands.
(`AUTH_URL` also decides the password cookie's `__Secure-` prefix, above.)

`AUTH_URL` is Auth.js v5's replacement for v4's `NEXTAUTH_URL`.

### Two layers of route protection

| Layer | What it checks | Is it the security boundary? |
| --- | --- | --- |
| `src/proxy.ts` | Whether a session **cookie is present** (either spelling) | **No** |
| `src/app/(app)/layout.tsx` | Whether the session is **valid**, against the database | **Yes** |

Proxy runs in a lightweight runtime with no database access, so a forged or expired cookie
gets past it — and is then rejected by the layout. The Next.js documentation warns explicitly
against using proxy as a session-management layer, and this split follows that advice.

What proxy contributes is real, though: it preserves the visitor's intended destination in
`?callbackUrl=`, which a layout cannot do because Server Components are never told the request
path, and it turns away obviously-anonymous requests before any rendering work happens.
`/settings/email/confirm` is the one path under a protected prefix that it lets through without a
cookie — the link is often opened on a device that was never signed in.

### Open-redirect protection

`callbackUrl` is attacker-controllable, so it is filtered everywhere it is used — the login page,
both sign-in actions, sign-up, and the Auth.js `redirect` callback. Each accepts only relative
paths (and, in the callback, same-origin absolute URLs), and each rejects protocol-relative URLs
such as `//evil.example` that a naive `startsWith("/")` check would let through.

### Error messages are looked up, never echoed

`?error=` is also attacker-controllable. Known Auth.js codes map to written explanations and
anything else gets a generic fallback, so no value from the query string is ever rendered into the
page.

### `allowDangerousEmailAccountLinking` stays off

Left at its default of `false`. Enabling it links a new provider account to an existing user
purely because the email addresses match, which lets anyone able to obtain a Google account
for that address take over the existing one. It matters more now that password accounts exist: a
password account cannot be entered by "Continue with Google" for the same address — that returns
`OAuthAccountNotLinked`, which the login page explains ("This email already has a password").

---

## 3. Google OAuth setup

1. Open <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → OAuth client ID → Web application.**
3. Authorised JavaScript origins:
   - `http://localhost:3000` (development)
   - `https://app.example.com` (production)
4. Authorised redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://app.example.com/api/auth/callback/google`
5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. On the OAuth consent screen, the `openid`, `profile` and `email` scopes are sufficient —
   no additional scopes are requested.

> **The Google Sheets integration is a second, separate Google flow**, over its own routes
> (`/api/integrations/google/{start,callback}`) and writing to its own table
> (`sheets_connections`). It is deliberately *not* this provider: adding Drive scopes here would
> force every customer to grant Drive access merely to sign in, and `Account`'s
> `@@unique([provider, providerAccountId])` means a second consent for the same Google account
> would write over the sign-in row that the Auth.js adapter owns. Nothing in this document's
> model is touched by it. See `docs/INTEGRATIONS.md`.

The redirect URI must match **exactly**, including scheme and the absence of a trailing slash.
A mismatch produces Google's `redirect_uri_mismatch` error before Auth.js is ever reached.

---

## 4. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | always | Session and user storage |
| `AUTH_SECRET` | production | Session/token encryption, ≥32 chars (`openssl rand -base64 32`). Also signs the Sheets OAuth state and, when `EDITOR_TOKEN_SECRET` is unset, derives the editor-token key |
| `AUTH_URL` | production | Canonical origin; the v5 equivalent of `NEXTAUTH_URL`; decides the `__Secure-` cookie |
| `GOOGLE_CLIENT_ID` | production | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | production | Google OAuth client secret |
| `RESEND_API_KEY` | production, in practice | Sends verification, reset, email-change, security and invite emails. Unset: development prints them (links included) to the console; production sends nothing and does **not** log the body |
| `EMAIL_FROM` | no | From header. Default `Routely <onboarding@resend.dev>`, Resend's test sender |
| `SUPPORT_EMAIL` | no | "Contact support" on the auth pages and in security emails |
| `AUTH_DEV_BYPASS` | never | Dev-only session; forced off in production |

"Required in production" is enforced at **runtime**, not at build time: `next build` also runs
with `NODE_ENV=production`, but a build machine legitimately has no runtime secrets — they are
supplied to the container at start-up. During the build phase a missing value is a warning;
in a running production server it is a fatal startup error. `RESEND_API_KEY` is deliberately not in
that list — a deployment without email still serves requests — but password sign-up, reset and
invites cannot be completed without it.

### The development bypass

`AUTH_DEV_BYPASS=true` makes `getSession()` return a fixed user so the dashboard can be worked on
without Google credentials. It is safe by construction:

- `src/env.ts` forces it to `false` whenever `NODE_ENV=production`, with a warning;
- `src/proxy.ts` only honours it under the same condition.

The bypass user (`dev@routely.local`) is now a **real row**, upserted on first use, with a real
personal workspace resolved per request like anyone else's — websites are foreign-keyed to a
workspace, so a fabricated id would render and then fail on the first write. It has no session
row (`sessionId` is null), so the sessions list cannot mark "this device".

---

## 5. Verifying

With `npm run db:up` and `npm run dev` running:

```bash
# Providers are registered
curl -s localhost:3000/api/auth/providers

# Protected routes redirect, preserving the destination
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'localhost:3000/experiments/abc?x=1'
# → 307 http://localhost:3000/login?callbackUrl=%2Fexperiments%2Fabc%3Fx%3D1

# Sign-in starts a real PKCE flow
CSRF=$(curl -s -c /tmp/cj http://localhost:3000/api/auth/csrf | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrfToken"])')
curl -s -b /tmp/cj -D - -o /dev/null -X POST localhost:3000/api/auth/signin/google -d "csrfToken=$CSRF"
# → 302 to accounts.google.com with code_challenge_method=S256
# → Set-Cookie: authjs.pkce.code_verifier=…; HttpOnly

# Session state
curl -s localhost:3000/api/auth/session          # null when anonymous
```

**Password sign-in** needs no Google credentials: `npm run db:seed`, then sign in at `/login` as
`alex@fernwoodsupply.com` with `fernwood-demo-2026` (every demo account shares it, one per role).
`/api/auth/session` then returns the user, proving the hand-minted row and cookie are read by
Auth.js. Sign-up, reset and invite links are printed to the dev server's console when
`RESEND_API_KEY` is unset.

To exercise a Google session without Google, insert the rows the adapter would create (`users`,
`accounts`, a workspace and OWNER membership, `sessions`) and send the session token as the
`authjs.session-token` cookie; `POST /api/auth/signout` deletes the session row while leaving the
user intact.

---

## 6. Known limitations

1. **`next-auth@5.0.0-beta.32`.** v5 is the only line that supports the App Router's
   `auth()` in Server Components; v4 (the current `latest` tag) does not. It is a beta by
   version number but is what the App Router ecosystem runs on. Pin it exactly — beta releases
   have shipped breaking changes, and `password-session.ts` copies its cookie and token
   conventions.
2. **Rate limits are per-process and IP-keyed.** Every limiter above except invites lives in one
   process's memory, so several instances multiply it, and a restart forgets it. The IP is the first
   `X-Forwarded-For` entry, which is trustworthy only behind a proxy that overwrites the header.
3. **Google sign-in has no rate limit of its own.** PKCE protects the flow; repeated attempts are
   throttled only by Google.
4. **A stale cookie loses the callback URL.** Proxy passes the request through because a
   cookie exists, and the layout — which cannot see the request path — redirects to a bare
   `/login`. The user reaches the right place, one step later than ideal.
5. **No account deletion, no workspace rename, no ownership transfer, no leaving a workspace.** The
   permission matrix reserves `workspace.manage` for the Owner, but no action uses it yet.
6. **Google cannot be added to a password account.** Account linking stays off (above), so
   "Continue with Google" for an address that already has a password account is refused. The other
   direction works: a Google account can add a password in Settings or through "Forgot password".
7. **Without `RESEND_API_KEY` in production, nothing is sent and nothing is logged.** A new password
   account then never receives its code and **cannot open at all**, so the key is required wherever
   password sign-up is offered.
