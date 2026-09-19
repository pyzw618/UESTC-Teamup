<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { RoleTypeLabel, TeamGoalLabel, TeamStatusLabel, RoleType, TeamGoal, TeamStatus } from '@teamup/shared';
import UserAvatar from './UserAvatar.vue';
import { api } from '../api/client';
import { daysLeft } from '../api/types';
import { useAuthStore } from '../stores/auth';

const props = withDefaults(defineProps<{
  leader: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
  goal: string;
  status: string;
  deadline?: string | null;
  openRoles?: string[];
  memberCount?: number;
  teamSize?: number | null;
  currentSize?: number | null;
  competition?: { id: string; name: string };
  expired?: boolean;
  /** 传入则显示举报入口（招募卡片） */
  teamId?: string;
}>(), { teamId: '' });

const auth = useAuthStore();
const reportVisible = ref(false);
const reportReason = ref('');
const reportSubmitting = ref(false);

const remaining = computed(() => {
  if (!props.deadline) return null;
  const d = daysLeft(props.deadline);
  if (d == null) return null;
  if (d < 0) return null;
  return d;
});

const goalText = computed(() => TeamGoalLabel[props.goal as TeamGoal] ?? props.goal);
const statusText = computed(() => TeamStatusLabel[props.status as TeamStatus] ?? props.status);

const statusType = computed(() => {
  switch (props.status) {
    case 'RECRUITING': return 'success';
    case 'NEGOTIATING': return 'warning';
    case 'FULL': return 'info';
    case 'COMPETING': return 'primary';
    default: return 'info';
  }
});

function roleLabel(r: string) {
  return RoleTypeLabel[r as RoleType] ?? r;
}

function openReport() {
  reportReason.value = '';
  reportVisible.value = true;
}

async function submitReport() {
  reportSubmitting.value = true;
  try {
    await api.post('/reports', { targetType: 'TEAM', targetId: props.teamId, reason: reportReason.value.trim() || '未填写原因' });
    reportVisible.value = false;
    ElMessage.success('举报已提交，管理员会尽快处理');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    reportSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-10px">
    <div class="flex items-center gap-8px flex-wrap">
      <el-tag :type="statusType as never" size="small" effect="light" round>{{ statusText }}</el-tag>
      <span class="chip" style="background: rgba(245,185,1,0.14); color: #8a5800">🎯 {{ goalText }}</span>
      <span v-if="competition" class="chip" style="background: rgba(15,76,140,0.08); color: var(--uestc-blue)">
        {{ competition.name }}
      </span>
      <span
        v-if="remaining != null"
        class="chip"
        :style="remaining <= 3 ? 'background:rgba(217,60,60,0.1);color:#c0392b' : 'background:rgba(15,76,140,0.07);color:var(--uestc-blue)'"
      >
        {{ remaining <= 0 ? '今天截止' : `剩 ${remaining} 天` }}
      </span>
      <span v-else-if="expired" class="chip" style="background:rgba(0,0,0,0.06);color:var(--ink-faint)">已截止</span>
    </div>

    <div v-if="openRoles" class="flex items-center gap-6px flex-wrap">
      <span class="text-12px color-ink-soft">缺口：</span>
      <template v-if="openRoles.length">
        <el-tag v-for="r in openRoles" :key="r" size="small" effect="plain" round>{{ roleLabel(r) }}</el-tag>
      </template>
      <span v-else class="text-12px color-ink-faint">暂无空缺</span>
    </div>

    <div class="flex items-center gap-8px">
      <UserAvatar :name="leader.nickname || leader.college || 'U'" :size="26" />
      <span class="text-13px color-ink-soft">
        队长 {{ leader.nickname || '同学' }}
        <template v-if="leader.college"> · {{ leader.college }}</template>
        <template v-if="leader.grade"> · {{ leader.grade }} 级</template>
        <template v-if="memberCount != null || props.currentSize != null">
          · 已有 {{ props.currentSize ?? memberCount }}<template v-if="teamSize">/{{ teamSize }}</template> 人
        </template>
      </span>
      <a
        v-if="teamId && auth.isLoggedIn"
        class="report-link ml-auto text-12px cursor-pointer"
        title="举报该招募帖"
        @click.stop="openReport"
      >举报</a>
    </div>

    <!-- 举报弹窗 -->
    <el-dialog v-model="reportVisible" title="举报招募帖" width="420px" append-to-body>
      <div class="flex flex-col gap-10px">
        <div class="text-13px color-ink-soft">请描述该招募帖的问题（虚假信息、垃圾广告、不当内容等）：</div>
        <el-input
          v-model="reportReason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="举报原因（可留空）"
        />
      </div>
      <template #footer>
        <el-button @click="reportVisible = false">取消</el-button>
        <el-button type="primary" :loading="reportSubmitting" @click="submitReport">提交举报</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.report-link {
  color: var(--ink-faint);
  transition: color 0.15s ease-out;
}
.report-link:hover {
  color: #c0392b;
}
</style>
