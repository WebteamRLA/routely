import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the process.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled query engine, so the
 * Postgres pool is configured here and owned by this module alone.
 *
 * Next.js hot-reloads server modules on every edit in development, so constructing the client
 * at module scope would leak a new connection pool per reload until Postgres refuses further
 * connections. Caching it on `globalThis` — which survives module reloads — avoids that; in
 * production the module is evaluated once and the cache is never read.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Connections held per process.
 *
 * On a long-lived server one pool serves every request, and a larger pool is free throughput.
 * On a serverless platform the opposite is true: each concurrent function instance opens its
 * own pool, so the ceiling is `instances × max`, and a busy moment can exhaust Postgres'
 * `max_connections` long before it exhausts the machine.
 *
 * Hence a small pool in serverless — but not a pool of one. A page's services issue their
 * independent reads together (`Promise.all`), and Vercel's Fluid Compute sends concurrent requests
 * to the same instance; with one connection every one of those queries waits its turn, so a page
 * pays one database round trip per query instead of one per *stage* (measured: the project
 * dashboard went from 29 sequential round trips to 11 on this change alone). Five keeps the
 * parallelism the services were written for while `instances × max` stays far below a pooler's
 * client limit. `DATABASE_URL` must still point at a pooler (PgBouncer, or Neon/Supabase's pooled
 * port): this setting bounds the damage, the pooler is what actually multiplexes.
 */
const isServerless = Boolean(process.env["VERCEL"] || process.env["AWS_LAMBDA_FUNCTION_NAME"]);
const POOL_MAX = isServerless ? 5 : 10;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: POOL_MAX,
    // An idle connection held open by a frozen serverless instance is a connection nobody can
    // use; releasing it early costs a reconnect that the pooler makes cheap.
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
  });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export { Prisma } from "@/generated/prisma/client";
export type { PrismaClient } from "@/generated/prisma/client";

/**
 * A Prisma client *or* an interactive transaction handle. Repository functions accept this so
 * a caller can compose several writes into one transaction without the repository knowing
 * which of the two it received.
 */
export type DbClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$transaction" | "$extends" | "$on" | "$use"
>;
