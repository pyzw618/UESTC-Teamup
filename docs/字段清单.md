# 字段清单（可编辑）

> 生成时间：2026-09-19，基于 `apps/api/prisma/schema.prisma` 与 `packages/shared/src/index.ts`（已同步至 commit e22bee2）。
> **2026-09-19 改版**：匹配域按「广告牌模式」重新设计并**已同步前后端代码**（迁移文件 `20260919130000_billboard_model`，启动数据库后运行 `pnpm db:migrate && pnpm db:seed` 生效）。
> **2026-09-20 补充**：招募帖恢复「计划人数 + 已有成员情况」展示（队长手填，平台不做成员身份管理），新增 TeamMember 表与 Team.targetSize 字段（迁移 `20260920000000_team_roster`）。
>
> **用法**：直接在本文件上增删改行，改完后告诉我「清单改完了」，我会据此同步更新：
> 后端 `schema.prisma`（并生成迁移）→ `packages/shared` 枚举与类型 → 前端 `api/types.ts`、表单页与列表页。
>
> - 「可空」= 该字段允许不填；「默认 X」= 未填时自动取值。
> - 类型含义：文本 / 长文本 / 整数 / 布尔 / 时间 / JSON / 字符串数组。
> - 标 🅿️ 的表为**预留表**（仅有表结构，功能未实现或流水线未跑通），改动只落库、不影响现有页面。

---

## 目录

1. [枚举](#枚举)
2. [用户域](#用户域)：User、UserSkill
3. [竞赛域](#竞赛域)：Competition、CompetitionLevel、CompetitionTimeline、CompetitionTag、CompetitionAward、CompetitionMaterial
4. [采集域](#采集域)：CrawlSource、CrawlSnapshot、CrawlItem、CrawlRevision、CrawlAnomaly、CorrectionReport
5. [匹配域](#匹配域)：Team（招募帖）
6. [内容与通知域](#内容与通知域)：Post、Comment、CommentLike、Favorite、Notification、Report
7. [管理域](#管理域)：MailLog、BanRecord、Announcement
8. [附录：接口返回的派生字段（只读）](#附录接口返回的派生字段只读)

---

## 枚举

改枚举值 = 同时改数据库枚举 + 前后端下拉选项；中文标签随值一起维护。

### Level（竞赛级别）

| 值 | 中文标签 |
| --- | --- |
| INTERNATIONAL | 国际级 |
| NATIONAL | 国家级 |
| PROVINCIAL | 省级 |
| SCHOOL | 校级 |

### UserRole（用户角色）

| 值 | 中文标签 |
| --- | --- |
| STUDENT | 学生 |
| CONTRIBUTOR | 认证贡献者 |
| ADMIN | 管理员 |

### CompetitionFormat（赛制）

| 值 | 中文标签 |
| --- | --- |
| INDIVIDUAL | 个人赛 |
| TEAM | 团队赛 |

### Audience（面向人群）

| 值 | 中文标签 |
| --- | --- |
| UNDERGRAD | 本科生 |
| POSTGRAD | 研究生 |
| MIXED | 本研皆可 |

### TeamGoal（组队目标）

| 值 | 中文标签 |
| --- | --- |
| PRIZE | 争取拿奖 |
| PRACTICE | 学习练手 |
| NATIONAL_FIRST | 冲国一 |
| BONUS_ONLY | 保研加分 |

### TeamStatus（招募帖状态，队长手动切换）

> 广告牌模式下无平台内成员/名额，状态全部由队长手动维护，无自动流转（自动归档 cron 一并移除）。

| 值 | 中文标签 |
| --- | --- |
| RECRUITING | 招募中 |
| FULL | 已满员 |
| COMPETING | 已参赛 （系统根据比赛时间设置，用户不能手动设置，若在比赛前就选择已解散则系统就不用切换状态了）|
| DISBANDED | 已解散 （选择已解散状态后放入用户的归档仓库中）|

### RoleType（队伍角色/空位类型）

| 值 | 中文标签 |
| --- | --- |
| ALGORITHM | 算法 |
| FRONTEND | 前端 |
| BACKEND | 后端 |
| HARDWARE | 硬件 |
| MODELING | 建模 |
| UI | UI |
| PAPER | 论文 |
| DEFENSE | 答辩 |
| OTHER | 其他(可以手动输入) |

### PublishStatus（发布状态）

| 值 | 中文标签 |
| --- | --- |
| DRAFT | 草稿 |
| PUBLISHED | 已发布 |
| ARCHIVED | 已下线 |

### SourceHealth（采集源健康度）🅿️

| 值 | 中文标签 |
| --- | --- |
| HEALTHY | 健康 |
| DEGRADED | 降级 |
| FAILING | 连续失败 |
| SUSPENDED | 已停用 |

### MaterialKind（资料/帖子类型）

| 值 | 中文标签 |
| --- | --- |
| PAST_PAPER | 真题 |
| OPEN_SOURCE | 开源作品 |
| EXPERIENCE | 经验帖 |
| TEMPLATE | 模板 |

### CommentTarget（评论/收藏目标类型）

| 值 | 中文标签 |
| --- | --- |
| COMPETITION | 竞赛 |
| POST | 帖子 |
| TEAM | 队伍 |

### NotificationKind（通知类型）

| 值 | 中文标签 |
| --- | --- |
| DDL_REMINDER | DDL 提醒 |
| COMMENT_REPLY | 回复 |
| CRAWL_ANOMALY | 采集异常 |
| SOURCE_FAILING | 数据源告警 |
| CORRECTION_NEW | 用户纠错 |
| SYSTEM NOTIFICATION | 系统通知 |


### RevisionOrigin（版本记录来源）🅿️

| 值 | 中文标签 |
| --- | --- |
| CRAWL | 爬虫写入 |
| MANUAL | 人工修改 |
| ROLLBACK | 回滚动作 |

### CorrectionStatus（纠错状态）

| 值 | 中文标签 |
| --- | --- |
| PENDING | 待处理 |
| ACCEPTED | 已采纳 |
| REJECTED | 已驳回 |

### SourceKind（采集源类型）🅿️

| 值 | 中文标签 |
| --- | --- |
| ACADEMIC_AFFAIRS | 教务处 |
| COLLEGE | 学院官网 |
| COMPETITION_SITE | 竞赛官网 |
| ACADEMY_LIST | 竞赛名录站 |

### ParseStrategy（解析策略）🅿️

| 值 | 中文标签 |
| --- | --- |
| CSS | CSS 选择器 |
| JSON_API | JSON 接口 |
| REGEX | 正则 |

---

## 用户域

### User（用户）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 用户 ID |
| studentNo | 文本 | 必填，全局唯一 | 学号（登录用） |
| email | 文本 | 必填，全局唯一 | 邮箱（登录用，验证码注册） |
| passwordHash | 文本 | **注册时必填** | 密码哈希（scrypt）；首次验证码注册后可未设密码 |
| college | 文本 | **必填** | 学院 |
| grade | 整数 | **必填** | 年级（入学年份） |
| major | 文本 | **必填** | 专业 |
| nickname | 文本 | **必填** | 昵称 |
| bio | 长文本 | 可空 | 个人简介 |
| role | 枚举 UserRole | 默认 STUDENT | 角色 |
| banned | 布尔 | 默认 false | 是否已封禁 |
| createdAt | 时间 | 自动 | 注册时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### UserSkill（用户技能）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 所属用户 |
| skill | 文本 | 联合主键 | 技能名（自由文本） |
| level | 整数 | 可空 | 熟练度（1-5） |

---

## 竞赛域

### Competition（竞赛）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 竞赛 ID |
| name | 文本 | 必填 | 竞赛名称 |
| aliases | 字符串数组 | 必填（可为空数组） | 别名列表 |
| organizer | 文本 | 可空 | 主办方 |
| officialUrl | 文本 | 可空 | 官网地址 |
| format | 枚举 CompetitionFormat | 可空 | 赛制（个人/团队） |
| teamSizeMin | 整数 | 可空 | 最小队伍人数 |
| teamSizeMax | 整数 | 可空 | 最大队伍人数 |
| audience | 枚举 Audience | 可空 | 面向人群 |
| intro | 长文本 | 可空 | 简介 |
| difficulty | 整数 | 可空 | 难度评分（1-5） |
| effort | 整数 | 可空 | 投入度评分（1-5） |
| isBonusEligible | 布尔 | 可空 | 是否推免加分 |
| bonusCategory | 文本 | 可空 | 加分奖项类别 |
| bonusPoints | 文本 | 可空 | 加分说明（文本，如「国一 3 分」） |
| sourceUrl | 文本 | 可空 | 信息来源地址 |
| lastSyncedAt | 时间 | 可空 | 最近同步时间 |
| status | 枚举 PublishStatus | 默认 PUBLISHED | 发布状态 |
| createdAt | 时间 | 自动 | 创建时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### CompetitionLevel（竞赛级别，多值）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| competitionId | 文本 | 联合主键 | 所属竞赛 |
| level | 枚举 Level | 联合主键 | 级别（一个竞赛可有 校→省→国 多档） |

### CompetitionTimeline（时间节点）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 节点 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| stage | 文本 | 必填 | 阶段名（报名、初赛、决赛…） |
| level | 枚举 Level | 可空 | 该节点对应级别 |
| startAt | 时间 | 可空 | 开始时间 |
| endAt | 时间 | 可空 | 结束时间（通常为 DDL） |
| isAuto | 布尔 | 默认 false | 是否爬虫自动抓取 |
| isLocked | 布尔 | 默认 false | 锁定后人工修改不被爬虫覆盖 |

### CompetitionTag（竞赛标签）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| competitionId | 文本 | 联合主键 | 所属竞赛 |
| tag | 文本 | 联合主键 | 标签名（自由文本） |

### CompetitionAward（历届获奖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| year | 整数 | 可空 | 获奖年份 |
| awardName | 文本 | 可空 | 奖项名 |
| teamName | 文本 | 可空 | 队伍名 |
| members | 字符串数组 | 必填（可为空数组） | 成员名单 |
| sourceUrl | 文本 | 可空 | 来源链接 |

### CompetitionMaterial（竞赛资料）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 资料 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| kind | 枚举 MaterialKind | 必填 | 资料类型 |
| title | 文本 | 必填 | 标题 |
| url | 文本 | 必填 | 链接 |
| authorId | 文本 | 可空 | 上传者 |

---

## 采集域

### CrawlSource（采集源）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 源 ID |
| name | 文本 | 必填 | 源名称 |
| url | 文本 | 必填 | 抓取地址 |
| kind | 枚举 SourceKind | 必填 | 源类型 |
| cron | 文本 | 必填 | 定时表达式 |
| parseStrategy | 枚举 ParseStrategy | 必填 | 解析策略 |
| selectorConf | JSON | 必填 | 选择器/解析配置 |
| enabled | 布尔 | 默认 true | 是否启用 |
| lastRunAt | 时间 | 可空 | 最近运行时间 |
| consecutiveFails | 整数 | 默认 0 | 连续失败次数 |
| health | 枚举 SourceHealth | 默认 HEALTHY | 健康度 |

### CrawlSnapshot（页面快照）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 快照 ID |
| sourceId | 文本 | 必填 | 所属源 |
| contentHash | 文本 | 必填 | 内容哈希（用于 diff） |
| fetchedAt | 时间 | 自动 | 抓取时间 |

### CrawlItem（原始条目）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 条目 ID |
| sourceId | 文本 | 必填 | 所属源 |
| title | 文本 | 必填 | 条目标题 |
| link | 文本 | 必填 | 条目链接 |
| rawText | 长文本 | 可空 | 原始文本 |
| fetchedAt | 时间 | 自动 | 抓取时间 |
| processed | 布尔 | 默认 false | 是否已处理入库 |

### CrawlRevision（修改版本记录）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| competitionId | 文本 | 可空 | 关联竞赛 |
| timelineId | 文本 | 可空 | 关联时间节点 |
| field | 文本 | 必填 | 被修改的字段名 |
| oldValue | 长文本 | 可空 | 旧值 |
| newValue | 长文本 | 可空 | 新值 |
| origin | 枚举 RevisionOrigin | 必填 | 修改来源（爬虫/人工/回滚） |
| createdAt | 时间 | 自动 | 发生时间 |

### CrawlAnomaly（采集异常）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 异常 ID |
| sourceId | 文本 | 可空 | 关联源 |
| competitionId | 文本 | 可空 | 关联竞赛 |
| rule | 文本 | 必填 | 触发的规则名 |
| payload | JSON | 必填 | 异常详情 |
| detectedAt | 时间 | 自动 | 检出时间 |
| alerted | 布尔 | 默认 false | 是否已告警 |

### CorrectionReport（用户纠错）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 纠错 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| field | 文本 | 必填 | 纠错字段名 |
| currentValue | 文本 | 可空 | 当前值 |
| proposedValue | 文本 | 可空 | 建议值 |
| note | 长文本 | 可空 | 补充说明 |
| reporterId | 文本 | 必填 | 提交人 |
| status | 枚举 CorrectionStatus | 默认 PENDING | 处理状态 |
| createdAt | 时间 | 自动 | 提交时间 |

---

## 匹配域（广告牌模式）

> **2026-09-19 产品改版**：平台不做申请 / 邀请 / 审批 / 私聊。队长发布招募帖（广告牌），感兴趣的人看到后通过帖子上公开的联系方式（微信 / QQ）直接联系队长，进队、退队都在平台外发生。
>
> 随之移除：TeamSlot（名额表）、Application（申请）、Invitation（邀请）、Workspace（队伍空间）、Review（互评）及 ApplicationStatus 枚举。
> **2026-09-20 补充**：恢复队长手填的「计划招募人数（Team.targetSize）+ 已有成员情况（TeamMember，纯展示）」，已有成员数量为派生计数。
>
> 帖子下方的评论区 = Comment（targetType = TEAM，支持楼中楼回复）+ CommentLike 点赞，见「内容与通知域」。

### Team（招募帖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 帖子 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| leaderId | 文本 | 必填 | 发帖人（队长） |
| goal | 枚举 TeamGoal | 必填 | 组队目标 |
| neededRoles | RoleType[] | 必填（可为空数组） | 招募方向标签（卡片展示 + 按方向筛选） |
| requirement | 长文本 | 可空 | 招募要求（方向、水平等，自由文本） |
| contact | 文本 | 必填 | 联系方式（微信 / QQ），直接公开展示 |
| deadline | 时间 | 可空 | 招募截止时间 |
| targetSize | 整数 | 可空 | 计划招募人数（队长填写，展示用） |
| status | 枚举 TeamStatus | 默认 RECRUITING | 帖子状态，队长手动切换 |
| createdAt | 时间 | 自动 | 发布时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### TeamMember（已有成员情况，队长手填）

> 广告牌模式：成员仅作展示信息（加入在平台外发生），不关联平台账号、不做身份管理；已有成员数量 = 本表行数（派生）。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 成员行 ID |
| teamId | 文本 | 必填 | 所属招募帖 |
| grade | 整数 | 可空 | 年级（入学年份） |
| college | 文本 | 可空 | 学院 |
| major | 文本 | 可空 | 专业 |
| rank | 文本 | 可空 | rank（成绩/排名，如「前 15%」） |
| intro | 长文本 | 可空 | 成员介绍（方向、经历，可含称呼） |
| createdAt | 时间 | 自动 | 录入时间 |

---

## 内容与通知域

### Post（经验帖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 帖子 ID |
| authorId | 文本 | 必填 | 作者 |
| title | 文本 | 必填 | 标题 |
| content | 长文本 | 必填 | 正文 |
| kind | 枚举 MaterialKind | 必填 | 帖子类型 |
| refined | 布尔 | 默认 false | 是否精华为管理 |
| likes | 整数 | 默认 0 | 点赞数 |
| createdAt | 时间 | 自动 | 发布时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### Comment（评论，多态：竞赛/帖子/招募帖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 评论 ID |
| authorId | 文本 | 必填 | 评论人 |
| targetType | 枚举 CommentTarget | 必填 | 目标类型（TEAM = 招募帖下的评论区） |
| targetId | 文本 | 必填 | 目标 ID |
| content | 长文本 | 必填 | 内容 |
| parentId | 文本 | 可空 | 父评论（楼中楼回复） |
| likes | 整数 | 默认 0 | 点赞数（冗余计数，由 CommentLike 维护） |
| createdAt | 时间 | 自动 | 发布时间 |

### CommentLike（评论点赞）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 点赞人 |
| commentId | 文本 | 联合主键 | 被点赞的评论 |
| createdAt | 时间 | 自动 | 点赞时间 |

### Favorite（收藏）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 收藏人 |
| targetType | 枚举 CommentTarget | 联合主键 | 目标类型 |
| targetId | 文本 | 联合主键 | 目标 ID |
| createdAt | 时间 | 自动 | 收藏时间 |

### Notification（站内通知）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 通知 ID |
| userId | 文本 | 必填 | 接收人 |
| kind | 枚举 NotificationKind | 必填 | 通知类型 |
| payload | JSON | 必填 | 通知内容（跳转参数等） |
| readAt | 时间 | 可空 | 已读时间（空 = 未读） |
| createdAt | 时间 | 自动 | 发出时间 |

### Report（举报）🅿️

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 举报 ID |
| reporterId | 文本 | 必填 | 举报人 |
| targetType | 文本 | 必填 | 目标类型（TEAM/USER/COMMENT） |
| targetId | 文本 | 必填 | 目标 ID |
| reason | 长文本 | 必填 | 举报理由 |
| handled | 布尔 | 默认 false | 是否已处理 |
| createdAt | 时间 | 自动 | 举报时间 |

---

## 管理域

### MailLog（发信日志）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 日志 ID |
| to | 文本 | 必填 | 收件邮箱 |
| kind | 文本 | 必填 | 邮件类型 |
| status | 文本 | 必填 | 发送结果 |
| error | 文本 | 可空 | 失败原因 |
| sentAt | 时间 | 自动 | 发送时间 |

### BanRecord（封禁记录）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| userId | 文本 | 必填 | 被封禁用户 |
| actorId | 文本 | 必填 | 操作管理员 |
| reason | 文本 | 可空 | 封禁理由 |
| createdAt | 时间 | 自动 | 操作时间 |

### Announcement（系统公告）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 公告 ID |
| title | 文本 | 必填 | 标题 |
| content | 长文本 | 必填 | 内容 |
| active | 布尔 | 默认 true | 是否启用（站内横幅展示） |
| createdBy | 文本 | 必填 | 发布管理员 |
| createdAt | 时间 | 自动 | 发布时间 |

---

## 附录：接口返回的派生字段（只读）

这些字段**不存库**，由后端查询时计算。如果你希望它们变成本人可编辑的真实字段，或调整计算规则，也可以直接改下面的表格告诉我。

### 竞赛列表项（CompetitionListItem）

| 字段 | 说明 |
| --- | --- |
| recruitingTeams | 该竞赛下招募中的队伍数（计数） |
| nextDeadline | 最近一个未过期的截止时间（取时间线最早 endAt） |
| status | OPEN / UPCOMING / ENDED / UNKNOWN（由时间线推算） |

> 竞赛详情页另有 `recruitingTeamsCount`：正在招募的队伍数量（游客亦可获取）。

### 时间线节点（TimelineNode）

| 字段 | 说明 |
| --- | --- |
| kind | signup / race：报名类节点 vs 比赛类节点（按阶段名推算） |

### 招募帖（TeamListItem / TeamSummary）

| 字段 | 说明 |
| --- | --- |
| expired | 是否已过 deadline（由 deadline 推算） |
| commentCount | 帖子评论数（计数） |
| memberCount | 已有成员数量 = TeamMember 行数（派生） |
