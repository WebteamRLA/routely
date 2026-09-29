# Authentication

Auth.js v5 with Google as the sole identity provider, backed by the Prisma adapter and
database-stored sessions.

---

## 1. How it fits together

```
/login  ──form action──►  signInWithGoogle()  ──►  Auth.js  ──►  accounts.google.com
                                                                        │
                                          /api/auth/callback/google  ◄───┘
                                                       │
                        PrismaAdapter writes users + accounts + sessions rows
                                                       │
                                            redirect to callbackUrl
```

| File | Responsibility |
| --- | --- |
| `src/server/auth/config.ts` | The `NextAuthConfig`: adapter, provider, session strategy, callbacks |
| `src/server/auth/index.ts` | `NextAuth(config)` → `handlers`, `auth`, `signIn`, `signOut` |
| `src/server/auth/session.ts` | **The seam.** The only module the rest of the app imports |
| `src/server/auth/actions.ts` | Server Actions for sign-in and sign-out |
| `src/app/api/auth/[...nextauth]/route.ts` | Mounts the Auth.js handlers on the Node runtime |
| `src/proxy.ts` | Optimistic cookie check; preserves the intended destination |
| `src/lib/auth-errors.ts` | Maps Auth.js error codes to messages a person can act on |
| `src/types/next-auth.d.ts` | Adds `user.id` to the `Session` type |

Nothing outside `src/server/auth/` imports `next-auth`. Pages and layouts call
`requireSession()`; Server Actions and route handlers call `requireUser()`. Swapping or adding
a provider is a change to `config.ts` and nothing else.

---

## 2. Design decisions

### Database sessions, not JWT

`session.strategy` is `"database"`, so a session is a row in `sessions` and the cookie holds
only its token.

The cost is one database read per request. The benefit is **revocation**: signing out deletes
the row and the session is dead immediately, whereas a signed JWT stays valid until it expires
no matter what the server does — there is no way to log someone out of a stolen token. For a
dashboard that already queries Postgres on every page, that read is effectively free.

`updateAge` is 24 hours, so a browsing session refreshes its expiry at most once a day rather
than writing on every page view.

### `trustHost: true` plus a required `AUTH_URL`

The app runs behind Nginx, where the request Host arrives via `X-Forwarded-Host`. Auth.js will
not trust that header unless `trustHost` is set, and without it OAuth callbacks break entirely
behind the proxy.

On its own, trusting the header would allow host-header injection into the callback URL. The
mitigation is the second half of the pair: `src/env.ts` **requires `AUTH_URL` when
`NODE_ENV=production`**. With a canonical origin configured, Auth.js builds callback URLs from
it rather than from the request, and the header can no longer influence where a user lands.

`AUTH_URL` is Auth.js v5's replacement for v4's `NEXTAUTH_URL`.

### Two layers of route protection

| Layer | What it checks | Is it the security boundary? |
| --- | --- | --- |
| `src/proxy.ts` | Whether a session **cookie is present** | **No** |
| `src/app/(app)/layout.tsx` | Whether the session is **valid**, against the database | **Yes** |

Proxy runs in a lightweight runtime with no database access, so a forged or expired cookie
gets past it — and is then rejected by the layout. The Next.js documentation warns explicitly
against using proxy as a session-management layer, and this split follows that advice.

What proxy contributes is real, though: it preserves the visitor's intended destination in
`?callbackUrl=`, which a layout cannot do because Server Components are never told the request
path, and it turns away obviously-anonymous requests before any rendering work happens.

### Open-redirect protection

`callbackUrl` is attacker-controllable, so it is filtered in three places — the login page,
the sign-in action, and the Auth.js `redirect` callback. Each accepts only relative paths and
same-origin absolute URLs, and each rejects protocol-relative URLs such as `//evil.example`
that a naive `startsWith("/")` check would let through.

### Error messages are looked up, never echoed

`?error=` is also attacker-controllable. `describeAuthError()` maps known Auth.js codes to
written explanations and returns a generic fallback for anything else, so no value from the
query string is ever rendered into the page.

### `allowDangerousEmailAccountLinking` stays off

Left at its default of `false`. Enabling it links a new provider account to an existing user
purely because the email addresses match, which lets anyone able to obtain a Google account
for that address take over the existing one. The cost of leaving it off is the
`OAuthAccountNotLinked` error, which the login page explains.

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
> (`sheets_connections`). It is deliberately *not* this provider: adding `spreadsheets` and Drive
> scopes here would force every customer to grant Drive access merely to sign in, and `Account`'s
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
| `AUTH_SECRET` | production | Session/token encryption, ≥32 chars (`openssl rand -base64 32`) |
| `AUTH_URL` | production | Canonical origin; the v5 equivalent of `NEXTAUTH_URL` |
| `GOOGLE_CLIENT_ID` | production | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | production | Google OAuth client secret |
| `AUTH_DEV_BYPASS` | never | Dev-only placeholder session; forced off in production |

"Required in production" is enforced at **runtime**, not at build time: `next build` also runs
with `NODE_ENV=production`, but a build machine legitimately has no runtime secrets — they are
supplied to the container at start-up. During the build phase a missing value is a warning;
in a running production server it is a fatal startup error.

### The development bypass

`AUTH_DEV_BYPASS=true` returns a fixed placeholder user from `getSession()` so the dashboard
can be worked on without Google credentials. It is safe by construction:

- `src/env.ts` forces it to `false` whenever `NODE_ENV=production`, with a warning;
- `src/proxy.ts` only honours it under the same condition.

The placeholder user (`dev-user`) has **no row in the database**, so any code path that reads
or writes user-owned data will fail against it. It is for looking at the UI, not for exercising
the data layer — use a real sign-in for that.

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

Completing a real sign-in needs Google credentials. To exercise everything after the callback
without them, insert the rows the adapter would create (`users`, `accounts`, `sessions`) and
send the session token as the `authjs.session-token` cookie; `/api/auth/session` will return
the user, protected routes will render, and `POST /api/auth/signout` will delete the session
row while leaving the user row intact.

---

## 6. Known limitations

1. **`next-auth@5.0.0-beta.32`.** v5 is the only line that supports the App Router's
   `auth()` in Server Components; v4 (the current `latest` tag) does not. It is a beta by
   version number but is what the App Router ecosystem runs on. Pin it exactly — beta releases
   have shipped breaking changes.
2. **Google only.** Adding a provider is a change to `config.ts`, but no other provider is
   configured or tested.
3. **A stale cookie loses the callback URL.** Proxy passes the request through because a
   cookie exists, and the layout — which cannot see the request path — redirects to a bare
   `/login`. The user reaches the right place, one step later than ideal.
4. **No account management.** No way to delete an account, revoke other sessions, or change
   the profile; the name and picture are whatever Google last supplied.
5. **No sign-in rate limiting.** The OAuth flow is protected by PKCE, but nothing throttles
   repeated attempts. Rate limiting arrives with the public ingestion endpoints.
6. **`emailVerified` is trusted from Google.** Reasonable for Google as the only provider,
   but it would need re-examining before adding one that does not verify email.
