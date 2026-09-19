<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { RoleType, RoleTypeLabel, TeamGoalLabel, TeamStatusLabel, TeamGoal, TeamStatus, ApplicationStatus } from '@teamup/shared';
import { api } from '../../api/client';
import { fmtDate, daysLeft } from '../../api/types';
import UserAvatar from '../../components/UserAvatar.vue';
import FrostedGate from '../../components/FrostedGate.vue';
import { useAuthStore } from '../../stores/auth';

interface TeamDetail {
  id: string;
  goal: TeamGoal;
  status: TeamStatus;
  requirement: string | null;
  contact: string | null;
  contactVisible: boolean;
  deadline: string | null;
  teamSize?: number | null;
  currentSize?: number | null;
  createdAt: string;
  competition: { id: string; name: string; levels: string[]; officialUrl: string | null };
  leader: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null; studentNo?: string };
  slots: { id: string; role: RoleType; filled: boolean }[];
  members: {
    id: string;
    role: RoleType | null;
    rank: string | null;
    grade: number | null;
    college: string | null;
    note: string | null;
    displayName: string | null;
    user: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null; studentNo?: string; contact?: string | null } | null;
  }[];
  applications?: { id: string; pitch: string; createdAt: string; user: { id: string; nickname: string | null; college: string | null; grade: number | null; studentNo?: string } }[];
  invitations?: { id: string; status: string; createdAt: string; user: { id: string; nickname: string | null } }[];
  viewer: { isLeader: boolean; isMember: boolean };
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const team = ref<TeamDetail | null>(null);
const loading = ref(true);

// 申请弹窗
const applyVisible = ref(false);
const pitch = ref('');
const applying = ref(false);

// 婉拒理由模板（降低社交压力）
const rejectVisible = ref(false);
const rejectReason = ref('');
const rejectTemplates = ['队伍已经招满了', '你的技能方向和我们的缺口不太匹配', '我们已经找到合适的队友了'];
const rejectingId = ref('');

const remaining = computed(() => {
  if (!team.value?.deadline) return null;
  const d = daysLeft(team.value.deadline);
  return d != null && d >= 0 ? d : null;
});

const expired = computed(() => team.value?.deadline ? new Date(team.value.deadline) < new Date() : false);

async function load() {
  // 队友招募信息仅登录可见
  if (!auth.isLoggedIn) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    team.value = await api.get<TeamDetail>(`/teams/${route.params.id}`);
  } catch {
    ElMessage.error('队伍不存在');
    router.push({ name: 'teams' });
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function submitApply() {
  applying.value = true;
  try {
    await api.post(`/teams/${team.value!.id}/applications`, { pitch: pitch.value.trim() });
    applyVisible.value = false;
    pitch.value = '';
    ElMessage.success('申请已提交，队长会尽快处理');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    applying.value = false;
  }
}

async function review(applicationId: string, action: 'accept' | 'reject') {
  if (action === 'reject') {
    rejectingId.value = applicationId;
    rejectReason.value = '';
    rejectVisible.value = true;
    return;
  }
  await doReview(applicationId, 'accept', '');
  rejectVisible.value = false;
}

async function doReview(applicationId: string, action: string, reason: string) {
  try {
    await api.post('/teams/applications/review', { applicationId, action, reason: reason || undefined });
    ElMessage.success(action === 'accept' ? '已同意，对方已加入队伍' : '已婉拒');
    rejectVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function transition(action: 'NEGOTIATE' | 'COMPETE' | 'DISBAND' | 'REOPEN') {
  const labels = { NEGOTIATE: '转为沟通中', COMPETE: '标记为已参赛', DISBAND: '解散队伍', REOPEN: '重新开启招募' };
  await ElMessageBox.confirm(`确认${labels[action]}？`, '确认操作', { type: action === 'DISBAND' ? 'warning' : 'info' });
  await api.post(`/teams/${team.value!.id}/transition`, { action });
  ElMessage.success('已更新');
  load();
}

const statusType = computed(() => {
  switch (team.value?.status) {
    case 'RECRUITING': return 'success';
    case 'NEGOTIATING': return 'warning';
    case 'FULL': return 'info';
    case 'COMPETING': return 'primary';
    default: return 'info';
  }
});

const statusText = computed(() => TeamStatusLabel[team.value?.status as TeamStatus] ?? '');
const canApply = computed(
  () =>
    auth.isLoggedIn &&
    !team.value?.viewer.isMember &&
    !team.value?.viewer.isLeader &&
    team.value?.status === TeamStatus.RECRUITING &&
    !expired.value,
);
</script>

<template>
  <div class="page-wrap">
    <!-- 游客：磨砂玻璃门 -->
    <div v-if="!auth.isLoggedIn && !loading" class="max-w-860px mx-auto">
      <FrostedGate
        title="该队伍的招募详情仅对登录同学可见"
        description="登录后查看招募要求、缺位情况、已有成员，并可一键申请加入"
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
            <div class="flex items-center gap-8px flex-wrap mb-8px">
              <el-tag :type="statusType as never" round>{{ statusText }}</el-tag>
              <span class="chip" style="background: rgba(245,185,1,0.14); color: #8a5800">🎯 {{ TeamGoalLabel[team.goal] }}</span>
              <span
                v-if="remaining != null"
                class="chip"
                :style="remaining <= 3 ? 'background:rgba(217,60,60,0.1);color:#c0392b' : 'background:rgba(15,76,140,0.07);color:var(--uestc-blue)'"
              >{{ remaining === 0 ? '今天截止' : `招募剩 ${remaining} 天` }}</span>
              <span v-else-if="expired" class="chip" style="background:rgba(0,0,0,0.06);color:var(--ink-faint)">已截止</span>
            </div>
            <!-- 关联竞赛卡（双向联动的另一半） -->
            <div
              class="text-18px font-bold color-uestc-600 cursor-pointer hover:underline"
              @click="router.push(`/competitions/${team.competition.id}`)"
            >{{ team.competition.name }}</div>
            <div class="text-12px color-ink-faint mt-2px">发布于 {{ fmtDate(team.createdAt) }}</div>
          </div>
          <div class="flex gap-8px shrink-0 flex-wrap justify-end">
            <el-button v-if="canApply" type="primary" round @click="applyVisible = true">申请加入</el-button>
            <template v-if="team.viewer.isLeader">
              <el-button v-if="team.status === 'RECRUITING'" size="default" @click="transition('NEGOTIATE')">开启沟通</el-button>
              <el-button v-if="team.status === 'NEGOTIATING'" size="default" @click="transition('REOPEN')">重新招募</el-button>
              <el-button v-if="team.status !== 'COMPETING' && team.status !== 'DISBANDED'" type="warning" plain @click="transition('COMPETE')">标记参赛</el-button>
              <el-button v-if="team.status !== 'DISBANDED'" type="danger" plain @click="transition('DISBAND')">解散</el-button>
            </template>
          </div>
        </div>
      </section>

      <!-- 招募要求 + 联系方式 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <section class="glass p-20px">
          <h2 class="text-15px font-bold m-0 mb-10px">📋 招募要求</h2>
          <p v-if="team.requirement" class="text-14px color-ink-soft m-0 whitespace-pre-wrap leading-relaxed">{{ team.requirement }}</p>
          <p v-else class="text-13px color-ink-faint m-0">队长没有填写具体要求，大胆申请试试</p>
        </section>
        <section class="glass p-20px">
          <h2 class="text-15px font-bold m-0 mb-10px">🔐 联系方式</h2>
          <template v-if="team.contactVisible">
            <p class="text-14px color-ink m-0">{{ team.contact || '（队长未留联系方式）' }}</p>
            <p class="text-12px color-ink-faint mt-8px m-0">你们已在同一队伍，信息已解锁</p>
          </template>
          <template v-else>
            <p class="text-13px color-ink-soft m-0">🔒 申请通过后可见 —— 防止联系方式被爬虫批量抓取</p>
            <p class="text-12px color-ink-faint mt-8px m-0">先申请加入，通过后这里会直接展示</p>
          </template>
        </section>
      </div>

      <!-- 缺位情况 -->
      <section class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">🧩 缺位情况</h2>
        <div class="flex gap-8px flex-wrap">
          <template v-if="team.slots.length">
            <div
              v-for="s in team.slots"
              :key="s.id"
              class="slot-pill"
              :class="{ filled: s.filled }"
            >
              {{ RoleTypeLabel[s.role] }}
              <span class="ml-2px">{{ s.filled ? '✓' : '空缺' }}</span>
            </div>
          </template>
          <span v-else class="text-13px color-ink-faint">未设置角色缺口</span>
        </div>
      </section>

      <!-- 已有成员情况 -->
      <section class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">👥 已有成员（{{ team.currentSize ?? team.members.length }}<template v-if="team.teamSize">/{{ team.teamSize }}</template>）</h2>
        <div class="flex flex-col gap-10px">
          <div v-for="m in team.members" :key="m.id" class="flex items-center gap-10px flex-wrap">
            <UserAvatar :name="m.user?.nickname || m.displayName || 'U'" :size="34" />
            <div class="text-13px">
              <router-link v-if="m.user" :to="`/u/${m.user.id}`" class="font-semibold color-ink no-underline hover:text-uestc-500">
                {{ m.user.nickname || '同学' }}
              </router-link>
              <span v-else class="font-semibold color-ink">{{ m.displayName || '平台外成员' }}</span>
              <span class="color-ink-soft">
                <template v-if="m.role"> · {{ RoleTypeLabel[m.role] }}</template>
                <template v-if="m.college || m.user?.college"> · {{ m.college || m.user?.college }}</template>
                <template v-if="m.grade || m.user?.grade"> · {{ m.grade || m.user?.grade }} 级</template>
                <template v-if="m.rank"> · 排名 {{ m.rank }}</template>
                <template v-if="m.note"> · {{ m.note }}</template>
                <template v-if="m.note === '队长'"></template>
              </span>
              <div v-if="m.user?.studentNo" class="text-12px color-ink-faint">学号 {{ m.user.studentNo }}（同队可见）</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 队长视角：审批台 -->
      <section v-if="team.viewer.isLeader && team.applications?.length" class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">📥 收到的申请（{{ team.applications.length }}）</h2>
        <div class="flex flex-col gap-12px">
          <div v-for="a in team.applications" :key="a.id" class="rounded-14px p-12px" style="background: rgba(255,255,255,0.5)">
            <div class="flex items-center gap-8px mb-6px">
              <UserAvatar :name="a.user.nickname || 'U'" :size="28" />
              <span class="text-13px font-semibold color-ink">{{ a.user.nickname || '同学' }}</span>
              <span class="text-12px color-ink-faint">{{ a.user.college || '' }} {{ a.user.grade ? `· ${a.user.grade} 级` : '' }}</span>
              <span class="text-12px color-ink-faint">{{ fmtDate(a.createdAt) }}</span>
              <div class="ml-auto flex gap-6px">
                <el-button size="small" type="primary" round @click="review(a.id, 'accept')">同意</el-button>
                <el-button size="small" round @click="review(a.id, 'reject')">婉拒</el-button>
              </div>
            </div>
            <p class="text-13px color-ink-soft m-0 whitespace-pre-wrap">{{ a.pitch }}</p>
          </div>
        </div>
      </section>

      <!-- 队长视角：发出的邀请 -->
      <section v-if="team.viewer.isLeader && team.invitations?.length" class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">📤 发出的邀请</h2>
        <div class="flex gap-8px flex-wrap">
          <el-tag v-for="i in team.invitations" :key="i.id" round effect="plain">
            {{ i.user.nickname || '用户' }} · {{ i.status === ApplicationStatus.PENDING ? '待回应' : i.status === 'ACCEPTED' ? '已加入' : '已拒绝' }}
          </el-tag>
        </div>
      </section>
    </div>

    <!-- 申请弹窗 -->
    <el-dialog v-model="applyVisible" title="申请加入" width="480px">
      <div class="flex flex-col gap-12px">
        <div class="text-13px color-ink-soft">
          给队长介绍一下自己：技能方向、相关经历、每周可投入时间…
        </div>
        <el-input v-model="pitch" type="textarea" :rows="5" placeholder="例如：2024 级计算机，会 Python 后端（Flask/FastAPI），有数据库设计经验，每周可投入 10+ 小时" />
        <div class="text-12px color-ink-faint">申请通过后，双方解锁学号与联系方式</div>
      </div>
      <template #footer>
        <el-button @click="applyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applying" @click="submitApply">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- 婉拒弹窗 -->
    <el-dialog v-model="rejectVisible" title="婉拒申请" width="420px">
      <div class="flex flex-col gap-10px">
        <div class="text-13px color-ink-soft">选择一个理由，让双方都体面：</div>
        <el-radio-group v-model="rejectReason" class="flex flex-col gap-8px">
          <el-radio v-for="t in rejectTemplates" :key="t" :value="t">{{ t }}</el-radio>
        </el-radio-group>
        <el-input v-model="rejectReason" placeholder="或自定义理由（可选）" />
      </div>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="primary" @click="doReview(rejectingId, 'reject', rejectReason)">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.slot-pill {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--uestc-blue);
  background: rgba(15, 76, 140, 0.07);
  border: 1px dashed rgba(15, 76, 140, 0.35);
}
.slot-pill.filled {
  color: #2c7355;
  background: rgba(64, 153, 117, 0.08);
  border: 1px solid rgba(64, 153, 117, 0.3);
}
</style>
