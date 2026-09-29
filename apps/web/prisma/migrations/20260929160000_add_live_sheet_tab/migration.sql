-- Adds the "Routely live" tab: today's running totals, refreshed as traffic arrives.
--
-- The daily sync appends a completed day once and never touches those rows again, which is what
-- makes it safe against a customer's own formulas. That guarantee is incompatible with showing
-- today's numbers, because today's numbers change. So live data goes to a *second* tab that Routely
-- owns and overwrites in place, and the two never contend for the same cells.
--
-- `liveRefreshedAt` is not a timestamp for display. It is the throttle: a refresh is claimed with a
-- compare-and-set against this column, so however many events arrive, the tab is rewritten at most
-- once per interval per website. That matters because Google allows 60 write requests per minute
-- per user, and a per-event write would exceed it at roughly one visitor per second.
--
-- `liveRowCount` exists so a refresh can blank rows that are no longer needed. Writing N rows over a
-- tab that previously held N+5 would otherwise leave five stale rows visible below the new data.
--
-- All columns are nullable or defaulted with no backfill: an existing destination simply has no live
-- tab until its next refresh creates one, which is exactly the state the code already handles.

ALTER TABLE "website_sheet_targets" ADD COLUMN "liveSheetId" INTEGER;
ALTER TABLE "website_sheet_targets" ADD COLUMN "liveSheetTitle" TEXT;
ALTER TABLE "website_sheet_targets" ADD COLUMN "liveRowCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "website_sheet_targets" ADD COLUMN "liveRefreshedAt" TIMESTAMP(3);
