// Builds the browser tracking SDK into a single dependency-free IIFE bundle and copies it
// into the Next.js app's public directory, from where it is served as /sdk.js.
//
// Published to /sdk/v2/ (protocol v4). /sdk/v1/ is served `immutable` for a year, so the new
// bytes must not be relied on to reach anyone through that path — but a page that hard-coded
// it must not 404 either, so the same file is copied there too. Whichever bundle a browser ends
// up running, the API answers it: v3 bundles get the v3 config, v4 bundles ask for v4.
//
//   node build.mjs            production build, minified, size-checked
//   node build.mjs --watch    rebuild and republish on change, unminified
//
// The bundle is deliberately self-contained: customers load one file from one URL, with no
// module graph, no polyfill service and no second request.

import { mkdir, copyFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(root, "dist/sdk.js");
const publicDir = resolve(root, "../../apps/web/public/sdk/v2");
const publicFile = resolve(publicDir, "sdk.js");
const legacyDir = resolve(root, "../../apps/web/public/sdk/v1");

/**
 * The origin baked into the bundle, which every installed snippet will call.
 *
 * Falls back to the Vercel-assigned production URL when building there, so a deployment cannot
 * ship an SDK that calls `localhost` — the failure mode is silent (the SDK just degrades and
 * does nothing) and therefore expensive to notice.
 */
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const apiBase =
  process.env.ROUTELY_API_BASE ?? (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
const watch = process.argv.includes("--watch");

/**
 * Size budget, gzipped.
 *
 * This runs on every page of a customer's site, often on connections they do not control, so
 * the size is a product constraint rather than a nice-to-have. The build fails when it is
 * exceeded, which forces the trade-off to be made deliberately instead of drifting.
 *
 * History: 6 kB while the SDK only redirected. Raised to 7.5 kB with protocol v4, which added
 * A/B element changes (with the MutationObserver wait), page/audience/device/condition
 * targeting, crawler skipping, preview links, winner redirects and the `track()` API + queue —
 * measured at 7.22 kB gzip (19.15 kB raw), so the new ceiling leaves ~280 B for fixes, not
 * features.
 */
const MAX_GZIP_BYTES = 7.5 * 1024;

/**
 * ES2019 is the floor.
 *
 * It covers every browser that still receives security updates, and avoids the regenerator
 * and helper preamble that a lower target would inline into a file this small. `optional
 * chaining` and `??` compile down; `fetch` and `AbortController` are feature-detected at
 * runtime rather than polyfilled.
 */
const TARGET = ["es2019"];

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: outFile,
  bundle: true,
  format: "iife",
  target: TARGET,
  platform: "browser",
  minify: !watch,
  sourcemap: true,
  legalComments: "none",
  // Nothing here should ever reference Node globals; failing loudly beats shipping a bundle
  // that throws `process is not defined` in a customer's browser.
  define: {
    __ROUTELY_API_BASE__: JSON.stringify(apiBase),
  },
  banner: watch
    ? undefined
    : { js: `/* Routely tracking SDK — https://github.com/routely | api: ${apiBase} */` },
};

async function report() {
  const { size } = await stat(outFile);
  const raw = readFileSync(outFile);
  const gzipped = gzipSync(raw).length;
  const brotli = brotliCompressSync(raw).length;

  const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;
  console.log(
    `[sdk] ${kb(size)} raw · ${kb(gzipped)} gzip · ${kb(brotli)} brotli ` +
      `(budget ${kb(MAX_GZIP_BYTES)} gzip)`,
  );

  if (!watch && gzipped > MAX_GZIP_BYTES) {
    console.error(`[sdk] FAILED: ${kb(gzipped)} gzipped exceeds the ${kb(MAX_GZIP_BYTES)} budget.`);
    process.exit(1);
  }

  return { size, gzipped, brotli };
}

async function publish(sizes) {
  await mkdir(publicDir, { recursive: true });
  await copyFile(outFile, publicFile);
  await copyFile(`${outFile}.map`, `${publicFile}.map`);
  await mkdir(legacyDir, { recursive: true });
  await copyFile(outFile, resolve(legacyDir, "sdk.js"));
  await copyFile(`${outFile}.map`, resolve(legacyDir, "sdk.js.map"));

  // A build manifest, so a deployed bundle can be identified without guessing from its bytes.
  await writeFile(
    resolve(publicDir, "build.json"),
    `${JSON.stringify({ apiBase, target: TARGET[0], ...sizes }, null, 2)}\n`,
  );

  console.log(`[sdk] published to ${publicFile}`);
}

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "routely-publish",
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length > 0) return;
            await publish(await report());
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log("[sdk] watching for changes…");
} else {
  await esbuild.build(options);
  await publish(await report());
}
