# 《UESTC TeamUp 审计报告》复核报告

> **复核日期**：2026-09-24
> **复核对象**：`docs/AUDIT_REPORT.md`（2026-09-24 版，共 61 个问题：6 Critical / 13 High / 19 Medium / 23 Low）
> **复核方法**：逐条打开被引用的源文件核对行号与代码逻辑；关键结论用 `npx tsc --noEmit`、迁移目录 grep、pnpm-lock.yaml 解析版本核对做实证。共核对 40+ 个源文件、9 个迁移、部署配置与 lockfile。

---

## 第一部分：复核结论概览

| 统计项 | 数量 | 明细 |
|---|---|---|
| 复核条目总数 | **61** | S1–S6, H1–H13, M1–M19, L1–L23 |
| **完全属实** | **53** | 绝大多数问题真实存在，行号引用基本精确 |
| **部分属实（含幻觉成分）** | **7** | H6、M18、L5、L17、L20、L21、L23 |
| **纯幻觉 / 误报** | **1** | L22 |
| 严重性**偏高** | **10** | S3、H6、H8、H9、H10、H12、H13、M16、M17、M19 |
| 严重性**偏低** | **0** | — |
| 严重性准确 | 51 | — |

**总体评价**：这份审计报告质量**相当高**——无一条 Critical 是幻觉，全部 6 个严重问题均经实证成立（S1 在本机复现了完全一致的 TS2339 编译错误）；行号、代码引用精确率约 95%。主要缺陷是：

1. 部分前端功能性 bug 被拔高到 High；
2. 7 条存在"一半真一半假"的复合论断（典型如把已存在的索引说成缺失、把已被 whitelist/类型守卫兜住的风险说成崩溃点）；
3. L22 未核对 lockfile 就下结论（实际已锁定修复版）。

---

## 第二部分：逐条复核详情

### 一、Critical（6 条）

#### S1. 后端引用不存在的 `user.contact` → 编译失败

- **复核结果**：✅ **真实存在**（已实证）
- **严重性评估**：**准确**
- **复核理由**：在 `apps/api` 下实际运行 `npx tsc --noEmit`，输出与报告**逐字一致**：

  ```
  src/modules/users/users.service.ts(108,21): error TS2339: Property 'contact' does not exist on type ...
  ```

  `schema.prisma` 全文 grep `contact` 零命中（User 模型 L135-164 确无该字段）；迁移 `20260920030000_team_contact_qq_wechat/migration.sql` 第 2-4 行证实 `contact` 历史上属于 Team 表并已拆为 qq/wechat；`test/teams.spec.ts` 的 `BASE_INPUT` 仍在用 `contact: 'QQ 10086'`（测试也必挂）。构建阻断，Critical 无争议。

#### S2. `Secure` Cookie + nginx 仅监听 80 → 生产登录瘫痪

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：`session.service.ts:77` `secure: process.env.NODE_ENV === 'production'`；`docker-compose.yml:44` 固定注入 `NODE_ENV: production`；`nginx.conf:2` 仅 `listen 80`，全文件无 443/TLS。三个前提全部成立，HTTP 下浏览器拒收 Secure Cookie，登录必然瘫痪。nginx L20 确实传了 `X-Forwarded-Proto` 而后端从未读取。

#### S3. 验证码用 `Math.random()` 生成

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（Critical → 建议 High，修复仍属必改）
- **复核理由**：`auth.service.ts:73` 确为 `Math.floor(100000 + Math.random() * 900000)`。但报告的"账号接管级"论证夸大了可利用性：

  1. xorshift128+ 状态恢复需要**观测到若干连续输出**，而验证码只进邮件（生产）或 dev 响应，攻击者拿不到观测样本；
  2. 盲爆路径被 `consumeCode`（L88-101）封死：错 5 次码即作废，每邮箱每日仅 5 次发码 + 60s 冷却，日均猜测上限 ~25 次 / 90 万空间，期望命中时间以百年计。

  真正的接管风险来自 **S4（码进日志）** 而非 S3 本身。换 `crypto.randomInt` 是必须的（CSPRNG 是底线要求），但独立定级 High 更客观。

#### S4. 生产默认 console 邮件通道：验证码进日志 + SMTP 是抛异常空桩

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：`docker-compose.yml:48` `MAIL_PROVIDER: ${MAIL_PROVIDER:-console}`；`console-dev.provider.ts` 第三个 `logger.log` 打印 `msg.text`（含验证码全文）；`qq-smtp.provider.ts` `send()` 直接 `throw new Error('邮件发送未接入...')`。`auth.service.ts:73-82` 确认先写 Redis 码、先占冷却锁与配额，`mail.send` 抛错后无任何回滚（第 4 点子项也属实）。生产形态下验证码登录事实不可用 + 日志即后门，Critical 成立。

#### S5. 管理后台竞赛编辑 levels/tags 对象数组回传 → 保存必失败

- **复核结果**：✅ **真实存在**（失败机制与报告描述略有出入）
- **严重性评估**：**准确**
- **复核理由**：后端 `admin.service.ts:215-220` `adminDetail` 确为 `include: { levels: true, tags: true, timelines: true }` 原样返回 Prisma 行（对象数组）；前端 `AdminCompetitionEdit.vue:41-51` `form.value = { ...c, tags: c.tags ?? [], levels: c.levels ?? [] }` 原样接收。一个细节修正：**若竞赛已有 tags，前端会先崩**——`save()` L78 `tags.filter((t) => t.trim())` 对对象调用 `.trim()` 抛 TypeError，请求根本发不出去（被 catch 显示"保存失败"）；只有 levels 非空而 tags 为空时才走到后端 `createMany` 收对象 → `PrismaClientValidationError` 500。两条路径殊途同归："编辑任何已有级别/标签的竞赛必失败"结论成立，UI 显示 `[object Object]` 也成立（`el-select multiple` 绑定对象数组）。对照 `competitions.service.ts:166-167` 公开接口确实做了 `.map(l=>l.level)` 字符串化，证实 detail 是遗漏。

#### S6. seed 内置弱口令管理员 + 先清空全库

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**（附条件：需生产执行过 seed）
- **复核理由**：`seed.ts:327-330` 注释原文"管理员（可用密码 123456789 登录…）"+ `password: '123456789'` + `role: 'ADMIN'`；`seed.ts:399-418` `$transaction` 内 17 个 `deleteMany()` 清空全库；`main()` 全程无 `NODE_ENV` 检查。`prisma migrate reset` 自动触发 seed 钩子的说法符合 Prisma 默认行为。凭据公开在仓库 + 无爆破防护（H3 属实）放大风险，Critical 定级可接受。

### 二、High（13 条）

#### H1. 学号+联系方式全量公开，与 README「半匿名」矛盾

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：三方矛盾全部实证：① `viewer.context.ts:53-55` 注释"站内信息全部公开…不再做半匿名裁剪"，`serialize()` L70-71 无条件输出 `studentNo`、`contact`；② `teams.service.ts:40-49` `SAFE_USER_SELECT` 注释声称"按可见规则决定是否输出"，实际含 `studentNo: true` 且序列化器无任何裁剪，L170-172 注释"广告牌模式：联系方式直接公开"；③ **README.md 第 54 行原文**："陌生人只见昵称/学院/年级/专业/技能；同队成员与管理员解锁学号与联系方式"。`docs/OPEN_QUESTIONS.md` Q8 确实讨论过此问题。`GET /teams` 每页可拿学号，逐个 `GET /teams/:id` 可拿 QQ/微信，任意注册用户可批量收割。需要指出：schema 注释和代码显示"广告牌模式"可能是**有意的产品变更**（报告也承认需产品拍板），但代码-注释-文档三方互相矛盾是客观事实，High 合理。

#### H2. XFF 取首段 → 限流可伪造绕过

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：`auth.controller.ts:56-60` `xff.split(',')[0].trim()`；`nginx.conf:19` `$proxy_add_x_forwarded_for`（追加模式，客户端伪造值排最前）；`main.ts` 全文无 `trust proxy`。报告的"反向陷阱"分析（直接改 `req.ip` 会拿到 nginx 容器 IP）也正确——`main.ts` 未设 trust proxy 时 Express `req.ip` 取 socket 地址。

#### H3. 密码登录无爆破防护

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：`auth.service.ts:133-141` 仅统一报错，无失败计数、无锁定；全仓 grep `throttler` 零命中（独立复核确认）；对照验证码路径有 `MAX_FAILS=5` 作废机制，密码路径确实裸奔。配合 S6 弱口令与可枚举学号邮箱，High 成立。

#### H4. pg_trgm 从未在迁移中创建 → 搜索必 500

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：对 `prisma/migrations/` 全部 9 个迁移目录 grep `trgm|EXTENSION`，**零命中**；`search.service.ts:19-24` 确用 `similarity(name, $1)` 与 `%` 操作符，二者均由 pg_trgm 提供。全新部署 `GET /api/search`（`@Public`）必抛 `function similarity does not exist`。注释 L6 还自称"ILIKE 粗筛 + pg_trgm"，与实际 `contains`（大小写敏感 LIKE）也不符（见 L2）。

#### H5. 重置/修改密码不吊销会话

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：`auth.service.ts` `setPassword`（L147-164）与 `resetPassword`（L167-182）均只 update passwordHash 后 return，无 `destroyByUserId` 调用；对照 `users.service.ts:178` 封禁流程有调用，证明基础设施存在、此处是遗漏。会话 TTL 168h 属实（`session.service.ts:23`）。

#### H6. 验证码冷却可定向 DoS + 注册枚举

- **复核结果**：⚠️ **部分属实**（第 1 点真，第 2 点幻觉）
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：
  - **DoS 属实**：`auth.service.ts:57-59` 冷却锁按邮箱 `SET NX EX 60`，攻击者每 60s 替受害者发一次码即可让受害者自己的请求永远撞"发送太频繁"；且每次发码会**覆写** Redis 中旧码（L74），受害者手里已收到的码也作废。
  - **枚举论断是幻觉**：报告称"报错文案区分『该邮箱今日发送次数已达上限』，配合 5 次发送可探测邮箱是否已注册"。核对 L63-64：配额计数 key 是 `verify:quota:${email}:${day}`，**与注册状态完全无关**——已注册和未注册邮箱得到一模一样的报错序列。该文案区分的是"冷却中"vs"超配额"，不泄露注册与否。发码响应本身也一致（controller L90-91 注释与实现相符）。误判原因：把"限流状态差异"错读成"注册状态差异"。

#### H7. ProfileView 读错 `hasPassword` 路径 → 改密死锁

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：前端 `ProfileView.vue:37-38` `api.get<{ hasPassword?: boolean }>('/auth/me')` 后 `!!me2?.hasPassword`；后端 `auth.controller.ts:151-157` 实际返回 `{ user: { ...hasPassword } }`——顶层无 `hasPassword`，恒 false。已设密码用户 UI 不渲染"当前密码"输入框（L184 `v-if="hasPassword"`），提交时 `oldPassword: undefined`（L92）→ 后端 L155 抛"请输入当前密码"。对照组 `LoginView.vue:153` 用 `auth.user.hasPassword`（store L29-30 正确解析 `res.user`）确实是对的。唯一缓和因素是"忘记密码"重置通道可绕行，但该通道依赖邮件——在生产即 S4 瘫痪状态下 High 完全成立。

#### H8. 未读筛选在分页后客户端过滤

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：`NotificationsView.vue:19-24` 逐字符核实：请求不带 filter 参数，`items.value = ... res.items.filter((i) => !i.readAt)` 只滤当前页；`total.value = res.total` 仍是全量；后端 `notification.controller.ts` list 也确无未读筛选参数；切 filter 时 `page` 不重置（radio-group `@change="load"`）。功能错误确凿，但影响面限于消息中心一个筛选器，属典型 Medium 级前端功能缺陷。

#### H9. 每按键触发请求 + 无竞态防护

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：`CompetitionListView.vue:171` `v-model="filters.q"` 绑定搜索框，L52-56 `watch(filters,...)` 对 reactive 对象默认深度监听 → 每字符一次 `load()`；L182 排序 `@change="load"` 与 watch 重复触发；L69-72 route.query watcher 手动 `load()`；`load()` L39-50 仅 try/finally 无 catch；全前端 grep `AbortController` **零命中**（独立确认）。全部属实，但这是性能/体验问题而非正确性破坏（数据最终一致），Medium 更匹配。

#### H10. 系统性未处理 Promise 拒绝（15+ 处）

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：逐一核实报告点名的模式全部成立：`TeamDetailView.vue:70` / `AdminCompetitionsView.vue:44` / `AdminAnnouncementsView.vue:50` / `AdminRevisionsView.vue:37` / `AdminReportsView.vue:46` 的 `await ElMessageBox.confirm` 均无外层 catch（取消即 unhandled rejection）；`AdminUsersView.setRole`（L58-63）、`AdminCorrectionsView.review`（L44-48）、`AdminAnnouncementsView.toggle`（L43-47）的 API 调用完全无 try/catch。一处细节修正：setRole 失败后 `el-select` 因绑定 `:model-value="row.role"` 且未调 `load()`，显示值不会真正"以为已成功"地保留——但无错误提示属实。属健壮性缺陷集合，Medium 更妥。

#### H11. 角色下拉误触即改 + 无自我降级保护 + 无最后管理员兜底

- **复核结果**：✅ **真实存在**
- **严重性评估**：**准确**
- **复核理由**：前端 `AdminUsersView.vue:90` `@change="(v) => setRole(row, v)"` 直连 API，无确认弹窗、无 self 排除（对照封禁有 `ElMessageBox`）；后端 `users.service.ts:183-186` `setRole` 直接 update，无任何保护，对照 `ban()` L166-169 有"不能封禁自己/管理员"双重保护；DTO L45-48 仅 `@IsString()`，传 `"SUPERUSER"` 会穿透到 Prisma 枚举报错 500。系统无其他产生 ADMIN 的途径（seed 在生产不可跑），"后台永久锁死"推论成立。

#### H12. 留言回复通知硬编码跳竞赛页 → 404

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：后端 `comments.service.ts:43-47` payload 确含 `targetType`（可为 TEAM）；前端 `NotificationsView.vue:64-65` `COMMENT_REPLY` 一律 `link: /competitions/${p.targetId}`——TEAM 评论的 targetId 是队伍 id，跳竞赛详情必 404（`/competitions/:id` 查无此竞赛 → catch 弹回列表）。死分支也属实：`packages/shared/src/index.ts` L90-95 枚举仅有 DDL_REMINDER / COMMENT_REPLY / CRAWL_ANOMALY / SOURCE_FAILING / CORRECTION_NEW，`APPLICATION_*`/`INVITATION_*`（L52-61）确已不存在。真实但影响是单类通知跳转错误，Medium 级。

#### H13. 游客访问 `/u/:id` → 401 未处理 + 整页空白

- **复核结果**：✅ **真实存在**
- **严重性评估**：⚠️ **偏高**（High → Medium 更妥）
- **复核理由**：后端 `users.controller.ts:82-85` `@Get(':id')` 无 `@Public()`，`auth.guard.ts:39` 默认拒绝抛 401；前端 `router/index.ts:28` `/u/:id` 无 `meta.auth`；`UserCardView.vue:28-39` onMounted 是 **try/finally 无 catch**（异常穿透为 unhandled rejection），模板 `v-else-if="user"` 无 `v-else` 分支 → 空白页。与序列化器"全部公开"注释自相矛盾也属实。注：`user.skills.length` 无兜底一点不成立（serializer 恒返回数组），但主结论成立。

### 三、Medium（19 条）

| # | 复核结果 | 严重性 | 复核理由（证据摘要） |
|---|---|---|---|
| **M1** officialUrl 可注入 `javascript:` | ✅ 真实 | **准确** | `corrections.service.ts:9` 白名单含 officialUrl 无 scheme 校验；`admin.service.ts:288-291` 采纳时 `{ [head]: report.proposedValue }` 直写；`CompetitionDetailView.vue:166` `:href="comp.officialUrl"`（Vue 不消毒 href），L153 sourceUrl、L298 m.url 同模式。需管理员采纳为前置条件，Medium 恰当 |
| **M2** 用户可无审核建 PUBLISHED 竞赛 | ✅ 真实 | **准确** | `teams.service.ts:399-408`：`slice(0,120)` 后 `findFirst→create({status:'PUBLISHED'})`；schema `Competition.name` 无 `@unique`（L180 核对），并发重复建档成立 |
| **M3** DEADLINE 排序分页契约破坏 | ✅ 真实 | **准确** | `competitions.service.ts:107` `take: pageSize*4` + L113-117 内存 filter/sort/slice；`total` 为全量 count（L109）。跨页错乱、页码失效推论正确 |
| **M4** Redis allkeys-lru 逐出会话/限流 | ✅ 真实 | **准确** | `docker-compose.yml:26` 原文一致；session/验证码/限流/锁确实同库（redis.service 单实例）。allkeys-lru 无差别逐出成立 |
| **M5** 三处 check-then-act 竞态 | ✅ 真实 | **准确** | `favorites.service.ts:11-20` findUnique→create 无 upsert/无 P2002 catch；`comments.service.ts:101-121` 事务内先读后写（默认 ReadCommitted 下两个并发事务均可通过读检查，第二个撞 `userId_commentId` 唯一键 → 500）；`teams.service.ts:208-216` count/dup 检查在 `team.create` 事务之外 |
| **M6** Cron 时区 + N+1 + 无防重入 | ✅ 真实 | **准确** | `jobs.service.ts:19` `@Cron('0 5 8 * * *')` 无 timeZone；Dockerfile.api 与 compose grep `TZ` **零命中**（独立确认）→ 容器 UTC，实际北京时间 16:05 触发；L25-58 三重循环逐条查询 + JSON path dup 检查；未过滤 PUBLISHED；无分布式锁 |
| **M7** 401 无全局处理，假登录 | ✅ 真实 | **准确** | `client.ts:27-29` 对 401 无钩子；`stores/auth.ts` user 仅主动清；`AppNav.vue:40-42` 轮询 catch 静默吞掉 |
| **M8** 登出失败无法登出 | ✅ 真实 | **准确** | `stores/auth.ts:43-46` `await api.post` 后才清 user；`AppNav.vue:47-50` doLogout 无 catch。断网点退出确实无反应 + unhandled rejection |
| **M9** 时区 bug + daysLeft 口径 | ✅ 真实 | **准确** | `HomeView.vue:28-38` `new Date("YYYY-MM-DD")` 按 UTC 解析（末日 08:00 后节点被滤掉，推演成立）；`types.ts:161-164` Math.ceil 毫秒差；`CompetitionDetailView.vue:134` `daysLeft(...)! > 0 ? ... : '今日截止'` 把负数（已过期）显示为"今日截止"；后端 date-only UTC 解析实质成立（实际转换点在 `teams.controller.ts:109`，报告写 `teams.service.ts:109` 系**引用行号小误**，不影响结论） |
| **M10** PATCH 无法清空字段 | ✅ 真实 | **准确** | `TeamDetailView.vue:145-148` `\|\| undefined`；后端 `teams.service.ts:250-255` 以 `!== undefined` 判定是否更新 → 字段缺失即不更新，永远删不掉 qq/wechat/deadline |
| **M11** skills 缺嵌套校验 → 500 | ✅ 真实 | **准确** | `users.controller.ts:34-36` 仅 `@IsArray()`；`users.service.ts:78` `s.skill.trim()` 对 `skills:[123]` 抛 TypeError；重复 skill 撞 `@@id([userId, skill])` P2002。`whitelist:true` 不深入数组元素，无兜底 |
| **M12** 评论删除非事务 + 孤儿数据 + 管理员无法删评论 | ✅ 真实 | **准确** | `comments.service.ts:128-129` 两步无事务；`reports.service.ts:110-111` 同样两步无事务；`comments.service.ts:127` 仅 `authorId !== userId` 判权，无 ADMIN 分支；Comment 多态无 FK（schema 注释自认），`deleteTeam` 硬删后 TEAM 评论成孤儿 |
| **M13** COOKIE_SECRET 死配置 | ✅ 真实 | **准确** | `docker-compose.yml:47` `${COOKIE_SECRET:?}` 强制；`main.ts:13` `cookieParser()` 无参；全仓无其他引用。"误导性配置而非直接漏洞"的定性也客观 |
| **M14** 无 helmet / 无安全头 / 无全局限流 | ✅ 真实 | **准确** | `main.ts:9-26` 无 helmet；`nginx.conf` 全文唯一 `add_header` 是 Cache-Control；评论 create（`radar.controller.ts:141-144`）无任何频率限制 |
| **M15** 管理员 isLeader=true 但写操作 403 | ✅ 真实 | **准确** | `teams.service.ts:161` `\|\| viewerRole === 'ADMIN'`；`mustOwn` L457 仅认 `leaderId`；`TeamDetailView.vue:219-229` 按 `viewer.isLeader` 渲染编辑/解散按钮 → 管理员点击必 403 |
| **M16** /auth/me skills 恒为空 | ✅ 真实 | ⚠️ **偏高**（→ Low） | 链路核实：`session.service.ts:39` findUnique 不 include skills → `auth.controller.ts:153` 展开的 user 无 skills → `viewer.context.ts:69` `(user.skills ?? [])` 恒 `[]`。属实，但当前无任何前端功能消费 `auth.user.skills`（ProfileView 用 `/users/me`），是潜伏契约谎言而非现行故障，Low 更妥 |
| **M17** dev 验证码回显前端拿不到 | ✅ 真实 | ⚠️ **偏高**（→ Low） | `transform.interceptor.ts:11-13` dev 提升到信封顶层；`client.ts:30` 只 `return body.data` 丢弃 dev；`LoginView.vue:86` `fpDevCode` 声明后零引用。全部属实，但仅影响开发联调体验，Low 级 |
| **M18** 收藏/名片空指针崩溃 | ⚠️ **部分属实** | ⚠️ **偏高** | **UserCardView 部分属实**：onMounted try/finally 无 catch、无 `v-else` 错误态 → 接口失败整页空白（L28-39、45 核实）。**MyFavoritesView 崩溃论断是幻觉**：模板 L58/L64 有 `f.competition` / `f.team` 真值守卫，为 null 时走 L70 "已失效的收藏"分支；且 `competition` 是 Team 的必需关系（FK 保证非空，竞赛只 archive 不硬删），`f.team.competition.name` 无崩溃路径。`unfavByIndex` 无 catch 属实（小问题）。误判原因：只看类型声明未看模板守卫 |
| **M19** 登录页计时器不清理 | ✅ 真实 | ⚠️ **偏高**（→ Low） | `LoginView.vue:24-34、105-115` 两个 setInterval 仅归零自清，全文件无 `onUnmounted`。属实，但 60s 自然过期、无累积泄漏（每次进页面新组件新 timer），实际影响仅 HMR 场景，Low 级 |

### 四、Low（23 条）

| # | 复核结果 | 复核理由（证据摘要） |
|---|---|---|
| **L1** calendar 参数穿透 500 | ✅ 真实 | `radar.controller.ts:47-51` start/end 仅 `@IsString`，levels 无 `@IsEnum`；`calendar.service.ts:11-12` `new Date(garbage)` → Invalid Date 进 Prisma where → 500 |
| **L2** contains 大小写敏感 | ✅ 真实 | `competitions.service.ts:66`、`search.service.ts:28`、`users.service.ts:135-137` 均无 `mode:'insensitive'`；`search.service.ts:6` 注释自称 ILIKE，与实现不符 |
| **L3** 分钟 key 缺日位 + 冷却先于配额 | ✅ 真实 | `auth.service.ts:69` `${month6(day)}${currentMinute()}` = YYYYMMHHMM 确缺 DD（L196-198 核实）；L57-64 冷却锁在配额检查之前，配额被拒也占 60s 冷却 |
| **L4** DRAFT 详情可读 | ✅ 真实 | `competitions.service.ts:135` 仅 `status === 'ARCHIVED'` 抛 404，`@Public` 路由下 DRAFT id 可全量读取 |
| **L5** archive/deleteTeam P2025 | ⚠️ **部分属实** | `archiveCompetition`（L174-177）直接 update 无判空 → P2025 500 **属实**；但 `deleteTeam`（L180-185）**有** `findUnique` + `NotFoundException('组队帖不存在')` 前置检查——该半句是幻觉（忽略了紧邻的判空代码）。同类问题另见补充发现① |
| **L6** action 仅 IsString + kind 语义复用 | ✅ 真实 | `admin.controller.ts:54-57` `@IsString() action`；L200 `dto.action === 'accept'` 任意值当 reject；`admin.service.ts:312` 采纳通知复用 `CORRECTION_NEW` |
| **L7** scryptSync 阻塞 | ✅ 真实 | `password.ts:11,19` 两处 `scryptSync` |
| **L8** destroyByUserId SCAN + 裸 JSON.parse | ✅ 真实 | `session.service.ts:50-57`，L55 `JSON.parse(raw)` 无 try/catch（对照 `resolve` L37-44 有），脏数据令封禁 500 成立 |
| **L9** 评论 take:50 / 回复无上限 over-fetch | ✅ 真实 | `comments.service.ts:55-67` 根评论 `take:50` 无翻页；回复无 take 且 `include: { author: true }` 全字段（含 passwordHash），靠 `stripAuthor` 输出兜底 |
| **L10** 公告/举报无事务、createMany 不分块 | ✅ 真实 | `announcements.service.ts:23-37` 三步独立；全员单条 createMany；`reports.service.ts:105-117` 删除+标记无事务 |
| **L11** ICS esc 漏 `\r` | ✅ 真实 | `calendar.service.ts:62` 正则 `/([,;\\])/g` + `\n`，确无 `\r`；行以 `\r\n` join，CR 注入成立 |
| **L12** compose 缺 WEB_ORIGIN | ✅ 真实 | `docker-compose.yml:43-52` 无该变量；`main.ts:20` 回退 `http://localhost:5173` |
| **L13** v-html 无 DOMPurify | ✅ 真实 | `MarkdownView.vue:6` `{ html: false, linkify: true }` + L13 `v-html`。当前配置安全、属纵深防御建议，定性客观 |
| **L14** 纠错无频控 + 通知全体管理员 | ✅ 真实 | `corrections.service.ts` 全文无频率/去重检查；L60-65 每条通知所有 ADMIN；评论 create 同样零限流 |
| **L15** AppNav 轮询不清理 | ✅ 真实 | `AppNav.vue:45` `setInterval(refreshUnread, 30_000)` 返回值丢弃，永不清理 |
| **L16** 回复无锁 + 删除无确认 | ✅ 真实 | `CommentList.vue` `post()` 有 submitting 锁而 `reply()`（L60-76）没有；`remove()`（L100-107）直接 `api.delete` 无 ElMessageBox |
| **L17** index 作 key + 多余字段回传 | ✅ 真实（影响被 whitelist 缓解） | 四处 `:key="i"` 核实（TeamNewView:213、TeamDetailView:335、ProfileView:157、AdminCompetitionEdit:236）；`{...c}` 展开确把 id/createdAt 回传，但后端 `ValidationPipe({whitelist:true})` 会剥离未声明属性，实际无害——报告未提这一点，作为代码坏味道列 Low 可接受 |
| **L18** levels 数组形式 `.split` 崩溃 | ✅ 真实 | `CompetitionListView.vue:16,67` `(route.query.levels as string)?.split(',')`——数组无 `.split`，`?.` 只防 nullish 不防类型 |
| **L19** redirect 未校验 | ✅ 真实 | `LoginView.vue:162-163`；catch-all 路由（router L45）确实使开放重定向难利用，Low 定级自己已说明 |
| **L20** qs 布尔/非 JSON/无超时 | ⚠️ **部分属实** | "非 JSON 当错误抛"（client.ts:27-28 body 为 null 即 throw）与"无超时"**属实**；但 `bonusOnly=false` 序列化为 `"false"` **无实际风险**——`query.transform.ts` `TransformBoolean` 明确 `value === 'true' \|\| value === '1'`，`"false"` 正确解析为 false。该半句属契约臆测 |
| **L21** CompetitionDetail 类型谎言 | ✅ 基本属实（一处小误） | `types.ts:37` extends ListItem；后端 detail（`competitions.service.ts:164-169` + radar.controller）确不返回 `nextDeadline`，`recruitingTeams` 实为数组，`recruitingTeamsList?` 全仓无赋值。小误：`status` **实际会返回**（`...row` 展开含 Prisma 原始 status 字段），报告将其列入"不返回"不准确。核心结论成立 |
| **L22** vite/markdown-it 版本风险 | ❌ **幻觉（过时/未核对）** | 报告自己要求"核对 lockfile 实际解析版本"，复核核对结果：**pnpm-lock.yaml 锁定 vite 5.4.21**（5.4 线最新补丁位，已含 5.4.12+ 的 dev-server CVE 修复）、**markdown-it 15.0.2 真实存在且已锁定**。`^5.4.11` 是 semver 范围而非固定版本。误判原因：只看 package.json 声明未查 lockfile |
| **L23** 缺索引 | ⚠️ **部分属实** | `Comment.parentId` 无索引 **属实**（`deleteMany({where:{parentId}})` 走顺扫）；`Report(reporterId,targetType,targetId)` 无复合索引 **属实**（仅有 `[handled, createdAt]`）；但"多态评论缺 `(targetType,targetId)` 复合索引"是**幻觉**——schema L475 存在 `@@index([targetType, targetId, createdAt])`，其最左前缀完全覆盖该查询。误判原因：grep 时只匹配了精确字段组合，忽略复合索引前缀规则 |

---

## 第三部分：补充发现（报告遗漏）

复核过程中发现以下报告未覆盖的真实问题：

1. **`announcements.service.ts:51-54` `remove()` 直接 `delete` 无判空** —— 删除不存在的公告 id → P2025 → 500 而非 404。报告 L5 只点名了 `archiveCompetition`，漏掉了同文件同类的这一处（且 L5 中 deleteTeam 的指控反而不成立）。同类：`admin.service.ts:357` `rollback` 的 competition 分支无存在性检查（但竞赛不硬删，风险低；timeline 分支 L347 有判空已挡住）。

2. **未处理 rejection 清单不全**：报告 H10 说"全站 15+ 处"但点名 6 处；复核另核实 `NotificationsView.read()/readAll()`（L31-41）、`ProfileView.onMounted`（L32-39）、`HomeView.onMounted`（L25-43，try/finally 无 catch，首页接口失败即空白无提示）、`MyFavoritesView.unfavByIndex`、`AdminUsersView.load()` 均属同族。其中 **HomeView 首页无错误态** 影响面最大，值得单列。

3. **`auth.service.ts:66` IP 配额 key 混用**：找回密码流程（`RESET_PREFIX`）复用 `verify:quota:ip:` 前缀的 IP 桶，而邮箱桶是分开的（L63 用 `${prefix}quota:`）。两个流程共享 `DAILY_PER_IP=20` 意味着攻击者可用找回接口耗尽某 IP 的登录发码额度（NAT 出口下殃及整栋宿舍楼），与 H2 叠加放大。疑似笔误而非设计。

4. **dev 环境忘记密码接口可枚举邮箱**：`auth.controller.ts:120` `devCode ? '找回验证码已发送' : '若该邮箱已注册，找回验证码已发送'`——dev 下两种文案不同，且 devCode 有无本身即注册信号。仅影响开发环境（生产 devCode 恒 undefined），与登录发码接口的严格一致性（L91）形成对照。

5. **`UserCardView.vue` 引入 `useAuthStore` 却未使用**（L7、L22，`auth` 无任何消费点）——死代码，暗示原本计划按登录态区分展示但未实现，与 H13 的设计摇摆互为佐证。

---

## 结语

这份审计报告**可信度高**：6 个 Critical 全部实证成立（S1 复现了逐字一致的编译错误），53/61 条完全属实，行号引用精确。需要修正的部分：

- **应降级**：S3（缺可利用的观测通道，Critical→High）、H8/H9/H10/H12/H13（前端功能缺陷，High→Medium）、M16/M17/M19（Medium→Low）；
- **应部分撤销**：H6 的"注册枚举"论断、M18 的收藏页崩溃论断、L5 的 deleteTeam 半句、L20 的布尔序列化风险、L23 的 (targetType,targetId) 索引缺失论断；
- **应整条撤销**：L22（lockfile 已锁定 vite 5.4.21 / markdown-it 15.0.2，无所述风险）。

幻觉的共性成因有三类：**忽略相邻的防御代码**（L5 的 findUnique、M18 的模板守卫、L23 的复合索引前缀）、**只看声明不看实际解析/转换层**（L20 的 TransformBoolean、L22 的 lockfile）、**把状态差异错读为敏感信息差异**（H6 的限流文案）。修复路线图（P0→P3）的排序本身经复核依然成立，按 S1→S3→H7 的 P0 顺序执行是合理的。

---

*本复核报告由独立复核流程生成：对原报告全部 61 条逐条打开源码核对，关键结论经 `tsc --noEmit` 编译验证、迁移/配置 grep、lockfile 解析版本核对实证。*
