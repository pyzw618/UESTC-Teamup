# UESTC TeamUp · 成电人的竞赛罗盘

电子科技大学校内竞赛信息与组队平台 —— **竞赛雷达**（自动监听竞赛信息、不错过 DDL）+ **队友匹配**（结构化组队卡 + 状态机 + 申请审批流）。

## 一键启动（开发）

### 0. 依赖环境

- Node ≥ 20、pnpm ≥ 9
- PostgreSQL 16+ 与 Redis 7+（本机开发使用 WSL2 Ubuntu，见下）

### 1. 启动数据库（WSL2）

```bash
wsl -d Ubuntu -e bash -c "systemctl start postgresql redis-server"
```

已配置（首次安装已完成）：

- 数据库 `teamup` / 用户 `teamup` / 密码 `teamup_dev`，已启用 pg_trgm 扩展
- PG 监听 `0.0.0.0:5432`、Redis 监听 `0.0.0.0:6379`（WSL mirrored 网络，Windows 侧经 `127.0.0.1` 直连）
- `.wslconfig` 已设置 `vmIdleTimeout=28800000`，避免 WSL 空闲关机导致数据库"失联"
- **注意**：连接串必须用 `127.0.0.1` 而不是 `localhost`（PG 只绑 IPv4，Node 会先解析 ::1）

### 2. 安装与启动

```bash
pnpm install
pnpm -F @teamup/shared build   # 首次需要
pnpm db:seed                  # 写入 59 个竞赛（含 56 项推免认定清单）+ 演示用户/队伍
pnpm dev                      # 同时启动 api(:3000) 与 web(:5173)
```

打开 http://localhost:5173 。

### 3. 登录（邮件留空，dev 验证码模式）

**两种登录方式**：验证码登录（首次即注册）与密码登录。首次用验证码登录后可在弹窗或「个人中心 → 登录密码」设置密码；忘记密码走登录页「忘记密码？」邮件验证码找回（dev 模式验证码打印到后端控制台并随响应 `dev.devCode` 回显）。

| 内置账号 | 密码 | 说明 |
|---|---|---|
| `2024080909015@std.uestc.edu.cn` | `123456789` | 管理员，登录后自动进入 `/admin` 后台 |
| `2024080909000@std.uestc.edu.cn` | `123456789` | 普通测试用户 |
| 其余 4 个演示用户 | 无密码 | 用验证码登录后可设置密码 |

**队友招募信息仅登录可见**：游客访问队伍列表/详情及竞赛详情的招募区块时，展示整块磨砂玻璃提示；后端对应接口（`GET /teams`、`GET /teams/:id`）要求登录，游客请求首页时热招队伍返回空数组。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 前后端并行开发（api watch / web vite） |
| `pnpm db:migrate` | Prisma 迁移（开发库） |
| `pnpm db:seed` | 重置并写入种子数据 |
| `pnpm build` | 全量构建 |

## 两项"留空"功能的位置与接缝

| 功能 | 状态 | 接缝 |
|---|---|---|
| **邮件发送** | 留空，仅 ConsoleDevProvider | 实现 `apps/api/src/modules/mail/qq-smtp.provider.ts`（nodemailer + smtp.qq.com:465），`.env` 设 `MAIL_PROVIDER=qq` 即切换；限流/防枚举/会话已就绪 |
| **竞赛爬取** | 留空，数据靠人工录入 + 种子 | 表结构已建（CrawlSource/Snapshot/Item/Anomaly/Revision），按 MODULE_CRAWLER §10 顺序补 fetcher→parser→matcher→guard→publisher；`/admin/sources`、`/admin/anomalies` 页面随之补 |

## 仓库结构

```
├─ apps/api          NestJS 10 + Prisma 5 + PG16 + Redis7
│  ├─ src/modules/   auth / users / mail / notification / radar / match / admin
│  ├─ src/jobs/      DDL 提醒（7/3/1 天）+ 队伍状态归档 cron
│  └─ prisma/        schema + seed + extract_bonus.py（PDF 提取认定清单）
├─ apps/web          Vue 3 + Vite + Pinia + Element Plus + UnoCSS + FullCalendar
│  └─ src/styles/    UESTC 深蓝 + 银杏黄 玻璃拟态设计系统
├─ packages/shared   前后端共享枚举与类型
├─ deploy/           docker-compose.yml / nginx.conf / pg.conf / .env.example
└─ docs/             设计文档（唯一需求来源）
```

## 设计要点

- **半匿名规则**：服务端序列化裁剪，陌生人只见昵称/学院/年级/专业/技能；同队/管理员解锁学号与联系方式（实现见 `viewer.context.ts` + `viewer.middleware.ts`，一次性预载 teamIds 防 N+1）
- **联系方式隐私（Q8）**：组队卡联系方式申请通过后才可见，不公开渲染
- **人工锁定（Q9）**：管理员/纠错采纳改过的时间轴节点 `isLocked=true`，未来爬虫接入后不会被自动更新覆盖；全部字段变更记入 `CrawlRevision`，`/admin/revisions` 支持一键回滚（回滚动作本身也记录）
- **自动发布安全带**：本次虽留空爬虫，但 `/admin/corrections`（纠错处理台）与 `/admin/revisions`（版本回滚）已就绪
- **推免加分**：独立口径字段，56 项认定清单直接从校教〔2026〕39 号 PDF 提取（`python apps/api/prisma/extract_bonus.py > apps/api/prisma/bonus-list.json`）
- **品牌素材**：`LOGO&成电元素/` 原始素材经 `python scripts/prepare_brand_assets.py` 加工后输出到 `apps/web/public/brand/`——校徽（导航/favicon 全套）、主楼与图书馆线稿（白线转绘为校徽深蓝，作首页/登录页/页脚装饰）、银杏（转绘为 token 金 #D99F00，首页摇曳点缀）；校训「求实求真 · 大气大为」以文字排版呈现于登录页与页脚
- **视觉**：参考站玻璃拟态布局与动效语言，配色替换为校徽深蓝 `#0F4C8C` + 银杏黄 `#F5B901`，token 见 `apps/web/src/styles/main.css` 与 `uno.config.ts`

## 生产部署

```bash
cd deploy && cp .env.example .env   # 填写密码与 SMTP
docker compose up -d --build
```

PG 参数按 2C2G 调优（shared_buffers=256MB 等，见 pg.conf）；HTTPS 建议前置 Caddy 或 Certbot。
