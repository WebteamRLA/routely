-- Replaces the append-once-per-day design with a single tab that is continuously rewritten.
--
-- What changed and why.
--
-- The previous design wrote two tabs: an append-only log of completed days, and a separate live tab
-- holding today. It worked, but it put the same date in two places with different numbers whenever
-- a day was synced by hand while still in progress, and "which tab is right?" is not a question a
-- customer should have to answer. One tab, recomputed from the database on every refresh, cannot
-- disagree with itself.
--
-- The tab now holds a rolling window of recent days rather than only today, so handing the
-- spreadsheet to someone as a report still makes sense. Because every refresh rewrites the whole
-- window from source data, there is nothing to reconcile and no notion of a day being "already
-- written" — which is why the entire claim mechanism below is dropped.
--
-- Dropping sheets_sync_runs removes the per-(website, day) claim that made appends idempotent. That
-- constraint existed to stop a duplicated cron invocation appending a day twice. Overwriting a fixed
-- range is idempotent by construction: running it twice leaves the same cells. The throttle on
-- website_sheet_targets.refreshedAt remains, and it now serves only to protect Google's write quota
-- rather than to protect correctness.
--
-- headerWrittenAt goes for the same reason: the header is rewritten with every refresh, so there is
-- no longer a question of whether it exists.
--
-- liveSheetId/liveSheetTitle collapse into sheetId/sheetTitle. There is one tab now, and Routely
-- owns it — the customer chooses a spreadsheet, not a tab, because a full overwrite aimed at a tab
-- holding their own work would destroy it.
--
-- Existing rows are migrated rather than dropped: a customer who has already attached a spreadsheet
-- keeps it, and their next refresh recreates the tab and repopulates the window from the database.
-- Nothing is lost, because the spreadsheet was never the system of record.

-- The tab Routely owns becomes the destination. Where a live tab already exists, adopt it; otherwise
-- keep whatever tab was chosen and let the next refresh take it over.
UPDATE "website_sheet_targets"
   SET "sheetId"    = COALESCE("liveSheetId", "sheetId"),
       "sheetTitle" = COALESCE("liveSheetTitle", "sheetTitle");

ALTER TABLE "website_sheet_targets" DROP COLUMN "liveSheetId";
ALTER TABLE "website_sheet_targets" DROP COLUMN "liveSheetTitle";
ALTER TABLE "website_sheet_targets" DROP COLUMN "headerWrittenAt";

ALTER TABLE "website_sheet_targets" RENAME COLUMN "liveRowCount" TO "rowCount";
ALTER TABLE "website_sheet_targets" RENAME COLUMN "liveRefreshedAt" TO "refreshedAt";

ALTER TABLE "website_sheet_targets" ADD COLUMN "lastError" TEXT;

-- The claim mechanism is no longer needed; see the note above.
DROP TABLE "sheets_sync_runs";
DROP TYPE "SheetsSyncStatus";
