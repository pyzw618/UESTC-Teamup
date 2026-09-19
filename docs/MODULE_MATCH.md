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

> 重构后状态统一为：`RECRUITING / PAUSED / FULL / COMPETING / DISBANDED / ARCHIVED`。
> 旧状态 `NEGOTIATING` 已迁移为 `PAUSED`（见 `prisma/migrations/20260919120000_refactor_match_state_machine`）。

```
                 ┌──────────────┐  队长暂停招募   ┌──────────────┐
                 │  招募中       │ ─────────────▶ │  暂停招募     │
  创建时默认 ───▶│  RECRUITING  │ ◀───────────── │  PAUSED      │
                 └───┬──────────┘  队长恢复招募   └───┬──────────┘
                     │  最后一个名额被填满             │ 最后一个名额被填满
                     ▼                                 ▼
                 ┌────────────────────────────────────────┐
                 │  已满员  FULL                            │
                 └───┬────────────────────────────────┬───┘
                     │ 成员退出/被移除 → PAUSED         │ 队长标记参赛
                     │ （绝不自动回到 RECRUITING）      ▼
                     │                          ┌──────────────┐
                     │   队长“重新调整阵容” ◀─── │  已参赛       │
                     │   （回到 PAUSED）         │  COMPETING   │
                     │                          └──────┬───────┘
 队长主动解散 ────────┴──────────────┐                  │ 竞赛结束 60 天后
                                     ▼                  ▼
                              ┌──────────────┐   ┌──────────────┐
                              │  已解散       │   │  已归档       │
                              │  DISBANDED   │   │  ARCHIVED    │
                              │  人为终止     │   │  正常结束     │
                              └──────────────┘   └──────────────┘
```

**语义要点**

| 状态 | 可新申请/邀请 | 可处理已有候选人 | 成员退出 |
|---|---|---|---|
| RECRUITING | ✅ | ✅ | ✅（名额恢复 OPEN；原状态保持） |
| PAUSED | ❌ | ✅ | ✅ |
| FULL | ❌ | ❌（入 FULL 时未兑现的请求自动 EXPIRED） | ✅ → 回到 PAUSED |
| COMPETING | ❌ | ❌ | ✅（保持 COMPETING，通知队长） |
| DISBANDED | ❌ | ❌ | ❌ |
| ARCHIVED | ❌ | ❌ | ❌ |

### 自动流转规则（cron 每日执行）

| 触发条件 | 动作 | 理由 |
|---|---|---|
| `deadline`（招募截止）已过 且状态为 RECRUITING | 保持展示但**关闭申请入口**，列表加「已截止」标记 | 论坛被诟病的正是满屏没截止标记的僵尸帖 |
| 竞赛报名截止已过 30 天 且状态为 RECRUITING/PAUSED/FULL | 自动转 **ARCHIVED** | 报名都结束了还挂着招募，是纯噪音 |
| 状态为 COMPETING 且竞赛结束 60 天 | 自动转 **ARCHIVED** | 正常生命周期结束，归档而非解散 |

> **正常结束 ≠ 解散。** 只有队长主动解散才是 `DISBANDED`；比赛周期结束由系统归档为 `ARCHIVED`。
> 归档同时把所有 pending 申请/邀请置为 `EXPIRED`。

### 默认可见性

**列表默认只显示 `RECRUITING`。** PAUSED / FULL / COMPETING 需手动勾选才可见；
**`DISBANDED` 与 `ARCHIVED` 默认且永远不出现在公共组队发现列表。**

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

### 并发问题 / 统一加入流程

**如果两个人同时申请（或申请 + 邀请）、只剩一个位置**：不能“先 `findUnique` 再拿 `slots[0]` 再 update” ——
那是假事务，两个请求仍可能读到同一个 OPEN slot。

重构后申请接受与邀请接受共用同一个 `joinTeam` 事务：

1. `SELECT … FOR UPDATE` 锁队伍行，串行化同一队伍的所有成员/状态变更；
2. 请求在锁内重新读取并确认为 `PENDING`；
3. 校验队伍状态 / 截止时间 / 用户不在本队 / 用户未加入同竞赛其他队；
4. 用 **compare-and-swap**（`updateMany where status=OPEN` 并检查 affected rows）原子占用一个 `role` 匹配的 OPEN slot；
5. 创建/复用 `TeamMember`，回填 `slot.filledByMemberId`，请求置 `ACCEPTED`；
6. 同竞赛其他 pending 请求 `EXPIRED`；若无 OPEN slot → `FULL`。

任一步失败整个事务回滚。跨队伍的“同竞赛一人一队”另由数据库部分唯一索引兜底。
详见 `apps/api/src/modules/match/teams.service.ts` 的 `joinTeam` / `claimSlot`。

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
  // 默认只看还在招人的（DISBANDED / ARCHIVED 永不出现在此）
  status: { in: ['RECRUITING'] },

  ...(q.competitionId && { competitionId: q.competitionId }),
  ...(q.goal && { goal: q.goal }),

  // 缺口角色：存在"仍 OPEN 且角色命中"的 slot
  ...(q.roles?.length && {
    slots: { some: { role: { in: q.roles }, status: 'OPEN' } }
  }),

  // 还没截止的
  ...(q.onlyOpen && {
    OR: [{ deadline: null }, { deadline: { gte: new Date() } }]
  }),
};
```

配套索引（见 [DATA_MODEL.md](./DATA_MODEL.md)）：`Team(status, competitionId)`、`TeamSlot(teamId, role, status)`、`Team(deadline)`。

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
