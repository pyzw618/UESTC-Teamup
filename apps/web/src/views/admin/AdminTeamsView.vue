<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { TeamGoal, TeamGoalLabel, TeamStatus, TeamStatusLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate } from '../../api/types';

const router = useRouter();

interface AdminTeamItem {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  createdAt: string;
  competition: { id: string; name: string; year: number };
  leader: { id: string; nickname: string | null; studentNo: string; college: string | null };
  memberCount: number;
  intentCount: number;
}

const items = ref<AdminTeamItem[]>([]);
const total = ref(0);
const page = ref(1);
const q = ref('');
const status = ref('');
const loading = ref(true);

const statusOptions: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: TeamStatus.RECRUITING, label: TeamStatusLabel[TeamStatus.RECRUITING] },
  { value: TeamStatus.FULL, label: TeamStatusLabel[TeamStatus.FULL] },
  { value: TeamStatus.DISBANDED, label: TeamStatusLabel[TeamStatus.DISBANDED] },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: AdminTeamItem[]; total: number }>(
      `/admin/teams${qs({ page: page.value, pageSize: 15, q: q.value || undefined, status: status.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '招募帖列表加载失败');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function resetAndLoad() {
  page.value = 1;
  load();
}

async function toggleArchive(id: string, currentStatus: string) {
  const archived = currentStatus !== TeamStatus.DISBANDED;
  try {
    await ElMessageBox.confirm(
      archived
        ? '归档后帖子从公共列表与竞赛详情中消失，其他用户无法访问；管理员可随时恢复。'
        : '恢复后帖子重新出现在公共列表，状态重置为「招募中」。',
      archived ? '归档招募帖' : '恢复招募帖',
      { type: archived ? 'warning' : 'info', confirmButtonText: archived ? '确认归档' : '确认恢复' },
    );
  } catch {
    return;
  }
  try {
    await api.post(`/admin/teams/${id}/archive`, { archived });
    ElMessage.success(archived ? '已归档' : '已恢复');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

const statusLabel = (s: string) => TeamStatusLabel[s as TeamStatus] ?? s;
const statusTagType = (s: string) => {
  if (s === TeamStatus.DISBANDED) return 'info';
  if (s === TeamStatus.FULL) return 'warning';
  return 'success';
};
const goalLabel = (g: string) => TeamGoalLabel[g as TeamGoal] ?? g;
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <el-input
        v-model="q"
        placeholder="竞赛名 / 队长昵称 / 学号"
        clearable
        style="max-width: 260px"
        @keyup.enter="resetAndLoad"
        @clear="resetAndLoad"
      >
        <template #prefix><el-icon><i-ep-search /></el-icon></template>
      </el-input>
      <el-select v-model="status" placeholder="状态" style="width: 120px" @change="resetAndLoad">
        <el-option v-for="s in statusOptions" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <span class="text-12px color-ink-faint ml-auto">仅可归档 / 恢复，不能编辑帖子内容 · 共 {{ total }} 条</span>
    </div>

    <el-table :data="items" v-loading="loading">
      <el-table-column label="竞赛" min-width="200">
        <template #default="{ row }">
          <div class="text-13px font-semibold color-uestc-600 cursor-pointer" @click="router.push(`/competitions/${row.competition.id}`)">
            {{ row.competition.name }}
          </div>
          <div class="text-12px color-ink-faint">{{ row.competition.year }} 届 · {{ goalLabel(row.goal) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="队长" min-width="150">
        <template #default="{ row }">
          <div class="text-13px">{{ row.leader.nickname || '同学' }}</div>
          <div class="text-12px color-ink-faint">{{ row.leader.studentNo }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" round :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="人数 / 意愿" width="110">
        <template #default="{ row }">{{ row.memberCount }} 人 · {{ row.intentCount }} 意愿</template>
      </el-table-column>
      <el-table-column label="招募截止" width="110">
        <template #default="{ row }">{{ fmtDate(row.deadline) }}</template>
      </el-table-column>
      <el-table-column label="发布时间" width="110">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="router.push(`/teams/${row.id}`)">查看</el-button>
          <el-button
            size="small"
            link
            :type="row.status === TeamStatus.DISBANDED ? 'success' : 'danger'"
            @click="toggleArchive(row.id, row.status)"
          >{{ row.status === TeamStatus.DISBANDED ? '恢复' : '归档' }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="15" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
