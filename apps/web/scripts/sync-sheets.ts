/**
 * Runs the Google Sheets refresh from the command line.
 *
 *   npm run sheets:sync --workspace @routely/web            # rewrite every attached website's tab
 *   npm run sheets:sync --workspace @routely/web -- --dry-run --user <userId> [--day 2026-09-28] [--website <id>]
 *   npm run sheets:sync --workspace @routely/web -- --website <websiteId>   # one tab, unthrottled
 *
 * Exists for two reasons. It is how the refresh is exercised locally without waiting for traffic or
 * the scheduled run, and `--dry-run` prints one UTC day's rows exactly as they would be written into
 * the tab (which holds the last 30 days, rewritten wholesale) without touching Google at all — the
 * only way to check the numbers against the dashboard before trusting the write.
 *
 * It is a convenience, not the load-bearing path. Event ingestion, the scheduled cron and the
 * "Sync now" button in the project's Google Sheets dialog drive the same service through the real
 * app, and those are the paths that have to be trustworthy.
 *
 * ## Why `--conditions=react-server`
 *
 * Every module under `src/server` begins `import "server-only"`, whose whole job is to throw when
 * imported outside a React Server Component bundler. Node resolves that package's `react-server`
 * export condition to a no-op, so running under that condition is what makes a service importable
 * here — the same trick `vitest.config.mts` performs with an alias. `prisma/seed.ts` and
 * `prisma/verify.ts` sidestep the issue entirely by building their own client and importing nothing
 * from `src/`, which is not an option when the point is to run the real service.
 */
import "dotenv/config";

import { buildSheetSections } from "@/lib/sheet-rows";
import { previousUtcDay, utcDayRange } from "@/lib/utc-day";
import { getArmRowsByDay } from "@/server/services/analytics.service";
import { refreshAllSheets, refreshSheet } from "@/server/services/sheets-sync.service";

interface Options {
  dryRun: boolean;
  day: string;
  userId: string | null;
  websiteId: string | null;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };

  return {
    dryRun: argv.includes("--dry-run"),
    day: flag("day") ?? previousUtcDay(),
    userId: flag("user"),
    websiteId: flag("website"),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun) {
    if (!options.userId) {
      console.error("--dry-run needs --user <userId>: rows are scoped to one account.");
      process.exitCode = 1;
      return;
    }

    const rows = await getArmRowsByDay(
      options.userId,
      utcDayRange(options.day),
      options.websiteId ?? undefined,
    );
    // The same blocks the tab is written in (one per experiment), for this one day.
    const cells = buildSheetSections(
      rows.map((row) => ({
        ...row,
        experimentCreated: row.experimentCreatedAt.toISOString().slice(0, 10),
      })),
    );

    console.log(`# dry run — ${cells.length} row(s) for ${options.day} (UTC), nothing written\n`);
    for (const row of cells) {
      console.log(row.map((cell) => (typeof cell === "string" ? cell : String(cell))).join("\t"));
    }

    return;
  }

  if (options.websiteId) {
    const result = await refreshSheet(options.websiteId, new Date(), { force: true });
    console.log(JSON.stringify(result));
    return;
  }

  const summary = await refreshAllSheets();
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
