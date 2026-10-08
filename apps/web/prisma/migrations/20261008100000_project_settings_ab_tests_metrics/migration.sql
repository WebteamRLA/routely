-- CreateEnum
CREATE TYPE "ExperimentType" AS ENUM ('SPLIT_URL', 'AB');

-- CreateEnum
CREATE TYPE "CountingMode" AS ENUM ('UNIQUE', 'ALL');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('CUSTOM_EVENT', 'PAGE_VISIT');

-- CreateEnum
CREATE TYPE "InstallMethod" AS ENUM ('MANUAL', 'GTM');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('EDITOR', 'VIEWER');

-- DropIndex
DROP INDEX "conversions_assignmentId_key";

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN     "goalKey" TEXT NOT NULL DEFAULT 'url';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "goalKey" TEXT;

-- AlterTable
ALTER TABLE "experiment_variants" ADD COLUMN     "changes" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "experiments" ADD COLUMN     "countingMode" "CountingMode" NOT NULL DEFAULT 'UNIQUE',
ADD COLUMN     "goalMetricId" TEXT,
ADD COLUMN     "keepWinner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "secondaryMetricIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targeting" JSONB,
ADD COLUMN     "type" "ExperimentType" NOT NULL DEFAULT 'SPLIT_URL',
ADD COLUMN     "winnerPosition" INTEGER,
ALTER COLUMN "conversionUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "cdnPurgedAt" TIMESTAMP(3),
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "installMethod" "InstallMethod" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "significanceThreshold" INTEGER NOT NULL DEFAULT 95,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "website_domains" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT,
    "matchType" "UrlMatchType" NOT NULL DEFAULT 'EXACT',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_hits" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "url" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "MemberRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_activities" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "actorName" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_domains_websiteId_domain_key" ON "website_domains"("websiteId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_websiteId_key_key" ON "metrics"("websiteId", "key");

-- CreateIndex
CREATE INDEX "metric_hits_metricId_occurredAt_idx" ON "metric_hits"("metricId", "occurredAt");

-- CreateIndex
CREATE INDEX "metric_hits_websiteId_occurredAt_idx" ON "metric_hits"("websiteId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_websiteId_email_key" ON "project_members"("websiteId", "email");

-- CreateIndex
CREATE INDEX "experiment_activities_experimentId_createdAt_idx" ON "experiment_activities"("experimentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_assignmentId_goalKey_key" ON "conversions"("assignmentId", "goalKey");

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_goalMetricId_fkey" FOREIGN KEY ("goalMetricId") REFERENCES "metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_domains" ADD CONSTRAINT "website_domains_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_hits" ADD CONSTRAINT "metric_hits_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_hits" ADD CONSTRAINT "metric_hits_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_activities" ADD CONSTRAINT "experiment_activities_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: every project has the system `page_view` metric (new projects get it from the service).
INSERT INTO "metrics" ("id", "websiteId", "name", "kind", "key", "system", "updatedAt")
SELECT 'm' || substr(md5(random()::text || w."id"), 1, 24), w."id", 'Page view', 'PAGE_VISIT', 'page_view', true, CURRENT_TIMESTAMP
FROM "websites" w;
