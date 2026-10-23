// Builds the browser tracking SDK into a single dependency-free IIFE bundle and copies it
// into the Next.js app's public directory, from where it is served as /sdk.js.
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
import { existsSync, readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(root, "dist/sdk.js");
const publicDir = resolve(root, "../../apps/web/public/sdk/v1");
const publicFile = resolve(publicDir, "sdk.js");

/**
 * The visual editor agent — a second, separate bundle.
 *
 * It is loaded only inside the Routely editor (see `src/editor-bridge.ts`), never by an ordinary
 * visitor, so it is not counted in the main budget. It has its own, looser ceiling: it still
 * loads into a customer's page, just not on every page view. Built only when its source exists.
 */
const agentEntry = resolve(root, "src/editor-agent.ts");
const agentOutFile = resolve(root, "dist/editor-agent.js");
const agentPublicFile = resolve(publicDir, "editor-agent.js");
const MAX_AGENT_GZIP_BYTES = 12 * 1024;
const hasAgent = existsSync(agentEntry);

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
 */
const MAX_GZIP_BYTES = 8 * 1024;

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

async function measure(file, budget, name) {
  const { size } = await stat(file);
  const raw = readFileSync(file);
  const gzipped = gzipSync(raw).length;
  const brotli = brotliCompressSync(raw).length;

  const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;
  console.log(
    `[sdk] ${name}: ${kb(size)} raw · ${kb(gzipped)} gzip · ${kb(brotli)} brotli ` +
      `(budget ${kb(budget)} gzip)`,
  );

  if (!watch && gzipped > budget) {
    console.error(`[sdk] FAILED: ${name} ${kb(gzipped)} gzipped exceeds the ${kb(budget)} budget.`);
    process.exit(1);
  }

  return { size, gzipped, brotli };
}

async function report() {
  const sizes = await measure(outFile, MAX_GZIP_BYTES, "sdk.js");
  if (hasAgent) {
    sizes.editorAgent = await measure(agentOutFile, MAX_AGENT_GZIP_BYTES, "editor-agent.js");
  } else {
    console.log("[sdk] editor-agent.js: no src/editor-agent.ts — not built");
  }
  return sizes;
}

async function publish(sizes) {
  await mkdir(publicDir, { recursive: true });
  await copyFile(outFile, publicFile);
  await copyFile(`${outFile}.map`, `${publicFile}.map`);
  if (hasAgent) {
    await copyFile(agentOutFile, agentPublicFile);
    await copyFile(`${agentOutFile}.map`, `${agentPublicFile}.map`);
  }

  // A build manifest, so a deployed bundle can be identified without guessing from its bytes.
  await writeFile(
    resolve(publicDir, "build.json"),
    `${JSON.stringify({ apiBase, target: TARGET[0], ...sizes }, null, 2)}\n`,
  );

  console.log(`[sdk] published to ${publicFile}`);
}

/** @type {import("esbuild").BuildOptions} */
const agentOptions = {
  ...options,
  entryPoints: [agentEntry],
  outfile: agentOutFile,
  banner: watch ? undefined : { js: "/* Routely visual editor agent */" },
};

if (watch) {
  // The agent is rebuilt on change too; it is published alongside the main bundle.
  if (hasAgent) await (await esbuild.context(agentOptions)).watch();
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
  if (hasAgent) await esbuild.build(agentOptions);
  await publish(await report());
}
