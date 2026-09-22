# 贡献指南

本项目为电子科技大学校内平台，开发协作遵循以下约定。环境搭建见 [README 快速开始](./README.md#-快速开始)。

## 分支模型

- `main`：始终可用，受保护，只接受 PR 合入
- 功能分支：`<type>/<topic>`，例如 `refactor/match-state-machine`、`feat/crawler-fetcher`
- 一个 PR 只做一件事；涉及数据模型的 PR 必须附迁移说明

## 提交信息规范（Conventional Commits）

```
<type>(<scope>): <中文摘要>

feat(web): 按钮设计系统统一 + 招募/评论/公告多项迭代
refactor(match): 招募帖「广告牌模式」收尾
fix(api): 修复验证码限流在 Redis 重启后失效
```

- **type**：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `build` / `perf`
- **scope**：`api` / `web` / `shared` / `match` / `radar` / `admin` / `mail` / `jobs` / `docker` / `repo` 等模块名
- 摘要用中文、动词开头、不超过 72 字符；多项改动用 `+` / `、` 连接

## 数据模型变更流程

1. 修改 `apps/api/prisma/schema.prisma`
2. `pnpm db:migrate` 生成迁移，**迁移 SQL 必须随 PR 提交**
3. 同步更新 `docs/DATA_MODEL.md`、`docs/FIELDS.md`，以及 `packages/shared` 中受影响的枚举/类型
4. 涉及既有数据语义变化时，在 `docs/OPEN_QUESTIONS.md` 记录决策依据

## 文档先行

`docs/` 是唯一需求来源：需求、字段口径、交互逻辑的变更先改文档、再改代码。文档入口见 [docs/README.md](./docs/README.md)。

## PR 自检清单

- [ ] `pnpm build` 通过（web 端含 `vue-tsc --noEmit` 类型检查）
- [ ] `pnpm -F @teamup/api test` 通过；改动组队状态机必须补/改 `test/teams.spec.ts`
- [ ] 未提交任何机密：`.env`、cookie 文件、SMTP 授权码
- [ ] 前端改动附截图或录屏
- [ ] 不新增第三方重依赖（2C2G 内存预算，见 `docs/TECH_STACK.md`）

## 代码约定

- TypeScript strict，命名直白优先（与产品「直白命名」决策一致，不用隐喻黑话）
- 后端模块边界：`apps/api/src/modules/<domain>/`，controller 只做参数校验与转发，业务放 service
- 半匿名与权限裁剪一律走服务端序列化（`viewer.context.ts`），禁止前端藏字段
