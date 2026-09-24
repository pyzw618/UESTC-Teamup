<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { PublishStatus, PublishStatusLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate } from '../../api/types';

const router = useRouter();

const items = ref<
  {
    id: string;
    name: string;
    status: string;
    levels: string[];
    tags: string[];
    recruitingTeams: number;
    nextDeadline: string | null;
    teamCount: number;
    updatedAt: string;
  }[]
>([]);
const total = ref(0);
const page = ref(1);
const q = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: typeof items.value; total: number }>(
      `/admin/competitions${qs({ page: page.value, pageSize: 15, q: q.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    // H10：补 catch
    ElMessage.error(e instanceof Error ? e.message : '竞赛列表加载失败');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function archive(id: string) {
  try {
    await ElMessageBox.confirm('下线后用户端不再展示，确定？', '下线竞赛', { type: 'warning' });
  } catch {
    return; // H10：用户取消 / 关闭弹窗
  }
  try {
    await api.delete(`/admin/competitions/${id}`);
    ElMessage.success('已下线');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下线失败');
  }
  await load();
}

const statusLabel = (s: string) => PublishStatusLabel[s as PublishStatus] ?? s;
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <el-input v-model="q" placeholder="搜索竞赛名" clearable style="max-width: 260px" @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><i-ep-search /></el-icon></template>
      </el-input>
      <el-button type="primary" round @click="router.push({ name: 'admin-competition-new' })">+ 录入竞赛</el-button>
      <span class="text-12px color-ink-faint ml-auto">共 {{ total }} 个</span>
    </div>

    <el-table :data="items" v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="220" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" round :type="row.status === 'PUBLISHED' ? 'success' : row.status === 'DRAFT' ? 'info' : 'danger'">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="报名截止" width="110">
        <template #default="{ row }">{{ fmtDate(row.nextDeadline) }}</template>
      </el-table-column>
      <el-table-column label="队伍" width="70">
        <template #default="{ row }">{{ row.teamCount }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="110">
        <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="router.push(`/admin/competitions/${row.id}/edit`)">编辑</el-button>
          <el-button size="small" link type="danger" @click="archive(row.id)">下线</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="15" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
