# 技术栈与架构

> 相关：[README.md](./README.md)（项目速览）、[DATA_MODEL.md](./DATA_MODEL.md)、[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)

---

## 1. 选型的唯一出发点：2 核 2G

本项目所有技术决策都被这一条约束推导出来：**服务器 2 核 2G，峰值用户 < 1000（真实并发只有几十）**。

**核心判断**：2C2G 上的第一杀手是 JVM。Spring Boot 空跑即吃 500–800MB，叠加 PostgreSQL + Redis 必然 OOM。**这是排除 Java 的唯一原因** —— 如果将来服务器扩容，这个结论需要重新评估。

同理被排除的还有：
- **Elasticsearch**（光它就要 1G）→ 用 PG 全文检索替代
- **无头浏览器 Playwright/Puppeteer**（常驻 300–500MB）→ 只抓静态可解析的源
- **微服务 / K8s**（2G 跑不动，且纯属自找麻烦）→ 单体 + 模块化边界

---

## 2. 选型总表

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 前端框架 | Vue 3 + TypeScript | 3.x | 校园/管理型项目生态最成熟，中文资料多 |
| 构建 | Vite | 5.x | |
| 状态 | Pinia | 2.x | |
| 路由 | Vue Router | 4.x | |
| UI 组件 | **Element Plus** | 2.x | 表格、表单、后台页面开发极快 |
| 样式 | UnoCSS | | 原子化，按需生成，产物体积小 |
| 日历组件 | **FullCalendar** | 6.x | 跨天区间条带、多资源着色、月/周/列表视图开箱即用。**自己写日历是纯浪费时间** |
| 后端框架 | **NestJS** | 10.x | 全栈 TS 同语言；模块化能力天然契合一节一 module 的架构 |
| ORM | **Prisma** | 5.x | 迁移体验极好，类型安全 |
| 参数校验 | class-validator + class-transformer | | NestJS 官方搭档 |
| 数据库 | **PostgreSQL** | 16 | `shared_buffers=256MB` 调优后约 350MB |
| 缓存 | **Redis** | 7 | 验证码、限流、Session、采集任务锁 |
| 全文检索 | PG 全文检索 + pg_trgm | | 中文可配 zhparser；**不用 Elasticsearch** |
| 抓取 | **undici + cheerio** | | 纯 HTTP + HTML 解析，约 30MB |
| 邮件 | nodemailer（SMTP） | | 封装在 `MailProvider` 接口后 |
| 定时任务 | @nestjs/schedule | | 应用内 cron，不引入外部调度器 |
| 部署 | Docker Compose + Nginx + Cloudflare CDN | | 单机 |
| HTTPS | Let's Encrypt（certbot）或 Caddy 自动签发 | | |
| 监控 | Uptime Kuma + 日志落盘 | | 主站挂了必须知道 |
| CI/CD | GitHub Actions → 构建镜像 → SSH 部署 | | |
| 包管理 | **pnpm workspace** | | monorepo |

---

## 3. 两条选型红线

### 3.1 ❌ 禁用无头浏览器

Playwright / Puppeteer / Selenium 单实例常驻内存 300–500MB，2C2G 直接爆掉。

**✅ 只抓静态可解析的源**（服务端渲染的 HTML / 公开 JSON API）。

**选源原则（重要）**：优先选择**由 CMS 生成、结构稳定的页面**（教务处、学院官网、竞赛官网的通知列表页）。
如果某个源是纯前端 JS 渲染（`<div id="app"></div>` 然后 fetch 数据），**要么找到它背后的 JSON API 直接调，要么放弃这个源改人工录入** —— 不要为了一个源上无头浏览器。

### 3.2 ❌ 禁用 JVM 系

见 §1。**这条只在服务器保持 2C2G 时成立。**

---

## 4. 内存预算

| 组件 | 内存 |
|---|---|
| OS + 基础 | ~250 MB |
| Nginx / Caddy | ~30 MB |
| NestJS API | ~250 MB |
| PostgreSQL 16 | ~350 MB |
| Redis 7 | ~50 MB |
| 抓取 worker（cron 时峰值） | ~50 MB |
| **合计** | **~980 MB / 2048 MB** |

**余量约 1G。** 抓取任务串行执行、用完即释放，不会与 API 争抢。

> **加任何新组件前，先往这张表里加一行。** 余量只有 1G，加两个常驻服务就见底了。

---

## 5. 系统架构

```
        手机 / PC
            │
    ┌───────▼────────┐
    │ Cloudflare CDN │ ← 静态资源 / 图片
    └───────┬────────┘
            │ HTTPS
    ┌───────▼────────┐
    │  Nginx / Caddy │  反代 · 限流 · TLS
    └───────┬────────┘
            │
    ┌───────▼────────────────┐
    │  单体 API 服务（模块化） │  radar 模块 + match 模块
    │  └─ 内置 cron worker    │
    │       ├ 采集任务（串行） │
    │       ├ DDL 提醒        │
    │       ├ 状态归档        │
    │       └ 邮件队列        │
    └──┬─────────────────┬───┘
       │                 │
  ┌────▼─────┐      ┌────▼────┐
  │PostgreSQL│      │  Redis  │
  └──────────┘      └─────────┘
```

**关键：单体 + 模块化边界清晰，绝不微服务。**
代码上把 `radar/`（含 `crawler/` 子模块）与 `match/` 拆成独立 module，未来要拆服务时才有路可退。

---

## 6. 仓库结构

```
uestc-teamup/
├─ apps/
│  ├─ api/                     # NestJS 后端
│  │  ├─ src/
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/              # 校园邮箱登录
│  │  │  │  ├─ users/             # 用户与个人名片
│  │  │  │  ├─ radar/             # 竞赛雷达
│  │  │  │  │  ├─ crawler/           # 采集子系统（见 MODULE_CRAWLER.md）
│  │  │  │  │  │  ├─ fetcher.ts      # 抓取
│  │  │  │  │  │  ├─ parser.ts       # 解析
│  │  │  │  │  │  ├─ differ.ts       # 变更检测
│  │  │  │  │  │  ├─ matcher.ts      # 竞赛匹配
│  │  │  │  │  │  ├─ guard.ts        # 异常拦截器（安全带①）
│  │  │  │  │  │  └─ sources/        # 各源的选择器配置
│  │  │  │  │  ├─ competitions/      # 竞赛档案
│  │  │  │  │  └─ calendar/          # 日历与 .ics 导出
│  │  │  │  ├─ match/             # 队友匹配
│  │  │  │  ├─ mail/              # MailProvider 抽象 + QqSmtp 实现
│  │  │  │  ├─ notification/
│  │  │  │  └─ admin/             # 数据源管理 / 异常拦截 / 版本回滚 / 纠错处理 / 举报
│  │  │  ├─ common/               # 守卫 / 拦截器 / 过滤器 / 限流
│  │  │  ├─ jobs/                 # cron worker
│  │  │  └─ main.ts
│  │  ├─ prisma/schema.prisma
│  │  └─ Dockerfile
│  └─ web/                     # Vue 3 前端
│     ├─ src/
│     │  ├─ views/radar/          # 竞赛列表 / 详情 / 日历
│     │  ├─ views/match/          # 队伍列表 / 详情 / 发布 / 队伍空间
│     │  ├─ views/admin/          # 管理后台
│     │  ├─ components/ api/ stores/ router/ utils/
│     ├─ vite.config.ts
│     └─ Dockerfile
├─ packages/shared/            # 共享 TS 类型（前后端共用的 DTO）
├─ deploy/
│  ├─ docker-compose.yml
│  ├─ nginx.conf
│  ├─ pg.conf                  # PostgreSQL 内存调优参数
│  └─ .env.example
└─ docs/                       # 本目录
```

---

## 7. 部署要点

| 项 | 做法 |
|---|---|
| 数据库调优 | `shared_buffers=256MB`、`effective_cache_size=768MB`、`work_mem=8MB`、`max_connections=50` |
| 静态资源 | 前端构建产物由 Nginx 直接服务；图片走 Cloudflare CDN |
| 图片上传 | 早期落本地磁盘 + Nginx 静态服务；注意磁盘容量与压缩 |
| HTTPS | Let's Encrypt 自动续期，或 Caddy 自动签发 |
| 备份 | **PG 每日 `pg_dump` 异地备份**（见 §8） |
| 日志 | 落盘 + logrotate，不要指望在 2G 机器上跑 ELK |
| 进程守护 | Docker Compose `restart: unless-stopped` |

---

## 8. 后加的 1 核 1G 用途（按优先级）

1. **备份 + 监控节点** —— PG 每日 `pg_dump` 异地备份 + Uptime Kuma。**最重要**，主站挂了才知道；数据丢了才是真的完了。
2. **采集 worker 节点** —— 把抓取/解析彻底挪出主站，主站只服务请求。**优先级在 v0.2 后上升**，因为采集是整个系统里唯一有外部依赖、最不稳定的组件。
3. **Redis / 静态资源分流**
4. **PG 只读从库** —— 最后考虑，1G 跑 PG 从库较勉强
