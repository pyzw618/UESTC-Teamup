<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { FeedbackTypeLabel, type FeedbackType } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, type FeedbackItem } from '../../api/types';

/**
 * 后台反馈管理（Issue 5）：
 * - 按日期查看与导出反馈，一次只能导出一天；
 * - 无反馈的日期在选择器中置灰、不可导出（每日条数来自 /admin/feedback/counts）。
 */

const date = ref<string>(today());
const items = ref<FeedbackItem[]>([]);
const loading = ref(false);
const month = ref(today().slice(0, 7));
/** 每日反馈条数（key = YYYY-MM-DD），为 0 的日期禁用 */
const dayCounts = ref<Record<string, number>>({});

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const typeText = (t: string) => FeedbackTypeLabel[t as FeedbackType] ?? t;
const typeTag = (t: string) => (t === 'FUNCTION' ? 'primary' : 'warning');

const dayTotal = computed(() => items.value.length);

async function loadCounts() {
  try {
    dayCounts.value = await api.get<Record<string, number>>(`/admin/feedback/counts${qs({ month: month.value })}`);
  } catch {
    dayCounts.value = {};
  }
}

async function load() {
  if (!date.value) return;
  loading.value = true;
  try {
    items.value = await api.get<FeedbackItem[]>(`/admin/feedback${qs({ date: date.value })}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '反馈加载失败');
    items.value = [];
  } finally {
    loading.value = false;
  }
}

/** 无反馈的日期置灰（Issue 5：该日没有反馈则不可选、不可导出） */
function disabledDate(d: Date): boolean {
  const p = (n: number) => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return (dayCounts.value[key] ?? 0) === 0;
}

function onMonthChange(m: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  month.value = `${m.getFullYear()}-${p(m.getMonth() + 1)}`;
  loadCounts();
}

/** 导出该日反馈 JSON（Content-Disposition 由后端设置，直接跳转下载） */
function exportJson() {
  if (!dayTotal.value) {
    ElMessage.warning('该日没有反馈，无法导出');
    return;
  }
  window.open(`/api/admin/feedback/export?date=${date.value}`, '_blank');
}

onMounted(async () => {
  await Promise.all([loadCounts(), load()]);
});
</script>

<template>
  <div class="glass p-18px">
    <div class="flex items-center gap-10px mb-14px flex-wrap">
      <el-date-picker
        v-model="date"
        type="date"
        placeholder="选择日期"
        value-format="YYYY-MM-DD"
        :clearable="false"
        :disabled-date="disabledDate"
        @calendar-change="onMonthChange"
        @change="load"
        style="width: 160px"
      />
      <el-button type="primary" round :disabled="!dayTotal" @click="exportJson">⬇ 导出该日反馈 JSON</el-button>
      <span class="text-12px color-ink-faint ml-auto">
        {{ date }} 共 {{ dayTotal }} 条反馈 · 一次只能导出一天；无反馈的日期已置灰
      </span>
    </div>

    <div v-loading="loading" class="flex flex-col gap-10px min-h-200px">
      <div
        v-for="f in items"
        :key="f.id"
        class="rounded-14px p-14px"
        style="background: rgba(255,255,255,0.55)"
      >
        <div class="flex items-center gap-8px flex-wrap mb-6px">
          <el-tag size="small" round :type="typeTag(f.type)">{{ typeText(f.type) }}</el-tag>
          <span v-if="f.competitionName" class="text-13px font-semibold color-ink">📌 {{ f.competitionName }}</span>
          <span v-if="f.pagePath" class="text-12px color-ink-faint truncate" style="max-width: 320px">页面：{{ f.pagePath }}</span>
          <span class="text-12px color-ink-faint ml-auto">{{ fmtDate(f.createdAt, true) }}</span>
        </div>
        <p class="text-13px color-ink m-0 whitespace-pre-wrap">{{ f.content }}</p>
        <div class="text-12px color-ink-faint mt-6px">
          <template v-if="f.submittedBy">提交者：{{ f.submittedBy.nickname || f.submittedBy.userId }}</template>
          <template v-else>游客提交</template>
          <template v-if="f.contact"> · 回访方式：{{ f.contact }}</template>
        </div>
      </div>
      <el-empty v-if="!loading && !items.length" description="该日没有反馈" :image-size="60" />
    </div>
  </div>
</template>
