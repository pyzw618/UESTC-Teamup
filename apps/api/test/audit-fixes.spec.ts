/**
 * 2026-10-11 审计修复回归测试（Issues #8 / #10 / #11 / #13 / #14 / #15 / #17）。
 * 运行：pnpm -F @teamup/api test （需要本地 PostgreSQL）
 */
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventNodeType, PublishStatus, TeamGoal, TeamStatus } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { CompetitionsService } from '../src/modules/radar/competitions.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import {
  closePrisma,
  getPrisma,
  makeService,
  makeTeamPost,
  makeUser,
  migrateTestDatabase,
  resetDb,
} from './helpers.js';

migrateTestDatabase();

let admin: AdminService;
let competitions: CompetitionsService;
let teams: ReturnType<typeof makeService>['teams'];
let comments: ReturnType<typeof makeService>['comments'];

test('setup', async () => {
  const prisma = getPrisma();
  const notify = new NotificationService(prisma);
  competitions = new CompetitionsService(prisma);
  admin = new AdminService(prisma, notify, competitions);
  teams = makeService(prisma).teams;
  comments = makeService(prisma).comments;
  await resetDb(prisma);
});

// ---------- Issue 11：DRAFT 竞赛不可被普通用户访问 ----------

test('#11 detail：DRAFT 对游客/普通用户按不存在处理，管理员可预览', async () => {
  const prisma = getPrisma();
  const comp = await prisma.competition.create({
    data: { code: 'AUDIT11', name: '草稿详情赛', year: 2026, status: PublishStatus.DRAFT },
  });

  await assert.rejects(competitions.detail(comp.id), /不存在或已下线/, '游客不可见');
  await assert.rejects(competitions.detail(comp.id, 'STUDENT'), /不存在或已下线/, '普通用户不可见');
  await assert.rejects(competitions.detail(comp.id, 'CONTRIBUTOR'), /不存在或已下线/, '贡献者不可见');
  const d = await competitions.detail(comp.id, 'ADMIN');
  assert.equal(d.id, comp.id, '管理员可预览草稿');

  // ARCHIVED 维持原口径
  await prisma.competition.update({ where: { id: comp.id }, data: { status: 'ARCHIVED' } });
  await assert.rejects(competitions.detail(comp.id, 'ADMIN'), /不存在或已下线/);
});

// ---------- Issue 8 / #15：事件编辑持久化 + 按 eventId 精确回滚 ----------

test('#8/#15 updateCompetition：events 契约持久化，修订记录携带 eventId，回滚只动目标事件', async () => {
  const prisma = getPrisma();
  const actor = await makeUser(prisma);
  const comp = await admin.createCompetition({
    name: '事件编辑赛',
    code: 'AUDIT8',
    year: 2026,
    status: PublishStatus.PUBLISHED,
  });
  const stage = await prisma.competitionStage.create({
    data: { competitionId: comp.id, code: 'S1', name: '校赛', stageKind: 'CAMPUS', sequence: 1 },
  });
  const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T10:00:00.000Z`;

  // 首次编辑：同阶段挂两个事件
  await admin.updateCompetition(
    comp.id,
    {
      events: [
        { stageId: stage.id, nodeType: EventNodeType.CONTEST, startAt: day(1), endAt: day(2) },
        { stageId: stage.id, nodeType: EventNodeType.CONTEST, startAt: day(10), endAt: day(11) },
      ],
    },
    actor.id,
  );
  const events = await prisma.competitionEvent.findMany({ where: { competitionId: comp.id }, orderBy: { startAt: 'asc' } });
  assert.equal(events.length, 2, 'events 数组应持久化（旧版被白名单丢弃）');
  const [eventA, eventB] = events;

  // 再次编辑：两个事件的时间都被修改 → 每个事件的修订记录精确绑定 eventId
  await admin.updateCompetition(
    comp.id,
    {
      events: [
        { id: eventA.id, stageId: stage.id, nodeType: EventNodeType.CONTEST, startAt: day(3), endAt: day(4) },
        { id: eventB.id, stageId: stage.id, nodeType: EventNodeType.CONTEST, startAt: day(13), endAt: day(14) },
      ],
    },
    actor.id,
  );
  const revisions = await prisma.competitionRevision.findMany({
    where: { competitionId: comp.id, origin: 'MANUAL' },
  });
  const startRevisions = revisions.filter((r) => r.field === 'startAt');
  assert.equal(startRevisions.length, 2);
  assert.ok(startRevisions.every((r) => r.eventId != null), '事件级修订必须携带 eventId（Issue 15）');

  // 回滚事件 B 的 startAt：事件 A 不受影响（旧逻辑按 stageId 取最近一条会改错节点）
  const revB = startRevisions.find((r) => r.eventId === eventB.id)!;
  await admin.rollback(revB.id);

  const after = await prisma.competitionEvent.findMany({ where: { competitionId: comp.id }, orderBy: { startAt: 'asc' } });
  const afterA = after.find((e) => e.id === eventA.id)!;
  const afterB = after.find((e) => e.id === eventB.id)!;
  assert.equal(afterA.startAt?.toISOString(), day(3), '事件 A 不应被回滚波及');
  assert.equal(afterB.startAt?.toISOString(), day(10), '事件 B 的 startAt 应回滚到旧值');
  assert.equal(afterB.endAt?.toISOString(), day(14), '事件 B 的 endAt 不受影响');

  // 回滚动作本身留痕，且同样绑定 eventId
  const rollbackRev = await prisma.competitionRevision.findFirst({ where: { competitionId: comp.id, origin: 'ROLLBACK' } });
  assert.ok(rollbackRev);
  assert.equal(rollbackRev.eventId, eventB.id);
});

// ---------- Issue 10：code / bonusSpecialRule 持久化与重复编号 ----------

test('#10 createCompetition：code 与 bonusSpecialRule 落库；(code, year) 重复给出友好错误', async () => {
  const comp = await admin.createCompetition({
    name: '编码赛',
    code: 'AUDIT10',
    year: 2027,
    bonusSpecialRule: '美赛 Outstanding 按国家级最高奖计',
    status: PublishStatus.PUBLISHED,
  });
  assert.equal(comp!.code, 'AUDIT10', '管理员指定编号不被时间戳覆盖');
  assert.equal(comp!.bonusSpecialRule, '美赛 Outstanding 按国家级最高奖计');

  await assert.rejects(
    admin.createCompetition({ name: '编码赛副本', code: 'AUDIT10', year: 2027 }),
    /编号在此年份已存在/,
  );
  // 同编号不同年份允许（跨届次沿用稳定编号）
  const next = await admin.createCompetition({ name: '编码赛', code: 'AUDIT10', year: 2028 });
  assert.equal(next!.code, 'AUDIT10');
});

// ---------- Issue 14：并发建档不重复 + 不擅自发布管理员草稿 ----------

test('#14 resolveCompetition：并发同名建档只落一条；DRAFT 不被代发布', async () => {
  const prisma = getPrisma();
  const leader = await makeUser(prisma);

  // 并发提交同届同名竞赛
  const results = await Promise.allSettled([
    teams.create(leader.id, { goal: TeamGoal.PRIZE, qq: '10086', competitionName: '并发建档赛' }),
    teams.create(leader.id, { goal: TeamGoal.PRIZE, qq: '10086', competitionName: '并发建档赛' }),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'), '并发建档双方都应成功');
  const dups = await prisma.competition.findMany({ where: { name: '并发建档赛', year: new Date().getFullYear() } });
  assert.equal(dups.length, 1, '(code, year) 确定性编号下不允许同名同年重复档案');

  // 管理员草稿：组队复用档案但不代为发布
  const draft = await prisma.competition.create({
    data: { code: 'AUDIT14', name: '草稿建档赛', year: new Date().getFullYear(), status: PublishStatus.DRAFT },
  });
  await teams.create(leader.id, { goal: TeamGoal.PRIZE, qq: '10086', competitionName: '草稿建档赛' });
  const after = await prisma.competition.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(after.status, PublishStatus.DRAFT, '普通组队操作不得发布管理员草稿');
});

// ---------- Issue 17：招募截止不再让帖子失效 + 招募计数口径 ----------

test('#17 registerIntent：招募截止已过仍可登记（是否下架由发帖人决定）', async () => {
  const prisma = getPrisma();
  const leader = await makeUser(prisma);
  const visitor = await makeUser(prisma);
  const comp = await prisma.competition.create({
    data: { code: 'AUDIT17', name: '截止测试赛', year: 2026, status: 'PUBLISHED' },
  });
  const post = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    deadline: new Date(Date.now() - 3600_000),
  });
  const res = await teams.registerIntent(post.id, visitor.id);
  assert.equal(res.hasIntent, true);

  // 未设置截止时间的帖子不受影响
  const openPost = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  const res2 = await teams.registerIntent(openPost.id, visitor.id);
  assert.equal(res2.hasIntent, true);
});

test('#17 detail：recruitingTeamsCount 为独立 count，不受 take:20 限制；只排除已归档帖', async () => {
  const prisma = getPrisma();
  const leader = await makeUser(prisma);
  const comp = await prisma.competition.create({
    data: { code: 'AUDIT17B', name: '计数测试赛', year: 2026, status: 'PUBLISHED' },
  });

  // 22 个招募中 + 1 个过期 deadline 帖 + 1 个 FULL 帖，均属于展示中的帖子
  for (let i = 0; i < 22; i += 1) {
    await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  }
  await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    deadline: new Date(Date.now() - 3600_000),
  });
  await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, status: TeamStatus.FULL });
  // 归档帖不计入
  await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, status: TeamStatus.DISBANDED });

  const d = await competitions.detail(comp.id, 'STUDENT');
  assert.equal(d.recruitingTeamsCount, 24, '独立 count 不过滤分页，且只排除已归档帖');
  assert.equal(d.recruitingTeams.length, 20, '列表仍按前 20 条返回');
  assert.equal(d.recruitingTeamsCount !== d.recruitingTeams.length, true, '数组长度 ≠ 总量（Issue 17）');

  // 游客只见计数不见帖子详情 —— 该裁剪在 radar.controller.detail 中实施（服务层返回全量 + 计数）
  const guest = await competitions.detail(comp.id);
  assert.equal(guest.recruitingTeamsCount, 24);
  assert.equal(guest.recruitingTeams.length, 20);

  // 列表计数与详情同口径（只排除已归档）
  const list = await competitions.list({ page: 1, pageSize: 20 });
  const row = list.items.find((c) => c.id === comp.id);
  assert.equal(row?.recruitingTeams, 24, '列表 recruitingTeams 计数应包含已满员与过期截止帖');
});

test('admin teams：列表可按竞赛名/学号搜索，归档与恢复只切换状态', async () => {
  const prisma = getPrisma();
  const leader = await makeUser(prisma, { studentNo: '20249999001', nickname: '归档测试队长' });
  const comp = await prisma.competition.create({
    data: { code: 'ADMINTEAM', name: '管理员归档测试赛', year: 2026, status: 'PUBLISHED' },
  });
  const post = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });

  const byComp = await admin.adminTeamsList({ page: 1, pageSize: 20, q: '管理员归档测试赛' });
  assert.ok(byComp.items.some((t) => t.id === post.id));

  const byStudentNo = await admin.adminTeamsList({ page: 1, pageSize: 20, q: '20249999001' });
  assert.ok(byStudentNo.items.some((t) => t.id === post.id));

  const archived = await admin.setTeamArchived(post.id, true);
  assert.equal(archived.status, 'DISBANDED');
  assert.equal((await prisma.team.findUniqueOrThrow({ where: { id: post.id } })).status, TeamStatus.DISBANDED);

  const filtered = await admin.adminTeamsList({ page: 1, pageSize: 20, q: '管理员归档测试赛', status: 'DISBANDED' });
  assert.ok(filtered.items.some((t) => t.id === post.id));

  const restored = await admin.setTeamArchived(post.id, false);
  assert.equal(restored.status, 'RECRUITING');
  assert.equal((await prisma.team.findUniqueOrThrow({ where: { id: post.id } })).status, TeamStatus.RECRUITING);
});

// ---------- Issue 13：评论接口复用队伍/竞赛可见性 ----------

test('#13 comments：隐藏队伍的评论读/写/点赞全部按不存在处理', async () => {
  const prisma = getPrisma();
  const leader = await makeUser(prisma);
  const stranger = await makeUser(prisma);
  const comp = await prisma.competition.create({
    data: { code: 'AUDIT13', name: '评论测试赛', year: 2026, status: 'PUBLISHED' },
  });
  const post = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  await prisma.team.update({ where: { id: post.id }, data: { status: TeamStatus.DISBANDED } });

  // 队长先在帖子可读时留一条评论
  const own = await comments.create(leader.id, { targetType: 'TEAM', targetId: post.id, content: '队长留言' });

  await assert.rejects(
    comments.create(stranger.id, { targetType: 'TEAM', targetId: post.id, content: '踩' }, 'STUDENT'),
    /招募帖不存在/,
    '无权用户不能向隐藏队伍发表评论',
  );
  await assert.rejects(comments.list('TEAM', post.id), /招募帖不存在/, '游客不可读隐藏队伍评论');
  await assert.rejects(comments.list('TEAM', post.id, stranger.id, 'STUDENT'), /招募帖不存在/);
  await assert.rejects(
    comments.toggleLike(stranger.id, own.id, 'STUDENT'),
    /招募帖不存在/,
    '隐藏队伍的评论不允许点赞',
  );

  // 队长与管理员仍可互动
  const adminComment = await comments.create(stranger.id, { targetType: 'TEAM', targetId: post.id, content: '管理员视角' }, 'ADMIN');
  assert.ok(adminComment.id);
  const listByLeader = await comments.list('TEAM', post.id, leader.id, 'STUDENT');
  assert.equal(listByLeader.length, 2);

  // 已删除 / 不存在的目标：一致 404
  await assert.rejects(comments.list('TEAM', 'nonexistent-id'), /招募帖不存在/);
});

test('#13 comments：草稿/归档竞赛的评论对非管理员关闭', async () => {
  const prisma = getPrisma();
  const user = await makeUser(prisma);
  const draft = await prisma.competition.create({
    data: { code: 'AUDIT13B', name: '评论草稿赛', year: 2026, status: PublishStatus.DRAFT },
  });
  await assert.rejects(
    comments.create(user.id, { targetType: 'COMPETITION', targetId: draft.id, content: 'x' }, 'STUDENT'),
    /竞赛不存在/,
  );
  await assert.rejects(comments.list('COMPETITION', draft.id, user.id, 'STUDENT'), /竞赛不存在/);
  const adminView = await comments.list('COMPETITION', draft.id, user.id, 'ADMIN');
  assert.deepEqual(adminView, []);
});

test('teardown', async () => {
  const prisma = getPrisma();
  await resetDb(prisma);
  await closePrisma();
});
