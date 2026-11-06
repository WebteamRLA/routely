-- Custom events and browser-run install verification. Additive only: every new column is nullable
-- or defaulted, so an already-deployed build keeps working against this schema.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'custom';

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('URL', 'EVENT');
CREATE TYPE "EventTrackingMethod" AS ENUM ('CLICK', 'FORM', 'CODE');
CREATE TYPE "FormSuccessMode" AS ENUM ('SUBMIT', 'URL', 'ELEMENT', 'CALLBACK');
CREATE TYPE "InstallMethod" AS ENUM ('MANUAL', 'GTM');

-- AlterTable
ALTER TABLE "websites" ADD COLUMN "installMethod" "InstallMethod";
ALTER TABLE "experiments" ADD COLUMN "goalType" "GoalType" NOT NULL DEFAULT 'URL';
ALTER TABLE "experiments" ADD COLUMN "goalEventId" TEXT;

-- CreateTable
CREATE TABLE "install_verifications" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "method" "InstallMethod" NOT NULL,
    "url" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "staticLook" JSONB,
    "loadedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "failReason" TEXT,
    "otherSiteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tagCount" INTEGER,
    "sdkVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "install_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_definitions" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "method" "EventTrackingMethod" NOT NULL DEFAULT 'CODE',
    "selector" TEXT,
    "pageUrl" TEXT,
    "pageMatch" "UrlMatchType",
    "formSuccess" "FormSuccessMode",
    "successUrl" TEXT,
    "successMatch" "UrlMatchType" NOT NULL DEFAULT 'EXACT',
    "successSelector" TEXT,
    "successEvent" TEXT,
    "issueCode" TEXT,
    "issueUrl" TEXT,
    "issueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_events" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "properties" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "install_verifications_tokenHash_key" ON "install_verifications"("tokenHash");
CREATE INDEX "install_verifications_websiteId_createdAt_idx" ON "install_verifications"("websiteId", "createdAt");
CREATE INDEX "install_verifications_expiresAt_idx" ON "install_verifications"("expiresAt");
CREATE INDEX "experiments_goalEventId_idx" ON "experiments"("goalEventId");
CREATE UNIQUE INDEX "event_definitions_websiteId_name_key" ON "event_definitions"("websiteId", "name");
CREATE UNIQUE INDEX "custom_events_websiteId_eventKey_key" ON "custom_events"("websiteId", "eventKey");
CREATE INDEX "custom_events_websiteId_name_occurredAt_idx" ON "custom_events"("websiteId", "name", "occurredAt");

-- AddForeignKey
ALTER TABLE "install_verifications" ADD CONSTRAINT "install_verifications_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_definitions" ADD CONSTRAINT "event_definitions_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_goalEventId_fkey" FOREIGN KEY ("goalEventId") REFERENCES "event_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
