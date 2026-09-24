<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { AudienceLabel, CompetitionFormatLabel, Audience, CompetitionFormat, Level, LevelLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, daysLeft, type CompetitionListItem } from '../../api/types';
import LevelChips from '../../components/LevelChips.vue';
import { useSlideThumb } from '../../composables/useSlideThumb';

const route = useRoute();
const router = useRouter();

/**
 * H9e：`?levels=A&levels=B` 这种数组形式在 `as string` 下会拿到 string[]，
 * 直接 `.split` 抛 TypeError，整个筛选侧栏白屏。统一先转字符串再 split。
 */
function parseLevels(raw: unknown): string[] {
  const s = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  return s.split(',').filter(Boolean);
}
function readQueryString(raw: unknown): string {
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
}

const filters = reactive({
  q: readQueryString(route.query.q),
  levels: parseLevels(route.query.levels),
  audience: '',
  format: '',
  bonusOnly: false,
  status: '',
  sort: 'LATEST',
});
const page = ref(1);
const pageSize = 12;
const total = ref(0);
const items = ref<CompetitionListItem[]>([]);
const loading = ref(false);
const view = ref<'card' | 'table'>('card');
const viewSwitchRef = ref<HTMLElement | null>(null);
const { thumbStyle: viewThumbStyle } = useSlideThumb(viewSwitchRef, () => view.value, '.seg-switch-item.active');

const levelOptions = [
  { value: Level.INTERNATIONAL, label: LevelLabel[Level.INTERNATIONAL] },
  { value: Level.NATIONAL, label: LevelLabel[Level.NATIONAL] },
  { value: Level.PROVINCIAL, label: LevelLabel[Level.PROVINCIAL] },
  { value: Level.SCHOOL, label: LevelLabel[Level.SCHOOL] },
];

/**
 * H9b：竞态防护。用户快速改筛选时会有多个请求在飞，
 * 先发的后到就会覆盖后发的结果（列表与筛选条件不一致）。
 * 用自增 requestId，只有最新一次请求的响应才落地。
 */
let requestSeq = 0;

async function load() {
  const reqId = ++requestSeq;
  loading.value = true;
  try {
    const res = await api.get<{ items: CompetitionListItem[]; total: number }>(
      `/competitions${qs({ ...filters, page: page.value, pageSize })}`,
    );
    if (reqId !== requestSeq) return; // 已有更新的请求，丢弃本次响应
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    if (reqId !== requestSeq) return;
    // H9d：原实现只有 try/finally，失败即 unhandled rejection 且用户无任何反馈
    ElMessage.error(e instanceof Error ? e.message : '竞赛列表加载失败，请稍后重试');
  } finally {
    if (reqId === requestSeq) loading.value = false;
  }
}

/**
 * H9a：搜索输入防抖 300ms。
 *
 * 关键点：搜索框绑定的是 `searchInput`（普通 ref），**不是** `filters.q`。
 * filters 是 reactive 对象、watch 默认深度监听，如果 v-model 直连 filters.q，
 * 每敲一个字符就会触发一次请求（原缺陷）。这里让「输入 → filters.q」之间隔一层
 * 300ms 防抖：只有防抖到期才写 filters.q，从而只发一次请求。
 * 其余筛选（下拉/复选/排序）是离散操作，立即生效。
 */
const searchInput = ref(readQueryString(route.query.q));
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    if (filters.q !== v) filters.q = v; // → filters watcher 触发 load
  }, 300);
});

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

/**
 * H9c：单一数据流 route.query → filters → watch → load。
 * 写操作（下拉、复选框、排序、搜索框、分页）只改 filters/page，统一由下面两个
 * watcher 触发 load；已去掉 `@change="load"` 与路由 watcher 里手动 load() 的重复触发源。
 */
watch(
  filters,
  () => {
    if (page.value !== 1) {
      // 改筛选条件回到第一页；page watcher 会负责这次加载
      page.value = 1;
      syncUrl();
      return;
    }
    syncUrl();
    load();
  },
  { deep: true },
);
watch(page, () => load());

function syncUrl() {
  router.replace({ query: { ...route.query, q: filters.q || undefined, levels: filters.levels.join(',') || undefined, bonusOnly: filters.bonusOnly ? 'true' : undefined } });
}

/**
 * 外部路由变化（浏览器前进/后退、站内跳转带 query）回填到 filters；
 * 回填本身会触发 filters watcher → load，这里不再手动加载。
 */
watch(
  () => route.query,
  (nq) => {
    const q = readQueryString(nq.q);
    if (q !== searchInput.value) searchInput.value = q;
    if (q !== filters.q) {
      // 外部导航应即时生效，取消可能还在挂起的防抖
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      filters.q = q;
    }
    const lv = parseLevels(nq.levels);
    if (lv.join(',') !== filters.levels.join(',')) filters.levels = lv;
    const bonus = nq.bonusOnly === 'true';
    if (bonus !== filters.bonusOnly) filters.bonusOnly = bonus;
  },
);

onMounted(load);

const statusText: Record<string, string> = { OPEN: '报名中', UPCOMING: '即将开始', ENDED: '已结束', UNKNOWN: '待定' };
const statusColor: Record<string, string> = {
  OPEN: '#2c7355',
  UPCOMING: '#8a5800',
  ENDED: 'var(--ink-faint)',
  UNKNOWN: 'var(--ink-faint)',
};

function deadlineText(c: CompetitionListItem) {
  const d = daysLeft(c.nextDeadline);
  if (d == null) return '暂无节点';
  if (d < 0) return '已截止';
  if (d === 0) return '今天截止';
  return `剩 ${d} 天`;
}

const activeFilterCount = computed(
  () => filters.levels.length + (filters.audience ? 1 : 0) + (filters.format ? 1 : 0) + (filters.bonusOnly ? 1 : 0) + (filters.status ? 1 : 0),
);
</script>

<template>
  <div class="page-wrap">
    <div class="flex items-end justify-between mb-18px flex-wrap gap-10px">
      <div>
        <h1 class="text-28px font-extrabold m-0">竞赛雷达</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">自动监听竞赛信息源，不错过任何 DDL</p>
      </div>
      <div class="flex items-center gap-8px">
        <el-button round class="seg-plate" @click="router.push({ name: 'calendar' })">
          📅 竞赛日历
        </el-button>
        <div ref="viewSwitchRef" class="seg-switch" role="tablist" aria-label="视图切换">
          <span class="seg-switch-thumb" aria-hidden="true" :style="viewThumbStyle"></span>
          <button class="seg-switch-item" :class="{ active: view === 'card' }" @click="view = 'card'">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" stroke="currentColor" stroke-width="1.7"/></svg>
            卡片
          </button>
          <button class="seg-switch-item" :class="{ active: view === 'table' }" @click="view = 'table'">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            表格
          </button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-18px items-start">
      <!-- 筛选侧栏 -->
      <aside class="glass p-18px lg:sticky lg:top-90px">
        <div class="flex items-center justify-between mb-10px">
          <span class="font-semibold text-14px">筛选</span>
          <el-badge v-if="activeFilterCount" :value="activeFilterCount" type="primary" />
        </div>
        <div class="flex flex-col gap-14px">
          <div>
            <div class="filter-label">级别</div>
            <el-checkbox-group v-model="filters.levels" class="flex flex-col gap-4px">
              <el-checkbox v-for="l in levelOptions" :key="l.value" :value="l.value" :label="l.label" />
            </el-checkbox-group>
          </div>
          <div>
            <div class="filter-label">面向年级</div>
            <el-select v-model="filters.audience" placeholder="全部" clearable size="default" style="width: 100%">
              <el-option :value="Audience.UNDERGRAD" :label="AudienceLabel[Audience.UNDERGRAD]" />
              <el-option :value="Audience.POSTGRAD" :label="AudienceLabel[Audience.POSTGRAD]" />
              <el-option :value="Audience.MIXED" :label="AudienceLabel[Audience.MIXED]" />
            </el-select>
          </div>
          <div>
            <div class="filter-label">赛制</div>
            <el-select v-model="filters.format" placeholder="全部" clearable size="default" style="width: 100%">
              <el-option :value="CompetitionFormat.INDIVIDUAL" :label="CompetitionFormatLabel[CompetitionFormat.INDIVIDUAL]" />
              <el-option :value="CompetitionFormat.TEAM" :label="CompetitionFormatLabel[CompetitionFormat.TEAM]" />
            </el-select>
          </div>
          <div>
            <div class="filter-label">状态</div>
            <el-select v-model="filters.status" placeholder="全部" clearable size="default" style="width: 100%">
              <el-option value="OPEN" label="报名中" />
              <el-option value="UPCOMING" label="即将开始" />
              <el-option value="ENDED" label="已结束" />
            </el-select>
          </div>
          <el-divider class="!my-4px" />
          <el-checkbox v-model="filters.bonusOnly" class="bonus-check">
            <span class="font-semibold" style="color: #8a5800">🎓 保研加分竞赛</span>
          </el-checkbox>
        </div>
      </aside>

      <!-- 列表 -->
      <div>
        <div class="glass !rounded-14px px-14px py-10px mb-14px flex items-center gap-10px flex-wrap">
          <el-input
            v-model="searchInput"
            placeholder="搜索竞赛名称或别名…"
            clearable
            style="max-width: 300px"
          >
            <template #prefix><el-icon><i-ep-search /></el-icon></template>
          </el-input>
          <div class="flex items-center gap-6px ml-auto">
            <span class="text-13px color-ink-soft">排序</span>
            <el-select v-model="filters.sort" style="width: 140px">
              <el-option value="LATEST" label="最新收录" />
              <el-option value="DEADLINE" label="报名截止临近" />
              <el-option value="DIFFICULTY" label="难度" />
              <el-option value="HOT" label="热度" />
            </el-select>
          </div>
        </div>

        <!-- 卡片视图 -->
        <div v-if="view === 'card'" v-loading="loading" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-14px min-h-300px">
          <router-link
            v-for="(c, i) in items"
            :key="c.id"
            :to="`/competitions/${c.id}`"
            class="glass glass-hover p-18px no-underline flex flex-col gap-10px animate-row-enter"
            :style="{ animationDelay: `${Math.min(i, 8) * 0.04}s` }"
          >
            <div class="flex items-start justify-between gap-8px">
              <h3 class="text-15px font-bold m-0 color-ink leading-snug">{{ c.name }}</h3>
              <span
                class="text-12px font-semibold shrink-0"
                :style="{ color: statusColor[c.status] }"
              >{{ statusText[c.status] }}</span>
            </div>
            <LevelChips :levels="c.levels" />
            <div class="flex items-center justify-between mt-auto pt-6px">
              <span class="text-12px" :style="{ color: c.nextDeadline ? '#8a5800' : 'var(--ink-faint)' }">
                ⏳ {{ deadlineText(c) }}
              </span>
              <span class="text-12px color-ink-faint">
                {{ c.recruitingTeams > 0 ? `👥 ${c.recruitingTeams} 支队伍招募中` : '' }}
              </span>
            </div>
          </router-link>
          <el-empty v-if="!loading && !items.length" description="没有符合条件的竞赛" class="col-span-full" />
        </div>

        <!-- 表格视图 -->
        <div v-else class="glass p-14px min-h-300px">
          <el-table :data="items" v-loading="loading" style="width: 100%">
            <el-table-column prop="name" label="竞赛" min-width="220">
              <template #default="{ row }">
                <router-link :to="`/competitions/${row.id}`" class="font-semibold color-ink no-underline hover:text-uestc-500">
                  {{ row.name }}
                </router-link>
              </template>
            </el-table-column>
            <el-table-column label="级别" width="180">
              <template #default="{ row }"><LevelChips :levels="row.levels" :max="4" /></template>
            </el-table-column>
            <el-table-column label="加分" width="70">
              <template #default="{ row }">
                <span v-if="row.isBonusEligible" style="color: #d99f00">🎓</span>
                <span v-else class="color-ink-faint">—</span>
              </template>
            </el-table-column>
            <el-table-column label="报名截止" width="110">
              <template #default="{ row }">{{ fmtDate(row.nextDeadline) }}</template>
            </el-table-column>
            <el-table-column label="队伍" width="90">
              <template #default="{ row }">{{ row.recruitingTeams || '—' }}</template>
            </el-table-column>
          </el-table>
          <div class="flex justify-center mt-16px">
            <el-pagination v-model:current-page="page" :total="total" :page-size="pageSize" layout="prev, pager, next" />
          </div>
        </div>

        <div v-if="view === 'card'" class="flex justify-center mt-18px">
          <el-pagination v-model:current-page="page" :total="total" :page-size="pageSize" layout="prev, pager, next" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-label {
  font-size: 12px;
  color: var(--ink-faint);
  margin-bottom: 4px;
}
.bonus-check :deep(.el-checkbox__inner) {
  border-color: rgba(217, 159, 0, 0.6);
}
@media (max-width: 1024px) {
  aside {
    position: static !important;
  }
}
</style>
