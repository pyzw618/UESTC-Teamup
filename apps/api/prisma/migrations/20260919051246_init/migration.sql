-- CreateEnum
CREATE TYPE "Level" AS ENUM ('INTERNATIONAL', 'NATIONAL', 'PROVINCIAL', 'SCHOOL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'CONTRIBUTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "CompetitionFormat" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('UNDERGRAD', 'POSTGRAD', 'MIXED');

-- CreateEnum
CREATE TYPE "TeamGoal" AS ENUM ('PRIZE', 'PRACTICE', 'NATIONAL_FIRST', 'BONUS_ONLY');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('RECRUITING', 'NEGOTIATING', 'FULL', 'COMPETING', 'DISBANDED');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('ALGORITHM', 'FRONTEND', 'BACKEND', 'HARDWARE', 'MODELING', 'UI', 'PAPER', 'DEFENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'FAILING', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('PAST_PAPER', 'OPEN_SOURCE', 'EXPERIENCE', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "CommentTarget" AS ENUM ('COMPETITION', 'POST', 'TEAM');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('DDL_REMINDER', 'APPLICATION_NEW', 'APPLICATION_RESULT', 'INVITATION_NEW', 'COMMENT_REPLY', 'CRAWL_ANOMALY', 'SOURCE_FAILING', 'CORRECTION_NEW');

-- CreateEnum
CREATE TYPE "RevisionOrigin" AS ENUM ('CRAWL', 'MANUAL', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('ACADEMIC_AFFAIRS', 'COLLEGE', 'COMPETITION_SITE', 'ACADEMY_LIST');

-- CreateEnum
CREATE TYPE "ParseStrategy" AS ENUM ('CSS', 'JSON_API', 'REGEX');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "studentNo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "college" TEXT,
    "grade" INTEGER,
    "major" TEXT,
    "nickname" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "level" INTEGER,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("userId","skill")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "organizer" TEXT,
    "officialUrl" TEXT,
    "format" "CompetitionFormat",
    "teamSizeMin" INTEGER,
    "teamSizeMax" INTEGER,
    "audience" "Audience",
    "intro" TEXT,
    "difficulty" INTEGER,
    "effort" INTEGER,
    "isBonusEligible" BOOLEAN,
    "bonusCategory" TEXT,
    "bonusPoints" TEXT,
    "sourceUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "status" "PublishStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionLevel" (
    "competitionId" TEXT NOT NULL,
    "level" "Level" NOT NULL,

    CONSTRAINT "CompetitionLevel_pkey" PRIMARY KEY ("competitionId","level")
);

-- CreateTable
CREATE TABLE "CompetitionTimeline" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "level" "Level",
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "isAuto" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CompetitionTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionTag" (
    "competitionId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "CompetitionTag_pkey" PRIMARY KEY ("competitionId","tag")
);

-- CreateTable
CREATE TABLE "CompetitionAward" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "year" INTEGER,
    "awardName" TEXT,
    "teamName" TEXT,
    "members" TEXT[],
    "sourceUrl" TEXT,

    CONSTRAINT "CompetitionAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionMaterial" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "kind" "MaterialKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorId" TEXT,

    CONSTRAINT "CompetitionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "cron" TEXT NOT NULL,
    "parseStrategy" "ParseStrategy" NOT NULL,
    "selectorConf" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "health" "SourceHealth" NOT NULL DEFAULT 'HEALTHY',

    CONSTRAINT "CrawlSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "rawText" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrawlItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRevision" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT,
    "timelineId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "origin" "RevisionOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlAnomaly" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "competitionId" TEXT,
    "rule" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrawlAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionReport" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" TEXT,
    "proposedValue" TEXT,
    "note" TEXT,
    "reporterId" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "goal" "TeamGoal" NOT NULL,
    "requirement" TEXT,
    "contact" TEXT,
    "deadline" TIMESTAMP(3),
    "status" "TeamStatus" NOT NULL DEFAULT 'RECRUITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT,
    "role" "RoleType",
    "rank" TEXT,
    "grade" INTEGER,
    "college" TEXT,
    "note" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSlot" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "RoleType" NOT NULL,
    "filled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TeamSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pitch" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "MaterialKind" NOT NULL,
    "refined" BOOLEAN NOT NULL DEFAULT false,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetType" "CommentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" TEXT NOT NULL,
    "targetType" "CommentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","targetType","targetId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "revieweeId" TEXT NOT NULL,
    "reliability" INTEGER,
    "skill" INTEGER,
    "communication" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BanRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_studentNo_key" ON "User"("studentNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Competition_status_idx" ON "Competition"("status");

-- CreateIndex
CREATE INDEX "Competition_updatedAt_idx" ON "Competition"("updatedAt");

-- CreateIndex
CREATE INDEX "CompetitionLevel_level_idx" ON "CompetitionLevel"("level");

-- CreateIndex
CREATE INDEX "CompetitionTimeline_startAt_idx" ON "CompetitionTimeline"("startAt");

-- CreateIndex
CREATE INDEX "CompetitionTimeline_endAt_idx" ON "CompetitionTimeline"("endAt");

-- CreateIndex
CREATE INDEX "CompetitionTimeline_competitionId_idx" ON "CompetitionTimeline"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionTag_tag_idx" ON "CompetitionTag"("tag");

-- CreateIndex
CREATE INDEX "CompetitionAward_competitionId_idx" ON "CompetitionAward"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionMaterial_competitionId_idx" ON "CompetitionMaterial"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionMaterial_kind_idx" ON "CompetitionMaterial"("kind");

-- CreateIndex
CREATE INDEX "CrawlSnapshot_sourceId_fetchedAt_idx" ON "CrawlSnapshot"("sourceId", "fetchedAt");

-- CreateIndex
CREATE INDEX "CrawlItem_sourceId_processed_idx" ON "CrawlItem"("sourceId", "processed");

-- CreateIndex
CREATE INDEX "CrawlRevision_competitionId_createdAt_idx" ON "CrawlRevision"("competitionId", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlRevision_timelineId_createdAt_idx" ON "CrawlRevision"("timelineId", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlAnomaly_detectedAt_idx" ON "CrawlAnomaly"("detectedAt");

-- CreateIndex
CREATE INDEX "CorrectionReport_status_createdAt_idx" ON "CorrectionReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Team_status_competitionId_idx" ON "Team"("status", "competitionId");

-- CreateIndex
CREATE INDEX "Team_deadline_idx" ON "Team"("deadline");

-- CreateIndex
CREATE INDEX "Team_leaderId_idx" ON "Team"("leaderId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamSlot_teamId_role_filled_idx" ON "TeamSlot"("teamId", "role", "filled");

-- CreateIndex
CREATE INDEX "Application_teamId_userId_status_idx" ON "Application"("teamId", "userId", "status");

-- CreateIndex
CREATE INDEX "Application_userId_idx" ON "Application"("userId");

-- CreateIndex
CREATE INDEX "Invitation_userId_status_idx" ON "Invitation"("userId", "status");

-- CreateIndex
CREATE INDEX "Invitation_teamId_status_idx" ON "Invitation"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_teamId_key" ON "Workspace"("teamId");

-- CreateIndex
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");

-- CreateIndex
CREATE INDEX "Post_kind_refined_idx" ON "Post"("kind", "refined");

-- CreateIndex
CREATE INDEX "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Favorite_targetType_targetId_idx" ON "Favorite"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_teamId_reviewerId_revieweeId_key" ON "Review"("teamId", "reviewerId", "revieweeId");

-- CreateIndex
CREATE INDEX "Report_handled_createdAt_idx" ON "Report"("handled", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionLevel" ADD CONSTRAINT "CompetitionLevel_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionTimeline" ADD CONSTRAINT "CompetitionTimeline_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionTag" ADD CONSTRAINT "CompetitionTag_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionAward" ADD CONSTRAINT "CompetitionAward_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMaterial" ADD CONSTRAINT "CompetitionMaterial_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMaterial" ADD CONSTRAINT "CompetitionMaterial_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlSnapshot" ADD CONSTRAINT "CrawlSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrawlSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlItem" ADD CONSTRAINT "CrawlItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrawlSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRevision" ADD CONSTRAINT "CrawlRevision_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRevision" ADD CONSTRAINT "CrawlRevision_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "CompetitionTimeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlAnomaly" ADD CONSTRAINT "CrawlAnomaly_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrawlSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlAnomaly" ADD CONSTRAINT "CrawlAnomaly_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionReport" ADD CONSTRAINT "CorrectionReport_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionReport" ADD CONSTRAINT "CorrectionReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSlot" ADD CONSTRAINT "TeamSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
