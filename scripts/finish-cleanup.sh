#!/usr/bin/env bash
# 仓库整理·一键完成：清理 + 目录规范化 + 4 个逻辑提交 + 推送
# 用法：在 Claude Code 输入框运行   ! bash scripts/finish-cleanup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PDF="校教〔2026〕39号_关于开展推荐2027届优秀应届本科毕业生免试攻读研究生工作的通知.pdf"

# ── 步骤 1：工作区清理与规范化 ──────────────────────────────
rm -f  apps/api/adm.txt apps/api/test.txt          # curl cookie 垃圾（含 session cookie）
rm -rf listen .firecrawl                           # 空目录 / 抓取会话残留
rm -f  scripts/repo-cleanup.sh                     # 前一版辅助脚本（未入库）
mkdir -p assets data
[ -d "LOGO&成电元素" ] && mv "LOGO&成电元素" assets/brand
[ -f "$PDF" ]          && mv -n "$PDF" data/
[ -f net.csv ]         && mv -n net.csv data/competition-sites.csv
[ -f "docs/字段清单.md" ] && mv "docs/字段清单.md" docs/FIELDS.md

# ── 步骤 2：全部暂存（重命名以 删除+新增 呈现，git 自动识别）──
git add -A

# ── 步骤 3：按逻辑分组提交 ──────────────────────────────────
git commit -q -m "chore(repo): 清理垃圾文件并收紧忽略规则

- 删除 adm.txt/test.txt（curl 会话 cookie 残留，不应入库）
- 取消跟踪 前端参考/、.zcodeignore、校教〔2026〕39号 PDF（本地保留）
- .gitignore 分类化重写；新增 .editorconfig、CONTRIBUTING.md" -- \
  apps/api/adm.txt apps/api/test.txt .zcodeignore "前端参考" "$PDF" \
  .gitignore .editorconfig CONTRIBUTING.md

git commit -q -m "refactor(repo): 资产与数据目录规范化

- LOGO&成电元素/ → assets/brand/（去除 & 与中文路径，更新加工脚本）
- 根目录 net.csv/PDF → data/（competition-sites.csv 入库；校方 PDF 原件转本地留存）
- docs/字段清单.md → docs/FIELDS.md，同步更新代码注释、提取脚本与文档地图引用" -- \
  assets "LOGO&成电元素" data docs scripts/prepare_brand_assets.py \
  apps/api/prisma/extract_bonus.py packages/shared/src/index.ts

git commit -q -m "build(docker): 补齐生产镜像构建定义

- 新增 docker/Dockerfile.api、Dockerfile.web（构建上下文 = 仓库根，pnpm workspace）
- 修复 docker-compose 引用的 Dockerfile 此前不存在的问题
- 新增 .dockerignore 与 apps/api/.env.example" -- \
  docker deploy/docker-compose.yml .dockerignore apps/api/.env.example

git commit -q -m "docs(readme): 按 GitHub 标准格式重写 README

徽章/目录/功能特性/技术栈表/mermaid 架构/快速开始/命令表/部署/文档索引/路线图/许可" -- \
  README.md

# 兜底：若仍有散落改动，收进最后一个提交
git status --porcelain | grep -q . && { git add -A && git commit -q --amend --no-edit; } || true

# ── 步骤 4：推送 ────────────────────────────────────────────
git push -u origin main || { git pull --rebase origin main && git push -u origin main; }

rm -f scripts/finish-cleanup.sh
echo "===== ALL DONE ====="
git log --oneline -6
