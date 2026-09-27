ALTER TABLE "CrawlItem" ADD COLUMN "externalId" TEXT;
CREATE INDEX "CrawlItem_sourceId_externalId_idx" ON "CrawlItem"("sourceId", "externalId");
