/** DDL 提醒回归测试：使用内存替身，无需 PostgreSQL / Redis。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma.service';
import type { RedisService } from '../src/common/redis.service';
import type { NotificationService } from '../src/modules/notification/notification.service';
import type { TeamsService } from '../src/modules/match/teams.service';
import { JobsService } from '../src/jobs/jobs.service';

const event = (id: string, endAt: string) => ({
  id,
  endAt: new Date(endAt),
  competitionId: 'competition-1',
  competition: { name: '测试赛' },
  stage: { name: '校赛' },
});

type StoredNotification = {
  userId: string;
  kind: string;
  payload: { eventId: string };
  createdAt: Date;
};

function makeJob(events: ReturnType<typeof event>[], existing: StoredNotification[] = []) {
  const notifications = [...existing];
  const prisma = {
    competitionEvent: {
      findMany: test.mock.fn(async (query: {
        where: { OR: { endAt: { gte: Date; lt: Date } }[] };
      }) => events.filter((e) => query.where.OR.some(({ endAt }) => e.endAt >= endAt.gte && e.endAt < endAt.lt))),
    },
    favorite: {
      findMany: test.mock.fn(async () => [
        { userId: 'user-1', targetId: 'competition-1' },
        { userId: 'user-2', targetId: 'competition-1' },
        { userId: 'user-1', targetId: 'competition-1' }, // 同批次也要防重
      ]),
    },
    notification: {
      findMany: test.mock.fn(async (query: {
        where: { userId: { in: string[] }; kind: string; createdAt: { gte: Date; lt: Date } };
      }) => notifications.filter((n) =>
        query.where.userId.in.includes(n.userId) && n.kind === query.where.kind &&
        n.createdAt >= query.where.createdAt.gte && n.createdAt < query.where.createdAt.lt)),
    },
  };
  const notify = {
    notifyBatch: test.mock.fn(async (rows: Prisma.NotificationCreateManyInput[]) => {
      notifications.push(...rows.map((row) => ({
        userId: row.userId,
        kind: row.kind,
        payload: row.payload as { eventId: string },
        createdAt: new Date(),
      })));
    }),
  };
  const redis = {
    lock: test.mock.fn(async (_key: string, _ttl: number) => true),
    unlock: test.mock.fn(async (_key: string) => {}),
  };
  const job = new JobsService(
    prisma as unknown as PrismaService,
    notify as unknown as NotificationService,
    {} as TeamsService,
    redis as unknown as RedisService,
  );
  return { job, prisma, notify, redis };
}

const cases = [
  { name: '普通日期', today: '2026-10-13', dates: ['2026-10-20', '2026-10-16', '2026-10-14'], ends: ['2026-10-21', '2026-10-17', '2026-10-15'] },
  { name: '闰年跨月', today: '2028-02-28', dates: ['2028-03-06', '2028-03-02', '2028-02-29'], ends: ['2028-03-07', '2028-03-03', '2028-03-01'] },
  { name: '跨年', today: '2026-12-31', dates: ['2027-01-07', '2027-01-03', '2027-01-01'], ends: ['2027-01-08', '2027-01-04', '2027-01-02'] },
];

for (const { name, today, dates, ends } of cases) {
  test(`DDL 提醒：${name}，7/3/1 天覆盖全天且右端点不包含`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T08:05:00+08:00`) });
    const times = ['00:00:00.000', '08:05:00.000', '12:00:00.000', '23:59:59.999'];
    const events = dates.flatMap((date, i) => times.map((time, j) => event(`${i}-${j}`, `${date}T${time}+08:00`)));
    // 每个目标日期的下一天零点，以及目标日期左边界前 1ms，均不在提醒窗口内。
    const outside = dates.flatMap((date, i) => {
      const start = new Date(`${date}T00:00:00+08:00`).getTime();
      return [event(`before-${i}`, new Date(start - 1).toISOString()),
        event(`after-${i}`, new Date(start + 86400_000).toISOString())];
    });
    const { job, prisma, notify, redis } = makeJob([...events, ...outside]);
    await job.ddlReminders();

    const query = prisma.competitionEvent.findMany.mock.calls[0].arguments[0];
    assert.deepEqual(query.where, {
      nodeType: 'SIGNUP_END',
      competition: { status: 'PUBLISHED' },
      OR: dates.map((date, i) => ({ endAt: {
        gte: new Date(`${date}T00:00:00+08:00`),
        lt: new Date(`${ends[i]}T00:00:00+08:00`),
      } })),
    });
    const rows = notify.notifyBatch.mock.calls[0].arguments[0];
    assert.equal(rows.length, events.length * 2);
    for (const e of events) {
      const matching = rows.filter((r) => (r.payload as { eventId: string }).eventId === e.id);
      assert.deepEqual(matching.map((r) => r.userId), ['user-1', 'user-2']);
      assert.ok(matching.every((r) => (r.payload as { daysLeft: number }).daysLeft === [7, 3, 1][Number(e.id[0])]));
    }
    assert.equal(prisma.competitionEvent.findMany.mock.callCount(), 1);
    assert.equal(prisma.favorite.findMany.mock.callCount(), 1);
    assert.equal(prisma.notification.findMany.mock.callCount(), 1);
    assert.equal(notify.notifyBatch.mock.callCount(), 1);
    assert.deepEqual(redis.lock.mock.calls[0].arguments, ['job:ddl', 3600]);
    assert.deepEqual(redis.unlock.mock.calls[0].arguments, ['job:ddl']);
  });
}

test('DDL 提醒：北京时间当天判重，重复执行不重发且不跨用户/节点判重', async (t) => {
  // 北京时间已进入新的一天，UTC 仍是前一天；晚间重跑保持同一自然日窗口。
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-31T00:05:00+08:00') });
  const existing: StoredNotification[] = [
    { userId: 'user-1', kind: 'DDL_REMINDER', payload: { eventId: 'one' }, createdAt: new Date('2026-12-31T00:00:00+08:00') },
    { userId: 'user-2', kind: 'DDL_REMINDER', payload: { eventId: 'one' }, createdAt: new Date('2026-12-30T23:59:59.999+08:00') },
    { userId: 'user-1', kind: 'DDL_REMINDER', payload: { eventId: 'three' }, createdAt: new Date('2027-01-01T00:00:00+08:00') },
  ];
  const { job, prisma, notify } = makeJob([
    event('one', '2027-01-01T23:59:59+08:00'), event('three', '2027-01-03T12:00:00+08:00'),
  ], existing);
  await job.ddlReminders();
  const keys = notify.notifyBatch.mock.calls[0].arguments[0].map((r) => `${r.userId}:${(r.payload as { eventId: string }).eventId}`);
  assert.deepEqual(keys, ['user-2:one', 'user-1:three', 'user-2:three']);
  t.mock.timers.setTime(new Date('2026-12-31T23:59:59+08:00').getTime());
  await job.ddlReminders();
  assert.deepEqual(notify.notifyBatch.mock.calls[1].arguments[0], []);
  for (const call of prisma.notification.findMany.mock.calls) {
    assert.deepEqual(call.arguments[0].where.createdAt, {
      gte: new Date('2026-12-30T16:00:00Z'), lt: new Date('2026-12-31T16:00:00Z'),
    });
  }
});

test('DDL 提醒：未获得 Redis 锁时不查询、不投递也不释放他人锁', async () => {
  const { job, prisma, notify, redis } = makeJob([]);
  redis.lock.mock.mockImplementation(async () => false);
  await job.ddlReminders();
  assert.equal(prisma.competitionEvent.findMany.mock.callCount(), 0);
  assert.equal(notify.notifyBatch.mock.callCount(), 0);
  assert.equal(redis.unlock.mock.callCount(), 0);
});
