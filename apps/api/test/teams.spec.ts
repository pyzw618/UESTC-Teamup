import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationStatus, RoleType, SlotStatus, TeamStatus } from '@prisma/client';
import {
  closePrisma,
  getPrisma,
  makeCompetition,
  makeService,
  makeTeam,
  makeUser,
  migrateTestDatabase,
  resetDb,
  seedApplication,
  seedInvitation,
} from './helpers';
import type { TeamsService } from '../src/modules/match/teams.service';
import type { ViewerContext } from '../src/common/auth/viewer.context';

const prisma = getPrisma();
let service: TeamsService;
let viewer: ViewerContext;

function viewerRun<T>(userId: string, role: string, teamIds: string[], fn: () => T): T {
  return viewer.run({ userId, role, teamIds: new Set(teamIds) }, fn);
}

describe('组队模块核心不变量', () => {
  before(() => {
    migrateTestDatabase();
  });
  before(() => {
    const built = makeService(prisma);
    service = built.service;
    viewer = built.viewer;
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  after(async () => {
    await closePrisma();
  });

  // (1) 两个并发 ACCEPT 争抢最后一个 slot：只能一个成功
  it('并发接受申请时，最后一个名额只能被一个人获得', async () => {
    const leader = await makeUser(prisma);
    const u1 = await makeUser(prisma);
    const u2 = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '并发名额竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });

    const app1 = await seedApplication(prisma, team.id, u1.id, RoleType.ALGORITHM);
    const app2 = await seedApplication(prisma, team.id, u2.id, RoleType.ALGORITHM);

    const results = await Promise.allSettled([
      service.reviewApplication(leader.id, app1.id, true),
      service.reviewApplication(leader.id, app2.id, true),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, '必须恰好一个 ACCEPT 成功');

    const filled = await prisma.teamSlot.count({ where: { teamId: team.id, status: SlotStatus.FILLED } });
    const activeMembers = await prisma.teamMember.count({ where: { teamId: team.id, active: true } });
    assert.equal(filled, 1, '只有一个 slot 被占用');
    assert.equal(activeMembers, 2, '队长 + 1 名新成员');

    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.FULL);
  });

  // (2) 同一个 (teamId, userId) 不能重复成为成员（并发接受同一条申请也只成功一次）
  it('同一用户不能重复成为同队伍成员', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '重复成员竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    const app = await seedApplication(prisma, team.id, applicant.id, RoleType.ALGORITHM);

    const results = await Promise.allSettled([
      service.reviewApplication(leader.id, app.id, true),
      service.reviewApplication(leader.id, app.id, true),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);

    const rows = await prisma.teamMember.count({ where: { teamId: team.id, userId: applicant.id, active: true } });
    assert.equal(rows, 1);
  });

  // (3) FULL 队伍不能通过旧的 Invitation 绕过状态加入
  it('FULL 队伍不能通过旧邀请加入', async () => {
    const leader = await makeUser(prisma);
    const first = await makeUser(prisma);
    const invitee = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '满员邀请竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });

    const app = await seedApplication(prisma, team.id, first.id, RoleType.ALGORITHM);
    await service.reviewApplication(leader.id, app.id, true); // 队伍 -> FULL

    // 直接在库中伪造一条“旧邀请”
    const inv = await seedInvitation(prisma, team.id, invitee.id, RoleType.ALGORITHM);
    await assert.rejects(() => service.respondInvitation(invitee.id, inv.id, true), /状态|接受新成员|名额/);

    const stillFull = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(stillFull.status, TeamStatus.FULL);
    const memberCount = await prisma.teamMember.count({ where: { teamId: team.id, active: true } });
    assert.equal(memberCount, 2);
  });

  // (4) DISBANDED / ARCHIVED 队伍不能加入
  it('DISBANDED / ARCHIVED 队伍不能加入', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);

    for (const status of [TeamStatus.DISBANDED, TeamStatus.ARCHIVED]) {
      // 每个状态用独立竞赛，避免“同竞赛一人一队”唯一约束干扰
      const comp = await makeCompetition(prisma, `终止状态竞赛-${status}`);
      const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
      // 先构造申请，再把队伍置为终止状态（避免 DISBAND 流程把申请自动失效）
      const app = await seedApplication(prisma, team.id, applicant.id, RoleType.ALGORITHM);
      await prisma.team.update({ where: { id: team.id }, data: { status } });
      await assert.rejects(() => service.reviewApplication(leader.id, app.id, true), /状态|接受新成员/);
      const active = await prisma.teamMember.count({ where: { teamId: team.id, userId: applicant.id, active: true } });
      assert.equal(active, 0, `${status} 队伍不能新增成员`);
    }
  });

  // (5) 邀请接受与申请接受共用同一套加入不变量
  it('邀请接受与申请接受共用同一加入流程（名额唯一）', async () => {
    const leader = await makeUser(prisma);
    const viaApp = await makeUser(prisma);
    const viaInvite = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '统一加入竞赛');
    // 两个名额但方向不同：ALGORITHM 只有一个名额，PAPER 保持空缺
    const team = await makeTeam(prisma, {
      competitionId: comp.id,
      leaderId: leader.id,
      slots: [RoleType.ALGORITHM, RoleType.PAPER],
    });

    const app = await seedApplication(prisma, team.id, viaApp.id, RoleType.ALGORITHM);
    const inv = await seedInvitation(prisma, team.id, viaInvite.id, RoleType.ALGORITHM);

    // 申请先兑现，占满唯一的 ALGORITHM 名额（队伍仍有 PAPER 空缺，不会 FULL）
    await service.reviewApplication(leader.id, app.id, true);
    // 邀请走的是同一个 joinTeam + 同一个 claimSlot，理应因无 ALGORITHM 名额失败
    await assert.rejects(() => service.respondInvitation(viaInvite.id, inv.id, true), /名额/);

    const filled = await prisma.teamSlot.count({ where: { teamId: team.id, status: SlotStatus.FILLED } });
    assert.equal(filled, 1);
    const invRow = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(invRow.status, ApplicationStatus.PENDING, '失败的邀请仍保持 PENDING，等待队长/队伍恢复');
  });

  it('两个名额时，申请与邀请都能通过同一流程成功加入', async () => {
    const leader = await makeUser(prisma);
    const viaApp = await makeUser(prisma);
    const viaInvite = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '双名额竞赛');
    const team = await makeTeam(prisma, {
      competitionId: comp.id,
      leaderId: leader.id,
      slots: [RoleType.ALGORITHM, RoleType.PAPER],
    });
    const app = await seedApplication(prisma, team.id, viaApp.id, RoleType.ALGORITHM);
    const inv = await seedInvitation(prisma, team.id, viaInvite.id, RoleType.PAPER);

    await service.reviewApplication(leader.id, app.id, true);
    await service.respondInvitation(viaInvite.id, inv.id, true);

    const members = await prisma.teamMember.findMany({ where: { teamId: team.id, active: true } });
    assert.equal(members.length, 3);
    const filledSlots = await prisma.teamSlot.findMany({ where: { teamId: team.id, status: SlotStatus.FILLED } });
    assert.equal(filledSlots.length, 2);
    assert.ok(filledSlots.every((s) => s.filledByMemberId));
    // 两个名额都填满 -> FULL
    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.FULL);
  });

  // (6) desiredRole 没有 OPEN slot 时不能成功加入
  it('desiredRole 没有对应 OPEN 名额时不能加入', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '方向不匹配竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });

    // 申请人期望 PAPER，但队伍只有 ALGORITHM 名额
    const app = await seedApplication(prisma, team.id, applicant.id, RoleType.PAPER);
    await assert.rejects(() => service.reviewApplication(leader.id, app.id, true), /名额/);

    const active = await prisma.teamMember.count({ where: { teamId: team.id, userId: applicant.id, active: true } });
    assert.equal(active, 0);
    const open = await prisma.teamSlot.count({ where: { teamId: team.id, status: SlotStatus.OPEN } });
    assert.equal(open, 1, '失败后名额仍为 OPEN');
  });

  // (7) 最后一个 slot 被占用 -> FULL
  it('填满最后一个名额后队伍进入 FULL', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '自动满员竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.BACKEND] });
    const app = await seedApplication(prisma, team.id, applicant.id, RoleType.BACKEND);
    await service.reviewApplication(leader.id, app.id, true);
    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.FULL);
  });

  // (8)(9) FULL 成员退出 -> PAUSED + slot OPEN，且绝不自动回 RECRUITING
  it('FULL 队伍成员退出后变为 PAUSED，名额回到 OPEN，且不自动恢复招募', async () => {
    const leader = await makeUser(prisma);
    const member = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '退出恢复竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.HARDWARE] });
    const app = await seedApplication(prisma, team.id, member.id, RoleType.HARDWARE);
    await service.reviewApplication(leader.id, app.id, true); // FULL

    await service.leaveTeam(member.id, team.id);

    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.PAUSED, 'FULL -> PAUSED');
    assert.notEqual(fresh.status, TeamStatus.RECRUITING, '绝不自动恢复公开招募');

    const slots = await prisma.teamSlot.findMany({ where: { teamId: team.id } });
    assert.equal(slots.length, 1);
    assert.equal(slots[0].status, SlotStatus.OPEN, '名额恢复 OPEN');
    assert.equal(slots[0].filledByMemberId, null);

    const membership = await prisma.teamMember.findUniqueOrThrow({
      where: { teamId_userId: { teamId: team.id, userId: member.id } },
    });
    assert.equal(membership.active, false, '成员关系软删除，保留历史');
    assert.ok(membership.leftAt);
  });

  it('RECRUITING 队伍成员退出后保持 RECRUITING，名额回到 OPEN', async () => {
    const leader = await makeUser(prisma);
    const member = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '招募中退出竞赛');
    const team = await makeTeam(prisma, {
      competitionId: comp.id,
      leaderId: leader.id,
      slots: [RoleType.ALGORITHM, RoleType.PAPER],
    });
    const app = await seedApplication(prisma, team.id, member.id, RoleType.ALGORITHM);
    await service.reviewApplication(leader.id, app.id, true); // 还剩 1 个 OPEN，仍 RECRUITING

    await service.leaveTeam(member.id, team.id);

    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.RECRUITING);
    const open = await prisma.teamSlot.count({ where: { teamId: team.id, status: SlotStatus.OPEN } });
    assert.equal(open, 2);
  });

  it('队长不能直接退出队伍', async () => {
    const leader = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '队长退出竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    await assert.rejects(() => service.leaveTeam(leader.id, team.id), /队长不能直接退出/);
  });

  // (10) 同一竞赛下两个 Team 并发接受同一个用户：最终只能属于一支
  it('同竞赛两个队伍并发接受同一用户时只能成功一个', async () => {
    const leaderA = await makeUser(prisma);
    const leaderB = await makeUser(prisma);
    const user = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '抢人竞赛');
    const teamA = await makeTeam(prisma, { competitionId: comp.id, leaderId: leaderA.id, slots: [RoleType.ALGORITHM] });
    const teamB = await makeTeam(prisma, { competitionId: comp.id, leaderId: leaderB.id, slots: [RoleType.ALGORITHM] });

    const appA = await seedApplication(prisma, teamA.id, user.id, RoleType.ALGORITHM);
    const appB = await seedApplication(prisma, teamB.id, user.id, RoleType.ALGORITHM);

    const results = await Promise.allSettled([
      service.reviewApplication(leaderA.id, appA.id, true),
      service.reviewApplication(leaderB.id, appB.id, true),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, '只能加入一支队伍');

    const memberships = await prisma.teamMember.findMany({
      where: { userId: user.id, competitionId: comp.id, active: true },
    });
    assert.equal(memberships.length, 1, '同竞赛下最多一个有效成员关系');

    // 失败方名额必须回滚为 OPEN，且没有新成员
    const loserTeamId = memberships[0].teamId === teamA.id ? teamB.id : teamA.id;
    const loserOpen = await prisma.teamSlot.count({ where: { teamId: loserTeamId, status: SlotStatus.OPEN } });
    assert.equal(loserOpen, 1, '失败事务整体回滚，名额未被占用');
    const loserMembers = await prisma.teamMember.count({ where: { teamId: loserTeamId, active: true } });
    assert.equal(loserMembers, 1, '失败队伍只剩队长');
  });

  // (11) API 不向非授权用户泄漏原始 User 敏感字段
  it('队伍详情不泄漏非成员用户的 passwordHash / email / studentNo', async () => {
    const leader = await makeUser(prisma, { passwordHash: 'SECRET_HASH_VALUE', email: 'leader@std.uestc.edu.cn' });
    const member = await makeUser(prisma, { passwordHash: 'MEMBER_SECRET_HASH', email: 'member@std.uestc.edu.cn' });
    const outsider = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '隐私竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    const app = await seedApplication(prisma, team.id, member.id, RoleType.ALGORITHM);
    await service.reviewApplication(leader.id, app.id, true);

    // 陌生人（已登录但非同队）视角
    const detail = await viewerRun(outsider.id, 'STUDENT', [], () => service.detail(team.id, outsider.id, 'STUDENT'));
    const json = JSON.stringify(detail);
    assert.ok(!json.includes('passwordHash'), '不得返回 passwordHash');
    assert.ok(!json.includes('SECRET_HASH_VALUE'));
    assert.ok(!json.includes('MEMBER_SECRET_HASH'));
    assert.ok(!json.includes('leader@std.uestc.edu.cn'), '不得返回 email');
    assert.ok(!json.includes('member@std.uestc.edu.cn'));
    assert.equal(detail.leader.studentNo, undefined, '陌生人看不到学号');
    assert.equal(detail.members.find((m) => m.userId === member.id)?.user?.studentNo, undefined);

    // 同队成员视角：允许解锁学号
    const asMember = await viewerRun(member.id, 'STUDENT', [team.id], () => service.detail(team.id, member.id, 'STUDENT'));
    const memberEntry = asMember.members.find((m) => m.userId === member.id);
    assert.equal(memberEntry?.user?.studentNo, member.studentNo, '同队解锁学号');
    assert.ok(!JSON.stringify(asMember).includes('passwordHash'));
  });

  it('我的申请列表不返回原始 User 对象', async () => {
    const leader = await makeUser(prisma, { passwordHash: 'LEADER_SECRET', email: 'lead2@std.uestc.edu.cn' });
    const applicant = await makeUser(prisma, { passwordHash: 'APPLICANT_SECRET', email: 'app2@std.uestc.edu.cn' });
    const comp = await makeCompetition(prisma, '申请隐私竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    await seedApplication(prisma, team.id, applicant.id, RoleType.ALGORITHM);

    const sent = await viewerRun(applicant.id, 'STUDENT', [], () => service.myApplications(applicant.id));
    const received = await viewerRun(leader.id, 'STUDENT', [team.id], () => service.myApplications(leader.id));
    const json = JSON.stringify({ sent, received });
    assert.ok(!json.includes('passwordHash'));
    assert.ok(!json.includes('LEADER_SECRET'));
    assert.ok(!json.includes('APPLICANT_SECRET'));
    assert.ok(!json.includes('lead2@std.uestc.edu.cn'));
    assert.ok(!json.includes('app2@std.uestc.edu.cn'));
  });

  // (12) 正常比赛生命周期归档为 ARCHIVED，而不是 DISBANDED
  it('比赛生命周期结束后 cron 归档为 ARCHIVED 而非 DISBANDED', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86400_000);

    // 报名截止已过 40 天的 RECRUITING 队伍
    const comp1 = await makeCompetition(prisma, '过期招募竞赛');
    await prisma.competitionTimeline.create({
      data: { competitionId: comp1.id, stage: '报名截止', endAt: daysAgo(40) },
    });
    const recruitingTeam = await makeTeam(prisma, {
      competitionId: comp1.id,
      leaderId: leader.id,
      slots: [RoleType.ALGORITHM],
    });
    await seedApplication(prisma, recruitingTeam.id, applicant.id, RoleType.ALGORITHM);

    // 参赛结束已过 61 天的 COMPETING 队伍
    const comp2 = await makeCompetition(prisma, '结束参赛竞赛');
    await prisma.competitionTimeline.create({
      data: { competitionId: comp2.id, stage: '决赛', endAt: daysAgo(61) },
    });
    const competingTeam = await makeTeam(prisma, {
      competitionId: comp2.id,
      leaderId: leader.id,
      slots: [RoleType.ALGORITHM],
      status: TeamStatus.COMPETING,
    });

    const result = await service.archiveExpired();
    assert.equal(result.archived, 2);

    const t1 = await prisma.team.findUniqueOrThrow({ where: { id: recruitingTeam.id } });
    const t2 = await prisma.team.findUniqueOrThrow({ where: { id: competingTeam.id } });
    assert.equal(t1.status, TeamStatus.ARCHIVED);
    assert.notEqual(t1.status, TeamStatus.DISBANDED);
    assert.ok(t1.archivedAt);
    assert.equal(t2.status, TeamStatus.ARCHIVED);

    // 归档后 pending 申请失效
    const app = await prisma.application.findFirstOrThrow({ where: { teamId: recruitingTeam.id } });
    assert.equal(app.status, ApplicationStatus.EXPIRED);

    // 归档后成员关系软删除，释放“同竞赛一人一队”约束（保留历史行）
    const archivedMember = await prisma.teamMember.findFirstOrThrow({
      where: { teamId: recruitingTeam.id, userId: leader.id },
    });
    assert.equal(archivedMember.active, false);
  });

  // 补充：队长主动解散 -> DISBANDED，且 pending 失效
  it('队长主动解散标记为 DISBANDED 并失效所有 pending 请求', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '主动解散竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    await seedApplication(prisma, team.id, applicant.id, RoleType.ALGORITHM);

    await service.transition(leader.id, team.id, 'DISBAND');
    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.status, TeamStatus.DISBANDED);
    const app = await prisma.application.findFirstOrThrow({ where: { teamId: team.id } });
    assert.equal(app.status, ApplicationStatus.EXPIRED);

    // 成员关系软删除：保留历史行，但不再占用“同竞赛一人一队”约束
    const leaderMembership = await prisma.teamMember.findFirstOrThrow({
      where: { teamId: team.id, userId: leader.id },
    });
    assert.equal(leaderMembership.active, false);
    assert.ok(leaderMembership.leftAt);
  });

  // 补充：PAUSED 可继续处理已有候选人，但不能产生新申请
  it('PAUSED 队伍可继续兑现已有申请，但不接受新申请', async () => {
    const leader = await makeUser(prisma);
    const applicant = await makeUser(prisma);
    const other = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '暂停招募竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    const app = await seedApplication(prisma, team.id, applicant.id, RoleType.ALGORITHM);

    await service.transition(leader.id, team.id, 'PAUSE');

    // 已有申请可以继续接受
    await service.reviewApplication(leader.id, app.id, true);
    const active = await prisma.teamMember.count({ where: { teamId: team.id, active: true } });
    assert.equal(active, 2);

    // 新申请被拒绝
    await assert.rejects(() => service.apply(other.id, team.id, RoleType.ALGORITHM, 'pitch'), /不在招募中|状态/);
  });

  // 补充：队长通过 members 传 userId 直接拉人 -> 拒绝
  it('创建队伍时不允许通过 userId 直接添加平台用户', async () => {
    const leader = await makeUser(prisma);
    const victim = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '非法加人竞赛');
    await assert.rejects(
      () =>
        service.create(leader.id, {
          competitionId: comp.id,
          goal: 'PRIZE' as never,
          slots: [{ role: RoleType.ALGORITHM }],
          members: [{ userId: victim.id } as never],
        }),
      /userId|申请或邀请/,
    );
  });

  // 补充：转让队长只能给本队注册成员
  it('转让队长只能转给本队伍注册成员，且原队长保留成员身份', async () => {
    const leader = await makeUser(prisma);
    const member = await makeUser(prisma);
    const outsider = await makeUser(prisma);
    const comp = await makeCompetition(prisma, '转让队长竞赛');
    const team = await makeTeam(prisma, { competitionId: comp.id, leaderId: leader.id, slots: [RoleType.ALGORITHM] });
    const app = await seedApplication(prisma, team.id, member.id, RoleType.ALGORITHM);
    await service.reviewApplication(leader.id, app.id, true);

    await assert.rejects(() => service.transferLeadership(leader.id, team.id, outsider.id), /注册成员/);
    await service.transferLeadership(leader.id, team.id, member.id);

    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    assert.equal(fresh.leaderId, member.id);
    const leaderMembership = await prisma.teamMember.findFirstOrThrow({
      where: { teamId: team.id, userId: leader.id, active: true },
    });
    assert.ok(leaderMembership, '原队长仍是成员');
  });
});
