<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, qs } from '../../api/client';
import { fmtDate } from '../../api/types';

const router = useRouter();

const items = ref<
  {
    id: string;
    targetType: string;
    reason: string;
    handled: boolean;
    createdAt: string;
    reporter: { id: string; nickname: string | null; college: string | null } | null;
    team: { id: string; name: string; leader: string | null; status: string } | null;
    comment: { id: string; content: string } | null;
  }[]
>([]);
const filter = ref('');
const page = ref(1);
const total = ref(0);
const loading = ref(true);

const typeLabel: Record<string, string> = { TEAM: '组队帖', COMMENT: '评论', POST: '经验帖' };

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: typeof items.value; total: number }>(
      `/admin/reports${qs({ page: page.value, pageSize: 15, handled: filter.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function handle(row: (typeof items.value)[number], action: 'dismiss' | 'delete-content') {
  if (action === 'delete-content') {
    const label = row.targetType === 'TEAM' ? `组队帖「${row.team?.name || ''}」` : '被举报内容';
    await ElMessageBox.confirm(
      `将删除${label}（级联删除其成员与申请记录），该操作不可恢复。确认？`,
      '删除内容',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    );
  }
  await api.post(`/admin/reports/${row.id}/${action === 'dismiss' ? 'handle' : 'delete-content'}`);
  ElMessage.success(action === 'dismiss' ? '已驳回该举报' : '内容已删除');
  load();
}
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <el-radio-group v-model="filter" @change="load">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="false">待处理</el-radio-button>
        <el-radio-button value="true">已处理</el-radio-button>
      </el-radio-group>
      <span class="text-12px color-ink-faint ml-auto">删除内容不可恢复，请先核实</span>
    </div>

    <div v-loading="loading" class="flex flex-col gap-12px min-h-200px">
      <div v-for="r in items" :key="r.id" class="rounded-14px p-14px" style="background: rgba(255,255,255,0.55)">
        <div class="flex items-center gap-8px flex-wrap mb-6px">
          <el-tag size="small" round :type="r.handled ? 'info' : 'warning'">{{ r.handled ? '已处理' : '待处理' }}</el-tag>
          <el-tag size="small" round effect="plain">{{ typeLabel[r.targetType] || r.targetType }}</el-tag>
          <template v-if="r.targetType === 'TEAM' && r.team">
            <span class="text-14px font-bold color-ink">{{ r.team.name }}</span>
            <span class="text-12px color-ink-faint">队长 {{ r.team.leader || '—' }} · 状态 {{ r.team.status }}</span>
          </template>
          <template v-else-if="r.targetType === 'COMMENT' && r.comment">
            <span class="text-13px color-ink-soft truncate" style="max-width: 420px">「{{ r.comment.content }}」</span>
          </template>
          <span class="text-12px color-ink-faint ml-auto">{{ fmtDate(r.createdAt, true) }} · 举报人 {{ r.reporter?.nickname || '同学' }}</span>
        </div>
        <p class="text-13px color-ink-soft m-0">举报原因：{{ r.reason }}</p>
        <div v-if="!r.handled" class="flex gap-8px mt-10px">
          <el-button size="small" type="danger" plain round @click="handle(r, 'delete-content')">删除内容</el-button>
          <el-button size="small" round @click="handle(r, 'dismiss')">驳回举报</el-button>
          <el-button v-if="r.targetType === 'TEAM' && r.team" size="small" link type="primary" @click="router.push(`/teams/${r.team.id}`)">
            查看队伍
          </el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !items.length" description="暂无举报" :image-size="56" />
    </div>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="15" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
