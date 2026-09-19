<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { RevisionOrigin } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, type RevisionItem } from '../../api/types';

const items = ref<RevisionItem[]>([]);
const page = ref(1);
const total = ref(0);
const loading = ref(true);
const competitionId = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: RevisionItem[]; total: number }>(
      `/admin/revisions${qs({ page: page.value, pageSize: 20, competitionId: competitionId.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const originLabel: Record<string, string> = {
  [RevisionOrigin.CRAWL]: '采集自动更新',
  [RevisionOrigin.MANUAL]: '人工修改',
  [RevisionOrigin.ROLLBACK]: '回滚动作',
};
const originType = (o: string) => (o === 'CRAWL' ? 'primary' : o === 'MANUAL' ? 'warning' : 'danger');

async function rollback(row: Record<string, unknown>) {
  const r = row as unknown as RevisionItem;
  await ElMessageBox.confirm(
    `将「${r.field}」从 ${val(r.newValue)} 回滚到 ${val(r.oldValue)}？回滚动作本身也会记录一条版本。`,
    '一键回滚',
    { type: 'warning' },
  );
  await api.post(`/admin/revisions/${r.id}/rollback`);
  ElMessage.success('已回滚');
  load();
}

function val(s: string | null) {
  if (s == null) return '（空）';
  return s.length > 19 && !Number.isNaN(Date.parse(s)) ? fmtDate(s, true) : s;
}
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <span class="text-13px color-ink-soft">版本历史是全自动发布模式的恢复通道：每次字段变更都记录旧值，支持一键回滚</span>
    </div>

    <el-table :data="items" v-loading="loading">
      <el-table-column label="对象" min-width="160">
        <template #default="{ row }">
          {{ row.competition?.name || '—' }}
          <span v-if="row.timeline" class="color-ink-faint">（{{ row.timeline.stage }}）</span>
        </template>
      </el-table-column>
      <el-table-column prop="field" label="字段" width="90" />
      <el-table-column label="旧值" min-width="130">
        <template #default="{ row }"><span class="color-ink-soft">{{ val(row.oldValue) }}</span></template>
      </el-table-column>
      <el-table-column label="新值" min-width="130">
        <template #default="{ row }">{{ val(row.newValue) }}</template>
      </el-table-column>
      <el-table-column label="来源" width="120">
        <template #default="{ row }">
          <el-tag size="small" round :type="originType(row.origin) as never">{{ originLabel[row.origin] ?? row.origin }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="140">
        <template #default="{ row }">{{ fmtDate(row.createdAt, true) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.oldValue != null" size="small" text type="warning" @click="rollback(row)">回滚</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
