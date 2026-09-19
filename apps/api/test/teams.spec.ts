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
  contact: 'QQ 10086',
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
    teams.create(leader.id, { ...BASE_INPUT, contact: '   ' }),
    /联系方式/,
  );

  const post = await teams.create(leader.id, {
    ...BASE_INPUT,
    competitionName: '广告牌测试赛',
    neededRoles: [RoleType.ALGORITHM, RoleType.ALGORITHM, RoleType.PAPER],
  });
  assert.equal(post.contact, 'QQ 10086');
  assert.deepEqual(post.neededRoles, [RoleType.ALGORITHM, RoleType.PAPER]);

  const comp = await prisma.competition.findFirst({ where: { name: '广告牌测试赛' } });
  assert.ok(comp, '手动填写竞赛名应自动建档');
});

test('create：24h 内同竞赛重复发帖被拒', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '重复发帖赛');

  await teams.create(leader.id, { ...BASE_INPUT, competitionId: comp.id });
  await assert.rejects(teams.create(leader.id, { ...BASE_INPUT, competitionId: comp.id }), /重复发帖/);
});

test('list：默认只展示招募中，DISBANDED 永不出现在公共列表', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '列表测试赛');

  const recruiting = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, status: TeamStatus.FULL });
  const disbanded = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    status: TeamStatus.DISBANDED,
  });

  const all = await teams.list({ page: 1, pageSize: 20, statuses: [TeamStatus.RECRUITING, TeamStatus.FULL, TeamStatus.DISBANDED] });
  const ids = all.items.map((t) => t.id);
  assert.ok(ids.includes(recruiting.id));
  assert.ok(!ids.includes(disbanded.id), '已解散帖子不能出现在公共列表');

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
  await assert.rejects(teams.setStatus(leader.id, post.id, TeamStatus.COMPETING), /系统/);

  await teams.setStatus(leader.id, post.id, TeamStatus.FULL);
  await teams.setStatus(leader.id, post.id, TeamStatus.RECRUITING);
  await teams.setStatus(leader.id, post.id, TeamStatus.DISBANDED);

  const after = await prisma.team.findUniqueOrThrow({ where: { id: post.id } });
  assert.equal(after.status, TeamStatus.DISBANDED);
  await assert.rejects(teams.setStatus(leader.id, post.id, TeamStatus.RECRUITING), /归档/);
  await assert.rejects(teams.update(leader.id, post.id, { ...BASE_INPUT, contact: 'QQ 2' }), /归档/);
});

test('detail：联系方式公开可见', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const visitor = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '详情测试赛');
  const post = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id, contact: '微信 abc_123' });

  const d = await teams.detail(post.id, visitor.id, 'STUDENT');
  assert.equal(d.contact, '微信 abc_123');
  assert.equal(d.viewer.isLeader, false);

  const own = await teams.detail(post.id, leader.id, 'STUDENT');
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

test('autoCompete：竞赛比赛节点开始后自动置为 COMPETING，已解散不动', async () => {
  const prisma = getPrisma();
  const { teams } = makeService(prisma);
  const leader = await makeUser(prisma);
  const comp = await makeCompetition(prisma, '自动参赛赛');
  const past = new Date(Date.now() - 86400_000);

  await prisma.competitionTimeline.create({
    data: { competitionId: comp.id, stage: '全国决赛', startAt: past },
  });
  const recruiting = await makeTeamPost(prisma, { competitionId: comp.id, leaderId: leader.id });
  const disbanded = await makeTeamPost(prisma, {
    competitionId: comp.id,
    leaderId: leader.id,
    status: TeamStatus.DISBANDED,
  });

  const result = await teams.autoCompete();
  assert.ok(result.updated >= 1);
  assert.equal((await prisma.team.findUniqueOrThrow({ where: { id: recruiting.id } })).status, TeamStatus.COMPETING);
  assert.equal((await prisma.team.findUniqueOrThrow({ where: { id: disbanded.id } })).status, TeamStatus.DISBANDED);
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

  const d = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(d.memberCount, 2);
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
  assert.equal(after.memberCount, 2);
  assert.ok(after.members.some((m) => m.major === '软件工程'));
  assert.ok(!after.members.some((m) => m.major === '数学与应用数学'));

  // 空行与超限
  await teams.update(leader.id, post.id, { ...BASE_INPUT, members: [{ intro: '  ' }, { intro: '有效行' }] });
  const cleaned = await teams.detail(post.id, leader.id, 'STUDENT');
  assert.equal(cleaned.memberCount, 1, '全空成员行应被丢弃');
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
