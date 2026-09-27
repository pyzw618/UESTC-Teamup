ALTER TABLE "CrawlSource" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "CrawlRevision" ADD COLUMN "sourceId" TEXT;
CREATE INDEX "CrawlRevision_sourceId_idx" ON "CrawlRevision"("sourceId");
ALTER TABLE "CrawlRevision" ADD CONSTRAINT "CrawlRevision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrawlSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
