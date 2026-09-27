-- 2026-09-27 产品迭代批次（docs/ISSUES_PRODUCT_FIXES.md）：
-- 1) TeamIntent 组队意愿  2) Competition.year 届次 + (name, year) 唯一
-- 3) CompetitionCustomField 竞赛自定义字段  4) Feedback 反馈  5) NotificationKind.TEAM_INTENT

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('FUNCTION', 'COMPETITION_INFO');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'TEAM_INTENT';

-- DropIndex
DROP INDEX "Competition_name_key";

-- DropIndex
DROP INDEX "Competition_name_trgm_idx";

-- AlterTable（先加可空列，回填后再设 NOT NULL：存量 85 行无法直接加 NOT NULL 列）
ALTER TABLE "Competition" ADD COLUMN     "year" INTEGER;

-- 回填届次：取该竞赛最早时间轴节点的年份；没有时间轴的用当前年份
UPDATE "Competition" c
SET "year" = COALESCE(
  (
    SELECT MIN(EXTRACT(YEAR FROM COALESCE(t."startAt", t."endAt")))::int
    FROM "CompetitionTimeline" t
    WHERE t."competitionId" = c."id"
  ),
  EXTRACT(YEAR FROM c."createdAt")::int
);

ALTER TABLE "Competition" ALTER COLUMN "year" SET NOT NULL;

-- CreateTable
CREATE TABLE "CompetitionCustomField" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamIntent" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "competitionId" TEXT,
    "competitionName" TEXT,
    "pagePath" TEXT,
    "content" TEXT NOT NULL,
    "contact" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionCustomField_competitionId_key_key" ON "CompetitionCustomField"("competitionId", "key");

-- CreateIndex
CREATE INDEX "TeamIntent_teamId_idx" ON "TeamIntent"("teamId");

-- CreateIndex
CREATE INDEX "TeamIntent_userId_idx" ON "TeamIntent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamIntent_teamId_userId_key" ON "TeamIntent"("teamId", "userId");

-- CreateIndex
CREATE INDEX "Feedback_type_createdAt_idx" ON "Feedback"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Competition_year_idx" ON "Competition"("year");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_name_year_key" ON "Competition"("name", "year");

-- AddForeignKey
ALTER TABLE "CompetitionCustomField" ADD CONSTRAINT "CompetitionCustomField_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionCustomField" ADD CONSTRAINT "CompetitionCustomField_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamIntent" ADD CONSTRAINT "TeamIntent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamIntent" ADD CONSTRAINT "TeamIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
