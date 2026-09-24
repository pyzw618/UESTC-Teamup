<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { CorrectionStatus, CorrectionStatusLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, type CorrectionItem } from '../../api/types';

const items = ref<CorrectionItem[]>([]);
const status = ref<CorrectionStatus | ''>('');
const page = ref(1);
const total = ref(0);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: CorrectionItem[]; total: number }>(
      `/admin/corrections${qs({ page: page.value, pageSize: 15, status: status.value || undefined })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    // H10：补 catch，接口失败不再静默/产生 unhandled rejection
    ElMessage.error(e instanceof Error ? e.message : '纠错列表加载失败');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function fieldLabel(f: string) {
  if (f.startsWith('timeline:')) {
    const [, tlId, field] = f.split(':');
    return `时间轴节点 ${tlId.slice(-6)} 的 ${field === 'endAt' ? '截止时间' : '开始时间'}`;
  }
  const map: Record<string, string> = {
    name: '竞赛名称',
    organizer: '主办方',
    officialUrl: '官网链接',
    intro: '竞赛简介',
    isBonusEligible: '是否计入推免加分',
    bonusCategory: '加分认定类别',
    bonusPoints: '加分分值',
  };
  return map[f] ?? f;
}

async function review(id: string, action: 'accept' | 'reject') {
  // H10：采纳会写入字段值并加锁，加一次确认；取消直接返回，不产生 unhandled rejection
  if (action === 'accept') {
    try {
      await ElMessageBox.confirm('采纳后建议值将写入该字段并自动加锁，同时记录一条版本。确认采纳？', '采纳纠错', {
        type: 'warning',
        confirmButtonText: '确认采纳',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
  }
  try {
    await api.post(`/admin/corrections/${id}/review`, { action });
    ElMessage.success(action === 'accept' ? '已采纳：值已写入，节点自动加锁，版本已记录' : '已驳回');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
  await load();
}
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px">
      <el-radio-group v-model="status" @change="load">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button :value="CorrectionStatus.PENDING">待处理</el-radio-button>
        <el-radio-button :value="CorrectionStatus.ACCEPTED">已采纳</el-radio-button>
        <el-radio-button :value="CorrectionStatus.REJECTED">已驳回</el-radio-button>
      </el-radio-group>
      <span class="text-12px color-ink-faint ml-auto">纠错处理的优先级高于采集任务（全自动模式的事后纠错执行台）</span>
    </div>

    <div v-loading="loading" class="flex flex-col gap-12px min-h-200px">
      <div v-for="c in items" :key="c.id" class="rounded-14px p-14px" style="background: rgba(255,255,255,0.55)">
        <div class="flex items-center gap-8px flex-wrap mb-6px">
          <el-tag size="small" round :type="c.status === 'PENDING' ? 'warning' : c.status === 'ACCEPTED' ? 'success' : 'info'">
            {{ CorrectionStatusLabel[c.status as CorrectionStatus] ?? c.status }}
          </el-tag>
          <router-link
            v-if="c.competition"
            :to="`/competitions/${c.competition.id}`"
            class="text-14px font-bold color-uestc-600 no-underline"
          >{{ c.competition.name }}</router-link>
          <span class="text-12px color-ink-faint">{{ fieldLabel(c.field) }}</span>
          <span class="text-12px color-ink-faint ml-auto">{{ fmtDate(c.createdAt, true) }} · {{ c.reporter?.nickname || '同学' }}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8px text-13px">
          <div class="rounded-10px p-8px" style="background: rgba(0,0,0,0.03)">
            <span class="color-ink-faint">当前：</span>{{ c.currentValue || '（空）' }}
          </div>
          <div class="rounded-10px p-8px" style="background: rgba(64,153,117,0.06)">
            <span class="color-ink-faint">建议：</span>{{ c.proposedValue || '（未提供）' }}
          </div>
        </div>
        <p v-if="c.note" class="text-12px color-ink-soft m-0 mt-6px">说明：{{ c.note }}</p>
        <div v-if="c.status === 'PENDING'" class="flex gap-8px mt-10px">
          <el-button size="small" type="primary" round @click="review(c.id, 'accept')">采纳</el-button>
          <el-button size="small" round @click="review(c.id, 'reject')">驳回</el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !items.length" description="暂无纠错" :image-size="56" />
    </div>

    <div class="flex justify-center mt-14px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="15" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
