<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { RoleType, RoleTypeLabel, TeamGoal, TeamGoalLabel, TeamStatus, TeamStatusLabel } from '@teamup/shared';
import { api } from '../../api/client';
import { fmtDate, daysLeft, type TeamDetail } from '../../api/types';
import { safeHref } from '../../utils/safeHref';
import FrostedGate from '../../components/FrostedGate.vue';
import CommentList from '../../components/CommentList.vue';
import UserAvatar from '../../components/UserAvatar.vue';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const team = ref<TeamDetail | null>(null);
const loading = ref(true);

const remaining = computed(() => {
  if (!team.value?.deadline) return null;
  const d = daysLeft(team.value.deadline);
  return d != null && d >= 0 ? d : null;
});

const expired = computed(() => !!team.value?.expired);

const statusText = computed(() => TeamStatusLabel[team.value?.status as TeamStatus] ?? '');

/**
 * M15：写操作按钮只由 viewer.isLeader 控制。
 * 管理员（viewer.isAdmin）在队伍详情页没有编辑/解散权限——后端会返回 403，
 * 所以前端不能给管理员渲染编辑控件（原来渲染了但点下去全 403）。
 * isAdmin 只用于显示「管理员视角」提示。
 */
const isLeaderViewer = computed(() => !!team.value?.viewer?.isLeader);
const isAdminViewer = computed(() => !!team.value?.viewer?.isAdmin && !isLeaderViewer.value);

/** competition.officialUrl 来自采集，走协议白名单后再绑定 */
const competitionUrl = computed(() => safeHref(team.value?.competition?.officialUrl));

const statusClass = computed(() => {
  switch (team.value?.status) {
    case 'RECRUITING': return 'is-recruiting';
    case 'FULL': return 'is-full';
    case 'COMPETING': return 'is-competing';
    default: return 'is-closed';
  }
});

const roleLabel = (r: RoleType | string) => RoleTypeLabel[r as RoleType] ?? r;
const roleOptions = Object.values(RoleType).map((r) => ({ value: r, label: RoleTypeLabel[r] }));
const goalOptions = Object.values(TeamGoal).map((g) => ({ value: g, label: TeamGoalLabel[g] }));

async function load() {
  if (!auth.isLoggedIn) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    team.value = await api.get<TeamDetail>(`/teams/${route.params.id}`);
  } catch {
    ElMessage.error('招募帖不存在');
    router.push({ name: 'teams' });
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// ---------- 队长操作：状态切换 / 编辑 ----------

const STATUS_CONFIRM: Record<string, { tip: string; type: 'warning' | 'info' }> = {
  FULL: { tip: '标记为「已满员」后帖子仍会展示，但会提示同学不再收人。', type: 'info' },
  DISBANDED: { tip: '解散后帖子进入你的「归档仓库」，公共列表不再展示，且不可恢复。', type: 'warning' },
  RECRUITING: { tip: '重新开启招募，帖子恢复为「招募中」。', type: 'info' },
};

async function changeStatus(status: TeamStatus) {
  const confirm = STATUS_CONFIRM[status];
  // H10：ElMessageBox 在用户点「取消」时是 reject（'cancel'），没有外层 catch
  // 就是 unhandled rejection；叉掉弹窗同样走 close 分支。
  try {
    await ElMessageBox.confirm(confirm.tip, `确认切换为「${TeamStatusLabel[status]}」？`, { type: confirm.type });
  } catch {
    return;
  }
  try {
    await api.post(`/teams/${team.value!.id}/status`, { status });
    ElMessage.success('状态已更新');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
    // 失败后回到服务端真实状态，避免本地视图与后端不一致
    await load();
  }
}

/** 队长可用的状态操作（COMPETING 由系统自动设置，不提供按钮） */
const statusActions = computed(() => {
  switch (team.value?.status) {
    case 'RECRUITING': return [TeamStatus.FULL, TeamStatus.DISBANDED];
    case 'FULL': return [TeamStatus.RECRUITING, TeamStatus.DISBANDED];
    case 'COMPETING': return [TeamStatus.DISBANDED];
    default: return [];
  }
});

const statusActionLabel = (s: TeamStatus) =>
  s === TeamStatus.DISBANDED ? '解散帖子' : TeamStatusLabel[s];

// 编辑弹窗
const editVisible = ref(false);
const editSaving = ref(false);
interface EditMember { grade: number | null; college: string; major: string; rank: string; intro: string }
const editForm = ref({
  goal: undefined as TeamGoal | undefined,
  neededRoles: [] as RoleType[],
  requirement: '',
  qq: '',
  wechat: '',
  deadline: null as string | null,
  targetSize: null as number | null,
  members: [] as EditMember[],
});

function addEditMember() {
  if (editForm.value.members.length >= 20) return;
  editForm.value.members.push({ grade: null, college: '', major: '', rank: '', intro: '' });
}

function openEdit() {
  const t = team.value!;
  editForm.value = {
    goal: t.goal as TeamGoal,
    neededRoles: (t.neededRoles ?? []) as RoleType[],
    requirement: t.requirement ?? '',
    qq: t.qq ?? '',
    wechat: t.wechat ?? '',
    deadline: t.deadline ? t.deadline.slice(0, 10) : null,
    targetSize: t.targetSize,
    members: (t.members ?? []).map((m) => ({
      grade: m.grade,
      college: m.college ?? '',
      major: m.major ?? '',
      rank: m.rank ?? '',
      intro: m.intro ?? '',
    })),
  };
  editVisible.value = true;
}

async function submitEdit() {
  if (!editForm.value.qq.trim() && !editForm.value.wechat.trim()) {
    ElMessage.warning('QQ 与微信至少填写一项');
    return;
  }
  editSaving.value = true;
  try {
    /**
     * M10：PATCH 语义是「字段缺省 = 不更新」。
     * 原来 `qq: '' || undefined` 让空串从 JSON 里消失，队长永远删不掉已填的联系方式/截止日。
     * 后端契约：显式传 null 表示清空（targetSize 同样支持 null）。
     */
    await api.patch(`/teams/${team.value!.id}`, {
      goal: editForm.value.goal,
      neededRoles: editForm.value.neededRoles,
      requirement: editForm.value.requirement || null,
      qq: editForm.value.qq.trim() || null,
      wechat: editForm.value.wechat.trim() || null,
      deadline: editForm.value.deadline || null,
      targetSize: editForm.value.targetSize ?? null,
      members: editForm.value.members.map((m) => ({
        grade: m.grade ?? undefined,
        college: m.college || undefined,
        major: m.major || undefined,
        rank: m.rank || undefined,
        intro: m.intro || undefined,
      })),
    });
    editVisible.value = false;
    ElMessage.success('帖子已更新');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
    // H10：保存失败（含后端 403/409 契约校验）时刷新，避免弹窗里的本地值被当成已生效
    await load();
  } finally {
    editSaving.value = false;
  }
}

</script>

<template>
  <div class="page-wrap">
    <!-- 游客：磨砂玻璃门 -->
    <div v-if="!auth.isLoggedIn && !loading" class="max-w-860px mx-auto">
      <FrostedGate
        title="招募帖详情仅对登录同学可见"
        description="登录后查看招募要求、招募方向，并直接获取队长联系方式"
        style="min-height: 420px"
      >
        <div class="flex flex-col gap-12px p-8px">
          <div class="skeleton h-90px"></div>
          <div class="skeleton h-60px"></div>
          <div class="skeleton h-60px"></div>
        </div>
      </FrostedGate>
    </div>

    <div v-else-if="loading" class="max-w-860px mx-auto flex flex-col gap-14px">
      <div class="skeleton h-110px"></div>
      <div class="skeleton h-240px"></div>
    </div>

    <div v-else-if="team" class="max-w-860px mx-auto flex flex-col gap-16px">
      <!-- 头部 -->
      <section class="glass p-24px animate-appear">
        <div class="flex items-start justify-between gap-12px flex-wrap">
          <div>
            <div class="status-tags mb-8px">
              <span class="post-status" :class="statusClass"><i class="dot" />{{ statusText }}</span>
              <span class="chip" style="background: rgba(245,185,1,0.14); color: #8a5800">🎯 {{ TeamGoalLabel[team.goal as TeamGoal] }}</span>
              <span
                v-if="remaining != null"
                class="chip"
                :style="remaining <= 3 ? 'background:rgba(217,60,60,0.1);color:#c0392b' : 'background:rgba(15,76,140,0.07);color:var(--uestc-blue)'"
              >{{ remaining === 0 ? '今天截止' : `招募剩 ${remaining} 天` }}</span>
              <span v-else-if="expired" class="chip" style="background:rgba(0,0,0,0.06);color:var(--ink-faint)">已截止</span>
            </div>
            <div
              class="text-18px font-bold color-uestc-600 cursor-pointer hover:underline"
              @click="router.push(`/competitions/${team.competition.id}`)"
            >{{ team.competition.name }}</div>
            <a
              v-if="competitionUrl !== '#'"
              :href="competitionUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-12px color-uestc-500"
            >竞赛官网 ↗</a>
            <router-link :to="`/u/${team.leader.id}`" class="leader-line">
              <UserAvatar :name="team.leader.nickname || team.leader.college || 'U'" :size="26" />
              <span class="text-13px color-ink-soft">发布者 <b class="color-ink">{{ team.leader.nickname || '同学' }}</b></span>
            </router-link>
            <div class="text-12px color-ink-faint mt-2px">
              发布于 {{ fmtDate(team.createdAt) }} · 已有 {{ team.memberCount }}<template v-if="team.targetSize"> / 计划 {{ team.targetSize }}</template> 人 · 💬 {{ team.commentCount }} 条留言
            </div>
          </div>
          <div class="flex gap-8px shrink-0 flex-wrap justify-end">
            <template v-if="isLeaderViewer">
              <el-button round @click="openEdit" :disabled="team.status === 'DISBANDED'">编辑帖子</el-button>
              <el-button
                v-for="s in statusActions"
                :key="s"
                round
                :type="s === 'DISBANDED' ? 'danger' : 'default'"
                :plain="s === 'DISBANDED'"
                @click="changeStatus(s)"
              >{{ statusActionLabel(s) }}</el-button>
            </template>
            <span
              v-else-if="isAdminViewer"
              class="text-12px color-ink-faint self-center"
              title="管理操作请前往后台举报/内容管理台"
            >管理员视角（只读）</span>
          </div>
        </div>
      </section>

      <!-- 招募方向 + 要求 + 联系方式 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <section class="glass p-20px flex flex-col">
          <h2 class="text-15px font-bold m-0 mb-10px">📋 招募要求</h2>
          <div v-if="team.neededRoles?.length" class="flex gap-6px flex-wrap mb-12px">
            <span v-for="r in team.neededRoles" :key="r" class="role-tag">{{ roleLabel(r) }}</span>
          </div>
          <span v-else class="role-tag is-open mb-12px self-start">方向不限</span>
          <p v-if="team.requirement" class="text-14px color-ink-soft m-0 whitespace-pre-wrap leading-relaxed">{{ team.requirement }}</p>
          <p v-else class="text-13px color-ink-faint m-0">队长没有填写具体要求，直接联系聊聊吧</p>
        </section>

        <section class="glass p-20px contact-card">
          <h2 class="text-15px font-bold m-0 mb-10px">📞 联系队长</h2>
          <div class="contact-list">
            <div v-if="team.qq" class="contact-row">
              <span class="k">QQ</span>
              <span class="v">{{ team.qq }}</span>
            </div>
            <div v-if="team.wechat" class="contact-row">
              <span class="k">微信</span>
              <span class="v">{{ team.wechat }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- 已有成员情况（队长手填，纯展示） -->
      <section class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">👥 已有成员（{{ team.memberCount }}<template v-if="team.targetSize"> / 计划 {{ team.targetSize }}</template>）</h2>
        <div v-if="team.members?.length" class="flex flex-col gap-10px">
          <div
            v-for="m in team.members"
            :key="m.id"
            class="rounded-14px p-12px"
            style="background: rgba(255,255,255,0.5)"
          >
            <div class="flex items-center gap-8px flex-wrap text-13px">
              <el-tag v-if="m.grade" size="small" effect="plain" round>{{ m.grade }} 级</el-tag>
              <span v-if="m.college" class="font-semibold color-ink">{{ m.college }}</span>
              <span v-if="m.major" class="color-ink-soft">· {{ m.major }}</span>
              <el-tag v-if="m.rank" size="small" effect="plain" round type="warning">{{ m.rank }}</el-tag>
            </div>
            <p v-if="m.intro" class="text-13px color-ink-soft m-0 mt-6px whitespace-pre-wrap">{{ m.intro }}</p>
          </div>
        </div>
        <p v-else class="text-13px color-ink-faint m-0">队长还没有录入成员信息</p>
        <p class="text-12px color-ink-faint mt-10px m-b-0">成员信息由队长手工维护，加入队伍请直接联系队长</p>
      </section>

      <!-- 评论区 -->
      <section class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">💬 留言板</h2>
        <p class="text-12px color-ink-faint m-0 mb-12px">有意向或有问题就在这里留言，队长会看到；也可以直接加上方联系方式</p>
        <CommentList target-type="TEAM" :target-id="team.id" @posted="load" />
      </section>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="编辑招募帖" width="520px">
      <div class="flex flex-col gap-14px">
        <div>
          <div class="text-13px font-semibold mb-6px">队伍目标</div>
          <el-radio-group v-model="editForm.goal">
            <el-radio-button v-for="g in goalOptions" :key="g.value" :value="g.value">{{ g.label }}</el-radio-button>
          </el-radio-group>
        </div>
        <div>
          <div class="text-13px font-semibold mb-6px">招募方向</div>
          <el-select v-model="editForm.neededRoles" multiple filterable placeholder="选择方向（可多选）" style="width: 100%">
            <el-option v-for="r in roleOptions" :key="r.value" :value="r.value" :label="r.label" />
          </el-select>
        </div>
        <div>
          <div class="text-13px font-semibold mb-6px">招募要求</div>
          <el-input v-model="editForm.requirement" type="textarea" :rows="4" maxlength="2000" show-word-limit />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12px">
          <div>
            <div class="text-13px font-semibold mb-6px">QQ <span class="text-12px color-ink-faint font-normal">（QQ / 微信至少填一项）</span></div>
            <el-input v-model="editForm.qq" maxlength="64" placeholder="QQ 号，公开展示" />
            <div class="text-13px font-semibold mt-10px mb-6px">微信</div>
            <el-input v-model="editForm.wechat" maxlength="64" placeholder="微信号，公开展示" />
          </div>
          <div>
            <div class="text-13px font-semibold mb-6px">招募截止</div>
            <el-date-picker v-model="editForm.deadline" type="date" style="width: 100%" value-format="YYYY-MM-DD" />
          </div>
        </div>
        <div>
          <div class="text-13px font-semibold mb-6px">计划招募人数（含自己）</div>
          <el-input-number v-model="editForm.targetSize" :min="1" :max="99" controls-position="right" style="width: 180px" />
        </div>
        <div>
          <div class="flex items-center justify-between mb-6px">
            <div class="text-13px font-semibold">已有成员情况</div>
            <el-button size="small" plain round @click="addEditMember">+ 添加成员</el-button>
          </div>
          <div class="flex flex-col gap-10px">
            <div
              v-for="(m, i) in editForm.members"
              :key="i"
              class="rounded-12px p-10px flex flex-col gap-8px"
              style="background: rgba(0,0,0,0.03)"
            >
              <div class="grid grid-cols-2 md:grid-cols-4 gap-8px">
                <el-input-number v-model="m.grade" placeholder="年级" :min="2015" :max="2035" controls-position="right" style="width: 100%" />
                <el-input v-model="m.college" placeholder="学院" maxlength="40" />
                <el-input v-model="m.major" placeholder="专业" maxlength="40" />
                <el-input v-model="m.rank" placeholder="rank" maxlength="40" />
              </div>
              <div class="flex gap-8px">
                <el-input v-model="m.intro" type="textarea" :rows="2" placeholder="成员介绍" maxlength="500" />
                <el-button type="danger" plain circle size="small" class="self-start" @click="editForm.members.splice(i, 1)">
                  <el-icon><i-ep-delete /></el-icon>
                </el-button>
              </div>
            </div>
            <p v-if="!editForm.members.length" class="text-12px color-ink-faint m-0">暂无成员，点击上方按钮添加</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.status-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.post-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}
.post-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
}
.post-status.is-recruiting { background: rgba(64, 153, 117, 0.12); color: #2c7355; }
.post-status.is-full { background: rgba(245, 185, 1, 0.16); color: #8a5800; }
.post-status.is-competing { background: rgba(15, 76, 140, 0.12); color: #0f4c8c; }
.post-status.is-closed { background: rgba(0, 0, 0, 0.06); color: var(--ink-faint); }

.role-tag {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #0f4c8c;
  background: linear-gradient(135deg, rgba(15, 76, 140, 0.1), rgba(15, 76, 140, 0.05));
  border: 1px solid rgba(15, 76, 140, 0.18);
}
.role-tag.is-open {
  color: var(--ink-faint);
  background: rgba(0, 0, 0, 0.04);
  border: 1px dashed rgba(0, 0, 0, 0.15);
  font-weight: 500;
}

/* 发布人行：头像 + 昵称，点击进入个人主页 */
.leader-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  text-decoration: none;
  border-radius: 999px;
  padding: 2px 10px 2px 2px;
  transition: background 0.15s ease-out;
}
.leader-line:hover {
  background: rgba(15, 76, 140, 0.06);
}

.contact-card {
  background:
    linear-gradient(135deg, rgba(64, 153, 117, 0.06), rgba(255, 255, 255, 0.6) 55%);
}
/* 联系方式列表：标签列固定宽、数值列对齐，行间虚线分隔 */
.contact-list {
  display: flex;
  flex-direction: column;
}
.contact-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 2px;
}
.contact-row + .contact-row {
  border-top: 1px dashed rgba(15, 76, 140, 0.14);
}
.contact-row .k {
  flex-shrink: 0;
  width: 52px;
  font-size: 13px;
  color: var(--ink-faint);
}
.contact-row .v {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  word-break: break-all;
}
</style>
