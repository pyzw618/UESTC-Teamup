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
  /** 期望招募的方向（neededRoles，卡片标签主体） */
  neededRoles?: string[];
  /** 已有成员数量（手填成员行数） */
  memberCount?: number;
  /** 计划招募人数 */
  targetSize?: number | null;
  /** 评论数（可选展示） */
  commentCount?: number;
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
  if (d == null || d < 0) return null;
  return d;
});

const goalText = computed(() => TeamGoalLabel[props.goal as TeamGoal] ?? props.goal);
const statusText = computed(() => TeamStatusLabel[props.status as TeamStatus] ?? props.status);

/** 状态点的颜色语义：招募=绿，满员=金，参赛=蓝，解散=灰 */
const statusClass = computed(() => {
  switch (props.status) {
    case 'RECRUITING': return 'is-recruiting';
    case 'FULL': return 'is-full';
    case 'COMPETING': return 'is-competing';
    default: return 'is-closed';
  }
});

const deadlineText = computed(() => {
  if (props.expired) return '已截止';
  if (remaining.value == null) return null;
  if (remaining.value === 0) return '今天截止';
  if (remaining.value <= 3) return `剩 ${remaining.value} 天`;
  return `剩 ${remaining.value} 天`;
});

const deadlineHot = computed(() => remaining.value != null && remaining.value <= 3);

const sizeText = computed(() => {
  if (props.memberCount == null && props.targetSize == null) return null;
  const cur = props.memberCount ?? 0;
  return props.targetSize ? `${cur} / ${props.targetSize} 人` : `${cur} 人`;
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
  <div class="tcm flex flex-col gap-9px">
    <!-- 第一行：状态 + 目标 + 截止 + 评论数，统一胶囊规格 -->
    <div class="tcm-tags">
      <span class="tcm-chip" :class="statusClass">
        <i class="tcm-dot" />{{ statusText }}
      </span>
      <span class="tcm-chip is-goal">🎯 {{ goalText }}</span>
      <span v-if="competition" class="tcm-chip is-comp">{{ competition.name }}</span>
      <span v-if="deadlineText" class="tcm-chip" :class="deadlineHot ? 'is-urgent' : 'is-muted'">
        ⏱ {{ deadlineText }}
      </span>
      <span v-if="commentCount" class="tcm-chip is-muted">💬 {{ commentCount }}</span>
    </div>

    <!-- 第二行：招募方向（卡片视觉主体） -->
    <div class="tcm-roles">
      <span class="tcm-roles-label">招</span>
      <template v-if="neededRoles?.length">
        <span v-for="r in neededRoles" :key="r" class="tcm-role">{{ roleLabel(r) }}</span>
      </template>
      <span v-else class="tcm-role is-open">方向不限</span>
    </div>

    <div class="flex items-center gap-8px">
      <UserAvatar :name="leader.nickname || leader.college || 'U'" :size="26" />
      <span class="text-13px color-ink-soft truncate">
        队长 {{ leader.nickname || '同学' }}
        <template v-if="leader.college"> · {{ leader.college }}</template>
        <template v-if="leader.grade"> · {{ leader.grade }} 级</template>
        <template v-if="sizeText"> · 已有 {{ sizeText }}</template>
      </span>
      <a
        v-if="teamId && auth.isLoggedIn"
        class="report-link ml-auto text-12px cursor-pointer shrink-0"
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
/* ---- 统一标签体系：同高度、同圆角、同字重，颜色只靠语义类区分 ---- */
.tcm-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tcm-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  background: rgba(15, 76, 140, 0.06);
  color: var(--uestc-blue, #0f4c8c);
}
.tcm-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}
.tcm-chip.is-recruiting { background: rgba(64, 153, 117, 0.12); color: #2c7355; }
.tcm-chip.is-full { background: rgba(245, 185, 1, 0.16); color: #8a5800; }
.tcm-chip.is-competing { background: rgba(15, 76, 140, 0.12); color: #0f4c8c; }
.tcm-chip.is-closed { background: rgba(0, 0, 0, 0.06); color: var(--ink-faint, #9aa3ad); }
.tcm-chip.is-goal { background: rgba(245, 185, 1, 0.14); color: #8a5800; }
.tcm-chip.is-comp {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(15, 76, 140, 0.06);
}
.tcm-chip.is-urgent { background: rgba(217, 60, 60, 0.1); color: #c0392b; }
.tcm-chip.is-muted { background: rgba(0, 0, 0, 0.045); color: var(--ink-soft, #5d6670); font-weight: 500; }

/* ---- 招募方向：卡片主体标签，实心蓝底更醒目 ---- */
.tcm-roles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tcm-roles-label {
  font-size: 12px;
  color: var(--ink-faint, #9aa3ad);
  margin-right: 2px;
}
.tcm-role {
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
  transition: transform 0.15s ease-out, border-color 0.15s ease-out;
}
.tcm-role:hover {
  transform: translateY(-1px);
  border-color: rgba(15, 76, 140, 0.4);
}
.tcm-role.is-open {
  color: var(--ink-faint, #9aa3ad);
  background: rgba(0, 0, 0, 0.04);
  border: 1px dashed rgba(0, 0, 0, 0.15);
  font-weight: 500;
}

.report-link {
  color: var(--ink-faint);
  transition: color 0.15s ease-out;
}
.report-link:hover {
  color: #c0392b;
}
</style>
