import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the built SDK bundle actually lives, produced by `npm run sdk:build`.
 *
 * v2 speaks protocol v4 (A/B changes, targeting, `track()`). `/sdk/v1/` still exists — the
 * build copies the same file there — because it was served `immutable` for a year and pages may
 * reference it directly; the API keeps answering the v3 bundles those browsers may hold.
 */
const SDK_BUNDLE_PATH = "/sdk/v2/sdk.js";

/** A moving pointer: a bad bundle must not be stuck in browser caches for long. */
const SHORT_CACHE = "public, max-age=300, stale-while-revalidate=86400";

/**
 * Vercel builds and packages the app itself, and rejects `output: "standalone"`.
 * Self-hosting (Docker) needs it, so the mode is chosen by where the build is running rather
 * than by committing to one target.
 */
const isVercel = process.env["VERCEL"] === "1";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so a Docker image can ship without node_modules.
  // Omitted on Vercel, which does its own tracing and packaging.
  ...(isVercel ? {} : { output: "standalone" as const }),

  // In a workspace the tracer defaults to apps/web and would miss hoisted dependencies at the
  // repo root, producing a standalone build that cannot start.
  outputFileTracingRoot: path.join(appDir, "../../"),

  // @routely/sdk is consumed from TypeScript source within the workspace, so Next compiles it
  // rather than expecting a prebuilt CommonJS/ESM artifact.
  transpilePackages: ["@routely/sdk"],

  async rewrites() {
    return [
      // Customers install `/sdk.js`; the versioned path is the real artifact. Keeping the two
      // separate means the bundle can be cached immutably at its version while the short URL
      // stays stable in every snippet already pasted into a customer's site.
      { source: "/sdk.js", destination: SDK_BUNDLE_PATH },
      { source: "/sdk.js.map", destination: `${SDK_BUNDLE_PATH}.map` },
    ];
  },

  async headers() {
    return [
      {
        source: "/sdk.js",
        headers: [
          // Short cache: this URL is a moving pointer, so a bad deploy must not be stuck in
          // browser caches for long. `stale-while-revalidate` keeps it fast anyway.
          { key: "Cache-Control", value: SHORT_CACHE },
          // The snippet loads cross-origin from customer sites. A classic <script> does not
          // need CORS, but this makes the bundle usable from a module import or a fetch too.
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // Rebuilt in place on every deploy (no content hash in the name), so — unlike v1, which
        // was marked immutable before that was noticed — it is cached like the pointer.
        source: "/sdk/v2/:file*",
        headers: [
          { key: "Cache-Control", value: SHORT_CACHE },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/sdk/v1/:file*",
        headers: [
          // Immutable: the path contains the version, so its content never changes.
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
