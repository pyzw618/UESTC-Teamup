/**
 * 测试基础设施：使用真实的 PostgreSQL（teamup_test）+ 真实 Prisma 事务，
 * 因为本次重构的核心不变量（并发占名额、同竞赛一人一队）只有真库才能验证。
 *
 * 运行：pnpm -F @teamup/api test
 * 依赖：本地 PG（默认复用 docker 容器 axonhub-postgres）。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaService } from '../src/common/prisma.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { ViewerContext, UserSerializer } from '../src/common/auth/viewer.context';
import { TeamsService } from '../src/modules/match/teams.service';
import { RoleType, TeamGoal, TeamStatus, type Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');

/** 独立测试库，绝不触碰开发库 teamup */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://axonhub:axonhub_password@127.0.0.1:5432/teamup_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/** 让测试库 schema 与 migrations 一致（幂等） */
export function migrateTestDatabase() {
  execFileSync(join(apiRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

let prismaSingleton: PrismaService | null = null;

export function getPrisma(): PrismaService {
  if (!prismaSingleton) prismaSingleton = new PrismaService();
  return prismaSingleton;
}

let viewerSingleton: ViewerContext | null = null;

export function makeService(prisma: PrismaService) {
  const notify = new NotificationService(prisma);
  viewerSingleton ??= new ViewerContext();
  const serializer = new UserSerializer(viewerSingleton);
  return { service: new TeamsService(prisma, notify, serializer), viewer: viewerSingleton };
}

const TRUNCATE_TABLES = [
  'Notification',
  'Application',
  'Invitation',
  'TeamSlot',
  'TeamMember',
  'Review',
  'Workspace',
  'Team',
  'Favorite',
  'Comment',
  'UserSkill',
  'CompetitionTimeline',
  'CompetitionLevel',
  'CompetitionTag',
  'Competition',
  'User',
];

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

let userSeq = 0;

export async function makeUser(
  prisma: PrismaService,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  userSeq += 1;
  const n = userSeq;
  return prisma.user.create({
    data: {
      studentNo: overrides.studentNo ?? `2024${String(n).padStart(9, '0')}`,
      email: overrides.email ?? `tester${n}@std.uestc.edu.cn`,
      nickname: overrides.nickname ?? `同学${n}`,
      passwordHash: overrides.passwordHash ?? 'scrypt$fake$hash',
      college: overrides.college ?? '计算机科学与工程学院',
      grade: overrides.grade ?? 2024,
      major: overrides.major ?? '计算机科学与技术',
      ...overrides,
    },
  });
}

export async function makeCompetition(prisma: PrismaService, name: string) {
  return prisma.competition.create({ data: { name, status: 'PUBLISHED' } });
}

export interface MakeTeamOptions {
  competitionId: string;
  leaderId: string;
  slots?: RoleType[];
  status?: TeamStatus;
  deadline?: Date | null;
}

/** 创建队伍：队长自动成为注册 TeamMember，slots 默认 OPEN */
export async function makeTeam(prisma: PrismaService, opts: MakeTeamOptions) {
  const slots = opts.slots ?? [RoleType.ALGORITHM];
  const team = await prisma.team.create({
    data: {
      competitionId: opts.competitionId,
      leaderId: opts.leaderId,
      goal: TeamGoal.PRIZE,
      status: opts.status ?? TeamStatus.RECRUITING,
      deadline: opts.deadline ?? null,
      slots: { create: slots.map((role) => ({ role })) },
    },
    include: { slots: true },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: opts.leaderId, competitionId: opts.competitionId, note: '队长' },
  });
  return team;
}

/** 直接在数据库层插入一条 PENDING 申请，用于构造并发/绕过状态机的场景 */
export async function seedApplication(
  prisma: PrismaService,
  teamId: string,
  userId: string,
  desiredRole: RoleType,
  pitch = '测试申请',
) {
  return prisma.application.create({ data: { teamId, userId, desiredRole, pitch } });
}

export async function seedInvitation(
  prisma: PrismaService,
  teamId: string,
  userId: string,
  role: RoleType,
  message = '测试邀请',
) {
  return prisma.invitation.create({ data: { teamId, userId, role, message } });
}

export async function closePrisma() {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
}
