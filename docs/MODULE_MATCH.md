# 关键模块：队友匹配

> 相关：[README.md](./README.md)（项目速览）、[DATA_MODEL.md](./DATA_MODEL.md) §6、[PAGES.md](./PAGES.md) §3

---

## 1. 模块定位

**核心原则：不复刻论坛帖子，做成结构化组队卡 + 状态机。**

> **不做智能匹配算法。** 队友发现仅依赖「结构化筛选 + 手动浏览」。
> 理由：匹配算法需要足够的数据密度才有意义，冷启动期用户量和标签覆盖率都不足以支撑，做了也是空转。留到 P3，等数据够了再说。
>
> 注意区分：竞赛雷达的"按学院/年级推竞赛"是**规则筛选**，不是算法匹配，保留。

**这个模块相对论坛的三个不可替代性**（做不好就等于没做）：
1. **状态机** —— 帖子会沉底、状态不更新，组队卡不会
2. **结构化** —— 能按缺口角色、目标、竞赛筛选，帖子只能靠关键词搜
3. **闭环** —— 申请审批在站内完成，不用在评论区喊"还缺人吗"

---

## 2. 队伍状态机

```
                    ┌──────────────┐
                    │  招募中       │  RECRUITING
                    │  RECRUITING  │  ← 创建时默认状态，接收申请
                    └──┬────┬───┬──┘
        队长手动开启沟通 │    │   │ 招满（缺口角色全部 filled）
                        │    │   └──────────────┐
                        ▼    │                  ▼
              ┌──────────────┐│          ┌──────────────┐
              │  沟通中       ││          │  已满员       │  FULL
              │  NEGOTIATING ││          │  FULL        │  ← 默认不出现在列表中
              └──────┬───────┘│          └──────┬───────┘
                     │        │                 │
                     └────────┴────────┬────────┘
                                       │ 队长手动标记参赛
                                       ▼
                              ┌──────────────┐
                              │  已参赛       │  COMPETING
                              │  COMPETING   │  ← 可发起互评
                              └──────┬───────┘
                                     │
                    队长手动解散 ────┴──── 竞赛结束 60 天后自动归档
                                     ▼
                              ┌──────────────┐
                              │  已解散       │  DISBANDED
                              │  DISBANDED   │  ← 归档，不再展示
                              └──────────────┘
```

### 自动流转规则（cron 每日执行）

| 触发条件 | 动作 | 理由 |
|---|---|---|
| `deadline`（招募截止）已过 且状态为 RECRUITING | 保持展示但**关闭申请入口**，列表加「已截止」标记 | 论坛被诟病的正是满屏没截止标记的僵尸帖 |
| 竞赛报名截止已过 30 天 且状态为 RECRUITING/NEGOTIATING | 自动转 DISBANDED | 报名都结束了还挂着招募，是纯噪音 |
| 状态为 COMPETING 且竞赛结束 60 天 | 自动转 DISBANDED | |

> **自动流转是"结构化优于帖子"的核心体现。** 论坛帖子不会自己更新状态，因为没人有动力回来改。而我们的状态可以靠时间和规则自动推进。

### 默认可见性

**列表默认只显示 `RECRUITING` 和 `NEGOTIATING`。** FULL / COMPETING / DISBANDED 需手动勾选才可见。

---

## 3. 申请-审批双向流

```
【方向一：我申请加入】
  浏览者 → 队伍详情 → 点「申请加入」
              ↓ 填写自我介绍 + 技能证明（文本 / GitHub 链接）
       Application(PENDING)
              ↓ 通知队长（站内信 + 邮件）
       队长在 /me/applications 看到 → 同意 / 婉拒
              ↓
       ├─ 同意 → 加入 TeamMember，消耗一个 TeamSlot
       │        通知申请人，双方解锁完整联系方式
       └─ 婉拒 → 附理由（提供模板，降低社交压力）
                 通知申请人

【方向二：队长邀请】
  队长浏览个人名片 → 点「邀请加入」
              ↓
       Invitation(PENDING) → 通知被邀请人
              ↓
       被邀请人同意 / 拒绝 → 同上述流程
```

**婉拒理由模板**（降低社交压力，这是产品细节但很重要）：

```
□ 队伍已经招满了
□ 你的技能方向和我们的缺口不太匹配
□ 我们已经找到合适的队友了
□ 其他（自由填写）
```

> **为什么要有模板**：陌生人之间的拒绝是心理成本极高的事。没有模板，队长要么选择"直接不理"（申请人干等），要么写一句生硬的拒绝。**给模板等于给了台阶。**

### 并发问题

**如果两个人同时申请、只剩一个位置**：审批时必须在事务里检查 `TeamSlot.filled`，用乐观锁或行锁防止超额录取。

---

## 4. 半匿名规则

| 状态 | 可见信息 |
|---|---|
| 陌生人 | 昵称、学院、年级、专业、技能标签、参赛经历 |
| **同队成员 / 已通过申请 / 管理员** | 学号、姓名、联系方式 |

**实现要点：在序列化层裁剪，不能只靠前端隐藏。**

```ts
type Viewer = { userId?: string; role: UserRole; teamIds: string[] };

function serializeUser(u: User, viewer: Viewer) {
  const base = { id: u.id, nickname: u.nickname, college: u.college,
                 grade: u.grade, major: u.major };

  const canSeePrivate =
    u.id === viewer.userId ||
    viewer.role === UserRole.ADMIN ||
    viewer.teamIds.some(tid => u.teamIds.includes(tid));   // 同队

  return canSeePrivate ? { ...base, studentNo: u.studentNo, contact: u.contact } : base;
}
```

> ⚠️ **性能坑**：判断"是否同队"要查库。**列表页若对每个用户都查一次，就是 N+1 查询。**
> 解法：在请求上下文（如 AsyncLocalStorage 或 request-scoped 缓存）里，**一次性查出当前用户所在的全部 teamId**，序列化时用内存集合比对。

---

## 5. 结构化筛选（替代算法匹配的主力）

筛选维度**必须与组队卡字段严格对齐**，否则筛不出来。

```ts
const where: Prisma.TeamWhereInput = {
  // 默认只看还在招人的
  status: { in: ['RECRUITING', 'NEGOTIATING'] },

  ...(q.competitionId && { competitionId: q.competitionId }),
  ...(q.goal && { goal: q.goal }),

  // 缺口角色：存在"未招满且角色命中"的 slot
  ...(q.roles?.length && {
    slots: { some: { role: { in: q.roles }, filled: false } }
  }),

  // 还没截止的
  ...(q.onlyOpen && {
    OR: [{ deadline: null }, { deadline: { gte: new Date() } }]
  }),
};
```

配套索引（见 [DATA_MODEL.md](./DATA_MODEL.md)）：`Team(status, competitionId)`、`TeamSlot(teamId, role, filled)`、`Team(deadline)`。

> ⚠️ 原稿筛选维度里还有「技能标签、校区、投入时长」，但这三个字段在 v0.3 的组队卡改版中已被删除。**筛选维度必须跟着改**，见 [OPEN_QUESTIONS Q1](./OPEN_QUESTIONS.md)。

---

## 6. 反垃圾与防刷

| 风险 | 对策 |
|---|---|
| 批量发垃圾组队帖 | 每人每日发帖上限（如 5 个）、新用户首帖限流 |
| 恶意申请骚扰 | 同一用户对同一队伍只能有一条 PENDING 申请；被拒后冷却期 |
| 联系方式被爬 | 见 [OPEN_QUESTIONS Q8](./OPEN_QUESTIONS.md) |
| 重复发帖 | 提交前检测：同用户 + 同竞赛 + 24 小时内已有招募帖 → 提示 |

---

## 7. P3 预留：智能匹配

**触发条件**：当平台同时满足 —— 活跃队伍 > 100 支、技能标签覆盖率 > 60%、用户量 > 500。

届时可做：
- 基于技能标签 + 目标 + 年级的加权匹配分
- 语义匹配（"我会写 Rust 做过嵌入式" → 匹配电赛队伍）
- 双向推荐：「你可能适合的队伍」+「这些队伍正缺你这样技能的人」

**现在不做，但数据模型要留好口子** —— `UserSkill` 表就是为这个预留的（见 [OPEN_QUESTIONS Q6](./OPEN_QUESTIONS.md)）。
