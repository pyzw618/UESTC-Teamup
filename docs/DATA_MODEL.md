# 数据模型

> 相关：[README.md](./README.md)（项目速览）、[MODULE_CRAWLER.md](./MODULE_CRAWLER.md)、[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)

**状态**：设计草图（Prisma 风格伪代码），非最终 `schema.prisma`。
标 ⚠️ 的字段/表存在**未决问题**，见 [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)，不要直接照抄建表。

---

## 1. 关系总览

```
User ──┬── UserSkill
       ├── Team (作为队长)
       ├── TeamMember ── Team ── Competition
       ├── Application ── Team
       ├── Invitation  ── Team
       ├── Favorite    ── Competition / Team / Post
       ├── Notification
       ├── Comment     ── Competition / Post / Team
       ├── Review      (互评)
       └── CorrectionReport ── Competition

Competition ──┬── CompetitionLevel    (多值四档)
              ├── CompetitionTimeline (节点自带级别)
              ├── CompetitionTag
              ├── CompetitionAward
              ├── CompetitionMaterial
              ├── Comment
              ├── CrawlRevision / CrawlAnomaly / CorrectionReport
              └── Team

CrawlSource ──┬── CrawlSnapshot   (页面快照，用于 diff)
              ├── CrawlItem       (抓到的原始条目)
              └── CrawlAnomaly
```

---

## 2. 枚举

```prisma
enum Level { INTERNATIONAL  NATIONAL  PROVINCIAL  SCHOOL }
// 国际级 / 国家级 / 省级 / 校级

enum UserRole { STUDENT  CONTRIBUTOR  ADMIN }
// 学生 / 认证贡献者（学院科协、社团） / 管理员

enum CompetitionFormat { INDIVIDUAL  TEAM }
enum Audience { UNDERGRAD  POSTGRAD  MIXED }        // 本科生 / 研究生 / 混合参赛

enum TeamGoal { PRIZE  PRACTICE  NATIONAL_FIRST  BONUS_ONLY }
// 保奖 / 学习练手 / 冲国一 / 只为加分

enum TeamStatus { RECRUITING  PAUSED  FULL  COMPETING  DISBANDED  ARCHIVED }
// 招募中 / 暂停招募 / 已满员 / 已参赛 / 人为解散 / 正常归档
// 注：旧 NEGOTIATING 已迁移为 PAUSED；正常结束用 ARCHIVED，只有队长主动解散才是 DISBANDED

enum SlotStatus { OPEN  FILLED  CLOSED }
// 招募名额：仍缺人 / 已被成员占据 / 队长取消该需求

enum RoleType { ALGORITHM  FRONTEND  BACKEND  HARDWARE  MODELING  UI  PAPER  DEFENSE  OTHER }
// 算法 / 前端 / 后端 / 硬件 / 建模 / UI / 论文 / 答辩 / 其他

enum ApplicationStatus { PENDING  ACCEPTED  REJECTED  WITHDRAWN  EXPIRED }
// EXPIRED：队伍满员/解散/归档，或同竞赛已加入其他队伍而自动失效
enum PublishStatus { DRAFT  PUBLISHED  ARCHIVED }
enum SourceHealth { HEALTHY  DEGRADED  FAILING  SUSPENDED }
// 正常 / 降级 / 疑似失效 / 已熔断
```

---

## 3. 用户

```prisma
model User {
  id         String   @id @default(cuid())
  studentNo  String   @unique          // 2024080909015
  email      String   @unique          // 2024080909015@std.uestc.edu.cn
  college    String?                   // 学院（从学号解析，允许手工修正）
  grade      Int?                      // 年级，如 2024
  major      String?                   // 专业
  nickname   String?
  role       UserRole @default(STUDENT)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  // ⚠️ 头像：v0.3 前有，本次改动删除 —— 待确认是「确认不要」还是「遗漏」
  // ⚠️ 信誉分：v0.3 前有，本次改动删除 —— 但互评体系还在，见 OPEN_QUESTIONS Q2
}

model UserSkill {
  userId  String
  skill   String
  level   Int?        // 熟练度 1-5
  @@id([userId, skill])
}
// ⚠️ 组队卡本次删掉了「技能要求（标签+熟练度）」，
//    技能标签的用途只剩「个人能力名片」。是否保留此表待确认（Q6）。
```

---

## 4. 竞赛雷达

### 4.1 竞赛档案

```prisma
model Competition {
  id           String  @id @default(cuid())
  name         String
  aliases      String[]                    // 别名
  organizer    String?                     // 主办方
  officialUrl  String?                     // 官网链接

  format       CompetitionFormat?          // 个人 / 团队
  teamSizeMin  Int?                        // 团队人数下限
  teamSizeMax  Int?                        // 团队人数上限
  audience     Audience?                   // 面向年级
  intro        String?  @db.Text           // 竞赛简介（管理员填写）

  difficulty   Int?                        // 难度 1-5
  effort       Int?                        // 投入度 1-5

  // ---------- 推免加分（独立可选字段，允许为空）----------
  // 数据来源：校教〔2026〕39 号《关于开展推荐 2027 届优秀应届本科毕业生
  //           免试攻读研究生工作的通知》（各类别的认定名单与分值以当年最新通知为准）
  // ⭐ 爬虫抓不到这个字段（官网通知不会写"这是国家级"），只能人工维护
  isBonusEligible Boolean?                 // 是否计入推免加分
  bonusCategory   String?                  // 认定类别
  bonusPoints     String?                  // 分值（通知里常是描述性文字，用 String 稳妥）

  // ---------- 采集溯源 ----------
  sourceUrl     String?                    // 来源链接（用户可见处需标注）
  lastSyncedAt  DateTime?                  // 最后自动更新时间
  status        PublishStatus @default(PUBLISHED)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model CompetitionLevel {
  competitionId String
  level         Level
  @@id([competitionId, level])
}
// 级别多值：一个竞赛常有 校赛→省赛→国赛 链路
```

### 4.2 时间节点（日历的数据源）

```prisma
model CompetitionTimeline {
  id            String   @id @default(cuid())
  competitionId String
  stage         String                        // 报名开始/报名截止/初赛/复赛/决赛/结果公布
  level         Level?                        // 该节点自己的级别
  startAt       DateTime?
  endAt         DateTime?

  isAuto        Boolean  @default(false)      // 由采集自动写入
  isLocked      Boolean  @default(false)      // ⭐ 人工锁定，爬虫不得覆盖

  @@index([startAt])
}
```

> **⭐ `isLocked` 是必须的。** 管理员手工修正过一个被爬虫解析错的截止时间后，下一次采集会把它**改回去** —— 而且看起来像"数据自己变回去了"这种灵异现象。人工改过的节点自动置 `isLocked = true`，爬虫遇到带锁节点只记录冲突告警、不写入。

### 4.3 其它档案子表

```prisma
model CompetitionTag {
  competitionId String
  tag           String
  @@id([competitionId, tag])
}

model CompetitionAward {
  id            String   @id @default(cuid())
  competitionId String
  year          Int?
  awardName     String?                 // 奖项名称
  teamName      String?
  members       String[]                // 成员姓名
  sourceUrl     String?
}

model CompetitionMaterial {
  id            String   @id @default(cuid())
  competitionId String
  kind          MaterialKind            // 真题 / 开源作品 / 经验帖 / 答辩模板
  title         String
  url           String
  authorId      String?
}
enum MaterialKind { PAST_PAPER  OPEN_SOURCE  EXPERIENCE  TEMPLATE }
```

> **留言讨论**：竞赛详情页的留言复用 `Comment` 表，`targetType = COMPETITION`（见 §7）。

---

## 5. 采集子系统

```prisma
model CrawlSource {
  id            String   @id @default(cuid())
  name          String
  url           String
  kind          SourceKind               // 教务处 / 学院 / 竞赛官网 / 学会榜单
  cron          String                   // 抓取频率，如 "0 6 * * *"
  parseStrategy ParseStrategy            // CSS 选择器 / JSON API / 正则
  selectorConf  Json                     // 选择器配置，可在线编辑，改版不用发版
  enabled       Boolean  @default(true)

  lastRunAt      DateTime?
  consecutiveFails Int   @default(0)
  health         SourceHealth @default(HEALTHY)

  snapshots     CrawlSnapshot[]
  items         CrawlItem[]
  anomalies     CrawlAnomaly[]
}
enum SourceKind { ACADEMIC_AFFAIRS  COLLEGE  COMPETITION_SITE  ACADEMY_LIST }
enum ParseStrategy { CSS  JSON_API  REGEX }

model CrawlSnapshot {
  id         String   @id @default(cuid())
  sourceId   String
  contentHash String                       // 用于 diff，无变化则跳过
  fetchedAt  DateTime @default(now())
}

model CrawlItem {
  id         String   @id @default(cuid())
  sourceId   String
  title      String
  link       String
  rawText    String?  @db.Text             // 仅用于解析，不对外展示（版权）
  fetchedAt  DateTime @default(now())
  processed  Boolean  @default(false)
}

model CrawlRevision {
  id            String   @id @default(cuid())
  competitionId String?
  timelineId    String?
  field         String                      // 字段名
  oldValue      String?  @db.Text
  newValue      String?  @db.Text
  origin        RevisionOrigin
  createdAt     DateTime @default(now())    // ⭐ 一键回滚的数据来源
}
enum RevisionOrigin { CRAWL  MANUAL  ROLLBACK }

model CrawlAnomaly {
  id            String   @id @default(cuid())
  sourceId      String?
  competitionId String?
  rule          String                      // 命中的拦截规则名
  payload       Json                        // 原始值
  detectedAt    DateTime @default(now())
  alerted       Boolean  @default(false)    // ⭐ 异常拦截器的输出
}

model CorrectionReport {
  id            String   @id @default(cuid())
  competitionId String
  field         String
  currentValue  String?
  proposedValue String?
  note          String?  @db.Text
  reporterId    String
  status        CorrectionStatus @default(PENDING)
  createdAt     DateTime @default(now())
}
enum CorrectionStatus { PENDING  ACCEPTED  REJECTED }
```

---

## 6. 队友匹配

```prisma
model Team {
  id            String   @id @default(cuid())
  competitionId String
  leaderId      String
  goal          TeamGoal

  requirement   String?  @db.Text        // 招募要求（自由文本）
  contact       String?                  // ⚠️ 个人联系方式，见下方隐私说明
  deadline      DateTime?                // 招募截止时间

  status        TeamStatus @default(RECRUITING)
  archivedAt    DateTime?                // 正常生命周期归档时间
  createdAt     DateTime @default(now())

  // 人数不落库：当前 = 活跃 TeamMember 数，剩余 = OPEN 名额数，目标 = 两者之和

  members       TeamMember[]
  slots         TeamSlot[]
  applications  Application[]
  invitations   Invitation[]
  workspace     Workspace?
}

model TeamMember {
  id            String   @id @default(cuid())
  teamId        String
  userId        String?                     // ⚠️ 可为空 = 平台外成员（队友没注册）
  competitionId String                        // 冗余自 Team，用于“同竞赛一人一队”唯一索引
  displayName   String?                     // 平台外成员的名字

  role        RoleType?
  rank        String?
  grade       Int?
  college     String?
  note        String?

  active      Boolean  @default(true)       // false = 已退出/被移除（软删除，保留历史）
  joinedAt    DateTime @default(now())
  leftAt      DateTime?
  // 约束：@@unique([teamId, userId])；部分唯一索引 (userId, competitionId) WHERE active
}

model TeamSlot {
  id               String     @id @default(cuid())
  teamId           String
  role             RoleType
  note             String?
  status           SlotStatus @default(OPEN)   // OPEN / FILLED / CLOSED
  filledByMemberId String?   @unique           // 占据该名额的成员（一个成员最多占一个名额）
  filledAt         DateTime?
  createdAt        DateTime  @default(now())
}

model Application {
  id          String   @id @default(cuid())
  teamId      String
  userId      String
  desiredRole RoleType                          // 期望方向（不指定具体 slot id）
  pitch       String?  @db.Text                 // 自我介绍 + 技能证明
  status      ApplicationStatus @default(PENDING)
  reason      String?                           // 婉拒理由（用模板降低社交压力）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // 部分唯一索引 (teamId, userId) WHERE status='PENDING'
}

model Invitation {
  id        String   @id @default(cuid())
  teamId    String
  userId    String                              // 被邀请人
  role      RoleType                            // 邀请方向
  message   String?
  status    ApplicationStatus @default(PENDING)
  createdAt DateTime @default(now())
  // 部分唯一索引 (teamId, userId) WHERE status='PENDING'
}

model Workspace {
  id        String   @id @default(cuid())
  teamId    String   @unique
  // 讨论区 / 文件 / 任务看板 / 里程碑 各自建表，此处仅作归属锚点
}
```

### ⚠️ 两个必须处理的设计点

**① 联系方式的隐私风险**
`Team.contact` 是自由文本，会被直接展示。**如果公开展示，等于把一份可被爬取的成电学生联系方式清单挂在公网上。**
建议：登录可见 + 非公开字段，或改为"申请通过后站内可见"。**待确认（Q8）。**

**② 平台外成员**
组队卡要展示"已有成员情况"，但队友可能没注册本站。所以 `TeamMember.userId` 必须可空，配 `displayName` 兜底。**如果强制 userId 非空，用户会被迫把队友也拉进来注册才能发帖**，转化率会很难看。

---

## 7. 横向表

```prisma
model Post {                              // 经验帖 / 资料
  id       String @id @default(cuid())
  authorId String
  title    String
  content  String @db.Text
  kind     MaterialKind
  ...
}

model Comment {
  id         String       @id @default(cuid())
  authorId   String
  targetType CommentTarget                 // ⭐ 多态：竞赛 / 帖子 / 队伍
  targetId   String
  content    String @db.Text
  parentId   String?                       // 楼中楼
  createdAt  DateTime @default(now())
}
enum CommentTarget { COMPETITION  POST  TEAM }

model Favorite {
  userId     String
  targetType CommentTarget
  targetId   String
  @@id([userId, targetType, targetId])
}

model Notification {
  id       String   @id @default(cuid())
  userId   String
  kind     NotificationKind
  payload  Json
  readAt   DateTime?
  createdAt DateTime @default(now())
}
enum NotificationKind {
  DDL_REMINDER        // DDL 提醒
  APPLICATION_NEW     // 收到入队申请
  APPLICATION_RESULT  // 申请结果
  INVITATION_NEW      // 收到邀请
  COMMENT_REPLY
  CRAWL_ANOMALY       // 采集异常告警（发给管理员）
  SOURCE_FAILING      // 源失效告警（发给管理员）
  CORRECTION_NEW      // 用户纠错（发给管理员）
}

model Review {                            // 参赛完成后双向匿名互评
  id         String @id @default(cuid())
  teamId     String
  reviewerId String
  revieweeId String
  reliability Int?                        // 靠谱
  skill       Int?                        // 技术
  communication Int?                      // 沟通
  comment    String? @db.Text
  createdAt  DateTime @default(now())
}

model Report { ... }                      // 举报
model MailLog {                           // 发信日志，排查"同学说没收到"
  id      String   @id @default(cuid())
  to      String
  kind    String
  status  String
  error   String?
  sentAt  DateTime @default(now())
}
```

---

## 8. 不进数据库的东西

| 数据 | 存哪 | 原因 |
|---|---|---|
| 邮箱验证码 | Redis，TTL 5 分钟 | 高频读写、自动过期，落库无意义 |
| 限流计数 | Redis | 同上 |
| Session | Redis | 需要能强制下线 |
| 采集任务锁 | Redis | 防止多实例/重入重复抓取 |
| QQ 邮箱授权码 | 环境变量 `.env` | **绝不入库、绝不进 git** |
