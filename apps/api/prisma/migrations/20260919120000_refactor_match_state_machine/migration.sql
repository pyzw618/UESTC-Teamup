-- 重构组队模块数据模型与状态机
--
-- 关键点：
-- 1) TeamStatus.NEGOTIATING -> PAUSED（先把存量数据改好，再替换枚举类型）
-- 2) 新增 SlotStatus / ApplicationStatus.EXPIRED / NotificationKind 两个成员通知
-- 3) 删除 Team.currentSize / Team.teamSize（人数改为实时推导）
-- 4) TeamMember 增加 competitionId（冗余自 Team，用于“同竞赛唯一有效团队”约束）
--    与 active/leftAt（软删除，保留历史）
-- 5) TeamSlot.filled(boolean) -> status(SlotStatus) + filledByMemberId
-- 6) Application.desiredRole / Invitation.role
-- 7) 部分唯一索引（Prisma schema 无法表达，用 raw SQL 落地，这是并发不变量的一部分）

-- ===== 1. 新枚举 =====
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'FILLED', 'CLOSED');

ALTER TYPE "ApplicationStatus" ADD VALUE 'EXPIRED';

ALTER TYPE "NotificationKind" ADD VALUE 'MEMBER_LEFT';
ALTER TYPE "NotificationKind" ADD VALUE 'MEMBER_REMOVED';

-- TeamStatus 去掉 NEGOTIATING、新增 ARCHIVED：PostgreSQL 无法直接删除枚举值，
-- 采用“新类型 + USING 转换 + 重命名”的标准做法。
-- 旧值 NEGOTIATING 在类型转换的 USING CASE 中直接映射为 PAUSED（语义：暂停接收新候选人）。
BEGIN;
CREATE TYPE "TeamStatus_new" AS ENUM ('RECRUITING', 'PAUSED', 'FULL', 'COMPETING', 'DISBANDED', 'ARCHIVED');
ALTER TABLE "Team" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Team"
  ALTER COLUMN "status" TYPE "TeamStatus_new"
  USING (CASE WHEN "status"::text = 'NEGOTIATING' THEN 'PAUSED' ELSE "status"::text END)::"TeamStatus_new";
ALTER TYPE "TeamStatus" RENAME TO "TeamStatus_old";
ALTER TYPE "TeamStatus_new" RENAME TO "TeamStatus";
DROP TYPE "TeamStatus_old";
ALTER TABLE "Team" ALTER COLUMN "status" SET DEFAULT 'RECRUITING';
COMMIT;

-- ===== 3. 旧的索引调整 =====
DROP INDEX "Application_userId_idx";
DROP INDEX "TeamMember_teamId_idx";
DROP INDEX "TeamMember_userId_idx";
DROP INDEX "TeamSlot_teamId_role_filled_idx";

-- ===== 4. Team：删除冗余人数，新增归档时间 =====
ALTER TABLE "Team" DROP COLUMN "currentSize",
DROP COLUMN "teamSize",
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- ===== 5. TeamSlot：filled -> status，并记录占据者 =====
ALTER TABLE "TeamSlot"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "filledAt" TIMESTAMP(3),
  ADD COLUMN "filledByMemberId" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "status" "SlotStatus" NOT NULL DEFAULT 'OPEN';

-- 存量 filled=true 的 slot 视为已被成员占据（历史数据无 filledByMemberId 关联）
UPDATE "TeamSlot" SET "status" = 'FILLED' WHERE "filled" = true;
ALTER TABLE "TeamSlot" DROP COLUMN "filled";

-- ===== 6. TeamMember：冗余 competitionId + 软删除 + 唯一约束 =====
ALTER TABLE "TeamMember"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "competitionId" TEXT,
  ADD COLUMN "leftAt" TIMESTAMP(3);

-- 回填 competitionId（来自所属 Team）。正常情况下 FK 保证都能回填。
UPDATE "TeamMember" m SET "competitionId" = t."competitionId" FROM "Team" t WHERE m."teamId" = t.id;
UPDATE "TeamMember" SET "competitionId" = '' WHERE "competitionId" IS NULL;
ALTER TABLE "TeamMember" ALTER COLUMN "competitionId" SET NOT NULL;

-- ===== 7. Application：新增 desiredRole =====
ALTER TABLE "Application"
  ADD COLUMN "desiredRole" "RoleType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Application" ALTER COLUMN "desiredRole" DROP DEFAULT;
ALTER TABLE "Application" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ===== 8. Invitation：新增 role / message =====
ALTER TABLE "Invitation"
  ADD COLUMN "message" TEXT,
  ADD COLUMN "role" "RoleType" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Invitation" ALTER COLUMN "role" DROP DEFAULT;

-- ===== 9. 普通索引与唯一约束 =====
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");
CREATE INDEX "TeamMember_teamId_active_idx" ON "TeamMember"("teamId", "active");
CREATE INDEX "TeamMember_userId_active_idx" ON "TeamMember"("userId", "active");
CREATE INDEX "TeamMember_competitionId_active_idx" ON "TeamMember"("competitionId", "active");
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");
CREATE UNIQUE INDEX "TeamSlot_filledByMemberId_key" ON "TeamSlot"("filledByMemberId");
CREATE INDEX "TeamSlot_teamId_role_status_idx" ON "TeamSlot"("teamId", "role", "status");

ALTER TABLE "TeamSlot" ADD CONSTRAINT "TeamSlot_filledByMemberId_fkey" FOREIGN KEY ("filledByMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== 10. 部分唯一索引（Prisma schema 无法表达，数据库层并发不变量）=====
-- 同一用户对同一 Team 最多一条有效（PENDING）申请 / 邀请。
-- 为什么不用普通唯一约束：历史记录（ACCEPTED/REJECTED/WITHDRAWN/EXPIRED）需要保留多条。
CREATE UNIQUE INDEX "Application_pending_team_user_key"
  ON "Application" ("teamId", "userId") WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "Invitation_pending_team_user_key"
  ON "Invitation" ("teamId", "userId") WHERE "status" = 'PENDING';

-- 同一竞赛下，一个注册用户最多属于一支有效（active）Team。
-- 为什么可以这样保证：TeamMember.competitionId 冗余自所属 Team，且 Team 的竞赛不会变更。
CREATE UNIQUE INDEX "TeamMember_active_competition_user_key"
  ON "TeamMember" ("userId", "competitionId") WHERE "active" = true AND "userId" IS NOT NULL;
