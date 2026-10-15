/**
 * 系统公告编辑回归测试：展示中的公告可直接改文案，且改动同步到消息中心已投递的通知。
 * 运行：pnpm -F @teamup/api test （需要本地 PostgreSQL）
 */
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import test from 'node:test';
import { AnnouncementsService } from '../src/modules/admin/announcements.service';
import { closePrisma, getPrisma, makeUser, migrateTestDatabase, resetDb } from './helpers.js';

migrateTestDatabase();

let svc: AnnouncementsService;
let adminId: string;

test('setup', async () => {
  const prisma = getPrisma();
  svc = new AnnouncementsService(prisma);
  await resetDb(prisma);
  adminId = (await makeUser(prisma, { role: 'ADMIN' })).id;
});

test('update：展示中的公告可改标题与正文，上下线状态不变', async () => {
  const prisma = getPrisma();
  const ann = await svc.create(adminId, { title: '旧标题', content: '## 旧正文' });
  assert.equal((await svc.active())?.title, '旧标题', '新建即生效');

  const updated = await svc.update(ann.id, { title: '新标题', content: '## 新正文' });
  assert.equal(updated.title, '新标题');
  assert.equal(updated.active, true, '编辑不应改变展示状态');

  const active = await svc.active();
  assert.equal(active?.id, ann.id);
  assert.equal(active?.title, '新标题');
  assert.equal(active?.content, '## 新正文');
});

test('update：已投递到消息中心的通知同步更新，announcementId 锚点保留', async () => {
  const prisma = getPrisma();
  const ann = await svc.create(adminId, { title: '投递公告', content: '初版' });
  await svc.update(ann.id, { title: '投递公告（改）', content: '**终版**' });

  const notif = await prisma.notification.findFirst({
    where: { kind: 'SYSTEM_NOTIFICATION', userId: adminId },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(notif, '发布时应向用户投递系统通知');
  const payload = notif!.payload as Record<string, string>;
  assert.equal(payload.title, '投递公告（改）');
  assert.equal(payload.content, '**终版**');
  assert.equal(payload.announcementId, ann.id, '合并更新不能丢掉 announcementId 锚点');
});

test('update：公告不存在时报 404（不静默成功）', async () => {
  await assert.rejects(svc.update('no-such-id', { title: 'a', content: 'b' }), /公告不存在/);
});

test('teardown', async () => {
  await closePrisma();
});
