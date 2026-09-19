<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { RoleType, RoleTypeLabel, TeamGoal, TeamGoalLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const form = ref({
  competitionId: '',
  competitionName: '',
  manualMode: false,
  goal: undefined as TeamGoal | undefined,
  requirement: '',
  contact: '',
  deadline: null as string | null,
  // 每个方向一行，可设数量（算法 ×2、论文 ×1），允许同一 role 多行
  slots: [] as { role: RoleType | null; count: number; note: string }[],
  members: [] as { role: RoleType | null; rank: string; grade: null | number; college: string; note: string }[],
});
const submitting = ref(false);

const goalOptions = Object.values(TeamGoal).map((g) => ({ value: g, label: TeamGoalLabel[g] }));
const roleOptions = Object.values(RoleType).map((r) => ({ value: r, label: RoleTypeLabel[r] }));

const competitionOptions = ref<{ id: string; name: string }[]>([]);
const competitionSearching = ref(false);

/** 目标人数 = 已有成员（含自己）+ 展开后的名额数 */
const targetSize = computed(
  () => 1 + form.value.members.length + form.value.slots.reduce((sum, s) => sum + (s.role ? Math.max(1, s.count) : 0), 0),
);

async function searchCompetition(word: string) {
  if (!word.trim()) return;
  competitionSearching.value = true;
  try {
    const res = await api.get<{ competitions: { id: string; name: string }[] }>(`/search${qs({ q: word })}`);
    competitionOptions.value = res.competitions;
  } finally {
    competitionSearching.value = false;
  }
}

onMounted(async () => {
  // 预填竞赛（从竞赛详情页"我也要组队"跳转而来）
  const preselect = route.query.competitionId as string;
  if (preselect) {
    try {
      const c = await api.get<{ id: string; name: string; timelines: { stage: string; endAt: string | null }[] }>(
        `/competitions/${preselect}`,
      );
      form.value.competitionId = c.id;
      competitionOptions.value = [{ id: c.id, name: c.name }];
      const signup = c.timelines.find((t) => t.stage.includes('报名') && t.endAt);
      if (signup?.endAt) form.value.deadline = signup.endAt.slice(0, 10);
    } catch {
      /* ignore */
    }
  }
});

function switchToManual() {
  form.value.manualMode = true;
  form.value.competitionId = '';
}
function switchToSelect() {
  form.value.manualMode = false;
  form.value.competitionName = '';
}
function addSlot() {
  if (form.value.slots.length >= 10) return;
  form.value.slots.push({ role: null, count: 1, note: '' });
}
function addMember() {
  if (form.value.members.length >= 10) return;
  form.value.members.push({ role: null, rank: '', grade: null, college: '', note: '' });
}

async function submit() {
  if (!form.value.manualMode && !form.value.competitionId) {
    ElMessage.warning('请先选择竞赛');
    return;
  }
  if (form.value.manualMode && !form.value.competitionName.trim()) {
    ElMessage.warning('请填写竞赛名称');
    return;
  }
  if (!form.value.goal) {
    ElMessage.warning('请选择队伍目标');
    return;
  }
  const validSlots = form.value.slots.filter((s) => s.role);
  if (!validSlots.length) {
    ElMessage.warning('请至少添加一个缺口方向');
    return;
  }

  // 展开为真实名额：算法 ×2 -> 两个 ALGORITHM slot
  const slots = validSlots.flatMap((s) =>
    Array.from({ length: Math.max(1, Math.min(10, s.count)) }, () => ({ role: s.role as RoleType, note: s.note || undefined })),
  );

  submitting.value = true;
  try {
    const team = await api.post<{ id: string }>('/teams', {
      competitionId: form.value.manualMode ? undefined : form.value.competitionId,
      competitionName: form.value.manualMode ? form.value.competitionName.trim() : undefined,
      goal: form.value.goal,
      requirement: form.value.requirement || undefined,
      contact: form.value.contact || undefined,
      deadline: form.value.deadline || undefined,
      slots,
      // 只录入平台外成员：不传 userId，平台用户须走申请/邀请
      members: form.value.members.map((m) => ({
        role: m.role ?? undefined,
        rank: m.rank || undefined,
        grade: m.grade ?? undefined,
        college: m.college || undefined,
        note: m.note || undefined,
      })),
    });
    ElMessage.success('组队帖已发布，等队友来找你吧！');
    router.push(`/teams/${team.id}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败');
  } finally {
    submitting.value = false;
  }
}

void auth;
</script>

<template>
  <div class="page-wrap max-w-760px mx-auto">
    <h1 class="text-28px font-extrabold m-0 mb-4px">发布组队</h1>
    <p class="text-13px color-ink-soft m-0 mb-18px">带 <span style="color: #d99f00">*</span> 为必填 · 同一方向可填多个名额</p>

    <div class="glass p-24px flex flex-col gap-20px">
      <!-- 1. 竞赛：选择菜单 / 手动填写 -->
      <div>
        <div class="form-label">竞赛 <span class="req">*</span></div>
        <template v-if="!form.manualMode">
          <div class="flex gap-8px">
            <el-select
              v-model="form.competitionId"
              filterable
              remote
              :remote-method="searchCompetition"
              :loading="competitionSearching"
              placeholder="输入竞赛名搜索"
              style="flex: 1"
              size="large"
            >
              <el-option v-for="c in competitionOptions" :key="c.id" :value="c.id" :label="c.name" />
            </el-select>
            <el-button size="large" @click="switchToManual">手动填写</el-button>
          </div>
        </template>
        <template v-else>
          <div class="flex gap-8px">
            <el-input v-model="form.competitionName" size="large" maxlength="120" placeholder="手动填写竞赛名称" />
            <el-button size="large" @click="switchToSelect">改用选择菜单</el-button>
          </div>
        </template>
      </div>

      <!-- 2. 目标 -->
      <div>
        <div class="form-label">队伍目标 <span class="req">*</span></div>
        <el-radio-group v-model="form.goal">
          <el-radio-button v-for="g in goalOptions" :key="g.value" :value="g.value">{{ g.label }}</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 3. 缺口方向（支持同一方向多个名额） -->
      <div>
        <div class="form-label">缺口方向 <span class="req">*</span></div>
        <p class="text-12px color-ink-faint m-0 mb-8px">例如「算法 ×2，论文 ×1」。当前目标人数：{{ targetSize }} 人（含你自己与已录入成员）</p>
        <div class="flex flex-col gap-8px">
          <div
            v-for="(s, i) in form.slots"
            :key="i"
            class="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_auto] gap-8px items-center rounded-12px p-10px"
            style="background: rgba(255, 255, 255, 0.5)"
          >
            <el-select v-model="s.role" placeholder="角色方向">
              <el-option v-for="r in roleOptions" :key="r.value" :value="r.value" :label="r.label" />
            </el-select>
            <el-input-number v-model="s.count" :min="1" :max="10" controls-position="right" style="width: 100%" />
            <el-input v-model="s.note" placeholder="备注（选填）" maxlength="200" />
            <el-button type="danger" plain circle size="small" @click="form.slots.splice(i, 1)">
              <el-icon><i-ep-delete /></el-icon>
            </el-button>
          </div>
          <el-button plain round size="small" class="self-start" @click="addSlot">+ 添加缺口方向</el-button>
        </div>
      </div>

      <!-- 4. 已有成员情况（仅平台外成员） -->
      <div>
        <div class="form-label">已有成员情况（选填，仅平台外成员）</div>
        <p class="text-12px color-ink-faint m-0 mb-8px">平台注册同学请勿在此录入，须通过「申请 / 邀请」流程加入。</p>
        <div class="flex flex-col gap-8px">
          <div
            v-for="(m, i) in form.members"
            :key="i"
            class="grid grid-cols-2 md:grid-cols-5 gap-8px items-center rounded-12px p-10px"
            style="background: rgba(255,255,255,0.5)"
          >
            <el-select v-model="m.role" placeholder="角色" clearable>
              <el-option v-for="r in roleOptions" :key="r.value" :value="r.value" :label="r.label" />
            </el-select>
            <el-input v-model="m.rank" placeholder="排名" />
            <el-input-number v-model="m.grade" placeholder="年级" :min="2015" :max="2035" controls-position="right" style="width: 100%" />
            <el-input v-model="m.college" placeholder="学院" />
            <div class="flex gap-6px">
              <el-input v-model="m.note" placeholder="备注" />
              <el-button type="danger" plain circle size="small" @click="form.members.splice(i, 1)">
                <el-icon><i-ep-delete /></el-icon>
              </el-button>
            </div>
          </div>
          <el-button plain round size="small" class="self-start" @click="addMember">+ 添加已有成员</el-button>
        </div>
      </div>

      <!-- 5. 招募要求 -->
      <div>
        <div class="form-label">招募要求</div>
        <el-input v-model="form.requirement" type="textarea" :rows="3" placeholder="技能要求、投入时长、面试方式…" />
      </div>

      <!-- 6. 招募截止 / 联系方式 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <div>
          <div class="form-label">招募截止</div>
          <el-date-picker v-model="form.deadline" type="date" placeholder="截止日" style="width: 100%" value-format="YYYY-MM-DD" />
        </div>
        <div>
          <div class="form-label">联系方式</div>
          <el-input v-model="form.contact" placeholder="申请通过后队友才可见" />
        </div>
      </div>

      <el-button type="primary" size="large" round :loading="submitting" @click="submit">
        {{ submitting ? '发布中…' : '发布组队帖' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 8px;
}
.req {
  color: #d99f00;
}
</style>
