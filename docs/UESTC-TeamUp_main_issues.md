# UESTC TeamUp 当前 `main` 问题清单

> 基准：`main@08e67072c71abb1a80a59093ba89dcbfc7f90fc5`  
> 核对日期：2026-09-27  
> 用途：记录当前主分支存在的产品、数据模型、权限、隐私与维护性问题，作为后续 Issue / V2 重构输入。  
> 注意：本文描述的是**当前 main 的真实问题**，不是 V2 PRD。本文件不要求所有问题都在旧架构上修完；部分问题更适合在 V2 中解决。

---

## 1. 总览

当前 `main` 最大的问题不是某一个单独 bug，而是经历多轮产品方向变化后，出现了明显的**产品模型漂移**：

- 组队模块曾经是“申请 / 审批 / 邀请 / 真实成员关系”；
- 后来改成“广告牌模式”；
- 文档、Issue、代码注释和部分 UI 没有完全同步；
- crawler 又在 2026-09-24 合入，但 README 仍把它描述为未实现；
- 权限和隐私策略也出现“README / 前端 / API 各说各话”的情况。

因此，当前问题可以分成四类：

1. **高优先级安全 / 隐私问题**
2. **直接影响用户体验的业务 bug**
3. **数据模型与生命周期问题**
4. **文档和架构债务**

---

# A. 高优先级：安全 / 隐私 / 权限

## A1. 完整学号通过公开用户卡片暴露

### 现状

当前代码中：

- `GET /users/:id` 使用 `@Public()`，游客可访问；
- `UsersService.publicCard()` 将 `studentNo` 传入 serializer；
- `UserSerializer.serialize()` 无条件返回 `studentNo`；
- `UserCardView.vue` 直接显示完整学号；
- README 里还写有“注册即视为同意公开这些信息”。

### 问题

完整学号并不是公开浏览用户卡片所必需的信息。

校园邮箱本身已经可以用于验证“成电学生”身份；继续对公网暴露完整学号，属于额外的个人信息暴露。

限流只能降低批量抓取速度，不能等同于隐私保护。

### 建议

- 匿名 / 公共 DTO 默认不返回完整学号；
- 校园身份通过“校园邮箱已验证”表达；
- 如果未来确实需要展示学号，应该是明确业务场景下的权限解锁，而不是默认公开；
- 不再使用“注册即同意公开”作为隐私策略替代品。

### 验收标准

- [ ] 游客无法从任何公开接口获取完整学号
- [ ] `PublicUser` 类型和后端 serializer 行为一致
- [ ] 用户卡片不依赖学号证明身份
- [ ] 产品文档明确规定个人信息可见性

---

## A2. `MAIL_PROVIDER=console` 可在生产环境运行，验证码日志等价于登录凭据

### 现状

README 已明确：

- 当前未实装真实 SMTP；
- `MAIL_PROVIDER=console` 时验证码写入服务端日志；
- 生产环境不会因为 console provider 而拒绝启动；
- 能访问日志的人，可以获取任意邮箱验证码。

### 问题

这意味着：

> 生产日志访问权限 ≈ 用户账号登录权限。

如果生产日志进入第三方日志平台、多人共享控制台或服务器权限控制不严，就存在明显账号安全风险。

### 建议

旧版本若继续部署，应至少：

- 生产环境禁止 `MAIL_PROVIDER=console`；
- 或启动时强校验：`NODE_ENV=production` 时必须使用真实邮件 provider；
- 验证码不得进入常规日志系统；
- 为邮件发送失败设计明确 fallback，而不是日志取码。

V2 中直接使用校园邮箱 OTP + 正式 SMTP / 邮件服务，不保留生产 console provider。

### 验收标准

- [ ] `NODE_ENV=production` 时 console provider 无法启动
- [ ] 验证码不写普通业务日志
- [ ] 生产环境存在可测试的真实邮件发送链路

---

## A3. 匿名访问边界不一致，公开名片可能整页失败

### 现状

当前产品的匿名访问规则存在冲突：

- `TeamListView.vue`：游客看到登录门；
- `TeamDetailView.vue`：游客看到登录门；
- `TeamsController` list/detail 没有 `@Public()`，实际 API 需要登录；
- README 却写“游客可浏览竞赛雷达与公开的名片 / 招募信息”。

用户卡片还有更具体的问题：

- `GET /users/:id` 是公开接口；
- `GET /users/:id/teams` 不是公开接口；
- `UserCardView.vue` 用 `Promise.all()` 同时请求两个接口；
- 游客访问时，第二个请求 401 会让整个页面进入“用户不存在或加载失败”。

### 问题

- README、前端 gate、后端 AuthGuard 不一致；
- “公开名片”并不真正稳定可用；
- 401/403 被错误混同成“用户不存在”。

### 建议

先确定唯一规则，再统一：

- 竞赛信息：公开；
- 招募 / 队伍信息：校园账号登录后可见；
- 用户资料：V2 不做公开社交主页；旧版如果保留，则至少不能因为受保护子资源导致整页失败。

### 验收标准

- [ ] 有明确的匿名访问矩阵
- [ ] README / Router / Controller / 前端 gate 完全一致
- [ ] `/u/:id` 不会因一个受保护子请求整页失败
- [ ] 401 / 403 与 404 使用不同错误态

---

# B. 直接影响用户体验的业务问题

## B1. “计划招募人数（含自己）”与 `memberCount` 计算不一致

### 现状

`TeamNewView.vue` 写的是：

> 计划招募人数（含自己）

但当前后端：

- `memberCount = _count.members`
- `TeamMember` 只保存队长手工录入的“已有成员展示信息”
- 队长本人并不在 `TeamMember` 表中

因此：

- 队长 + 1 个已有成员
- `targetSize = 3`

页面可能显示：

> 已有 1 / 计划 3 人

而用户直觉上应该是：

> 已有 2 / 计划 3 人

### 建议

旧广告牌模型中至少统一语义：

- 如果 `targetSize` 包含队长，则 `memberCount = 1 + TeamMember.count`；
- 或把 UI 文案改为“计划额外招募人数”，但这会改变原有含义。

V2 中队长应作为真实 `TeamMember`，从数据模型上彻底消除此类歧义。

### 验收标准

- [ ] `targetSize` 和 `memberCount` 采用同一人数口径
- [ ] 列表、详情、编辑页显示一致

---

## B2. 用户手动创建新竞赛后，招募帖显示“发布成功”但别人可能看不到

### 现状

`TeamsService.resolveCompetition()` 允许用户手动填写一个平台不存在的比赛：

- 自动创建 `Competition(status = DRAFT)`；
- 通知管理员审核；
- 随后继续创建 Team。

但组队列表查询有条件：

```ts
competition: { status: 'PUBLISHED' }
```

因此：

1. 用户手动填新比赛；
2. 系统创建 DRAFT Competition；
3. Team 创建成功；
4. 前端提示“招募帖已上墙”；
5. 实际别人无法在公共组队列表中看到。

### 问题

这是明显的“操作成功但结果不可见”的产品断裂。

### 建议

必须选择一种明确策略：

- 用户提交新比赛后，先进入审核，审核通过前不能创建正式招募；
- 或允许创建，但明确展示“比赛待审核 / 招募暂不可见”；
- 或“我的招募”里展示 pending 状态。

V2 PRD 已确定：新比赛提交进入待审核队列，公开数据只有管理员批准后发布。

### 验收标准

- [ ] 用户不会看到“发布成功”但实际不可发现的假成功状态
- [ ] DRAFT competition 对应的招募帖有明确 pending UX

---

## B3. 过期招募帖仍可能停留在默认“招募中”列表

### 现状

Team 有 `deadline`，列表会计算：

```ts
expired: deadline != null && deadline < now
```

但查询条件不会因为 deadline 已过而排除 RECRUITING Team。

因此队长如果忘记更新状态：

- 招募截止已过；
- Team 仍是 `RECRUITING`；
- 仍会出现在默认列表；
- 只是前端多一个“已截止”标记。

### 问题

对于广告牌模式，陈旧帖子会直接破坏“当前是否还招人”的可信度。

### 建议

至少选择一个策略：

- 默认列表不显示 deadline 已过的 RECRUITING Team；
- 或系统自动转入关闭 / 历史状态；
- 或要求队长确认是否继续招募。

V2 已决定用真实 Team + `OPEN / CLOSED / FINISHED`，该问题应通过状态模型重新解决。

### 验收标准

- [ ] 默认发现流不再出现明显过期招募
- [ ] deadline 与 Team 状态有明确关系

---

## B4. 用户卡片写“正在参与的队伍”，实际查询的是“TA 发布的招募帖”

### 现状

`UserCardView.vue` 标题：

> 正在参与的队伍

但 `UsersService.publicTeams(id)` 的查询是：

```ts
where: {
  leaderId: id,
  status: { in: ['RECRUITING', 'COMPETING'] }
}
```

也就是说返回的其实是：

> 这个用户作为队长发布的招募帖

当前广告牌模型根本没有真实平台成员关系，因此无法知道“他参与了哪些队”。

### 建议

旧版文案应改为：

> TA 发布的招募帖

V2 如果恢复真实成员关系，再考虑展示“参与的队伍”。

### 验收标准

- [ ] UI 文案不暗示数据库中不存在的真实成员关系

---

## B5. `OTHER` 招募方向文档写“可手动输入”，实际 UI 不能自定义

### 现状

字段文档中存在“OTHER 可以手动输入”的描述，但 `TeamNewView.vue` 使用普通 `el-select multiple filterable`，没有 `allow-create`。

因此用户只能选择固定枚举：

- 算法
- 前端
- 后端
- 硬件
- 建模
- UI
- 论文
- 答辩
- 其他

无法为 “OTHER” 自定义名称。

### 建议

当前更合理的产品边界是：

- `neededRoles` 仅作为固定筛选标签；
- 个性化方向写在 `requirement`；
- 删除“OTHER 可手动输入”的文档承诺。

### 验收标准

- [ ] 文档和 UI 对 RoleType 的含义一致

---

# C. 数据模型与生命周期问题

## C1. Team 没有“正常完成 / 历史归档”状态

### 现状

当前四态：

```text
RECRUITING
FULL
COMPETING
DISBANDED
```

其中：

- `COMPETING` 由系统根据比赛时间线自动设置；
- `DISBANDED` 表示队长主动解散，是终态；
- 没有 `FINISHED / ARCHIVED` 之类的正常结束状态。

### 问题

比赛正常结束后：

- Team 可能长期停留在 `COMPETING`；
- 如果队长手动改成 `DISBANDED`，语义又变成“解散”；
- 历史队伍无法自然表示“正常完成”。

### 建议

V2 已决定简化为：

```text
OPEN
CLOSED
FINISHED
```

其中“是否正在比赛”由 `CompetitionEdition` 日期推导，而不是 Team 自己维护 COMPETING 状态。

如果旧版继续维护，也应该补一个正常生命周期终态，而不是用 DISBANDED 代替。

### 验收标准

- [ ] 正常比赛结束与主动解散语义分离
- [ ] 历史 Team 不会永久卡在 COMPETING

---

## C2. Competition 没有“届次”模型，长期运行后年份数据会混在一起

### 现状

当前核心模型：

```prisma
model Competition {
  name String @unique
  timelines CompetitionTimeline[]
  teams Team[]
}
```

没有：

```text
CompetitionEdition
season
year
edition
```

这意味着数据库无法明确表达：

```text
全国大学生数学建模竞赛
  ├─ 2026 届
  ├─ 2027 届
  └─ 2028 届
```

### 问题

随着网站运行跨年，会遇到：

- 每年报名时间不同；
- 每年比赛时间不同；
- 通知文件不同；
- 政策依据可能不同；
- 组队帖属于某一届，而不是永恒的 Competition；
- 历史数据与当前数据容易互相覆盖。

当前 Revision 虽然能保留变更历史，但它不等于领域层面的“届次”。

### 建议

V2 采用：

```text
Competition
    ↓
CompetitionEdition
    ↓
EditionEvent
```

Team、关注、提醒全部关联具体 Edition。

### 验收标准

- [ ] 同一赛事可以存在多个年度 / 届次
- [ ] 每届拥有独立时间事件、通知、政策依据和组队数据

---

## C3. 推免 / 加分信息过于像“平台结论”，缺少政策上下文

### 现状

Competition 直接存在：

```text
isBonusEligible
bonusCategory
bonusPoints
```

README 也重点宣传“只看能加分的比赛”。

### 问题

用户很容易把它理解为：

> “参加这个比赛就一定能获得推免加分。”

但现实中认定通常和：

- 政策年份
- 学院
- 奖项等级
- 适用群体
- 具体文件条款

有关。

### 建议

V2 不把它设计成脱离上下文的单一 boolean，而是重点展示：

- 政策文件名称
- 政策年份
- 来源链接 / 文件
- 适用说明
- 平台摘要

页面文案应表达：

> “根据某年某文件存在认定记录，具体以当年学院 / 学校政策为准。”

### 验收标准

- [ ] 任何“加分”展示都有来源依据
- [ ] 页面不把复杂政策包装成无条件承诺

---

# D. 文档与维护性问题

## D1. README / `docs/` 与真实 main 严重漂移

### 现状

仓库声明：

> `docs/` 是唯一需求来源

但当前至少存在这些冲突：

#### 组队模式

根 README：

- 广告牌模式
- 不做申请 / 邀请 / 审批 / 私聊

`docs/MODULE_MATCH.md`：

- 六状态 Team
- Application
- Invitation
- TeamSlot
- TeamMember
- `joinTeam`
- 双向申请 / 邀请

这些实体已经从当前 schema 中删除或改变语义。

#### 页面流程

`docs/PAGES.md` / `docs/ROADMAP.md` 仍存在：

- “申请加入”
- “队长审批”
- “我的申请”
- “解锁完整信息”

但当前 UI 已是直接公开 QQ / 微信的广告牌。

#### crawler 状态

README / MODULE_CRAWLER 部分描述仍写：

> 未实现 / 🔜 自动采集

但 PR #3 已将 crawler 子系统合入 main。

### 影响

- 新开发者无法判断真实需求；
- AI / 人工开发都会被旧文档误导；
- Review 难以判断改动是否符合产品；
- Issue 与代码方向持续分裂。

### 建议

- 将当前版本 SSOT 单独建立；
- legacy 文档明确加“已废弃”标识；
- 不再让旧方案和当前方案混在同一文档；
- V2 直接使用新的 PRD / Technical Spec 作为唯一事实来源。

### 验收标准

- [ ] README、PAGES、ROADMAP、MODULE_MATCH、MODULE_CRAWLER 描述一致
- [ ] 不再把已删除实体写成当前功能
- [ ] 文档明确对应哪个版本 / 分支

---

## D2. 现有 open issue #2 已被后续广告牌模式推翻

### 当前 Issue

`#2 重构组队模块核心数据模型与状态机（joinTeam 原子事务 + 数据库不变量）`

Issue 内容围绕：

- `Application`
- `Invitation`
- `TeamSlot`
- 六状态 Team
- `joinTeam`
- 一人一队数据库约束

但当前 main 已改成广告牌：

- 无申请
- 无邀请
- 无审批
- TeamMember 只是手工展示信息

### 问题

Issue 仍保持 open，会给维护者造成“这仍然是计划中的正式方向”的错误信号。

### 建议

- 明确关闭为 `not planned / superseded`；
- 如果未来 V2 恢复真实申请成员关系，重新创建一条基于 V2 PRD 的新 Issue，不复用旧 #2 的复杂六状态模型。

### 验收标准

- [ ] #2 不再作为当前 main 的待实现需求存在

---

## D3. 当前技术架构对 MVP 偏重，维护成本明显高于业务复杂度

### 当前组合

```text
Vue 3
+ Vite
+ NestJS
+ Prisma
+ PostgreSQL
+ Redis
+ nginx
+ Docker Compose
+ crawler / revision / anomaly / rollback
+ monorepo shared types
```

每一项单独看都合理，但组合在一起后，对当前校园 MVP 的个人维护成本偏高。

### 典型表现

- 修改一个领域字段需要同步 DTO / shared / Prisma / API / Vue types / docs；
- Redis 同时承担 session / 验证码 / 限流 / 分布式锁；
- crawler 在产品是否真正需要自动采集尚未验证时就进入主干；
- 多套旧产品模型留下大量注释、serializer、viewer context 等历史代码。

### 建议

这条不建议在当前 main 做“小修小补”，而是作为 V2 重构输入：

```text
Next.js
+ TypeScript
+ React
+ Drizzle
+ SQLite
+ Tailwind / shadcn/ui
```

MVP：

- 单体部署
- 无 Redis
- 无 crawler
- 无消息队列
- 数据库控制在少量核心表

当出现明确扩展需求时，再迁 PostgreSQL / 引入独立任务系统。

---

# E. 建议拆成的 GitHub Issues

为了避免 Issue 列表变成 12 条零碎 TODO，建议按下面结构提交。

## P0 / P1：立即影响安全或用户

### Issue 1

**`privacy: 公开用户卡片直接返回完整学号，需收紧个人信息可见性`**

对应：A1

### Issue 2

**`fix(auth): 统一匿名访问边界并修复游客访问用户卡片整页失败`**

对应：A3

### Issue 3

**`security: 生产环境禁止 console 邮件验证码 provider`**

对应：A2

---

## P1 / P2：业务逻辑问题

### Issue 4

**`fix(match): 修正 targetSize / memberCount 人数口径并处理过期招募帖`**

对应：B1 + B3

### Issue 5

**`fix(match): 用户手动新建 DRAFT 竞赛后招募帖存在“发布成功但不可见”问题`**

对应：B2

### Issue 6

**`fix(profile): 用户卡片“正在参与的队伍”与实际 leader posts 查询语义不一致`**

对应：B4

---

## P2：数据模型 / 产品债务

### Issue 7

**`design: 补齐 Team 正常结束生命周期，避免 COMPETING 僵尸数据`**

对应：C1

### Issue 8

**`design: Competition 缺少 Edition / 届次模型，跨年数据会混合`**

对应：C2

---

## Epic

### Issue 9

**`docs: 广告牌改版与 crawler 合并后，README / docs / open issue 与 main 严重漂移`**

对应：D1 + D2 + B5

### Issue 10

**`epic(v2): 基于新 PRD 重建轻量 TypeScript 全栈版本`**

内容包括：

- Next.js + TypeScript
- Drizzle + SQLite
- Competition / Edition / Event
- Follow + DDL reminder
- Team + Application + TeamMember
- 校园邮箱 OTP
- 审核制比赛数据
- 去 Redis / crawler / 旧广告牌模型

对应：D3 + 当前已冻结 V2 PRD。

---

# F. 当前不建议继续在 main 深修的内容

以下问题从技术上可以继续 patch，但如果已经确定会做 V2，则不建议在旧架构投入大量时间：

- 恢复复杂 Application / Invitation / TeamSlot；
- 修旧六状态机；
- 给 crawler 增加更多 source / parser；
- 完善 viewer context 半匿名体系；
- 给广告牌 TeamMember 增加更多字段；
- 继续扩展 Redis 分布式能力；
- 在当前 Competition 表上继续堆跨年度 timeline hack。

如果 main 仍需短期上线，优先只处理：

1. 学号隐私；
2. 生产验证码安全；
3. 匿名访问边界；
4. 发布成功但不可见；
5. 过期招募帖。

其他问题进入 V2 解决。

---

# G. 与 V2 的关系

当前 main 的问题已经说明：继续在旧模型上同时维护“竞赛数据库 + crawler + 广告牌 + 公开名片 + 复杂基础设施”，会持续增加认知成本。

V2 已冻结的产品方向是：

> **公开竞赛信息库 + 登录后的真实站内组队系统。**

主要变化：

```text
Competition
  ↓
CompetitionEdition
  ↓
EditionEvent

CompetitionEdition
  ├─ Follow / Reminder
  └─ Team
       ├─ TeamMember
       └─ Application
```

并明确：

- 不保存独立学号字段；校园邮箱前缀已包含学号信息，不主动公开；
- 不做公开社交主页；
- 联系方式在申请接受后解锁；
- 同一届比赛一名用户只能属于一支有效队伍；
- 第一版比赛数据由管理员手动维护；
- 用户只能提交新比赛 / 纠错，进入审核；
- 推免信息展示政策依据；
- MVP 不做 crawler；
- MVP 不使用 Redis；
- 技术栈采用 TypeScript 全栈单体。

因此，本文中的很多问题不要求在旧 main 上逐个补齐，而应该作为**为什么需要 V2**的证据和迁移检查表。

