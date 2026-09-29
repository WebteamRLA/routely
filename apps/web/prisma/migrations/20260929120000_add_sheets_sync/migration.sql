-- Adds the Google Sheets daily sync: one destination per account, and one claim row per day.
--
-- Three decisions here are worth knowing before reading the DDL, because none of them is what a
-- generated migration would have produced.
--
-- The refresh token is stored as ciphertext in a column named for what it holds
-- ("refreshTokenCipher"), not for what it represents. It is the only value in this database that
-- grants ongoing access to something outside Routely, and Postgres has no opinion about that, so
-- the encryption is the application's job: nothing reads this column without going through
-- src/server/crypto.ts. The access token is encrypted the same way — shorter-lived is not the
-- same as harmless.
--
-- "day" is TEXT, not DATE. It is a label for a UTC calendar day rather than an instant, and a
-- DATE round-tripped through a driver that applies a local timezone is one of the quietest ways
-- to write the wrong day into a customer's spreadsheet. ISO-8601 sorts correctly as text, so the
-- only thing given up is range arithmetic the application does not do.
--
-- The unique index on (connectionId, day) is not a tidiness constraint, it is the feature: the
-- row is claimed before the append happens, so a cron that fires twice — or a manual "Sync now"
-- racing the scheduled sweep — writes a day's rows once. It does not make the write
-- exactly-once, and docs/INTEGRATIONS.md states plainly which failure mode remains.
--
-- No backfill, and none is possible: there are no connections yet, and a day with no claim row
-- has simply never been synced, which is exactly what the sweep and the UI already treat as
-- "not done yet".

-- CreateEnum
CREATE TYPE "SheetsConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "SheetsSyncStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "sheets_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "googleSubject" TEXT,
    "refreshTokenCipher" TEXT NOT NULL,
    "accessTokenCipher" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT NOT NULL,
    "status" "SheetsConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "statusDetail" TEXT,
    "spreadsheetId" TEXT,
    "spreadsheetName" TEXT,
    "sheetId" INTEGER,
    "sheetTitle" TEXT,
    "headerWrittenAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheets_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheets_sync_runs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" "SheetsSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "rowsWritten" INTEGER,
    "updatedRange" TEXT,
    "error" TEXT,
    "spreadsheetId" TEXT,
    "sheetTitle" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheets_sync_runs_pkey" PRIMARY KEY ("id")
);

-- One destination per account.
CREATE UNIQUE INDEX "sheets_connections_userId_key" ON "sheets_connections"("userId");

-- The claim that makes a day's rows land once per connection.
CREATE UNIQUE INDEX "sheets_sync_runs_connectionId_day_key" ON "sheets_sync_runs"("connectionId", "day");

-- Serves the integrations page: the most recent runs for one connection.
CREATE INDEX "sheets_sync_runs_connectionId_day_idx" ON "sheets_sync_runs"("connectionId", "day");

-- AddForeignKey
ALTER TABLE "sheets_connections" ADD CONSTRAINT "sheets_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheets_sync_runs" ADD CONSTRAINT "sheets_sync_runs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "sheets_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
