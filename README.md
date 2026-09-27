<div align="center">

<img src="apps/web/public/brand/badge-192.png" width="120" alt="UESTC TeamUp" />

# UESTC TeamUp

**成电人的竞赛罗盘** —— 电子科技大学校内竞赛信息与组队平台

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-CB3837?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma)](https://www.prisma.io/)

</div>

解决两个校园痛点：**竞赛信息支离破碎**（靠 QQ 群口口相传、容易错过 DDL），以及**论坛组队低效**（帖子沉底、状态不更新）。

- **竞赛雷达**：结构化竞赛档案（含 `year` 届次）+ 日历视图，「只看能加分的比赛」一键筛选
- **队友匹配**：结构化组队卡 + 队伍状态机，「广告牌」式招募——登记组队意愿后解锁联系方式
- 差异化护城河：**推免加分是独立字段**——级别回答「比赛多大」，加分回答「对我保研有没有用」（56 项认定清单源自校教学文件，随种子数据入库）

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [架构](#架构)
- [仓库结构](#仓库结构)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [测试](#测试)
- [生产部署](#生产部署)
- [文档索引](#文档索引)
- [开发规范](#开发规范)
- [路线图](#路线图)
- [许可](#许可)

## 功能特性

**竞赛雷达**

- 竞赛档案：级别（国际 / 国家 / 省 / 校四档多值）、报名 / 初赛 / 决赛时间线、推免加分认定
- **届次年份**（2026-09-27）：同一赛事按年份建多份档案（名称 + 年份唯一），列表 / 日历 / 搜索默认只看当前届，可切换历史届次；竞赛详情页支持同名赛事跨届跳转
- **补充信息**：有编辑权限的用户可为单个竞赛维护自定义键值字段（如数模的「QQ 交流群号」），展示在详情页「补充信息」区块，修改进入版本留痕
- 日历视图（FullCalendar）、全文搜索、收藏、「只看能加分的比赛」筛选
- 事后纠错 + 反馈：用户可按字段提交纠错（管理员采纳后自动锁定），也可从竞赛详情页提交整体信息反馈；改过的时间线节点 `isLocked` 锁定，未来自动采集不会覆盖人工结果；全字段变更入 `CrawlRevision`，后台一键回滚（回滚本身也留痕）
- DDL 定时提醒：赛前 7 / 3 / 1 天推送站内通知

**队友匹配**

- 组队卡「广告牌模式」，队伍状态机四态：招募中 / 已满员 / 已参赛 / 已解散（公开发现流只展示「招募中」且招募截止未过的帖子，其余状态仅发布者与管理员可见）
- **组队意愿**：联系方式默认遮挡，点击「我想组队」登记一条意愿后解锁；帖子展示「有 X 人有组队意愿」（只给计数不公开身份，可撤销）；招募人收到聚合站内消息
- **个人信息可见性（2026-09-27 定稿）**：平台不做申请 / 邀请 / 审批 / 私聊，招募帖即广告牌。**学号仅对登录用户展示**（查看招募帖发布者与公开名片时可见），游客不下发——公开互联网不可批量抓取学号；联系方式仅队长 / 管理员 / 已登记意愿的用户可见
- 匿名访问矩阵：竞赛信息与招募计数对游客公开（帖子详情游客仅见外层壳与意愿计数）；招募正文 / 发现列表 / 帖子详情正文 / 学号需校园账号登录；公开名片可访客浏览，子资源 401 不影响整页
- 用户发帖时手动填写的新竞赛自动建档**免审核、即时发布**（同届同名历史草稿一并转发布），仅通知管理员知悉

**平台能力**

- 双登录：邮箱验证码（首次即注册）+ 密码。本地开发走 console provider（验证码进日志 / dev 模式响应回显）；**生产环境禁止 console provider 启动**，必须配置真实 SMTP——见 [路线图](#路线图)
- **反馈渠道**（2026-09-27）：导航栏「功能问题反馈」（自动附页面路径）+ 竞赛详情页「竞赛信息反馈」（自动附竞赛名快照）双入口，游客可提交；后台按日期查看并导出单日反馈 JSON
- 管理后台：竞赛编辑、竞赛自定义字段、来源 / 异常、纠错处理台、版本回滚、公告、举报、用户管理、反馈管理；CONTRIBUTOR（贡献者）角色可参与竞赛共建（编辑竞赛 / 维护补充字段，修改留痕可回滚），普通用户权限不变
- 品牌视觉：校徽深蓝 `#0F4C8C` + 银杏黄 `#F5B901` 玻璃拟态设计系统

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | NestJS 10 · Prisma 5 · PostgreSQL 16（pg_trgm 模糊搜索）· Redis 7（会话 / 验证码 / cron 防重入锁） |
| 前端 | Vue 3 · Vite 5 · Pinia · Vue Router · Element Plus · UnoCSS · FullCalendar |
| 共享 | `packages/shared`：前后端枚举与类型单一来源（与 [docs/FIELDS.md](./docs/FIELDS.md) 对齐） |
| 工程 | pnpm workspace 单体 monorepo · TypeScript 5 · `node:test`（tsx 直跑） |
| 部署 | Docker Compose（nginx 静态 + `/api` 反代）· PG 参数按 2C2G 单机调优 |

## 架构

```mermaid
flowchart LR
    B[浏览器] --> W["web（nginx :80）<br/>静态资源 + SPA 回退"]
    W -- "/api 反向代理" --> A["api（NestJS :3000）<br/>auth · users · radar · match · crawler<br/>notification · admin · feedback · mail · jobs"]
    A --> P[("PostgreSQL 16")]
    A --> R[("Redis 7")]
```

- 单体 + 模块化边界，**不做微服务**（2C2G 单机预算）
- API 全局前缀 `/api`，统一响应包装（`TransformInterceptor`）+ 全局异常过滤（`HttpExceptionFilter`）
- Cookie httpOnly 会话，CORS 白名单由 `WEB_ORIGIN` 控制
- cron 任务：DDL 提醒（7/3/1 天）+ 队伍状态归档（`apps/api/src/jobs/`）

## 仓库结构

```
.
├─ apps/
│  ├─ api/                # NestJS 10 + Prisma 5（:3000，全局前缀 /api）
│  │  ├─ src/common/      # 认证守卫 · Prisma/Redis · 拦截器 · 过滤器
│  │  ├─ src/modules/     # auth · users · mail · notification · radar · match · admin · crawler · feedback
│  │  ├─ src/jobs/        # DDL 提醒 + 队伍归档 cron
│  │  └─ prisma/          # schema · migrations · seed · extract_bonus.py · bonus-list.json
│  └─ web/                # Vue 3 + Vite（dev :5173，/api 代理到 :3000）
├─ packages/shared/       # 前后端共享枚举 / 类型
├─ docker/                # Dockerfile.api · Dockerfile.web（构建上下文 = 仓库根）
├─ deploy/                # docker-compose.yml · nginx.conf · pg.conf · .env.example
├─ scripts/               # 品牌素材加工（Python + Pillow）
├─ assets/brand/          # 校徽 / 线稿 / 银杏原始素材
├─ data/                  # competition-sites.csv（竞赛官网清单）
└─ docs/                  # 设计文档（唯一需求来源），入口 docs/README.md
```

## 快速开始

### 依赖环境

- Node.js ≥ 20，pnpm ≥ 9（`corepack enable` 即可）
- PostgreSQL 16+（需 `pg_trgm` 扩展）与 Redis 7+

### 步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 配置后端环境变量
cp apps/api/.env.example apps/api/.env   # 按本地数据库修改

# 3. 准备数据库（任选一种）
#    a) Docker：docker compose -f deploy/docker-compose.yml up -d db redis
#       （pg_trgm 扩展、届次唯一索引（name+year）等均已由迁移建好，无需手工执行）
#    b) WSL2 Ubuntu：wsl -d Ubuntu -e bash -c "systemctl start postgresql redis-server"

# 4. 构建共享包 → 迁移 → 种子数据
pnpm -F @teamup/shared build
pnpm db:migrate
pnpm db:seed        # 59 个竞赛（含 56 项推免认定清单，按届次年份入库）+ 演示用户 / 队伍

# 5. 启动开发（api :3000 与 web :5173 并行）
pnpm dev
```

打开 <http://localhost:5173>。

> **WSL2 提示**：`DATABASE_URL` 主机必须写 `127.0.0.1` 而非 `localhost`（WSL 中 PG 只监听 IPv4，Node 会先解析 `::1` 导致 P1001）。

### 演示账号（种子数据）

演示用户的初始密码取自环境变量 `SEED_ADMIN_PASSWORD`（未设置则不写入密码，此时走邮箱验证码登录——**本阶段验证码从服务端日志获取**，登录后在「个人中心」设置密码）。

```bash
SEED_ADMIN_PASSWORD='<自定义强密码>' pnpm db:seed
```

| 账号 | 说明 |
|---|---|
| `2024080909015@std.uestc.edu.cn` | 管理员，登录后进 `/admin` 后台 |
| `2024080909000@std.uestc.edu.cn` | 普通测试用户 |
| 其余 4 个演示用户 | 未设密码，用验证码登录（本阶段从服务端日志取码）后在「个人中心」设置密码 |

> 该 seed 脚本会**清空全库**再写入。`NODE_ENV=production` 时默认拒绝执行，确需在生产执行须显式设置 `ALLOW_PROD_SEED=true`。

**邮件发信说明**：本地开发默认 `MAIL_PROVIDER=console`，验证码打印到后端控制台，dev 模式另随响应 `dev.devCode` 回显（生产环境不回显）。**生产环境（`NODE_ENV=production`）下 console provider 会被拒绝启动**——验证码等价登录凭据，不能落日志兜底；生产部署必须配置 `MAIL_PROVIDER=qq` 及 SMTP 授权码——见 [生产部署](#生产部署)。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 前后端并行开发（api watch / web vite） |
| `pnpm dev:api` / `pnpm dev:web` | 只起后端 / 只起前端 |
| `pnpm build` | 全量构建（web 含 `vue-tsc --noEmit` 类型检查） |
| `pnpm db:migrate` | Prisma 迁移（开发库） |
| `pnpm db:seed` | 重置并写入种子数据 |
| `pnpm -F @teamup/api test` | 后端测试（组队状态机等） |

## 测试

后端使用 `node:test` + tsx 直跑，无需额外测试框架：

```bash
pnpm -F @teamup/api test          # apps/api/test/teams.spec.ts
```

前端以 `vue-tsc` 类型检查作为构建门槛（`pnpm -F @teamup/web build` 内含）。

## 生产部署

```bash
cd deploy
cp .env.example .env              # 必填：POSTGRES_PASSWORD、WEB_ORIGIN、MAIL_PROVIDER 等
docker compose up -d --build

# 首次部署 / 升级后同步 schema
docker compose exec api npx prisma migrate deploy
```

- 内存预算（2C2G）：PG `shared_buffers=256MB`（`deploy/pg.conf`）、API 限 320M、Redis 48M、nginx 64M
- `WEB_ORIGIN`：后端 CORS 白名单，必须设为真实对外域名（如 `https://teamup.example.edu.cn`），否则线上恒回退 `localhost` 导致跨域请求被拒
- HTTPS：nginx 当前仅监听 80；启用 TLS 请取消 `deploy/nginx.conf` 中 443 server 块的注释、填入证书路径，并**同时**把 `.env` 的 `COOKIE_SECURE` 设为 `true`（保持 `false` 会让浏览器拒收 Secure cookie，登录直接失效）。国内服务器 + 域名需 **ICP 备案**
- 邮件发信：**生产必须配置 `MAIL_PROVIDER=qq` + QQ 邮箱 16 位 SMTP 授权码**（个人邮箱有每日发信限额，上线前实测送达率）；`NODE_ENV=production` 时后端拒绝以 console provider 启动（验证码仅进日志等同账号登录凭据，安全收敛见 `docs/UESTC-TeamUp_main_issues.md` A2）

## 文档索引

设计文档位于 `docs/`，是**唯一需求来源**；入口与维护规则见 [docs/README.md](./docs/README.md)。

| 文档 | 内容 |
|---|---|
| [TECH_STACK.md](./docs/TECH_STACK.md) | 技术选型理由、内存预算、部署、依赖清单 |
| [DATA_MODEL.md](./docs/DATA_MODEL.md) | 表设计、关系、枚举、Prisma schema |
| [FIELDS.md](./docs/FIELDS.md) | 字段清单（可编辑）：展示 / 编辑 / 必填口径 |
| [PAGES.md](./docs/PAGES.md) | 信息架构、路由表、页面要素与交互 |
| [MODULE_AUTH.md](./docs/MODULE_AUTH.md) | 登录与邮件技术路线 |
| [MODULE_MATCH.md](./docs/MODULE_MATCH.md) | 队友匹配技术路线 |
| [MODULE_CRAWLER.md](./docs/MODULE_CRAWLER.md) | 采集子系统设计（已合入 main：预设官网 / 多源优先级 / 发布流水线） |
| [ISSUES_PRODUCT_FIXES.md](./docs/ISSUES_PRODUCT_FIXES.md) | 本期产品迭代清单（2026-09-27 六项：组队意愿 / 可见性收敛 / 届次年份 / 贡献者共建 / 反馈渠道 / 移除限流） |
| [UESTC-TeamUp_main_issues.md](./docs/UESTC-TeamUp_main_issues.md) | main 分支问题审计（隐私 / 匿名边界 / 文档漂移），作为迭代修复与 V2 重构输入 |
| [ROADMAP.md](./docs/ROADMAP.md) | 阶段划分、任务拆解、验收标准 |
| [OPEN_QUESTIONS.md](./docs/OPEN_QUESTIONS.md) | 待澄清事项与已知矛盾 |

## 开发规范

分支模型、Conventional Commits 中文摘要规范、数据模型变更流程与 PR 自检清单见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 路线图

- ✅ **P1 平台地基**：注册登录（验证码 / 密码）、竞赛雷达、组队状态机、管理后台、DDL 提醒
- ✅ **P2 自动采集**：crawler 子系统合入 main——竞赛官网预设、多源优先级防覆盖、externalId 去重
- ✅ **2026-09-27 产品迭代**（[ISSUES_PRODUCT_FIXES.md](./docs/ISSUES_PRODUCT_FIXES.md)）：组队意愿（意愿解锁联系方式 + 聚合通知）、公开可见性收敛（仅「招募中」）、竞赛届次 `year`、CONTRIBUTOR 共建 + 自定义字段、反馈双入口 + 单日导出、移除接口级限流；同步落定隐私口径（学号仅登录可见）与生产邮件安全守卫（[问题清单](./docs/UESTC-TeamUp_main_issues.md) A1/A2/A3/B1-B5）
- 🔜 **真实邮件发送**：本地开发仍走 console provider（验证码进日志便于联调）；**生产环境已禁止 console provider 启动**，部署必须配置 `MAIL_PROVIDER=qq` 及 SMTP 授权码
- 🔜 **人机验证替代限流**：2026-09-27 已按产品决策移除全部接口级 / 业务级限流（见 `docs/ISSUES_PRODUCT_FIXES.md` Issue 3），后续如出现滥用需补图形验证码 / 人机验证
- 💤 **智能匹配**：冷启动期数据密度不足，P3 再评估

## 数据与素材说明

- **推免加分**：56 项认定清单提取自《校教〔2026〕39 号》文（原件存 `data/`，不入库），提取脚本 `python apps/api/prisma/extract_bonus.py > apps/api/prisma/bonus-list.json`
- **品牌素材**：`assets/brand/` 原始 PNG 经 `python scripts/prepare_brand_assets.py` 加工输出到 `apps/web/public/brand/`；校训「求实求真 · 大气大为」以文字排版呈现于登录页与页脚
- 校徽、校名等标识版权归电子科技大学所有，本项目仅用于校内公益平台

## 许可

本仓库未附加开源许可证，**保留所有权利（All Rights Reserved）**。
