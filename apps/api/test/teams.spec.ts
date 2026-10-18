/**
 * 招募帖（广告牌模式）服务层测试。
 * 运行：pnpm -F @teamup/api test （需要本地 PostgreSQL）
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleType, TeamGoal, TeamStatus } from '@prisma/client';
import {
  closePrisma,
  getPrisma,
  makeCompetition,
  makeService,
  makeTeamPost,
  makeUser,
  migrateTestDatabase,
  resetDb,
} from './helpers.js';

migrateTestDatabase();

const BASE_INPUT = {
  goal: TeamGoal.PRIZE,
  qq: '10086',
  neededRoles: [RoleType.ALGORITHM, RoleType.OTHER],
} as const;

test('setup', async () => {
  await resetDb(getPrisma());
});

test('create：联系方式必填 + 竞赛自动建档 + 方向去重', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);

  await assert.rejects(
    teams.create(leader.id, { ...BASE_INPUT, qq: '   ' }),
    /联系方式/,
  );

  const post = await teams.create(leader.id, {
    ...BASE_INPUT,
    competitionName: '广告牌测试赛',
    neededRoles: [RoleType.ALGORITHM, RoleType.ALGORITHM, RoleType.PAPER],
  });
  assert.equal(post.qq, '10086');
  assert.deepEqual(post.neededRoles, [RoleType.ALGORITHM, RoleType.PAPER]);

  const comp = await prisma.competition.findFirst({ where: { name: '广告牌测试赛' } });
  assert.ok(comp, '手动填写竞赛名应自动建档');
});

test('create：同竞赛可重复发帖（2026-09-27 产品迭代去限流）', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '重复发帖赛');

  await teams.create(leader.id, { ...BASE_INPUT, competitionId: comp.id });
  const second = await teams.create(leader.id, { ...BASE_INPUT, competitionId: comp.id });
  assert.ok(second.id, '去限流后同竞赛再次发帖应成功');
});

test('list：展示所有未归档帖子（含已满员、已过截止），仅归档帖子不出现', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '列表测试赛');

  const recruiting = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  const full = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, status: TeamStatus.FULL });
  const expired = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    deadline: new Date(Date.now() - 3600_000),
  });
  const disbanded = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    status: TeamStatus.DISBANDED,
  });

  // 不再按竞赛时间 / 招募截止自动失效，只有归档帖子从公共列表消失
  const all = await teams.list({ page: 1, pageSize: 20 });
  const ids = all.items.map((t) => t.id);
  assert.ok(ids.includes(recruiting.id));
  assert.ok(ids.includes(full.id), '已满员帖子仍应展示');
  assert.ok(ids.includes(expired.id), '招募截止已过的帖子仍应展示，由发帖人决定是否归档');
  assert.ok(!ids.includes(disbanded.id), '已归档帖子不能出现在公共列表');

  const filtered = await teams.list({ page: 1, pageSize: 20, competitionId: comp.id, roles: [RoleType.PAPER] });
  assert.equal(filtered.items.length, 0, '方向筛选应基于 neededRoles');

  const byRole = await teams.list({ page: 1, pageSize: 20, competitionId: comp.id, roles: [RoleType.ALGORITHM] });
  assert.ok(byRole.items.some((t) => t.id === recruiting.id));
});

test('setStatus：手动三态可切换；COMPETING 拒绝手动；DISBANDED 是终态', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const stranger = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '状态测试赛');
  const post = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });

  await assert.rejects(teams.setStatus(stranger.id, post.id, TeamStatus.FULL), /发帖人/);
  await assert.rejects(teams.setStatus(leader.id, post.id, TeamStatus.COMPETING), /手动/);

  await teams.setStatus(leader.id, post.id, TeamStatus.FULL);
  await teams.setStatus(leader.id, post.id, TeamStatus.RECRUITING);
  await teams.setStatus(leader.id, post.id, TeamStatus.DISBANDED);

  const after = await prisma.team.findUniqueOrThrow({ where: { id: post.id } });
  assert.equal(after.status, TeamStatus.DISBANDED);
  await assert.rejects(teams.setStatus(leader.id, post.id, TeamStatus.RECRUITING), /归档/);
  await assert.rejects(teams.update(leader.id, post.id, { ...BASE_INPUT, qq: '2' }), /归档/);
});

test('detail：联系方式分层可见（队长/管理员/已登记意愿者，Issue 1）', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const visitor = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '详情测试赛');
  const post = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, wechat: 'abc_123' });

  // 未登记意愿的登录用户：联系方式不下发（服务端实施，不靠前端遮挡）
  const d = await teams.detail(post.id, visitor.id, 'STUDENT');
  assert.equal(d.wechat, null);
  assert.equal(d.qq, null);
  assert.equal(d.contactUnlocked, false);
  assert.equal(d.viewer.isLeader, false);

  // 游客：招募正文（requirement / 成员名单 / 队长）一律不下发（A3）
  const guest = await teams.detail(post.id);
  assert.equal(guest.wechat, null);
  assert.equal(guest.requirement, null);
  assert.equal(guest.leader, null);
  assert.deepEqual(guest.members, []);

  // 登记组队意愿后解锁
  await teams.registerIntent(post.id, visitor.id);
  const unlocked = await teams.detail(post.id, visitor.id, 'STUDENT');
  assert.equal(unlocked.wechat, 'abc_123');
  assert.equal(unlocked.contactUnlocked, true);

  // 队长本人始终可见
  const own = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(own.wechat, 'abc_123');
  assert.equal(own.viewer.isLeader, true);
});

test('myTeams：归档仓库包含已解散帖子', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '我的帖子赛');

  await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, status: TeamStatus.DISBANDED });

  const mine = await teams.myTeams(leader.id);
  assert.equal(mine.length, 2);
  assert.equal(mine.filter((t) => t.status === TeamStatus.DISBANDED).length, 1);
});

test('竞赛已开始也不自动改状态：帖子继续展示，只有发帖人归档才下架', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const stranger = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '自动参赛赛');
  const past = new Date(Date.now() - 86400_000);

  const stage = await prisma.competitionStage.create({
    data: { competitionId: comp.id, code: 'FINAL', name: '全国决赛', stageKind: 'FINAL', sequence: 1 },
  });
  await prisma.competitionEvent.create({
    data: { competitionId: comp.id, stageId: stage.id, nodeType: 'CONTEST', startAt: past },
  });
  const recruiting = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });

  // 竞赛比赛节点已开始：状态不应变化，公共列表与详情仍然可见
  assert.equal((await prisma.team.findUniqueOrThrow({ where: { id: recruiting.id } })).status, TeamStatus.RECRUITING);
  const listed = await teams.list({ page: 1, pageSize: 20, competitionId: comp.id });
  assert.ok(listed.items.some((t) => t.id === recruiting.id));
  const d = await teams.detail(recruiting.id, stranger.id, 'STUDENT');
  assert.equal(d.status, TeamStatus.RECRUITING);

  // 发帖人主动归档后才从公共列表消失，其他用户直链访问 404
  await teams.setStatus(leader.id, recruiting.id, TeamStatus.DISBANDED);
  const after = await teams.list({ page: 1, pageSize: 20, competitionId: comp.id });
  assert.ok(!after.items.some((t) => t.id === recruiting.id));
  await assert.rejects(teams.detail(recruiting.id, stranger.id, 'STUDENT'), /归档/);
});

test('评论点赞：切换语义（再点一次取消）+ 计数一致', async () => {
  const prisma = getPrisma();
  const { comments } = makeService(prisma);
  const author = await makeUser(prisma);
  const liker = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '评论测试赛');

  const created = await comments.create(author.id, {
    targetType: 'COMPETITION',
    targetId: comp.id,
    content: '第一条评论',
  });

  const liked = await comments.toggleLike(liker.id, created.id);
  assert.equal(liked.liked, true);
  assert.equal(liked.likes, 1);
  const toggledOff = await comments.toggleLike(liker.id, created.id);
  assert.equal(toggledOff.liked, false, '再次点击应取消点赞');
  assert.equal(toggledOff.likes, 0);
  const reLiked = await comments.toggleLike(liker.id, created.id);
  assert.equal(reLiked.liked, true);
  assert.equal(reLiked.likes, 1);

  const list = await comments.list('COMPETITION', comp.id, liker.id);
  assert.equal(list[0].likes, 1);
  assert.equal(list[0].liked, true);

  const listAfter = await comments.list('COMPETITION', comp.id);
  assert.equal(listAfter[0].likes, 1);
  assert.equal(listAfter[0].liked, false, '未登录/其他用户视角不应显示已点赞');
});

test('成员名单：memberCount 派生 + 编辑整表替换', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '成员名单测试赛');
  const post = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    targetSize: 4,
    members: [
      { grade: 2024, college: '信息与通信工程学院', major: '信息工程', rank: '前 10%', intro: '陈同学（队长）' },
      { grade: 2024, college: '数学科学学院', major: '数学与应用数学', rank: '前 5%', intro: null },
    ],
  });

  // memberCount 口径（B1）：队长本人是第 1 人，memberCount = 1 + 成员行数
  const d = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(d.memberCount, 3);
  assert.equal(d.targetSize, 4);
  assert.equal(d.members[0].college, '信息与通信工程学院');

  // 整表替换：留下 1 行、新增 1 行
  await teams.update(leader.id, post.id, {
    ...BASE_INPUT,
    members: [
      { grade: 2024, college: '信息与通信工程学院', major: '信息工程', rank: '前 10%', intro: '陈同学（队长）' },
      { grade: 2025, college: '信息与软件工程学院', major: '软件工程', rank: null, intro: '新同学' },
    ],
  });
  const after = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(after.memberCount, 3);
  assert.ok(after.members.some((m) => m.major === '软件工程'));
  assert.ok(!after.members.some((m) => m.major === '数学与应用数学'));

  // 空行与超限
  await teams.update(leader.id, post.id, { ...BASE_INPUT, members: [{ intro: '  ' }, { intro: '有效行' }] });
  const cleaned = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(cleaned.memberCount, 2, '全空成员行应被丢弃（1 行成员 + 队长）');
  await assert.rejects(
    teams.update(leader.id, post.id, { ...BASE_INPUT, targetSize: 0 }),
    /1-99/,
  );
});

test('teardown', async () => {
  const prisma = getPrisma();
  await resetDb(prisma);
  await closePrisma();
});
