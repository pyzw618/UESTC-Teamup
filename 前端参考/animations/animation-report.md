# Share LLM 前端动画效果分析报告

> 抓取时间：2026-09-19 · 页面：`https://sharellm.net/market`（登录态渲染）
> 本报告由下载的静态 CSS 与页面运行时数据（`document.getAnimations()`）交叉分析生成。

## 一、总体架构

该站动画分三层实现：

1. **CSS `@keyframes` 动画**：共 33 个定义，36 条规则引用。集中在 `static/css/index.b23e910b4c.css`（主样式包，含全部业务动画）。
2. **CSS transition 微交互**：按钮悬停、卡片阴影/位移、下拉展开等，时长集中在 `0.12s–0.25s`，缓动以 `ease-out` 为主，另有一个弹性缓动 `cubic-bezier(.22,1.4,.36,1)`（带轻微回弹，用于强调性出现动画）。
3. **运行时动画**：登录后 market 页面即时捕获到 **48 个正在播放的动画实例**（24 种组合），如公告光带流动、数字徽章旋转与闪光。

## 二、@keyframes 清单（33 个）

### 布局/入场类
| 名称 | 推测用途 |
| --- | --- |
| `appear` / `appear-zoom` | 通用入场（淡入 / 缩放淡入） |
| `slideDown` / `slideUp` | 顶部通知条、抽屉滑入 |
| `enter` / `exit` | 通用进出（配合 toast/弹层） |
| `tableRowEnter` | **市场表格行入场动画** |
| `accordion-down` / `accordion-up` | 手风琴展开收起 |
| `landing-fade-up/-in/-left/-right`、`landing-scale-in` | 落地页滚动入场 |

### 品牌/氛围光效类（market 页的视觉亮点）
| 名称 | 推测用途 |
| --- | --- |
| `notice-aura-flow-band` / `notice-aura-flow-tail` | 公告横幅上的流动光带（运行时确认在播放） |
| `rank-aura-spin` | 排行榜徽章光环旋转 |
| `oauth-badge-shimmer-sweep` | 官方认证徽章的高光扫过 |
| `auto-route-card-aura-flow` / `auto-flow-line` | "加入路由"卡片的光环流动与流光线 |
| `sl-number-badge-spin` / `sl-number-badge-glare` | 序号徽章旋转 + 眩光（运行时确认在播放） |

### 反馈/工具类
| 名称 | 推测用途 |
| --- | --- |
| `skeleton-shimmer` / `tw-shimmer` | 骨架屏微光 |
| `spin` / `ping` / `pulse` | 加载指示、脉冲点 |
| `caret-blink` | 输入光标闪烁 |
| `scroll-up` | 回到顶部滚动 |
| `terminal-demo-blink/-spin/-pulse` | 终端演示动效 |
| `auto-brand-pane-in` | 品牌面板切入 |

## 三、Transition 设计变量（来自 index 主 CSS 统计）

- **时长分布**：`.15s`×4、`.25s`×3、`.18s`×3、`.12s`×3、`.16s`×2、`80ms`、`.22s`、`.5s`
  → 设计规范明显控制在 80–250ms 区间，遵循"小交互快反馈"原则。
- **缓动**：`ease-out` 为主，`linear`（连续型动画），弹性 `cubic-bezier(.22,1.4,.36,1)`。
- **过渡属性 Top**：`background-color`、`transform`、`opacity`、`box-shadow`、`color` → 标准的玻璃拟态悬停组合（背景变亮 + 阴影加深 + 轻微位移）。

## 四、复刻建议（按视觉效果分组）

1. **渐变玻璃拟态底**：整页紫→粉→青渐变背景 + 半透明白卡片 + `backdrop-filter: blur`，这是该站最抓眼的设计语言。
2. **卡片悬停**：`transform: translateY(-2px)` + `box-shadow` 加深 + `background-color` 提亮，时长 `.15s–.25s`，`ease-out`。
3. **氛围光带**：`notice-aura-flow-band` 系列是渐变背景位移动画（`background-position` / `transform` 循环），适合横幅与高亮卡片。
4. **表格行入场**：`tableRowEnter`（行级 stagger 淡入上移），配合分页切换使用。
5. **徽章微动效**：`sl-number-badge-spin/glare`、`oauth-badge-shimmer-sweep` 让排名与认证徽章"活"起来。

## 五、文件索引

- `keyframes-all.css` —— 全部 33 个 `@keyframes` 原文
- `animation-rules.css` —— 全部 36 条应用动画的选择器规则（含选择器上下文）
- `transition-tokens.json` —— 过渡时长/缓动/属性频次统计
- `keyframes-index.json` —— keyframes 名称索引
- `runtime-animations.json` —— 页面运行时动画快照（`site/animations/` 下）
