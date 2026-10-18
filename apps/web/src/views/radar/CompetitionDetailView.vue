<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { AudienceLabel, CompetitionFormatLabel, Audience, CompetitionFormat } from '@teamup/shared';
import { api } from '../../api/client';
import { fmtDate, daysLeft, dayjs, type CompetitionDetail, type TeamSummary, type CompetitionStageView, type BonusStandardView } from '../../api/types';
import { safeHref, hrefHost } from '../../utils/safeHref';
import LevelChips from '../../components/LevelChips.vue';
import TeamCardMeta from '../../components/TeamCardMeta.vue';
import CommentList from '../../components/CommentList.vue';
import FrostedGate from '../../components/FrostedGate.vue';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const comp = ref<CompetitionDetail | null>(null);
const favorite = ref(false);
const loading = ref(true);
/** 当前选中的赛道（多赛道赛事） */
const activeTrackId = ref<string | null>(null);

// 纠错弹窗
const correctionVisible = ref(false);
const correctionField = ref('');
const correctionProposed = ref('');
const correctionNote = ref('');
const correctionSubmitting = ref(false);
const correctionFieldLabel = ref('');
const correctionCurrentValue = ref('');

const recruitingTeams = ref<TeamSummary[]>([]);
const recruitingTeamsCount = ref(0);

// 竞赛信息反馈
const feedbackVisible = ref(false);
const feedbackContent = ref('');
const feedbackContact = ref('');
const feedbackSubmitting = ref(false);

const editions = computed(() => comp.value?.editions ?? []);
const hasTracks = computed(() => (comp.value?.tracks?.length ?? 0) > 0);

/** 加分表行：同认定文件 + 类别下的国家级 / 省级两档（旧响应无 bonusStandards 时回落单条） */
const bonusRows = computed<BonusStandardView[]>(() => {
  const c = comp.value;
  if (!c) return [];
  if (c.bonusStandards?.length) return c.bonusStandards;
  return c.bonusStandard ? [c.bonusStandard] : [];
});
const BONUS_TIER_LABEL: Record<string, string> = { NATIONAL: '国家级', PROVINCIAL: '省级', NONE: '不认定' };

/** 当前展示的阶段链：有赛道看选中赛道，否则看共享阶段 */
const activeStages = computed<CompetitionStageView[]>(() => {
  if (!comp.value) return [];
  if (!hasTracks.value) return comp.value.sharedStages ?? [];
  const track = comp.value.tracks.find((t) => t.id === activeTrackId.value) ?? comp.value.tracks[0];
  return track?.stages ?? [];
});

const activeTrack = computed(() => {
  if (!comp.value || !hasTracks.value) return null;
  return comp.value.tracks.find((t) => t.id === activeTrackId.value) ?? comp.value.tracks[0] ?? null;
});

const nextDeadline = computed(() => comp.value?.nextDeadline ?? null);

const deadlineChipText = computed(() => {
  const d = daysLeft(nextDeadline.value);
  if (d == null) return '';
  if (d > 0) return `剩 ${d} 天`;
  if (d === 0) return '今日截止';
  return '已截止';
});

const statusMeta = computed(() => {
  switch (comp.value?.status) {
    case 'OPEN':
      return { text: '报名中', cls: 'st-open' };
    case 'UPCOMING':
      return { text: '即将开始', cls: 'st-upcoming' };
    case 'ENDED':
      return { text: '已结束', cls: 'st-ended' };
    default:
      return { text: '待定', cls: 'st-unknown' };
  }
});

/** 赛制：赛道级优先，回落赛事级 */
const effectiveFormat = computed(() => {
  const f = activeTrack.value?.format ?? comp.value?.format ?? null;
  const min = activeTrack.value?.teamSizeMin ?? comp.value?.teamSizeMin ?? null;
  const max = activeTrack.value?.teamSizeMax ?? comp.value?.teamSizeMax ?? null;
  return { format: f, min, max };
});

/** 赛道总览：每个赛道显示其最早与最晚节点 */
function trackSummary(trackId: string) {
  const t = comp.value?.tracks.find((x) => x.id === trackId);
  if (!t) return null;
  const dates = t.stages.flatMap((s) => s.events.flatMap((e) => [e.startAt, e.endAt])).filter(Boolean) as string[];
  dates.sort();
  return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, stageCount: t.stages.length };
}

const STAGE_KIND_LABEL: Record<string, string> = {
  CAMPUS: '校级',
  QUALIFIER: '预选',
  REGIONAL: '区域',
  PROVINCIAL: '省级',
  NATIONAL: '国家级',
  INTERNATIONAL: '国际',
  FINAL: '总决赛',
  OTHER: '赛程',
};

const NODE_META: Record<string, { label: string; icon: string }> = {
  SIGNUP_START: { label: '报名开始', icon: '🚩' },
  SIGNUP_END: { label: '报名截止', icon: '⏰' },
  SUBMISSION: { label: '作品提交', icon: '📤' },
  CONTEST: { label: '比赛', icon: '🏁' },
  RESULT: { label: '结果公布', icon: '📢' },
  AWARD: { label: '颁奖', icon: '🏅' },
  OTHER: { label: '节点', icon: '•' },
};

function nodeLabel(e: { nodeType: string; label: string | null }) {
  return e.label || NODE_META[e.nodeType]?.label || '节点';
}
function nodeIcon(e: { nodeType: string }) {
  return NODE_META[e.nodeType]?.icon ?? '•';
}

/**
 * 时间节点区间文案：只显示到「日」。
 * 时间节点按「本地日边界」入库（startAt = 当日 00:00、endAt = 当日 23:59:59），
 * 时刻只是数据边界、没有信息量，真正的时刻写在节点 label 里。
 */
function eventRangeText(e: { startAt: string | null; endAt: string | null }): string {
  const s = e.startAt ? dayjs(e.startAt) : null;
  const en = e.endAt ? dayjs(e.endAt) : null;
  if (s && en && !en.isSame(s, 'day')) return `${s.format('YYYY-MM-DD')} → ${en.format('YYYY-MM-DD')}`;
  return (s ?? en)?.format('YYYY-MM-DD') ?? '时间待定';
}
/** 时间点是否已过期 */
function isPast(s: string | null) {
  return !!s && new Date(s).getTime() < Date.now();
}
/** 阶段是否含未来节点 */
function stageHasFuture(stage: CompetitionStageView) {
  return stage.events.some((e) => (e.endAt && !isPast(e.endAt)) || (e.startAt && !isPast(e.startAt)));
}
/** 当前进行中的阶段序号（第一个含未来节点的阶段） */
const currentStageId = computed(() => activeStages.value.find((s) => stageHasFuture(s))?.id ?? null);

async function load() {
  loading.value = true;
  try {
    const raw = await api.get<CompetitionDetail & { recruitingTeams: TeamSummary[]; recruitingTeamsCount?: number }>(
      `/competitions/${route.params.id}`,
    );
    comp.value = raw;
    activeTrackId.value = raw.tracks?.[0]?.id ?? null;
    recruitingTeams.value = raw.recruitingTeams ?? [];
    recruitingTeamsCount.value = raw.recruitingTeamsCount ?? recruitingTeams.value.length;
    if (auth.isLoggedIn) {
      try {
        const favs = await api.get<{ targetType: string; targetId: string }[]>('/favorites?targetType=COMPETITION');
        favorite.value = favs.some((f) => f.targetId === raw.id);
      } catch {
        /* ignore */
      }
    }
  } catch {
    ElMessage.error('竞赛不存在或已下线');
    router.push({ name: 'competitions' });
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function toggleFavorite() {
  if (!auth.isLoggedIn) {
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  try {
    const res = await api.post<{ favorited: boolean }>('/favorites', {
      targetType: 'COMPETITION',
      targetId: comp.value!.id,
    });
    favorite.value = res.favorited;
    ElMessage.success(res.favorited ? '已关注，DDL 前 7/3/1 天会提醒你' : '已取消关注');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败，请稍后重试');
  }
}

function openCorrection(field: string, label: string, current?: string | null) {
  if (!auth.isLoggedIn) {
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  correctionField.value = field;
  correctionFieldLabel.value = label;
  correctionProposed.value = '';
  correctionNote.value = '';
  correctionCurrentValue.value = current ?? '';
  correctionVisible.value = true;
}

async function submitCorrection() {
  correctionSubmitting.value = true;
  try {
    await api.post(`/competitions/${comp.value!.id}/corrections`, {
      field: correctionField.value,
      proposedValue: correctionProposed.value,
      note: correctionNote.value,
    });
    correctionVisible.value = false;
    ElMessage.success('纠错已提交，管理员会尽快核对，感谢贡献！');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    correctionSubmitting.value = false;
  }
}

function openFeedback() {
  feedbackContent.value = '';
  feedbackContact.value = '';
  feedbackVisible.value = true;
}

async function submitFeedback() {
  if (!feedbackContent.value.trim()) {
    ElMessage.warning('请填写反馈内容');
    return;
  }
  feedbackSubmitting.value = true;
  try {
    await api.post('/feedback', {
      type: 'COMPETITION_INFO',
      competitionId: comp.value!.id,
      pagePath: route.fullPath,
      content: feedbackContent.value,
      contact: feedbackContact.value || undefined,
    });
    feedbackVisible.value = false;
    ElMessage.success('反馈已提交，运营同学会尽快核实，感谢贡献！');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    feedbackSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-wrap">
    <div v-if="loading" class="max-w-980px mx-auto flex flex-col gap-14px">
      <div class="skeleton h-140px"></div>
      <div class="skeleton h-220px"></div>
    </div>

    <div v-else-if="comp" class="max-w-980px mx-auto flex flex-col gap-16px">
      <!-- ================= 头部 ================= -->
      <section class="glass p-24px animate-appear relative overflow-hidden">
        <div class="hero-glow" />
        <div class="detail-head-row flex items-start justify-between gap-12px flex-wrap relative">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-8px flex-wrap mb-10px">
              <span class="chip status-chip" :class="statusMeta.cls">
                <span class="status-dot" />{{ statusMeta.text }}
              </span>
              <span
                v-if="comp.bonusCategory"
                class="chip cat-chip"
                :class="comp.bonusCategory === '文体竞赛' ? 'cat-art' : 'cat-academic'"
                :title="`竞赛类别：${comp.bonusCategory}（校教〔2026〕39号口径）`"
              >{{ comp.bonusCategory }}</span>
              <LevelChips :levels="comp.levels" />
              <span v-if="hasTracks" class="chip" style="background: rgba(15,76,140,0.07); color: var(--uestc-blue)">
                {{ comp.tracks.length }} 个赛道
              </span>
            </div>
            <h1 class="text-24px md:text-30px font-extrabold m-0 color-ink leading-tight">
              {{ comp.name }}
              <span class="text-14px font-bold align-middle ml-6px chip" style="background: rgba(15,76,140,0.08); color: var(--uestc-blue)">{{ comp.year }} 届</span>
            </h1>
            <div class="flex items-center gap-10px flex-wrap mt-8px">
              <span v-if="comp.code" class="text-12px color-ink-faint font-mono">#{{ comp.code }}</span>
              <div v-if="comp.aliases?.length" class="text-13px color-ink-faint">别名：{{ comp.aliases.join(' · ') }}</div>
              <el-select
                v-if="editions.length"
                size="small"
                :model-value="comp.id"
                style="width: 130px"
                @change="(id: string) => router.push(`/competitions/${id}`)"
              >
                <el-option :value="comp.id" :label="`${comp.year} 届（当前）`" />
                <el-option v-for="e in editions" :key="e.id" :value="e.id" :label="`${e.year} 届`" />
              </el-select>
            </div>
            <div v-if="comp.tags?.length" class="flex gap-6px flex-wrap mt-10px">
              <el-tag v-for="t in comp.tags" :key="t" size="small" effect="plain" round>{{ t }}</el-tag>
            </div>
          </div>
          <div class="detail-head-actions flex gap-8px shrink-0">
            <el-button round @click="toggleFavorite">{{ favorite ? '★ 已关注' : '☆ 关注' }}</el-button>
            <el-button round tag="a" href="/api/calendar.ics" target="_blank">📅 订阅 .ics</el-button>
          </div>
        </div>
        <div class="text-12px color-ink-faint mt-14px relative">
          最后更新 {{ fmtDate(comp.updatedAt, true) }}
          <template v-if="comp.sourceUrl && hrefHost(comp.sourceUrl)">
            · 信息来源：<a :href="safeHref(comp.sourceUrl)" target="_blank" rel="noopener noreferrer" class="color-uestc-500">{{ hrefHost(comp.sourceUrl) }} ↗</a>
          </template>
          · <el-button link size="small" class="!text-12px" @click="openFeedback">反馈信息问题</el-button>
        </div>
      </section>

      <!-- ================= 报名倒计时（特色） ================= -->
      <section v-if="nextDeadline" class="countdown-bar" :class="{ 'cd-past': (daysLeft(nextDeadline) ?? 0) < 0 }">
        <div class="cd-left">
          <div class="cd-icon">⏳</div>
          <div>
            <div class="cd-label">报名截止</div>
            <div class="cd-date">{{ fmtDate(nextDeadline) }}</div>
          </div>
        </div>
        <div class="cd-right">
          <span class="cd-num">{{ Math.abs(daysLeft(nextDeadline) ?? 0) }}</span>
          <span class="cd-unit">{{ (daysLeft(nextDeadline) ?? 0) < 0 ? '天前已截止' : (daysLeft(nextDeadline) ?? 0) === 0 ? '今日截止' : '天后截止' }}</span>
        </div>
      </section>

      <!-- ================= 关键信息 + 推免加分 ================= -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <section class="glass p-20px">
          <h2 class="section-title">关键信息</h2>
          <div class="grid grid-cols-2 gap-y-12px gap-x-8px text-13px">
            <span class="info-label">主办方</span><span class="color-ink">{{ comp.organizer || '—' }}</span>
            <span class="info-label">官网</span>
            <span class="color-ink">
              <a v-if="comp.officialUrl && safeHref(comp.officialUrl) !== '#'" :href="safeHref(comp.officialUrl)" target="_blank" rel="noopener noreferrer" class="color-uestc-500">访问官网 ↗</a>
              <template v-else>—</template>
            </span>
            <span class="info-label">赛制</span>
            <span class="color-ink">
              <template v-if="effectiveFormat.format">
                {{ CompetitionFormatLabel[effectiveFormat.format as CompetitionFormat] }}
                <template v-if="effectiveFormat.format === 'TEAM' && (effectiveFormat.min || effectiveFormat.max)">
                  （{{ effectiveFormat.min ?? '?' }}–{{ effectiveFormat.max ?? '?' }} 人）
                </template>
                <span v-if="activeTrack" class="text-11px color-ink-faint">· {{ activeTrack.name }}</span>
              </template>
              <template v-else>—</template>
            </span>
            <span class="info-label">面向年级</span><span class="color-ink">{{ comp.audience ? AudienceLabel[comp.audience as Audience] : '—' }}</span>
            <span class="info-label">难度 / 投入</span>
            <span class="color-ink">
              {{ comp.difficulty ? '★'.repeat(comp.difficulty) : '—' }} /
              {{ comp.effort ? '●'.repeat(comp.effort) : '—' }}
            </span>
            <span class="info-label">赛程链</span><span class="color-ink">{{ comp.stageChain || '—' }}</span>
          </div>
        </section>

        <section class="glass p-20px bonus-card relative overflow-hidden">
          <h2 class="section-title">
            🎓 推免加分
            <el-tooltip content="级别与加分是两套口径：级别回答比赛多大，加分回答对保研有没有用。数据来源：校教〔2026〕39 号文">
              <el-icon class="color-ink-faint cursor-help"><i-ep-question-filled /></el-icon>
            </el-tooltip>
          </h2>
          <template v-if="comp.isBonusEligible != null">
            <div class="flex items-center gap-8px mb-10px text-13px">
              <el-tag v-if="comp.isBonusEligible" type="success" size="small" round>计入推免加分</el-tag>
              <el-tag v-else type="info" size="small" round>不计入</el-tag>
              <span v-if="comp.bonusCategory" class="color-ink-soft">{{ comp.bonusCategory }}</span>
            </div>
            <div v-if="bonusRows.length" class="bonus-table">
              <div class="bt-head"><span>奖项档次</span><span>最高奖</span><span>次高奖</span><span>次次高奖</span></div>
              <div v-for="s in bonusRows" :key="s.id" class="bt-row">
                <span>{{ BONUS_TIER_LABEL[s.level] ?? s.level }}</span>
                <span>{{ s.topPoints }}</span>
                <span>{{ s.secondPoints }}</span>
                <span>{{ s.thirdPoints }}</span>
              </div>
            </div>
            <div v-if="comp.bonusSpecialRule" class="text-12px color-ink-soft mt-10px whitespace-pre-wrap">{{ comp.bonusSpecialRule }}</div>
            <div class="text-11px color-ink-faint mt-10px">
              分值以当年最新通知为准
              <el-button link size="small" type="primary" class="ml-4px !text-11px" @click="openCorrection('bonusSpecialRule', '加分特殊规则', comp.bonusSpecialRule)">纠错</el-button>
            </div>
          </template>
          <div v-else class="text-13px color-ink-soft py-8px">暂无认定信息 —— 官网通知不会写"这是国家级"，此类字段靠人工维护</div>
        </section>
      </div>

      <!-- ================= 赛程路线图（核心特色） ================= -->
      <section class="glass p-20px">
        <div class="flex items-center justify-between mb-14px flex-wrap gap-8px">
          <h2 class="section-title m-0">🗺️ 赛程路线图</h2>
          <span class="text-12px color-ink-faint">共 {{ activeStages.length }} 个阶段{{ hasTracks ? ` · 当前：${activeTrack?.name}` : '' }}</span>
        </div>

        <!-- 赛道切换 -->
        <div v-if="hasTracks" class="track-tabs mb-16px">
          <button
            v-for="t in comp.tracks"
            :key="t.id"
            class="track-tab"
            :class="{ 'track-tab-active': t.id === activeTrackId }"
            @click="activeTrackId = t.id"
          >
            {{ t.name }}
            <span class="track-tab-count">{{ t.stages.length }}</span>
          </button>
        </div>

        <el-empty v-if="!activeStages.length" description="暂无赛程节点" :image-size="56" />

        <div v-else class="stage-rail">
          <div
            v-for="(s, i) in activeStages"
            :key="s.id"
            class="stage-card"
            :class="{ 'stage-current': s.id === currentStageId, 'stage-past': !stageHasFuture(s) }"
          >
            <div class="stage-top">
              <span class="stage-index">{{ i + 1 }}</span>
              <span class="stage-kind" :class="`kind-${s.stageKind}`">{{ STAGE_KIND_LABEL[s.stageKind] || '赛程' }}</span>
              <span v-if="s.bonusTier === 'NATIONAL'" class="stage-tier tier-nat">国</span>
              <span v-else-if="s.bonusTier === 'PROVINCIAL'" class="stage-tier tier-prov">省</span>
            </div>
            <div class="stage-name">{{ s.name }}</div>
            <div v-if="s.scope" class="text-11px color-ink-faint mb-4px">{{ s.scope }}</div>

            <ul v-if="s.events.length" class="event-list">
              <li v-for="e in s.events" :key="e.id" class="event-item" :class="{ 'event-past': isPast(e.endAt ?? e.startAt) }">
                <span class="event-icon">{{ nodeIcon(e) }}</span>
                <div class="flex-1 min-w-0">
                  <div class="event-label">
                    {{ nodeLabel(e) }}
                    <el-icon v-if="e.isLocked" class="text-11px color-ink-faint"><i-ep-lock /></el-icon>
                  </div>
                  <div class="event-date">{{ eventRangeText(e) }}</div>
                  <div v-if="e.location" class="text-11px color-ink-faint">{{ e.location }}</div>
                </div>
                <el-button link size="small" type="primary" class="!text-11px" @click="openCorrection(`event:${e.id}:${e.endAt ? 'endAt' : 'startAt'}`, `${s.name} · ${nodeLabel(e)}`, e.endAt ?? e.startAt)">纠错</el-button>
              </li>
            </ul>
            <div v-else class="text-12px color-ink-faint py-6px">暂无具体时间</div>
            <div v-if="s.note" class="text-11px color-ink-faint mt-6px">{{ s.note }}</div>
          </div>
        </div>
      </section>

      <!-- ================= 赛道总览（多赛道） ================= -->
      <section v-if="comp.tracks.length > 1" class="glass p-20px">
        <h2 class="section-title">🧭 赛道总览</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12px">
          <button
            v-for="t in comp.tracks"
            :key="t.id"
            class="track-card"
            :class="{ 'track-card-active': t.id === activeTrackId }"
            @click="activeTrackId = t.id"
          >
            <div class="text-14px font-semibold color-ink">{{ t.name }}</div>
            <div class="text-12px color-ink-faint mt-4px">
              {{ t.stages.length }} 个阶段
              <template v-if="t.format"> · {{ CompetitionFormatLabel[t.format as CompetitionFormat] }}</template>
            </div>
            <div v-if="trackSummary(t.id)?.first" class="text-11px color-ink-faint mt-6px">
              {{ fmtDate(trackSummary(t.id)!.first) }} ~ {{ fmtDate(trackSummary(t.id)!.last) }}
            </div>
            <div v-if="t.description" class="text-12px color-ink-soft mt-6px line-clamp-2">{{ t.description }}</div>
          </button>
        </div>
      </section>

      <!-- ================= 竞赛简介 ================= -->
      <section v-if="comp.intro" class="glass p-20px">
        <h2 class="section-title">竞赛简介</h2>
        <p class="text-14px leading-relaxed color-ink-soft m-0 whitespace-pre-wrap">{{ comp.intro }}</p>
      </section>

      <!-- ================= 补充信息 ================= -->
      <section v-if="comp.customFields?.length" class="glass p-20px">
        <h2 class="section-title">📌 补充信息</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-24px gap-y-8px text-13px">
          <div v-for="f in comp.customFields" :key="f.id" class="flex gap-8px items-baseline py-4px border-b border-rgba(15,76,140,0.06)">
            <span class="info-label shrink-0">{{ f.key }}</span>
            <span class="color-ink whitespace-pre-wrap break-all">{{ f.value }}</span>
          </div>
        </div>
      </section>

      <!-- ================= 组队招募帖 ================= -->
      <section class="glass p-20px">
        <h2 class="section-title">👥 组队招募帖</h2>
        <template v-if="auth.isLoggedIn">
          <div v-if="recruitingTeams.length" class="grid grid-cols-1 md:grid-cols-2 gap-12px">
            <router-link v-for="t in recruitingTeams" :key="t.id" :to="`/teams/${t.id}`" class="glass glass-hover p-14px no-underline">
              <TeamCardMeta
                :leader="t.leader"
                :goal="t.goal"
                :status="t.status"
                :deadline="t.deadline"
                :needed-roles="t.neededRoles"
                :member-count="t.memberCount"
                :target-size="t.targetSize"
                :intent-count="t.intentCount"
                :team-id="t.id"
              />
            </router-link>
          </div>
          <el-empty v-else description="该竞赛下暂时没有组队帖，成为第一个发起者吧" :image-size="56" />
        </template>
        <FrostedGate
          v-else
          :title="recruitingTeamsCount > 0 ? `当前有 ${recruitingTeamsCount} 条组队帖` : '本竞赛暂无人组队'"
          description="组队招募信息仅对已通过校园邮箱认证并登录的同学开放，登录后查看队伍与缺口角色"
          style="min-height: 180px"
        >
          <div class="grid grid-cols-2 gap-12px p-6px">
            <div class="skeleton h-70px"></div>
            <div class="skeleton h-70px"></div>
          </div>
        </FrostedGate>
      </section>

      <!-- ================= 往届材料 + 获奖 ================= -->
      <div v-if="comp.materials.length || comp.awards.length" class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <section v-if="comp.materials.length" class="glass p-20px">
          <h2 class="section-title">📚 真题与开源作品</h2>
          <a v-for="m in comp.materials" :key="m.id" :href="safeHref(m.url)" target="_blank" rel="noopener noreferrer" class="block text-13px color-ink-soft py-6px no-underline hover:text-uestc-500 truncate">
            📄 {{ m.title }}
          </a>
        </section>
        <section v-if="comp.awards.length" class="glass p-20px">
          <h2 class="section-title">🏅 本校历年获奖</h2>
          <div v-for="a in comp.awards" :key="a.id" class="text-13px py-6px border-b border-rgba(15,76,140,0.05) last:border-0">
            <span class="color-ink font-semibold">{{ a.awardName || '获奖' }}</span>
            <span class="color-ink-faint"> · {{ a.teamName || '成电学子' }}{{ a.members.length ? ` · ${a.members.join('、')}` : '' }}{{ a.year ? ` · ${a.year}` : '' }}</span>
          </div>
        </section>
      </div>

      <!-- ================= 留言讨论 ================= -->
      <section class="glass p-20px">
        <h2 class="section-title">💬 留言讨论</h2>
        <CommentList target-type="COMPETITION" :target-id="comp.id || ''" />
      </section>
    </div>

    <!-- 纠错弹窗 -->
    <el-dialog v-model="correctionVisible" title="报告错误" width="min(440px, 92vw)">
      <div class="flex flex-col gap-14px">
        <div class="text-13px color-ink-soft">你正在纠错：<b class="color-ink">{{ correctionFieldLabel }}</b></div>
        <div class="text-12px color-ink-faint">当前值：{{ correctionCurrentValue || '（空）' }}</div>
        <el-input v-model="correctionProposed" placeholder="我认为正确的值应该是…" />
        <el-input v-model="correctionNote" type="textarea" :rows="2" placeholder="补充说明（可选），例如官网通知链接或截图位置" />
        <div class="text-12px color-ink-faint">纠错被采纳后会记录为你的贡献，并自动锁定该字段防止被自动更新覆盖</div>
      </div>
      <template #footer>
        <el-button @click="correctionVisible = false">取消</el-button>
        <el-button type="primary" :loading="correctionSubmitting" @click="submitCorrection">提交纠错</el-button>
      </template>
    </el-dialog>

    <!-- 竞赛信息反馈弹窗 -->
    <el-dialog v-model="feedbackVisible" title="反馈竞赛信息问题" width="min(440px, 92vw)">
      <div class="flex flex-col gap-14px">
        <div class="text-13px color-ink-soft">
          反馈对象：<b class="color-ink">{{ comp?.name }}</b>
          <span class="text-12px color-ink-faint ml-4px">（提交时会自动记录竞赛名快照）</span>
        </div>
        <el-input v-model="feedbackContent" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="请描述信息问题，例如：报名截止时间与官网不一致、级别标注有误…" />
        <el-input v-model="feedbackContact" maxlength="100" placeholder="回访联系方式（选填），如 QQ / 微信 / 邮箱" />
        <div class="text-12px color-ink-faint">若只是某个字段数值错误，推荐用各字段旁的「纠错」入口，处理更快</div>
      </div>
      <template #footer>
        <el-button @click="feedbackVisible = false">取消</el-button>
        <el-button type="primary" :loading="feedbackSubmitting" @click="submitFeedback">提交反馈</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.info-label {
  color: var(--ink-faint);
}

/* ---------- 头部氛围光 ---------- */
.hero-glow {
  position: absolute;
  right: -80px;
  top: -90px;
  width: 260px;
  height: 260px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(245, 185, 1, 0.16), rgba(245, 185, 1, 0) 70%);
  pointer-events: none;
}

/* ---------- 状态徽标 ---------- */
.status-chip {
  font-weight: 600;
  padding-left: 8px;
}
/* 竞赛类别标签：学科=湛蓝、文体=银杏金（校教〔2026〕39号口径） */
.cat-chip {
  font-weight: 600;
}
.cat-academic {
  background: rgba(15, 76, 140, 0.1);
  color: var(--uestc-blue);
}
.cat-art {
  background: rgba(217, 159, 0, 0.14);
  color: #8a5800;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.st-open {
  background: rgba(29, 158, 117, 0.12);
  color: #0f6e56;
}
.st-upcoming {
  background: rgba(15, 76, 140, 0.1);
  color: var(--uestc-blue);
}
.st-ended {
  background: rgba(147, 163, 181, 0.16);
  color: var(--ink-soft);
}
.st-unknown {
  background: rgba(147, 163, 181, 0.16);
  color: var(--ink-faint);
}

/* ---------- 倒计时条 ---------- */
.countdown-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-radius: 16px;
  background: linear-gradient(120deg, #fff3cd 0%, #ffe28a 45%, #ffd34e 100%);
  border: 1px solid rgba(245, 185, 1, 0.5);
  box-shadow: 0 10px 30px rgba(245, 185, 1, 0.22);
}
.countdown-bar.cd-past {
  background: linear-gradient(120deg, #eef2f7 0%, #e2e8f0 100%);
  border-color: rgba(147, 163, 181, 0.4);
  box-shadow: none;
}
.cd-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cd-icon {
  font-size: 22px;
}
.cd-label {
  font-size: 12px;
  color: #7a5a00;
  font-weight: 600;
}
.cd-past .cd-label {
  color: var(--ink-soft);
}
.cd-date {
  font-size: 15px;
  font-weight: 700;
  color: #4a3800;
}
.cd-past .cd-date {
  color: var(--ink-soft);
}
.cd-right {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.cd-num {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
  color: #6b4e00;
  font-variant-numeric: tabular-nums;
}
.cd-past .cd-num {
  color: var(--ink-soft);
}
.cd-unit {
  font-size: 13px;
  font-weight: 600;
  color: #7a5a00;
}
.cd-past .cd-unit {
  color: var(--ink-faint);
}

/* ---------- 加分卡 ---------- */
.bonus-card {
  background: linear-gradient(135deg, rgba(255, 240, 198, 0.5), rgba(255, 255, 255, 0.65) 60%);
}
.bonus-table {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(245, 185, 1, 0.35);
  background: rgba(255, 255, 255, 0.6);
}
.bt-head,
.bt-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  padding: 7px 12px;
  font-size: 12px;
  text-align: center;
}
.bt-head {
  background: rgba(245, 185, 1, 0.18);
  color: #7a5a00;
  font-weight: 600;
}
.bt-row {
  color: var(--ink);
  font-weight: 600;
}
.bt-head span:first-child,
.bt-row span:first-child {
  text-align: left;
}

/* ---------- 赛道切换 ---------- */
.track-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 移动端头部：信息与操作按钮上下堆叠，避免左侧内容被按钮列挤压成窄条 */
@media (max-width: 768px) {
  .detail-head-row {
    flex-direction: column;
    align-items: stretch;
  }
  .detail-head-actions {
    width: 100%;
  }
  .detail-head-actions .el-button {
    flex: 1 1 0;
    margin-left: 0 !important;
  }
}

/* 移动端：赛道多时横向滑动，避免换行堆叠占满半屏 */
@media (max-width: 768px) {
  .track-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
  }
  .track-tabs .track-tab {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
.track-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--ink-soft);
  background: rgba(15, 76, 140, 0.05);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.18s ease;
}
.track-tab:hover {
  background: rgba(15, 76, 140, 0.1);
}
.track-tab-active {
  background: linear-gradient(135deg, var(--uestc-blue), #1f63a0);
  color: #fff;
  box-shadow: 0 6px 16px rgba(15, 76, 140, 0.25);
}
.track-tab-count {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
}
.track-tab:not(.track-tab-active) .track-tab-count {
  background: rgba(15, 76, 140, 0.12);
}

/* ---------- 赛程路线图 ---------- */
.stage-rail {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.stage-card {
  position: relative;
  min-width: 230px;
  max-width: 320px;
  flex: 1 1 0;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 76, 140, 0.1);
  transition: all 0.2s ease;
}
.stage-card:not(:last-child)::after {
  content: '';
  position: absolute;
  right: -14px;
  top: 34px;
  width: 14px;
  height: 2px;
  background: rgba(15, 76, 140, 0.18);
}
.stage-current {
  border-color: rgba(245, 185, 1, 0.7);
  background: linear-gradient(160deg, rgba(255, 243, 205, 0.75), rgba(255, 255, 255, 0.8));
  box-shadow: 0 8px 22px rgba(245, 185, 1, 0.2);
}
.stage-past {
  opacity: 0.62;
}
.stage-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.stage-index {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--uestc-blue), #1f63a0);
}
.stage-current .stage-index {
  background: linear-gradient(135deg, #f5b901, #ffd34e);
  color: #5c4300;
}
.stage-kind {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(15, 76, 140, 0.08);
  color: var(--uestc-blue);
}
.kind-FINAL,
.kind-NATIONAL {
  background: rgba(15, 76, 140, 0.12);
}
.kind-PROVINCIAL {
  background: rgba(29, 158, 117, 0.12);
  color: #0f6e56;
}
.kind-REGIONAL {
  background: rgba(216, 90, 48, 0.12);
  color: #993c1d;
}
.stage-tier {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tier-nat {
  background: rgba(15, 76, 140, 0.14);
  color: var(--uestc-blue);
}
.tier-prov {
  background: rgba(29, 158, 117, 0.14);
  color: #0f6e56;
}
.stage-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 8px;
}

/* ---------- 时间节点 ---------- */
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.event-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 7px 9px;
  border-radius: 10px;
  background: rgba(15, 76, 140, 0.045);
}
.event-item.event-past {
  background: rgba(147, 163, 181, 0.1);
}
.event-icon {
  font-size: 13px;
  line-height: 18px;
}
.event-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 4px;
}
.event-date {
  font-size: 12px;
  color: var(--uestc-blue);
  font-variant-numeric: tabular-nums;
}
.event-past .event-date {
  color: var(--ink-faint);
}

/* ---------- 赛道卡片 ---------- */
.track-card {
  text-align: left;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 76, 140, 0.1);
  cursor: pointer;
  transition: all 0.18s ease;
}
.track-card:hover {
  border-color: rgba(15, 76, 140, 0.3);
  transform: translateY(-2px);
}
.track-card-active {
  border-color: rgba(15, 76, 140, 0.5);
  background: rgba(15, 76, 140, 0.05);
}
</style>
