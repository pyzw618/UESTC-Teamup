<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { AudienceLabel, CompetitionFormatLabel, Audience, CompetitionFormat } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, daysLeft, type CommentItem, type CompetitionDetail, type TeamSummary } from '../../api/types';
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

// 纠错弹窗
const correctionVisible = ref(false);
const correctionField = ref('');
const correctionProposed = ref('');
const correctionNote = ref('');
const correctionSubmitting = ref(false);

const comments = ref<CommentItem[]>([]);

const recruitingTeams = ref<TeamSummary[]>([]);
const recruitingTeamsCount = ref(0);

const nextDeadline = computed(() => {
  const signup = comp.value?.timelines.filter((t) => (t.stage || '').includes('报名') && t.endAt).sort((a, b) => new Date(a.endAt!).getTime() - new Date(b.endAt!).getTime());
  return signup?.[0]?.endAt ?? null;
});

const nowNodes = computed(() => {
  if (!comp.value) return [];
  const now = Date.now();
  return [...comp.value.timelines]
    .filter((t) => (t.endAt ? new Date(t.endAt).getTime() >= now : true))
    .sort((a, b) => (a.startAt ? new Date(a.startAt).getTime() : Infinity) - (b.startAt ? new Date(b.startAt).getTime() : Infinity));
});

async function load() {
  loading.value = true;
  try {
    const raw = await api.get<CompetitionDetail & { recruitingTeams: TeamSummary[]; recruitingTeamsCount?: number }>(
      `/competitions/${route.params.id}`,
    );
    comp.value = raw;
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
  const res = await api.post<{ favorited: boolean }>('/favorites', {
    targetType: 'COMPETITION',
    targetId: comp.value!.id,
  });
  favorite.value = res.favorited;
  ElMessage.success(res.favorited ? '已关注，DDL 前 7/3/1 天会提醒你' : '已取消关注');
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

const correctionFieldLabel = ref('');
const correctionCurrentValue = ref('');

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

async function loadComments() {
  if (!comp.value) return;
  comments.value = await api.get(`/comments${qs({ targetType: 'COMPETITION', targetId: comp.value.id })}`);
}
</script>

<template>
  <div class="page-wrap">
    <div v-if="loading" class="max-w-900px mx-auto flex flex-col gap-14px">
      <div class="skeleton h-120px"></div>
      <div class="skeleton h-200px"></div>
    </div>

    <div v-else-if="comp" class="max-w-900px mx-auto flex flex-col gap-16px">
      <!-- 头部 -->
      <section class="glass p-24px animate-appear">
        <div class="flex items-start justify-between gap-12px flex-wrap">
          <div class="min-w-0">
            <div class="flex items-center gap-8px flex-wrap mb-8px">
              <LevelChips :levels="comp.levels" />
              <span v-if="nextDeadline" class="chip" style="background: rgba(15,76,140,0.07); color: var(--uestc-blue)">
                ⏳ {{ daysLeft(nextDeadline)! > 0 ? `剩 ${daysLeft(nextDeadline)} 天` : '今日截止' }}
              </span>
            </div>
            <h1 class="text-24px md:text-28px font-extrabold m-0 color-ink leading-tight">{{ comp.name }}</h1>
            <div v-if="comp.aliases?.length" class="text-13px color-ink-faint mt-4px">别名：{{ comp.aliases.join(' · ') }}</div>
          </div>
          <div class="flex gap-8px shrink-0">
            <el-button round @click="toggleFavorite">
              {{ favorite ? '★ 已关注' : '☆ 关注' }}
            </el-button>
            <el-button round type="primary" plain tag="a" href="/api/calendar.ics" target="_blank">📅 订阅 .ics</el-button>
          </div>
        </div>
        <div class="text-12px color-ink-faint mt-12px">
          最后更新 {{ fmtDate(comp.updatedAt, true) }}
          <template v-if="comp.sourceUrl">
            · 信息来源：<a :href="comp.sourceUrl" target="_blank" rel="noopener" class="color-uestc-500">{{ comp.sourceUrl.replace(/^https?:\/\//, '').split('/')[0] }} ↗</a>
          </template>
        </div>
      </section>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <!-- 关键信息卡 -->
        <section class="glass p-20px">
          <h2 class="text-15px font-bold m-0 mb-12px">关键信息</h2>
          <div class="grid grid-cols-2 gap-y-10px gap-x-8px text-13px">
            <span class="info-label">主办方</span><span class="color-ink">{{ comp.organizer || '—' }}</span>
            <span class="info-label">官网</span>
            <span class="color-ink">
              <a v-if="comp.officialUrl" :href="comp.officialUrl" target="_blank" rel="noopener" class="color-uestc-500">访问官网 ↗</a>
              <template v-else>—</template>
            </span>
            <span class="info-label">赛制</span>
            <span class="color-ink">
              {{ comp.format ? CompetitionFormatLabel[comp.format as CompetitionFormat] : '—' }}
              <template v-if="comp.format === 'TEAM' && (comp.teamSizeMin || comp.teamSizeMax)">
                （{{ comp.teamSizeMin ?? '?' }}–{{ comp.teamSizeMax ?? '?' }} 人）
              </template>
            </span>
            <span class="info-label">面向年级</span>
            <span class="color-ink">{{ comp.audience ? AudienceLabel[comp.audience as Audience] : '—' }}</span>
            <span class="info-label">难度 / 投入</span>
            <span class="color-ink">
              {{ comp.difficulty ? '★'.repeat(comp.difficulty) : '—' }} /
              {{ comp.effort ? '●'.repeat(comp.effort) : '—' }}
            </span>
          </div>
        </section>

        <!-- 推免加分卡（核心） -->
        <section class="glass p-20px relative overflow-hidden bonus-card">
          <h2 class="text-15px font-bold m-0 mb-12px flex items-center gap-6px">
            🎓 推免加分
            <el-tooltip content="级别与加分是两套口径：级别回答比赛多大，加分回答对保研有没有用。数据来源：校教〔2026〕39 号文">
              <el-icon class="color-ink-faint cursor-help"><i-ep-question-filled /></el-icon>
            </el-tooltip>
          </h2>
          <template v-if="comp.isBonusEligible != null">
            <div class="grid grid-cols-2 gap-y-10px gap-x-8px text-13px">
              <span class="info-label">是否计入</span>
              <span>
                <el-tag v-if="comp.isBonusEligible" type="success" size="small" round>计入</el-tag>
                <el-tag v-else type="info" size="small" round>不计入</el-tag>
              </span>
              <span class="info-label">认定类别</span><span class="color-ink">{{ comp.bonusCategory || '—' }}</span>
              <span class="info-label">分值说明</span><span class="color-ink">{{ comp.bonusPoints || '—' }}</span>
            </div>
            <div class="text-11px color-ink-faint mt-10px">
              分值以当年最新通知为准
              <a class="ml-4px cursor-pointer color-uestc-500" @click="openCorrection('bonusPoints', '加分分值', comp.bonusPoints)">纠错</a>
            </div>
          </template>
          <div v-else class="text-13px color-ink-soft py-8px">暂无认定信息 —— 官网通知不会写"这是国家级"，此类字段靠人工维护</div>
        </section>
      </div>

      <!-- 时间轴 -->
      <section class="glass p-20px">
        <div class="flex items-center justify-between mb-12px">
          <h2 class="text-15px font-bold m-0">📅 时间轴</h2>
          <span class="text-12px color-ink-faint">每个节点有自己的级别</span>
        </div>
        <el-empty v-if="!comp.timelines.length" description="暂无时间节点" :image-size="56" />
        <div v-else class="timeline flex flex-col">
          <div
            v-for="(t, i) in comp.timelines"
            :key="t.id"
            class="tl-row"
            :class="{ 'tl-now': nowNodes[0]?.id === t.id }"
          >
            <div class="tl-dot" :class="{ 'tl-dot-now': nowNodes[0]?.id === t.id }">{{ i + 1 }}</div>
            <div class="flex-1 min-w-0 pb-14px">
              <div class="flex items-center gap-8px flex-wrap">
                <span class="text-14px font-semibold color-ink">{{ t.stage }}</span>
                <span v-if="t.level" class="level-chip" :class="`level-${t.level}`">{{ t.level === 'INTERNATIONAL' ? '国际' : t.level === 'NATIONAL' ? '国家' : t.level === 'PROVINCIAL' ? '省' : '校' }}</span>
                <span v-if="t.isLocked" class="text-11px color-ink-faint flex items-center gap-2px"><el-icon><i-ep-lock /></el-icon>人工锁定</span>
                <a class="text-11px color-uestc-500 cursor-pointer" @click="openCorrection(`timeline:${t.id}:${t.endAt ? 'endAt' : 'startAt'}`, `${t.stage}时间`, t.endAt ?? t.startAt)">
                  报告错误
                </a>
              </div>
              <div class="text-12px color-ink-soft mt-2px">
                {{ fmtDate(t.startAt, true) }} <template v-if="t.endAt">→ {{ fmtDate(t.endAt, true) }}</template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 竞赛简介 -->
      <section v-if="comp.intro" class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-10px">竞赛简介</h2>
        <p class="text-14px leading-relaxed color-ink-soft m-0 whitespace-pre-wrap">{{ comp.intro }}</p>
      </section>

      <!-- 正在招募的队伍（两模块联动的另一半；招募信息仅登录可见） -->
      <section class="glass p-20px">
        <div class="flex items-center justify-between mb-12px">
          <h2 class="text-15px font-bold m-0">👥 正在招募的队伍</h2>
          <el-button
            v-if="auth.isLoggedIn"
            type="primary"
            size="small"
            round
            @click="router.push({ name: 'team-new', query: { competitionId: comp.id } })"
          >
            我也要组队
          </el-button>
        </div>
        <template v-if="auth.isLoggedIn">
          <div v-if="recruitingTeams.length" class="grid grid-cols-1 md:grid-cols-2 gap-12px">
            <router-link
              v-for="t in recruitingTeams"
              :key="t.id"
              :to="`/teams/${t.id}`"
              class="glass glass-hover p-14px no-underline"
            >
              <TeamCardMeta
                :leader="t.leader"
                :goal="t.goal"
                :status="t.status"
                :deadline="t.deadline"
                :open-roles="t.openRoles"
                :member-count="t.memberCount"
                :target-size="t.targetSize"
                :team-id="t.id"
              />
            </router-link>
          </div>
          <el-empty v-else description="该竞赛下暂时没有队伍在招募，成为第一个发起者吧" :image-size="56" />
        </template>
        <FrostedGate
          v-else
          :title="recruitingTeamsCount > 0 ? `当前有 ${recruitingTeamsCount} 支队伍正在招募` : '本竞赛暂无人组队'"
          description="组队招募信息仅对已通过校园邮箱认证并登录的同学开放，登录后查看队伍与缺口角色"
          style="min-height: 180px"
        >
          <div class="grid grid-cols-2 gap-12px p-6px">
            <div class="skeleton h-70px"></div>
            <div class="skeleton h-70px"></div>
          </div>
        </FrostedGate>
      </section>

      <!-- 往届材料 + 获奖 -->
      <div v-if="comp.materials.length || comp.awards.length" class="grid grid-cols-1 md:grid-cols-2 gap-16px">
        <section v-if="comp.materials.length" class="glass p-20px">
          <h2 class="text-15px font-bold m-0 mb-12px">📚 真题与开源作品</h2>
          <a
            v-for="m in comp.materials"
            :key="m.id"
            :href="m.url"
            target="_blank"
            rel="noopener"
            class="block text-13px color-ink-soft py-6px no-underline hover:text-uestc-500 truncate"
          >
            📄 {{ m.title }}
          </a>
        </section>
        <section v-if="comp.awards.length" class="glass p-20px">
          <h2 class="text-15px font-bold m-0 mb-12px">🏅 本校历年获奖</h2>
          <div v-for="a in comp.awards" :key="a.id" class="text-13px py-6px border-b border-rgba(15,76,140,0.05) last:border-0">
            <span class="color-ink font-semibold">{{ a.awardName || '获奖' }}</span>
            <span class="color-ink-faint"> · {{ a.teamName || '成电学子' }}{{ a.members.length ? ` · ${a.members.join('、')}` : '' }}{{ a.year ? ` · ${a.year}` : '' }}</span>
          </div>
        </section>
      </div>

      <!-- 留言讨论 -->
      <section class="glass p-20px">
        <h2 class="text-15px font-bold m-0 mb-12px">💬 留言讨论</h2>
        <CommentList :comments="comments" target-type="COMPETITION" :target-id="comp.id || ''" @posted="loadComments" />
      </section>
    </div>

    <!-- 纠错弹窗 -->
    <el-dialog v-model="correctionVisible" title="报告错误" width="440px">
      <div class="flex flex-col gap-14px">
        <div class="text-13px color-ink-soft">
          你正在纠错：<b class="color-ink">{{ correctionFieldLabel }}</b>
        </div>
        <div class="text-12px color-ink-faint">
          当前值：{{ correctionCurrentValue || '（空）' }}
        </div>
        <el-input v-model="correctionProposed" placeholder="我认为正确的值应该是…" />
        <el-input v-model="correctionNote" type="textarea" :rows="2" placeholder="补充说明（可选），例如官网通知链接或截图位置" />
        <div class="text-12px color-ink-faint">纠错被采纳后会记录为你的贡献，并自动锁定该字段防止被自动更新覆盖</div>
      </div>
      <template #footer>
        <el-button @click="correctionVisible = false">取消</el-button>
        <el-button type="primary" :loading="correctionSubmitting" @click="submitCorrection">提交纠错</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.info-label {
  color: var(--ink-faint);
}
.bonus-card {
  background:
    linear-gradient(135deg, rgba(255, 240, 198, 0.5), rgba(255, 255, 255, 0.65) 60%);
}
.timeline {
  position: relative;
}
.tl-row {
  display: flex;
  gap: 12px;
  position: relative;
}
.tl-row:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 24px;
  bottom: 0;
  width: 2px;
  background: rgba(15, 76, 140, 0.1);
}
.tl-dot {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(15, 76, 140, 0.08);
  color: var(--uestc-blue);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.tl-dot-now {
  background: linear-gradient(135deg, #f5b901, #ffd34e);
  color: #5c4300;
  box-shadow: 0 0 0 4px rgba(245, 185, 1, 0.2);
}
</style>
