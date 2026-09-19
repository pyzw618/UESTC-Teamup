<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, EventClickArg } from '@fullcalendar/core';
import { ElMessage } from 'element-plus';
import { Level, LevelLabel } from '@teamup/shared';
import { api } from '../../api/client';
import type { TimelineNode } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { useRouter } from 'vue-router';

const auth = useAuthStore();
const router = useRouter();

const allEvents = ref<TimelineNode[]>([]);
const loading = ref(true);
const selectedDate = ref<string | null>(null);
const onlyBonus = ref(false);
const selectedLevels = ref<string[]>([]);
const calendarRef = ref<InstanceType<typeof FullCalendar>>();

const levelOptions = [Level.INTERNATIONAL, Level.NATIONAL, Level.PROVINCIAL, Level.SCHOOL].map((l) => ({
  value: l,
  label: LevelLabel[l],
}));

// 报名期 / 赛程期 两类样式 + 级别配色
function eventColor(t: TimelineNode): { bg: string; border: string } {
  const blue = t.level === 'INTERNATIONAL' ? '#0A2E55' : t.level === 'NATIONAL' ? '#0F4C8C' : t.level === 'PROVINCIAL' ? '#D99F00' : '#2C7355';
  if (t.kind === 'signup') {
    return { bg: `${blue}26`, border: `${blue}88` };
  }
  return { bg: `${blue}59`, border: blue };
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, listPlugin, interactionPlugin],
  initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth',
  headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
  locale: 'zh-cn',
  height: 'auto',
  events: filteredEvents.value.map((t) => {
    const c = eventColor(t);
    return {
      id: t.id,
      title: `${t.kind === 'signup' ? '🚩' : '🏁'} ${t.competitionName} · ${t.stage}`,
      start: t.startAt ?? t.endAt ?? undefined,
      end: t.endAt ?? undefined,
      backgroundColor: c.bg,
      borderColor: c.border,
      textColor: '#16283A',
      extendedProps: t,
    };
  }),
  dateClick: (info) => {
    selectedDate.value = info.dateStr;
  },
  eventClick: (info: EventClickArg) => {
    router.push(`/competitions/${(info.event.extendedProps as TimelineNode).competitionId}`);
  },
}));

const filteredEvents = computed(() =>
  allEvents.value.filter(
    (t) =>
      !selectedLevels.value.length ||
      selectedLevels.value.includes(t.level || '') ||
      t.competitionLevels.some((l) => selectedLevels.value.includes(l)),
  ),
);

const dayNodes = computed(() => {
  if (!selectedDate.value) return [];
  const day = new Date(`${selectedDate.value}T00:00:00`);
  const next = new Date(day.getTime() + 86400_000);
  return filteredEvents.value.filter((t) => {
    const s = t.startAt ? new Date(t.startAt) : null;
    const e = t.endAt ? new Date(t.endAt) : null;
    // 节点跨越当天
    const startOk = s && s < next && (!e || s >= day || e >= day);
    const endOk = e && e >= day && (!s || s < next);
    const spanOk = s && e && s < day && e >= next;
    return startOk || endOk || spanOk;
  });
});

onMounted(async () => {
  try {
    allEvents.value = await api.get<TimelineNode[]>('/calendar');
  } finally {
    loading.value = false;
  }
});

function goIcs() {
  ElMessage.success('已在新窗口打开订阅链接，可添加到手机日历');
  window.open('/api/calendar.ics', '_blank');
}
</script>

<template>
  <div class="page-wrap">
    <div class="flex items-end justify-between mb-16px flex-wrap gap-10px">
      <div>
        <h1 class="text-28px font-extrabold m-0">竞赛日历</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">
          🚩 报名期（浅色） · 🏁 赛程期（实色） —— 学生 90% 在手机上，订阅比站内提醒有用 10 倍
        </p>
      </div>
      <el-button type="primary" round @click="goIcs">📅 订阅 .ics 到手机日历</el-button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-16px items-start">
      <div class="glass p-18px" v-loading="loading">
        <div class="flex items-center gap-10px mb-10px flex-wrap">
          <el-checkbox-group v-model="selectedLevels" size="small">
            <el-checkbox-button v-for="l in levelOptions" :key="l.value" :value="l.value">{{ l.label }}</el-checkbox-button>
          </el-checkbox-group>
          <span class="text-12px color-ink-faint ml-auto">点击日期查看当天节点</span>
        </div>
        <FullCalendar ref="calendarRef" :options="calendarOptions" />
      </div>

      <!-- 当天节点侧栏 -->
      <aside class="glass p-18px lg:sticky lg:top-90px min-h-200px">
        <template v-if="selectedDate">
          <h3 class="text-15px font-bold m-0 mb-10px">{{ selectedDate }} 的节点</h3>
          <div class="flex flex-col gap-10px">
            <router-link
              v-for="t in dayNodes"
              :key="t.id"
              :to="`/competitions/${t.competitionId}`"
              class="glass-hover rounded-14px p-10px no-underline"
              style="background: rgba(255,255,255,0.5)"
            >
              <div class="flex items-center gap-6px mb-4px">
                <span class="level-chip" :class="`level-${t.level || t.competitionLevels[0] || 'SCHOOL'}`">
                  {{ t.kind === 'signup' ? '报名' : '赛程' }}
                </span>
                <span class="text-12px color-ink-faint">{{ t.stage }}</span>
              </div>
              <div class="text-14px font-semibold color-ink">{{ t.competitionName }}</div>
            </router-link>
            <el-empty v-if="!dayNodes.length" description="当天没有节点" :image-size="54" />
          </div>
        </template>
        <template v-else>
          <h3 class="text-15px font-bold m-0 mb-10px">点选日期</h3>
          <p class="text-13px color-ink-soft">在左侧日历中点击任意日期，这里会列出当天的所有竞赛节点。</p>
          <div class="mt-14px flex flex-col gap-8px text-12px color-ink-soft">
            <div class="flex items-center gap-8px"><span class="w-14px h-14px rounded-4px" style="background: rgba(15,76,140,0.15); border: 1px solid rgba(15,76,140,0.5)"></span> 报名期条带</div>
            <div class="flex items-center gap-8px"><span class="w-14px h-14px rounded-4px" style="background: rgba(15,76,140,0.35); border: 1px solid #0F4C8C"></span> 赛程期条带</div>
            <div class="flex items-center gap-8px"><span class="w-14px h-14px rounded-full" style="background: #f5b901"></span> 银杏黄 = 省级</div>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style>
/* FullCalendar 玻璃化适配 */
.fc {
  --fc-border-color: rgba(15, 76, 140, 0.1);
  --fc-page-bg-color: transparent;
  --fc-today-bg-color: rgba(245, 185, 1, 0.12);
  font-size: 13px;
}
.fc .fc-toolbar-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
}
.fc .fc-button {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 76, 140, 0.15);
  color: var(--ink-soft);
  border-radius: 10px;
  font-weight: 500;
}
.fc .fc-button:hover {
  background: #fff;
  color: var(--uestc-blue);
}
.fc .fc-button-primary:not(:disabled).fc-button-active,
.fc .fc-button-primary:not(:disabled):active {
  background: var(--uestc-blue);
  border-color: var(--uestc-blue);
  color: #fff;
}
.fc .fc-event {
  border-radius: 6px;
  padding: 1px 4px;
  cursor: pointer;
}
.fc .fc-daygrid-day-number,
.fc .fc-col-header-cell-cushion {
  color: var(--ink-soft);
  text-decoration: none;
}
.fc .fc-list-event-dot {
  border-color: var(--uestc-blue);
}
</style>
