<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import { ElMessage } from 'element-plus';
import { Level, LevelLabel } from '@teamup/shared';
import { api } from '../../api/client';
import { dayjs, type TimelineNode } from '../../api/types';
import { useRouter } from 'vue-router';
import { useSlideThumb } from '../../composables/useSlideThumb';

const router = useRouter();

const allEvents = ref<TimelineNode[]>([]);
const loading = ref(true);
const selectedDate = ref<string | null>(null);
const selectedLevels = ref<string[]>([]);
const calendarRef = ref<InstanceType<typeof FullCalendar>>();

/* ---------------- 统一配色：只按「报名期 / 赛程期」区分颜色 ----------------
   竞赛不再按国际/国家/省级/校级上色（那套色系信息密度低、还容易和筛选器混淆），
   只用两种颜色表达阶段性质：报名期 = 成电蓝，赛程期 = 银杏黄。
   统一用浅色填充（不做深色实心块，保持清爽观感），且所有节点都是同一种带框样式。 */

const KIND_COLOR: Record<'signup' | 'race', { fill: string; border: string; dot: string }> = {
  // 报名期：成电蓝
  signup: { fill: 'rgba(15, 76, 140, 0.15)', border: 'rgba(15, 76, 140, 0.42)', dot: '#0f4c8c' },
  // 赛程期：银杏黄（黄是浅色相，透明度要略高才看得清）
  race: { fill: 'rgba(245, 185, 1, 0.35)', border: '#d99f00', dot: '#d99f00' },
};

const legendKinds = [
  { key: 'race', label: '赛程期', color: KIND_COLOR.race.dot },
  { key: 'signup', label: '报名期', color: KIND_COLOR.signup.dot },
] as const;

/** 级别筛选器的选项（只用于过滤，不再参与配色） */
const LEVEL_ORDER: Level[] = [Level.INTERNATIONAL, Level.NATIONAL, Level.PROVINCIAL, Level.SCHOOL];
const levelOptions = LEVEL_ORDER.map((l) => ({ value: l, label: LevelLabel[l] }));

/* ---------------- 视图模式（月 / 列表） ---------------- */
// 手机端也默认「月」：日历页的第一眼诉求是「这个月有什么」，网格一眼看全；
// 单日节点挤不下时用列表视图，由工具栏切换（切换后跨断点也保留用户的选择）
const viewMode = ref<'dayGridMonth' | 'listMonth'>('dayGridMonth');
const viewSwitchRef = ref<HTMLElement | null>(null);
const { thumbStyle: viewThumbStyle } = useSlideThumb(viewSwitchRef, () => viewMode.value, '.seg-switch-item.active');
const viewTitle = ref('');

/* ---------------- 日历配置 ---------------- */
const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, listPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  // 工具栏完全自绘：默认的 fc-button 与站内玻璃按钮工艺对不齐，是「按键风格不统一」的来源
  headerToolbar: false,
  locale: 'zh-cn',
  height: 'auto',
  // 单日节点默认走 dayGrid 的「dot」样式（透明底 + 无边框 + 小圆点），与跨天节点的
  // 色块样式不一致 —— 用户看到的就是「有的有框、有的没框」。这里在日历级强制 block。
  eventDisplay: 'block',
  // 跨天节点的列表视图时间列会显示 allDay 文案，zh-cn 语言包未覆盖该文案，这里补齐
  allDayText: '全天',
  // 不做 dayMaxEvents 折叠：一天里的每个节点都完整展开成一行（信息优先，不藏进「还有 N 项」），
  // 手机端同样保留这个口径，格子密一点也要能一眼看全，需要逐条看时切「列表」视图。
  // 月视图事件标题只保留「竞赛名 · 阶段」：FullCalendar 默认还会在标题前拼时间（「0时」），
  // 竞赛节点以日期为主，时间放悬停提示里更清爽。列表视图的时间列由 FC 单独渲染，不受影响。
  // 自定义内容必须自带 clipping：否则长标题会溢出自己那条、压在相邻节点文字上。
  // 但列表视图（每条独占一行）里标题必须允许换行：设成 nowrap 会让表格的 min-content
  // 宽度跟着最长标题走（实测 460px），窄屏整页横向溢出。
  eventContent: (arg) => {
    const el = document.createElement('span');
    el.textContent = arg.event.title;
    el.style.display = 'block';
    if (arg.view.type !== 'listMonth') {
      el.style.overflow = 'hidden';
      el.style.textOverflow = 'ellipsis';
      el.style.whiteSpace = 'nowrap';
    }
    return { domNodes: [el] };
  },
  events: filteredEvents.value.flatMap((t) => {
    const s = nodeStartDay(t);
    const e = nodeEndDay(t);
    // 没有任何日期的节点不进日历：FullCalendar 缺 start 会直接丢弃并打警告
    if (!s || !e) return [];
    const signup = t.kind === 'signup';
    const c = KIND_COLOR[signup ? 'signup' : 'race'];
    return [
      {
        id: t.id,
        // 标题不再塞 emoji：报名期 / 赛程期由颜色表达
        title: `${t.competitionName} · ${t.stage}`,
        // 日期视图：整条按「全天」渲染（end 为排他上界，故 +1 天），
        // 避免出现 00:00 / 23:59 这类只是数据边界的无意义时刻
        start: s.format('YYYY-MM-DD'),
        end: e.isAfter(s) ? e.add(1, 'day').format('YYYY-MM-DD') : undefined,
        allDay: true,
        backgroundColor: c.fill,
        borderColor: c.border,
        // 一律用深墨色文字：填充足够浅，深色文字才清晰（避免深色底 + 白字的厚重观感）
        textColor: '#16283a',
        classNames: ['cal-ev', signup ? 'cal-signup' : 'cal-race'],
        extendedProps: t,
      },
    ];
  }),
  datesSet: (arg: DatesSetArg) => {
    viewTitle.value = arg.view.title;
  },
  eventDidMount: (info) => {
    const t = info.event.extendedProps as TimelineNode;
    const range = dateRangeText(t);
    const lock = t.isLocked ? '\n（时间已人工锁定）' : '';
    info.el.setAttribute('title', `${t.kind === 'signup' ? '报名期' : '赛程期'} · ${t.competitionName} · ${t.stage}\n${range}${lock}`);
  },
  dateClick: (info) => {
    selectedDate.value = info.dateStr;
  },
  eventClick: (info: EventClickArg) => {
    router.push(`/competitions/${(info.event.extendedProps as TimelineNode).competitionId}`);
  },
}));

const filteredEvents = computed(() =>
  allEvents.value.filter(
    (t) => !selectedLevels.value.length || t.competitionLevels.some((l) => selectedLevels.value.includes(l)),
  ),
);

/* ---------------- 节点日期口径 ----------------
   数据按「本地日边界」入库（startAt = 当日 00:00、endAt = 当日 23:59:59，+08:00），
   日历是日期视图，所以一律只算到「日」，不展示 00:00 / 23:59 这种纯数据边界时刻。 */
function nodeStartDay(t: TimelineNode) {
  const s = t.startAt ?? t.endAt;
  return s ? dayjs(s).startOf('day') : null;
}
function nodeEndDay(t: TimelineNode) {
  const e = t.endAt ?? t.startAt;
  return e ? dayjs(e).startOf('day') : null;
}

/**
 * 该节点是否覆盖某一天。
 * 按日历日比较而不是展开日期数组：报名期动辄横跨数月（如 3-20 ~ 11-30），
 * 旧实现把跨度截断在 60 天，导致点击中段日期时这类长节点在侧栏「消失」。
 */
function nodeCoversDay(t: TimelineNode, day: string): boolean {
  const s = nodeStartDay(t);
  const e = nodeEndDay(t);
  if (!s || !e) return false;
  const d = dayjs(day).startOf('day');
  return !d.isBefore(s) && !d.isAfter(e);
}

function dateRangeText(t: TimelineNode): string {
  const s = nodeStartDay(t);
  const e = nodeEndDay(t);
  if (s && e && e.isAfter(s)) return `${s.format('YYYY-MM-DD')} → ${e.format('YYYY-MM-DD')}`;
  return (s ?? e)?.format('YYYY-MM-DD') ?? '时间待定';
}

const dayNodes = computed(() => {
  const day = selectedDate.value;
  if (!day) return [];
  return filteredEvents.value
    .filter((t) => nodeCoversDay(t, day))
    .sort((a, b) => {
      const sa = nodeStartDay(a)?.valueOf() ?? 0;
      const sb = nodeStartDay(b)?.valueOf() ?? 0;
      // 先按开始日先后，同日再把报名期排在赛程期前（先要报名、后有比赛）
      return sa - sb || (a.kind === b.kind ? 0 : a.kind === 'signup' ? -1 : 1);
    });
});

/* ---------------- 工具栏动作 ---------------- */
function prevMonth() {
  calendarRef.value?.getApi().prev();
}
function nextMonth() {
  calendarRef.value?.getApi().next();
}
function goToday() {
  calendarRef.value?.getApi().today();
}
function setView(v: 'dayGridMonth' | 'listMonth') {
  viewMode.value = v;
  calendarRef.value?.getApi().changeView(v);
}

/* ---------------- 届次年份 ---------------- */
const currentYear = new Date().getFullYear();
const selectedYear = ref<number>(currentYear);
const yearOptions = ref<number[]>([]);

/** 竞态防护：快速切换届次时会有多个请求在飞，先发的后到会覆盖新数据（届次与内容不一致） */
let loadSeq = 0;

async function loadEvents() {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const rows = await api.get<TimelineNode[]>(`/calendar?year=${selectedYear.value}`);
    if (seq !== loadSeq) return; // 已有更新的请求，丢弃本次响应
    allEvents.value = rows;
  } catch (e) {
    if (seq !== loadSeq) return;
    // H10：日历接口失败要给出提示，不能只留空白页
    ElMessage.error(e instanceof Error ? e.message : '日历数据加载失败，请稍后重试');
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function loadYearOptions() {
  try {
    const years = await api.get<number[]>('/competitions/years');
    yearOptions.value = [...new Set([currentYear, ...years])].sort((a, b) => b - a);
  } catch {
    yearOptions.value = [currentYear];
  }
}

onMounted(async () => {
  await Promise.all([loadEvents(), loadYearOptions()]);
});

/** 切换届次：重新拉取事件并把日历视图跳到该年 1 月 */
function changeYear(y: number) {
  selectedYear.value = y;
  selectedDate.value = null;
  loadEvents();
  calendarRef.value?.getApi().gotoDate(`${y}-01-01`);
}

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
          黄色为赛程期、蓝色为报名期；订阅到手机日历可在 DDL 前自动提醒
        </p>
      </div>
      <div class="flex items-center gap-8px flex-wrap">
        <div ref="viewSwitchRef" class="seg-switch" role="tablist" aria-label="日历视图切换">
          <span class="seg-switch-thumb" aria-hidden="true" :style="viewThumbStyle"></span>
          <button class="seg-switch-item" :class="{ active: viewMode === 'dayGridMonth' }" @click="setView('dayGridMonth')">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 9.5h17M8 3v3M16 3v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            月
          </button>
          <button class="seg-switch-item" :class="{ active: viewMode === 'listMonth' }" @click="setView('listMonth')">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            列表
          </button>
        </div>
        <el-button round class="seg-plate" @click="goIcs">订阅 .ics 到手机日历</el-button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-16px items-start">
      <div class="glass p-18px" v-loading="loading">
        <!-- 自绘工具栏：导航（玻璃按钮）+ 届次 / 级别筛选，与站内按钮同一套工艺 -->
        <div class="cal-toolbar">
          <div class="cal-nav">
            <button class="cal-icon-btn" title="上一页" aria-label="上一页" @click="prevMonth">
              <svg viewBox="0 0 24 24" fill="none"><path d="M14.5 6 9 12l5.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="cal-icon-btn" title="下一页" aria-label="下一页" @click="nextMonth">
              <svg viewBox="0 0 24 24" fill="none"><path d="M9.5 6 15 12l-5.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="cal-text-btn" @click="goToday">今天</button>
            <h2 class="cal-title">{{ viewTitle }}</h2>
          </div>
          <div class="cal-filters">
            <el-select :model-value="selectedYear" style="width: 152px" @change="changeYear">
              <el-option v-for="y in yearOptions" :key="y" :value="y" :label="`${y} 届${y === currentYear ? '（今年）' : ''}`" />
            </el-select>
            <el-checkbox-group v-model="selectedLevels" size="small" aria-label="按级别筛选">
              <el-checkbox-button v-for="l in levelOptions" :key="l.value" :value="l.value">{{ l.label }}</el-checkbox-button>
            </el-checkbox-group>
          </div>
        </div>

        <!-- 图例：只有两种颜色，报名期 / 赛程期 -->
        <div class="cal-legend">
          <span class="cl-item"><i class="cl-bar is-race"></i>赛程期</span>
          <span class="cl-item"><i class="cl-bar is-signup"></i>报名期</span>
          <span class="cl-hint">点击日期查看当天节点</span>
        </div>

        <FullCalendar ref="calendarRef" :options="calendarOptions" />
      </div>

      <!-- 当天节点侧栏 -->
      <aside class="glass p-18px lg:sticky lg:top-90px min-h-200px">
        <template v-if="selectedDate">
          <h3 class="text-15px font-bold m-0 mb-10px">{{ selectedDate }} 的节点</h3>
          <div class="flex flex-col gap-8px">
            <router-link
              v-for="t in dayNodes"
              :key="t.id"
              :to="`/competitions/${t.competitionId}`"
              class="day-node glass-hover no-underline"
            >
              <i class="dn-dot" :style="{ background: KIND_COLOR[t.kind === 'signup' ? 'signup' : 'race'].dot }" />
              <div class="min-w-0 flex-1">
                <div class="dn-title">{{ t.competitionName }}</div>
                <div class="dn-meta">
                  <span class="dn-kind" :class="t.kind === 'signup' ? 'is-signup' : 'is-race'">
                    {{ t.kind === 'signup' ? '报名期' : '赛程期' }}
                  </span>
                  <span class="dn-stage">{{ t.stage }}</span>
                </div>
                <div class="dn-date">{{ dateRangeText(t) }}</div>
              </div>
            </router-link>
            <el-empty v-if="!dayNodes.length" description="当天没有节点" :image-size="54" />
          </div>
        </template>
        <template v-else>
          <h3 class="text-15px font-bold m-0 mb-10px">点选日期</h3>
          <p class="text-13px color-ink-soft m-0">在左侧日历中点击任意日期，这里会列出当天的所有竞赛节点。</p>
          <div class="cl-legend-vertical">
            <div v-for="l in legendKinds" :key="l.key" class="cl-item">
              <i class="cl-dot" :style="{ background: l.color }"></i>{{ l.label }}
            </div>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style>
/* ---------- FullCalendar 玻璃化适配 ---------- */
.fc {
  --fc-border-color: rgba(15, 76, 140, 0.1);
  --fc-page-bg-color: transparent;
  --fc-today-bg-color: rgba(245, 185, 1, 0.12);
  --fc-event-text-color: var(--ink);
  font-size: 13px;
}
.fc .fc-daygrid-day-number,
.fc .fc-col-header-cell-cushion,
.fc .fc-list-day-text,
.fc .fc-list-day-side-text {
  color: var(--ink-soft);
  text-decoration: none;
}
.fc .fc-col-header-cell-cushion {
  font-weight: 600;
}
/* 事件条：统一 block 样式（见 events 里的 eventDisplay），只靠颜色区分报名 / 赛程，
   不再用虚线——虚线在 1px 下偏深、容易被误读成「黑框」，反而制造困惑 */
.fc .fc-event {
  border-radius: 6px;
  padding: 1px 5px;
  cursor: pointer;
  font-weight: 500;
}
/* 标题必须被约束在事件条宽度内：一天节点全展开后横排很密，不 clipping 就会互相压字 */
.fc .fc-event-main,
.fc .fc-event-main-frame,
.fc .fc-event-title-container,
.fc .fc-event-title {
  overflow: hidden;
  min-width: 0;
}
.fc .fc-event-title {
  text-overflow: ellipsis;
}
/* 单日节点（原 dot 样式）也被强制成 block，补回内边距让文字不贴边 */
.fc .fc-daygrid-event-harness .fc-event {
  min-height: 17px;
}
/* 兜底：万一 FC 仍把单日节点渲染成 dot 样式，用同一套配色把它补成色块外观，
   保证「有框 / 没框」不再混搭。颜色与 script 里的 KIND_COLOR 对应。 */
.fc .fc-daygrid-dot-event.cal-race {
  background: rgba(245, 185, 1, 0.35);
  border: 1px solid #d99f00;
}
.fc .fc-daygrid-dot-event.cal-signup {
  background: rgba(15, 76, 140, 0.15);
  border: 1px solid rgba(15, 76, 140, 0.42);
}
.fc .fc-daygrid-dot-event {
  padding: 1px 5px;
  border-radius: 6px;
  min-height: 17px;
}
.fc .fc-list-event:hover td {
  background: rgba(15, 76, 140, 0.05);
}
.fc .fc-list-day-cushion {
  background: rgba(15, 76, 140, 0.05);
}

/* ---------- 移动端：控件缩一号 ---------- */
@media (max-width: 768px) {
  .fc {
    font-size: 12px;
  }
  .fc .fc-list-day-cushion {
    font-size: 13px;
  }
  /* 月视图每格只有 ~45px 宽：压缩留白，让标题多留几个字的位置 */
  .fc .fc-daygrid-day-frame {
    min-height: 0;
  }
  .fc .fc-daygrid-day-top {
    padding: 0 1px;
  }
  .fc .fc-daygrid-day-number {
    font-size: 11px;
    padding: 1px 3px;
  }
  .fc .fc-daygrid-day-events {
    margin: 1px 1px 0;
  }
  .fc .fc-daygrid-event {
    padding: 0 3px;
    font-size: 11px;
    min-height: 15px;
  }
}
</style>

<style scoped>
/* ---------- 自绘工具栏（沿用站内玻璃按钮工艺） ---------- */
.cal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.cal-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cal-icon-btn,
.cal-text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(232, 232, 232, 0.9);
  background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(239, 247, 255, 0.72));
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow:
    0 4px 14px rgba(15, 76, 140, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 1);
  transition: all 0.15s ease-out;
}
.cal-icon-btn {
  width: 34px;
  padding: 0;
}
.cal-icon-btn svg {
  width: 18px;
  height: 18px;
}
.cal-text-btn {
  padding: 0 14px;
}
.cal-icon-btn:hover,
.cal-text-btn:hover {
  background-image: linear-gradient(135deg, #fff, #f2f8ff);
  border-color: rgba(15, 76, 140, 0.35);
  color: var(--uestc-blue);
}
.cal-icon-btn:active,
.cal-text-btn:active {
  transform: translateY(1px);
}
.cal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 0 8px;
}
.cal-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ---------- 图例 ---------- */
.cal-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 7px 10px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: rgba(15, 76, 140, 0.035);
}
.cl-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-soft);
}
.cl-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex: none;
}
.cl-bar {
  width: 18px;
  height: 11px;
  border-radius: 4px;
  flex: none;
}
.cl-bar.is-race {
  background: rgba(245, 185, 1, 0.35);
  border: 1px solid #d99f00;
}
.cl-bar.is-signup {
  background: rgba(15, 76, 140, 0.15);
  border: 1px solid rgba(15, 76, 140, 0.42);
}
.cl-hint {
  font-size: 12px;
  color: var(--ink-faint);
  margin-left: auto;
}
.cl-legend-vertical {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

/* ---------- 侧栏当天节点 ---------- */
.day-node {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 9px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(15, 76, 140, 0.08);
  transition: all 0.18s ease;
}
.dn-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  margin-top: 5px;
  flex: none;
}
.dn-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dn-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-faint);
}
.dn-kind {
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
  flex: none;
}
.dn-kind.is-race {
  background: rgba(245, 185, 1, 0.2);
  color: #8a5800;
}
.dn-kind.is-signup {
  background: rgba(15, 76, 140, 0.1);
  color: var(--uestc-blue);
}
.dn-stage {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dn-date {
  font-size: 11.5px;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

@media (max-width: 768px) {
  .cl-hint {
    display: none;
  }
  .cal-title {
    font-size: 15px;
  }
}
</style>
