/**
 * Validated environment configuration.
 *
 * Importing this module is the *only* supported way to read configuration: `process.env` is
 * untyped and unvalidated, so reading it directly turns a missing variable into a runtime
 * `undefined` deep inside a request. Here a bad value fails loudly at module load with a
 * message naming every offending variable.
 *
 * Server-only variables are validated exclusively on the server — a client bundle that
 * happens to import this module gets the public values and `undefined` for the rest, rather
 * than a spurious validation crash in the browser.
 */

import { z } from "zod";

/**
 * The origin Vercel assigned this project, if we are running there.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is set by the platform at build and at runtime, and is the
 * *stable* production hostname rather than the per-deployment one — which is what an OAuth
 * callback and an install snippet both need. Deriving from it means `AUTH_URL` and
 * `NEXT_PUBLIC_APP_URL` cannot be left pointing at localhost, which is the single easiest way
 * to break a Vercel deployment of this app.
 *
 * An explicitly configured value always wins, so a custom domain is a matter of setting the
 * variable and nothing else.
 */
function vercelOrigin(): string | undefined {
  const host = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  return host ? `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : undefined;
}

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** PostgreSQL connection string. Required — every request path reaches Prisma. */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must be a postgresql:// connection string",
    ),

  /** Auth.js session/token encryption key. Required in production; see `readServerEnv()`. */
  AUTH_SECRET: z.string().min(32, "must be at least 32 characters").optional(),

  /**
   * Canonical public origin, e.g. https://app.example.com.
   *
   * Required in production because `trustHost` is enabled for the Nginx reverse proxy: with
   * an explicit origin configured, Auth.js builds OAuth callback URLs from it rather than
   * from an attacker-controllable Host header.
   */
  AUTH_URL: z
    .url()
    .optional()
    .default(() => vercelOrigin() as string),

  /** Google OAuth client credentials. Required in production. */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * Development-only escape hatch that grants a placeholder session so the dashboard can be
   * worked on without Google credentials. Forced off whenever NODE_ENV is "production".
   */
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  /**
   * 32 random bytes, base64, used to encrypt integration refresh tokens at rest — see
   * `src/server/crypto.ts`. Generate with `openssl rand -base64 32`.
   *
   * Deliberately **not** `AUTH_SECRET`. Rotating `AUTH_SECRET` is a cheap, routine operation
   * whose whole effect is that everybody signs in again. Rotating this one makes every stored
   * refresh token permanently undecryptable, so every customer must reconnect their Google
   * account and every daily sync fails until they do. Sharing one variable between those two
   * operations would mean a cheap rotation silently triggering an expensive, invisible outage.
   *
   * Validated by shape rather than by decoding, because this module is evaluated in the browser
   * bundle too and `Buffer` is not available there. The decode, and the real length assertion,
   * happen in `crypto.ts`.
   *
   * Absent, the Sheets integration reports itself unavailable. It never falls back to storing a
   * token in the clear.
   */
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      "must be 32 random bytes, base64-encoded — generate with: openssl rand -base64 32",
    )
    .optional(),

  /**
   * Shared secret the scheduled sync endpoint requires as a bearer token.
   *
   * On Vercel, an environment variable of this exact name is sent as
   * `Authorization: Bearer <value>` on cron invocations, which is why the name is not ours to
   * choose. Unset in production, `/api/cron/sheets-sync` refuses every request rather than
   * running unauthenticated.
   */
  CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
});

const clientSchema = z.object({
  /** Public origin of the dashboard. Used for absolute links and install snippets. */
  NEXT_PUBLIC_APP_URL: z.url().default(() => vercelOrigin() ?? "http://localhost:3000"),

  /**
   * Google API key for the Google Picker, which runs in the browser.
   *
   * Public by necessity — the Picker reads it from page script — and safe to be, because an API key
   * identifies the calling project rather than authorising anything: every file operation is
   * authorised by the customer's own OAuth token, not by this. Restrict it in the Google console to
   * the Picker API and to your own domains; note that "your domains" must include
   * `https://docs.google.com/*` as well, or the Picker fails to load.
   *
   * Unset, the picker is unavailable and the UI offers creating a new spreadsheet instead.
   */
  NEXT_PUBLIC_GOOGLE_API_KEY: z.string().min(1).optional(),

  /**
   * The Google Cloud project *number* (all digits), which the Picker requires as its `appId`.
   *
   * It is the digits before the dash in the OAuth client id. Needed so Google can tell which app is
   * being granted per-file access when the customer picks a spreadsheet — without it, a picked file
   * is not actually shared with this app and the subsequent write 404s.
   */
  NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: z
    .string()
    .regex(/^\d{6,30}$/, "must be the all-digits Google Cloud project number")
    .optional(),

  /**
   * Absolute URL of the tracking SDK bundle, as it appears in the install snippet customers
   * paste into their sites.
   *
   * Public by necessity — it is rendered into the snippet and fetched by every visitor's
   * browser — hence the `NEXT_PUBLIC_` prefix. Point it at a CDN in production
   * (e.g. https://cdn.example.com/sdk.js); the app serves the same bundle from its own
   * origin at /sdk.js, which is the default.
   *
   * Changing this does not invalidate anything already installed: existing snippets keep
   * loading from whatever URL they were generated with, so migrate by keeping the old URL
   * serving the bundle until customers update.
   */
  NEXT_PUBLIC_SDK_URL: z.url().optional(),
});

/**
 * `NEXT_PUBLIC_*` variables are inlined by the bundler only when referenced as complete
 * literal property accesses, so they must be listed explicitly rather than spread.
 */
const clientRuntime = {
  // `undefined` lets the schema default apply. On Vercel that is the deployment's own origin,
  // so a value left over from a local .env cannot leak into production snippets.
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  NEXT_PUBLIC_SDK_URL: process.env.NEXT_PUBLIC_SDK_URL,
  NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
  NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
};

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

function parse<T>(schema: z.ZodType<T>, source: unknown, label: string): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment configuration:\n${details}`);
  }

  return result.data;
}

/** Variables that are optional locally but mandatory once NODE_ENV is "production". */
const REQUIRED_IN_PRODUCTION = [
  "AUTH_SECRET",
  "AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const satisfies readonly (keyof ServerEnv)[];

/** True while `next build` is compiling, as opposed to a running production server. */
function isBuildPhase(): boolean {
  return process.env["NEXT_PHASE"] === "phase-production-build";
}

function readServerEnv(): ServerEnv {
  const parsed = parse(serverSchema, process.env, "server");

  // The dev bypass grants a session without credentials, so it must be impossible to leave on
  // by accident. Forcing it off (rather than throwing) keeps `next build`, which always runs
  // with NODE_ENV=production, usable on a developer machine while remaining fail-safe.
  const bypass = parsed.AUTH_DEV_BYPASS && parsed.NODE_ENV !== "production";

  if (parsed.AUTH_DEV_BYPASS && !bypass) {
    console.warn("[routely] AUTH_DEV_BYPASS is ignored when NODE_ENV=production.");
  }

  if (parsed.NODE_ENV === "production") {
    // A production deployment with no OAuth credentials would start successfully and then
    // fail on every sign-in attempt, so the check happens here rather than at first use.
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => !parsed[key]);

    if (missing.length > 0) {
      const details = missing.map((key) => `  • ${key}: required when NODE_ENV=production`);

      // `next build` also runs with NODE_ENV=production, but a build machine legitimately has
      // no runtime secrets — they are supplied to the container at start-up. Failing the build
      // would force secrets into CI for no benefit, so during the build phase this is a
      // warning and at runtime it is fatal.
      if (isBuildPhase()) {
        console.warn(`[routely] missing production configuration:\n${details.join("\n")}`);
      } else {
        throw new Error(`Invalid server environment configuration:\n${details.join("\n")}`);
      }
    }
  }

  return { ...parsed, AUTH_DEV_BYPASS: bypass };
}

const isServer = typeof window === "undefined";

const serverEnv: ServerEnv = isServer
  ? readServerEnv()
  : // Never reached in the browser: nothing outside src/server reads these fields.
    ({ NODE_ENV: "production", AUTH_DEV_BYPASS: false } as ServerEnv);

const clientEnv: ClientEnv = parse(clientSchema, clientRuntime, "client");

export const env = {
  ...serverEnv,
  ...clientEnv,
  /**
   * Resolved SDK URL: the configured value, or the copy this deployment serves itself.
   *
   * Falling back to the app's own origin means a fresh install produces a working snippet
   * with no extra configuration, while a production deployment can move the bundle to a CDN
   * by setting one variable.
   */
  SDK_URL:
    clientEnv.NEXT_PUBLIC_SDK_URL ?? `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/sdk.js`,
};

export type Env = typeof env;
