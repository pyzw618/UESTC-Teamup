# Share LLM 前端代码存档（五大面板完整版）

抓取时间：2026-09-19 · 来源：`https://sharellm.net`（ZCode 内置浏览器 + 用户登录态）
覆盖面板：**首页（/）、控制台（/dashboard）、模型市场（/market）、排行榜（/rankings）、关于（/about）**
抓取方式：Cloudflare 验证通过后，由页面内部 fetch 资源并回传本地落盘，所有文件与线上 served 内容逐字节一致。

## 目录结构

```
sharellm-frontend/
├── site/                          # 完整站点资源（保持线上目录结构）
│   ├── index-source.html          # 服务器返回的原始 HTML（SPA 壳，登录前后内容相同）
│   ├── home-rendered.html         # ★ 首页渲染完成 DOM
│   ├── dashboard-rendered.html    # ★ 控制台渲染完成 DOM（落地 /dashboard/models）
│   ├── market-rendered.html       # ★ 模型市场渲染完成 DOM（567KB，含真实数据）
│   ├── rankings-rendered.html     # ★ 排行榜渲染完成 DOM
│   ├── about-rendered.html        # ★ 关于页渲染完成 DOM（服务条款）
│   ├── routes-chunk-map.json      # ★ 五个面板 → 各自懒加载 chunk 的映射（实测）
│   ├── webpack-chunk-map.json     # 全部 421 个懒加载 chunk 的 id→hash 映射（可按需下载其余路由代码）
│   ├── asset-inventory.json       # 资源清单（JS/CSS/字体/图片/接口列表）
│   ├── static/js/                 # 全部 33 个 JS（5 主包 + 28 懒加载分包）
│   │   ├── index.dab3abaf03.js    # 应用主包（含路由表，五个面板路由在此注册）
│   │   ├── lib-react.58e4354059.js
│   │   ├── vendor-ui-primitives… / vendor-tanstack…
│   │   ├── 40.eb2ecbd178.js       # 公共布局分包
│   │   └── async/                 # 各面板分包（对应关系见 routes-chunk-map.json）：
│   │                              #   首页 2198(5MB) · 市场 8036/2286/7735/6196 ·
│   │                              #   排行榜 3322(640KB) · 关于 4349 · 控制台复用共享分包
│   ├── static/css/                # 全部 2 个 CSS（index 主包 517KB 含全部动画）
│   ├── static/font/               # KaTeX/Lora/Public Sans 等字体（woff2/woff/ttf）
│   ├── logo.png / badges/         # 图片资源
│   └── animations/runtime-animations.json  # 运行时动画快照
├── screenshots/                   # 每个面板的首屏 + 整页截图（共 10 张）
├── animations/                    # ★ 动画专项档案
│   ├── animation-report.md        # 动画分析报告（33 个 keyframes 详解 + 复刻建议）
│   ├── keyframes-all.css          # 全部 @keyframes 原文
│   ├── animation-rules.css        # 全部应用动画的选择器规则
│   ├── transition-tokens.json     # 过渡时长/缓动设计变量统计
│   └── keyframes-index.json
└── README.md
```

## 技术栈速览

- **React SPA**（react + tanstack query/router），webpack 构建，代码分割（421 个 async chunk）
- TanStack Router 文件式路由：`/market` 路由注册于 index 主包，懒加载 chunk `8036 + 2286 + 7735 + 6196`
- UI 风格：渐变背景 + 玻璃拟态卡片（`backdrop-filter`）、圆角、柔和阴影
- 动画：33 个 `@keyframes` + 大量 80–250ms 的 `transition` 微交互（详见 `animations/animation-report.md`）
- 其他：KaTeX 公式渲染、sonner 风格 toast、Cloudflare Turnstile 防护

## 如何阅读代码

- JS 为生产环境压缩产物（无 source map，站点未开放 `.map`）。
  想看某个功能逻辑：在 `site/static/js/` 内搜索关键词（如 `market`、`animationName`、类名、接口路径）。
- `market-rendered.html` 是还原"设计还原度"的最佳参考：完整 class 名、内联样式、数据驱动结构都在。
- `animations/keyframes-all.css` 可直接复制到自己的项目里用（每个 keyframes 都标注了来源文件）。

## 本地预览（仅静态壳，无后端）

```bash
cd sharellm-frontend/site
npx http-server -p 8080
# 打开 http://127.0.0.1:8080 —— 能看到页面壳与部分静态渲染；
# 接口数据（/api/*）需要后端，未包含在本存档内，表格数据请参考 market-rendered.html。
```

## 下载其余路由的前端代码

`webpack-chunk-map.json` 记录了全部 421 个 chunk 的哈希。任一路由的 chunk URL 形如：

```
https://sharellm.net/static/js/async/<id>.<hash>.js
```

在**已登录的浏览器**控制台里 `fetch(url)` 即可获取（该站对非浏览器指纹直接 403，请勿用脚本直连）。

## 版权与用途说明

本存档仅供个人学习研究该站的前端设计与动画实现，请勿用于商业用途或公开 redistribution；代码版权归 Share LLM 站点所有方。
