<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, qs } from '../../api/client';
import { fmtDate } from '../../api/types';

const items = ref<
  {
    id: string;
    email: string;
    studentNo: string;
    nickname: string | null;
    college: string | null;
    grade: number | null;
    role: string;
    banned: boolean;
    createdAt: string;
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
      `/users${qs({ page: page.value, pageSize: 15, q: q.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function toggleBan(row: Record<string, any>) {
    const r = row as unknown as (typeof items.value)[number];
  const action = r.banned ? '解封' : '封禁';
  let reason = '';
  if (!row.banned) {
    const { value } = await ElMessageBox.prompt('封禁后该用户将立即下线且无法登录', `确认${action} ${r.nickname || r.studentNo}？`, {
      confirmButtonText: '确认封禁',
      cancelButtonText: '取消',
      inputPlaceholder: '封禁原因（可选）',
    });
    reason = value || '';
  } else {
    await ElMessageBox.confirm(`确认解封 ${r.nickname || r.studentNo}？`, '确认操作', { type: 'warning' });
  }
  await api.post(`/users/${r.id}/ban`, { reason });
  ElMessage.success(`已${action}`);
  load();
}

async function setRole(row: Record<string, any>, role: string) {
    const r2 = row as unknown as (typeof items.value)[number];
  await api.post(`/users/${r2.id}/role`, { role });
  ElMessage.success('角色已更新');
  load();
}

const roleLabel = (r: string) => (r === 'ADMIN' ? '管理员' : r === 'CONTRIBUTOR' ? '贡献者' : '学生');
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <el-input v-model="q" placeholder="搜索邮箱 / 学号 / 昵称" clearable style="max-width: 260px" @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><i-ep-search /></el-icon></template>
      </el-input>
      <span class="text-12px color-ink-faint ml-auto">共 {{ total }} 位用户</span>
    </div>

    <el-table :data="items" v-loading="loading">
      <el-table-column label="用户" min-width="180">
        <template #default="{ row }">
          <span class="font-semibold color-ink">{{ row.nickname || '未设置昵称' }}</span>
          <span class="color-ink-faint text-12px ml-4px">{{ row.studentNo }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="email" label="邮箱" min-width="200" />
      <el-table-column label="学院" min-width="140">
        <template #default="{ row }">{{ row.college || '—' }}</template>
      </el-table-column>
      <el-table-column label="角色" width="150">
        <template #default="{ row }">
          <el-select :model-value="row.role" size="small" @change="(v: string) => setRole(row, v)">
            <el-option value="STUDENT" label="学生" />
            <el-option value="CONTRIBUTOR" label="贡献者" />
            <el-option value="ADMIN" label="管理员" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" round :type="row.banned ? 'danger' : 'success'">
            {{ row.banned ? '已封禁' : '正常' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" width="110">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text :type="row.banned ? 'success' : 'danger'" @click="toggleBan(row)">
            {{ row.banned ? '解封' : '封禁' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="15" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
