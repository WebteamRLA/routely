# Routely

A redirect URL testing platform. Compare two versions of a page — visitors on the **control**
URL are split evenly, half are redirected to the **variant**, and reaching a configured goal
URL counts as a conversion.

```
                    ┌─ 50% ─► control page (stays)
visitor ─► /pricing ┤                                 ─► /thank-you = conversion
                    └─ 50% ─► /pricing-v2 (redirect)
```

## Stack

| Concern | Choice |
| --- | --- |
| App | Next.js 16 (App Router) + TypeScript — one full-stack project, dashboard and API |
| UI | Tailwind CSS 4 + shadcn/ui |
| Auth | Auth.js v5, Google OAuth, database-backed sessions |
| Database | PostgreSQL 17 + Prisma 7 (driver adapter) |
| Tracking SDK | Vanilla TypeScript → one dependency-free browser bundle (~4.7 kB gzipped) |
| Deployment | Docker + Docker Compose + Nginx + Let's Encrypt |

## Layout

```
apps/web/        Next.js dashboard + public API (the only deployable)
packages/sdk/    Framework-independent tracking SDK, built with esbuild
infra/           Docker Compose and Nginx configuration
docs/            Architecture, database, auth and SDK deployment notes
```

## Getting started

```bash
npm install
cp .env.example apps/web/.env      # both Next.js and the Prisma CLI read this file
npm run db:up                      # Postgres in Docker
npm run db:migrate
npm run db:seed                    # optional sample data
npm run dev                        # http://localhost:3000
```

`AUTH_DEV_BYPASS=true` lets you browse the dashboard without Google credentials. Fill in
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and set it to `false` for the real sign-in flow —
see [docs/AUTH.md](docs/AUTH.md).

> After any `prisma generate`, restart `npm run dev`. The Prisma client is cached across hot
> reloads, so a regenerated client is not picked up until the process restarts.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Build the SDK, then the app |
| `npm run check` | Typecheck, lint, format check, and all tests |
| `npm run test` | 129 unit tests across both workspaces |
| `npm run db:migrate` / `db:deploy` | Migrations, development / production |
| `npm run db:seed` / `db:verify` | Sample data / data-model smoke test |
| `npm run db:studio` | Prisma Studio |
| `npm run sdk:build` | Build the tracking bundle (size-budgeted at 6 kB gzip) |

## Installing the tracking SDK

One snippet per website, reused by every experiment on it:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
```

In `<head>`, without `async` or `defer`, so the redirect decision happens before first paint.
The public site id is an identifier, not a secret.

## Documentation

| Document | Covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Folder and route structure, data model, service layering |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, indexes, constraints, migrations, production deploys |
| [docs/AUTH.md](docs/AUTH.md) | Auth.js setup, session strategy, route protection |
| [docs/SDK-DEPLOYMENT.md](docs/SDK-DEPLOYMENT.md) | SDK build, hosting, visitor identity, conversions, and why time-on-page is approximate |
| [CLAUDE.md](CLAUDE.md) | Full project context: locked stack, settled decisions, data-model invariants, gotchas |
| [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md) | Deploying to Vercel: database, env vars, and what behaves differently there |

## Status

Working: Google sign-in, websites, experiments with publish/pause lifecycle, the tracking SDK
(assignment, redirect, page views, visible time, conversions), event ingestion with rate
limiting, the results dashboard, date ranges, and public share links.

Not built: the production Docker Compose stack, statistical significance testing, click or
custom-JavaScript goals, and multi-variant tests. Per-part limitations are listed in the docs.
# routely
