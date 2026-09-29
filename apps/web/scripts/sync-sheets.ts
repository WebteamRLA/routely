/**
 * Runs the Google Sheets daily sync from the command line.
 *
 *   npm run sheets:sync --workspace @routely/web            # write yesterday for every connection
 *   npm run sheets:sync --workspace @routely/web -- --dry-run
 *   npm run sheets:sync --workspace @routely/web -- --dry-run --day 2026-09-28 --user <userId> [--website <id>]
 *   npm run sheets:sync --workspace @routely/web -- --user <userId> --website <websiteId>
 *
 * Exists for two reasons. It is how the sync is exercised locally without waiting for a scheduled
 * run, and `--dry-run` prints exactly the rows that *would* be appended without touching Google at
 * all — which is the only way to check the numbers against the dashboard before trusting the write.
 *
 * It is a convenience, not the load-bearing path. The "Sync yesterday now" button drives the same
 * service through the real app, and that is the path that has to be trustworthy.
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

import { buildSheetRows } from "@/lib/sheet-rows";
import { previousUtcDay, utcDayRange } from "@/lib/utc-day";
import { getDailyArmRows } from "@/server/services/analytics.service";
import { runDailySweep, syncDay } from "@/server/services/sheets-sync.service";

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

    const rows = await getDailyArmRows(
      options.userId,
      utcDayRange(options.day),
      options.websiteId ?? undefined,
    );
    const cells = buildSheetRows(options.day, rows);

    console.log(`# dry run — ${cells.length} row(s) for ${options.day} (UTC), nothing written\n`);
    for (const row of cells) {
      console.log(row.map((cell) => (typeof cell === "string" ? cell : String(cell))).join("\t"));
    }

    return;
  }

  if (options.userId) {
    if (!options.websiteId) {
      console.error("--user needs --website <websiteId>: a sheet is attached per website.");
      process.exitCode = 1;
      return;
    }

    const result = await syncDay(options.userId, options.websiteId, options.day);
    console.log(`${result.outcome}: ${result.message}`);
    return;
  }

  const summary = await runDailySweep();
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
