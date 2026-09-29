-- Moves the Google Sheets destination from the account to the website, and narrows the OAuth grant.
--
-- The previous migration put the destination on `sheets_connections`, i.e. one spreadsheet per
-- Routely account. That was wrong for the way customers actually work: someone running several
-- sites — an agency especially — wants each site's numbers in its own spreadsheet, frequently one
-- they will hand to a different client. So the destination becomes its own table, keyed one-to-one
-- on the website.
--
-- The *authorisation* deliberately stays per account. `sheets_connections` is now purely the Google
-- grant, holding tokens and nothing else. Splitting grant from destination is what lets a sheet be
-- attached to a website without another consent screen, and it matters for a limit Google does not
-- advertise loudly: refresh tokens are capped at roughly 100 per account per OAuth client, and the
-- oldest are invalidated silently. A grant per website would walk into that.
--
-- `sheets_sync_runs` is re-keyed from the connection to the website for the same reason, plus one
-- more: a customer who disconnects and reconnects Google must not lose the record of which days
-- were already written, or the next sweep would send every one of them a second time.
--
-- Dropping columns rather than migrating their contents is safe here and needs saying so nobody
-- assumes data was discarded. Both tables were created hours ago by the preceding migration, the
-- feature has never been deployed, and both are empty — verified before writing this. There is
-- nothing to move. A DELETE on `sheets_connections` is included anyway, because the rows that could
-- exist are grants whose scope set is no longer the one requested: the integration now asks only
-- for `drive.file`, having dropped the sensitive `spreadsheets` and restricted
-- `drive.metadata.readonly` scopes, and a stored token carrying the old pair should be re-consented
-- rather than silently reused with more access than the app now asks for.

-- Any pre-existing grant predates the scope narrowing. Force a reconnect rather than reuse it.
DELETE FROM "sheets_connections";

-- CreateTable
CREATE TABLE "website_sheet_targets" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetName" TEXT,
    "sheetId" INTEGER NOT NULL,
    "sheetTitle" TEXT NOT NULL,
    "headerWrittenAt" TIMESTAMP(3),
    "createdByRoutely" BOOLEAN NOT NULL DEFAULT false,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_sheet_targets_pkey" PRIMARY KEY ("id")
);

-- One destination per website.
CREATE UNIQUE INDEX "website_sheet_targets_websiteId_key" ON "website_sheet_targets"("websiteId");

ALTER TABLE "website_sheet_targets" ADD CONSTRAINT "website_sheet_targets_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The grant keeps only what a grant needs.
ALTER TABLE "sheets_connections" DROP COLUMN "spreadsheetId";
ALTER TABLE "sheets_connections" DROP COLUMN "spreadsheetName";
ALTER TABLE "sheets_connections" DROP COLUMN "sheetId";
ALTER TABLE "sheets_connections" DROP COLUMN "sheetTitle";
ALTER TABLE "sheets_connections" DROP COLUMN "headerWrittenAt";

-- Re-key the claim rows onto the website.
--
-- The unique index is dropped before the column so the rename cannot briefly leave two claims for
-- one day, and recreated immediately after: that index is the entire idempotency guarantee, and a
-- window without it is a window in which a day could be written twice.
DROP INDEX "sheets_sync_runs_connectionId_day_key";
DROP INDEX "sheets_sync_runs_connectionId_day_idx";

ALTER TABLE "sheets_sync_runs" DROP CONSTRAINT "sheets_sync_runs_connectionId_fkey";
ALTER TABLE "sheets_sync_runs" DROP COLUMN "connectionId";
ALTER TABLE "sheets_sync_runs" ADD COLUMN "websiteId" TEXT NOT NULL;

CREATE UNIQUE INDEX "sheets_sync_runs_websiteId_day_key" ON "sheets_sync_runs"("websiteId", "day");
CREATE INDEX "sheets_sync_runs_websiteId_day_idx" ON "sheets_sync_runs"("websiteId", "day");

ALTER TABLE "sheets_sync_runs" ADD CONSTRAINT "sheets_sync_runs_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
