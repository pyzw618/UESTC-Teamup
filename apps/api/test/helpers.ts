/**
 * 测试基础设施：使用真实的 PostgreSQL（teamup_test）。
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
import { CommentsService } from '../src/modules/radar/comments.service';
import { RoleType, TeamGoal, TeamStatus, type Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');

/** 独立测试库，绝不触碰开发库 teamup */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://teamup:teamup_dev@127.0.0.1:5432/teamup_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/** 让测试库 schema 与 migrations 一致（幂等） */
export function migrateTestDatabase() {
  const bin = join(apiRoot, 'node_modules/.bin/prisma') + (process.platform === 'win32' ? '.cmd' : '');
  execFileSync(bin, ['migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
    shell: process.platform === 'win32',
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
  return {
    teams: new TeamsService(prisma, notify, serializer),
    comments: new CommentsService(prisma, notify),
    viewer: viewerSingleton,
  };
}

const TRUNCATE_TABLES = [
  'Notification',
  'CommentLike',
  'Comment',
  'Team',
  'Favorite',
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

export interface MakeTeamPostOptions {
  competitionId: string;
  leaderId: string;
  goal?: TeamGoal;
  neededRoles?: RoleType[];
  status?: TeamStatus;
  deadline?: Date | null;
  contact?: string;
  requirement?: string;
  targetSize?: number;
  members?: { grade?: number | null; college?: string | null; major?: string | null; rank?: string | null; intro?: string | null }[];
}

/** 创建招募帖（广告牌模式） */
export async function makeTeamPost(prisma: PrismaService, opts: MakeTeamPostOptions) {
  return prisma.team.create({
    data: {
      competitionId: opts.competitionId,
      leaderId: opts.leaderId,
      goal: opts.goal ?? TeamGoal.PRIZE,
      neededRoles: opts.neededRoles ?? [RoleType.ALGORITHM],
      status: opts.status ?? TeamStatus.RECRUITING,
      deadline: opts.deadline ?? null,
      contact: opts.contact ?? 'QQ 10000',
      requirement: opts.requirement ?? null,
      targetSize: opts.targetSize,
      members: opts.members ? { create: opts.members } : undefined,
    },
  });
}

export async function closePrisma() {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
}
