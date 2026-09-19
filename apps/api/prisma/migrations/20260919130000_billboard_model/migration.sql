-- Backfill: 广告牌模式下 contact 必填，历史空值填占位文案
UPDATE "Team" SET "contact" = '可通过站内评论区联系' WHERE "contact" IS NULL;

-- AlterEnum
BEGIN;
CREATE TYPE "TeamStatus_new" AS ENUM ('RECRUITING', 'FULL', 'COMPETING', 'DISBANDED');
ALTER TABLE "Team" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Team" ALTER COLUMN "status" TYPE "TeamStatus_new" USING ("status"::text::"TeamStatus_new");
ALTER TYPE "TeamStatus" RENAME TO "TeamStatus_old";
ALTER TYPE "TeamStatus_new" RENAME TO "TeamStatus";
DROP TYPE "TeamStatus_old";
ALTER TABLE "Team" ALTER COLUMN "status" SET DEFAULT 'RECRUITING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationKind_new" AS ENUM ('DDL_REMINDER', 'COMMENT_REPLY', 'CRAWL_ANOMALY', 'SOURCE_FAILING', 'CORRECTION_NEW', 'SYSTEM_NOTIFICATION');
ALTER TABLE "Notification" ALTER COLUMN "kind" TYPE "NotificationKind_new" USING ("kind"::text::"NotificationKind_new");
ALTER TYPE "NotificationKind" RENAME TO "NotificationKind_old";
ALTER TYPE "NotificationKind_new" RENAME TO "NotificationKind";
DROP TYPE "NotificationKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "TeamSlot" DROP CONSTRAINT "TeamSlot_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamSlot" DROP CONSTRAINT "TeamSlot_filledByMemberId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_userId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_userId_fkey";

-- DropForeignKey
ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_revieweeId_fkey";

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "archivedAt",
ADD COLUMN     "neededRoles" "RoleType"[],
ALTER COLUMN "contact" SET NOT NULL;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "TeamMember";

-- DropTable
DROP TABLE "TeamSlot";

-- DropTable
DROP TABLE "Application";

-- DropTable
DROP TABLE "Invitation";

-- DropTable
DROP TABLE "Workspace";

-- DropTable
DROP TABLE "Review";

-- DropEnum
DROP TYPE "SlotStatus";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- CreateTable
CREATE TABLE "CommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("userId","commentId")
);

-- CreateIndex
CREATE INDEX "CommentLike_commentId_idx" ON "CommentLike"("commentId");

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

