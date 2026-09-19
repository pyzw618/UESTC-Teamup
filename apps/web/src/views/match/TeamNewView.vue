<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
  neededRoles: [] as RoleType[],
  requirement: '',
  contact: '',
  deadline: null as string | null,
  targetSize: null as number | null,
  members: [] as { grade: number | null; college: string; major: string; rank: string; intro: string }[],
});
const submitting = ref(false);

const goalOptions = Object.values(TeamGoal).map((g) => ({ value: g, label: TeamGoalLabel[g] }));
const roleOptions = Object.values(RoleType).map((r) => ({ value: r, label: RoleTypeLabel[r] }));

const competitionOptions = ref<{ id: string; name: string }[]>([]);
const competitionSearching = ref(false);

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
function addMember() {
  if (form.value.members.length >= 20) return;
  form.value.members.push({ grade: null, college: '', major: '', rank: '', intro: '' });
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
  if (!form.value.contact.trim()) {
    ElMessage.warning('请填写联系方式（微信/QQ），感兴趣的同学要直接联系你');
    return;
  }

  submitting.value = true;
  try {
    const team = await api.post<{ id: string }>('/teams', {
      competitionId: form.value.manualMode ? undefined : form.value.competitionId,
      competitionName: form.value.manualMode ? form.value.competitionName.trim() : undefined,
      goal: form.value.goal,
      neededRoles: form.value.neededRoles,
      requirement: form.value.requirement || undefined,
      contact: form.value.contact.trim(),
      deadline: form.value.deadline || undefined,
      targetSize: form.value.targetSize ?? undefined,
      members: form.value.members.map((m) => ({
        grade: m.grade ?? undefined,
        college: m.college || undefined,
        major: m.major || undefined,
        rank: m.rank || undefined,
        intro: m.intro || undefined,
      })),
    });
    ElMessage.success('招募帖已上墙，坐等同学加你！');
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
    <h1 class="text-28px font-extrabold m-0 mb-4px">发布招募帖</h1>
    <p class="text-13px color-ink-soft m-0 mb-18px">带 <span style="color: #d99f00">*</span> 为必填 · 发出后同学会直接通过联系方式找到你</p>

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

      <!-- 3. 招募方向标签 -->
      <div>
        <div class="form-label">招募方向（选填，可多选）</div>
        <p class="text-12px color-ink-faint m-0 mb-8px">会以标签形式展示在卡片上，方便同学按方向找到你</p>
        <el-select
          v-model="form.neededRoles"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          placeholder="例如：算法、前端、论文"
          style="width: 100%"
          size="large"
        >
          <el-option v-for="r in roleOptions" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
      </div>

      <!-- 4. 招募要求 -->
      <div>
        <div class="form-label">招募要求</div>
        <el-input
          v-model="form.requirement"
          type="textarea"
          :rows="4"
          maxlength="2000"
          show-word-limit
          placeholder="技能要求、期望人数、投入时长、面试方式…（自由填写）"
        />
      </div>

      <!-- 4. 计划招募人数 -->
      <div>
        <div class="form-label">计划招募人数（含自己）</div>
        <el-input-number v-model="form.targetSize" :min="1" :max="99" controls-position="right" style="width: 200px" placeholder="如 3" />
        <p class="text-12px color-ink-faint m-0 mt-6px">选填。已有成员数量按下方名单自动统计</p>
      </div>

      <!-- 5. 已有成员情况（队长手填，纯展示） -->
      <div>
        <div class="form-label">已有成员情况（选填）</div>
        <p class="text-12px color-ink-faint m-0 mb-8px">平台不管理成员身份，这里只是展示信息——加入仍在平台外通过联系方式进行。成员介绍里可以写称呼。</p>
        <div class="flex flex-col gap-10px">
          <div
            v-for="(m, i) in form.members"
            :key="i"
            class="rounded-12px p-12px flex flex-col gap-8px"
            style="background: rgba(255,255,255,0.5)"
          >
            <div class="grid grid-cols-2 md:grid-cols-4 gap-8px">
              <el-input-number v-model="m.grade" placeholder="年级" :min="2015" :max="2035" controls-position="right" style="width: 100%" />
              <el-input v-model="m.college" placeholder="学院" maxlength="40" />
              <el-input v-model="m.major" placeholder="专业" maxlength="40" />
              <el-input v-model="m.rank" placeholder="rank（如 前 15%）" maxlength="40" />
            </div>
            <div class="flex gap-8px">
              <el-input v-model="m.intro" type="textarea" :rows="2" placeholder="成员介绍：称呼、方向、经历…" maxlength="500" />
              <el-button type="danger" plain circle size="small" class="self-start" @click="form.members.splice(i, 1)">
                <el-icon><i-ep-delete /></el-icon>
              </el-button>
            </div>
          </div>
          <el-button plain round size="small" class="self-start" @click="addMember">+ 添加已有成员</el-button>
        </div>
      </div>

      <!-- 6. 联系方式 / 招募截止 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <div>
          <div class="form-label">联系方式 <span class="req">*</span></div>
          <el-input v-model="form.contact" size="large" maxlength="200" placeholder="微信 / QQ 号，将直接公开展示" />
          <p class="text-12px color-ink-faint m-0 mt-6px">平台不提供私聊与申请审批，同学看到帖子后会直接加你</p>
        </div>
        <div>
          <div class="form-label">招募截止</div>
          <el-date-picker v-model="form.deadline" type="date" placeholder="截止日（选填）" style="width: 100%" value-format="YYYY-MM-DD" />
        </div>
      </div>

      <el-button type="primary" size="large" round :loading="submitting" @click="submit">
        {{ submitting ? '发布中…' : '发布招募帖' }}
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
