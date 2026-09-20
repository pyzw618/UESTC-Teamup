<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { daysLeft, fmtDate, type CompetitionListItem, type TeamListItem, type TimelineNode } from '../api/types';
import LevelChips from '../components/LevelChips.vue';
import TeamCardMeta from '../components/TeamCardMeta.vue';
import FrostedGate from '../components/FrostedGate.vue';
import { useAuthStore } from '../stores/auth';
import { Level } from '@teamup/shared';

const router = useRouter();
const auth = useAuthStore();

const home = ref<{
  deadlines: { competitionId: string; competitionName: string; stage: string; endAt: string; daysLeft: number }[];
  hotTeams: (TeamListItem & { neededRoles?: string[] })[];
  bonusCompetitions: CompetitionListItem[];
  levelCounts: Record<string, number>;
  recommend: { id: string; name: string; levels: string[]; tags: string[]; reason: string }[];
} | null>(null);
const miniMonth = ref<TimelineNode[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;
    const [h, month] = await Promise.all([
      api.get<NonNullable<typeof home.value>>('/home'),
      api.get<TimelineNode[]>(`/calendar?start=${monthStart}&end=${monthEnd}`),
    ]);
    home.value = h;
    miniMonth.value = (month || []).filter((t) => {
      const s = t.startAt ? new Date(t.startAt) : null;
      const e = t.endAt ? new Date(t.endAt) : null;
      return (s && s <= new Date(monthEnd) && s >= new Date(monthStart)) || (e && e <= new Date(monthEnd) && e >= new Date(monthStart));
    });
  } finally {
    loading.value = false;
  }
});

const levelEntries = [
  { key: Level.INTERNATIONAL, color: '#0A2E55', label: '国际级' },
  { key: Level.NATIONAL, color: '#0F4C8C', label: '国家级' },
  { key: Level.PROVINCIAL, color: '#D99F00', label: '省级' },
  { key: Level.SCHOOL, color: '#2C7355', label: '校级' },
];
</script>

<template>
  <div class="page-wrap">
    <!-- 第一屏：回答"现在有什么比赛我能参加" -->
    <section class="hero relative text-center pt-34px pb-30px">
      <!-- 银杏装饰（转绘 token 金，不响应鼠标） -->
      <img
        src="/brand/ginkgo-gold.png"
        alt=""
        aria-hidden="true"
        class="ginkgo-deco ginkgo-tr pointer-events-none select-none absolute"
      />
      <img
        src="/brand/ginkgo-line-gold.png"
        alt=""
        aria-hidden="true"
        class="ginkgo-deco ginkgo-line-bl pointer-events-none select-none absolute hidden md:block"
      />

      <!-- 主楼线稿水印（转绘深蓝） -->
      <img
        src="/brand/building-front-blue.png"
        alt=""
        aria-hidden="true"
        class="building-watermark pointer-events-none select-none absolute left-0 right-0 mx-auto w-full"
      />

      <div class="relative z-1">
        <div class="chip mx-auto mb-14px animate-appear" style="background: rgba(245,185,1,0.16); color: #8a5800; border: 1px solid rgba(217,159,0,0.3)">
          ✨ 成电人的竞赛罗盘
        </div>
        <h1 class="text-40px md:text-50px font-extrabold m-0 animate-landing-fade-up tracking-wide">
          <span class="text-gradient">UESTC TeamUp</span>
        </h1>
        <p class="text-16px md:text-17px font-semibold color-ink mt-12px mb-0 animate-landing-fade-up" style="animation-delay: 0.08s">
          电子科技大学竞赛组队平台
        </p>
        <p class="text-14px color-ink-soft mt-6px animate-landing-fade-up" style="animation-delay: 0.12s">
          为 UESTC 学生打造的竞赛聚合与组队平台
        </p>
        <div class="flex gap-14px justify-center mt-22px flex-wrap animate-landing-fade-up" style="animation-delay: 0.18s">
          <button class="hero-btn hero-btn-blue" @click="router.push({ name: 'competitions' })">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            浏览竞赛
          </button>
          <button class="hero-btn hero-btn-gold" @click="router.push({ name: 'teams' })">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3m2 10c1.9.4 3.5 1.3 3.5 2.5V19M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8v-1.5C2 15.57 4.42 14 8 14s6 1.57 6 3.5V19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            招募队友
          </button>
        </div>
      </div>
    </section>

    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-3 gap-16px mt-8px">
      <div v-for="i in 6" :key="i" class="skeleton h-150px"></div>
    </div>

    <div v-else class="stagger flex flex-col gap-18px">
      <!-- 近期 DDL -->
      <section class="glass p-22px">
        <div class="flex items-center justify-between mb-14px">
          <h2 class="text-17px font-bold m-0 flex items-center gap-8px">
            ⏰ 近期报名截止
            <span class="text-12px font-normal color-ink-faint">未来 30 天</span>
          </h2>
          <router-link :to="{ name: 'calendar' }" class="text-13px color-uestc-500 no-underline">查看日历 →</router-link>
        </div>
        <div v-if="home?.deadlines.length" class="grid grid-cols-1 sm:grid-cols-2 gap-10px">
          <router-link
            v-for="d in home.deadlines"
            :key="d.competitionId + d.stage"
            :to="`/competitions/${d.competitionId}`"
            class="ddl-row glass-hover"
          >
            <span
              class="ddl-badge"
              :class="d.daysLeft <= 3 ? 'ddl-urgent' : d.daysLeft <= 7 ? 'ddl-warn' : ''"
            >{{ d.daysLeft <= 0 ? '今天' : d.daysLeft }}天</span>
            <div class="flex-1 min-w-0">
              <div class="text-14px font-semibold truncate color-ink">{{ d.competitionName }}</div>
              <div class="text-12px color-ink-faint">{{ d.stage }} · {{ fmtDate(d.endAt, true) }}</div>
            </div>
          </router-link>
        </div>
        <el-empty v-else description="近期暂无报名截止的竞赛" :image-size="60" />
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-18px">
        <!-- 推免加分 -->
        <section class="glass p-22px relative overflow-hidden">
          <div class="flex items-center justify-between mb-14px">
            <h2 class="text-17px font-bold m-0">🎓 推免加分竞赛</h2>
            <router-link
              :to="{ name: 'competitions', query: { bonusOnly: 'true' } }"
              class="text-13px color-uestc-500 no-underline"
            >全部 →</router-link>
          </div>
          <div class="flex flex-col gap-10px">
            <router-link
              v-for="c in home?.bonusCompetitions.slice(0, 5)"
              :key="c.id"
              :to="`/competitions/${c.id}`"
              class="bonus-row glass-hover"
            >
              <div class="flex-1 min-w-0">
                <div class="text-14px font-semibold truncate color-ink">{{ c.name }}</div>
                <div class="text-12px color-ink-faint mt-2px flex items-center gap-6px">
                  <LevelChips :levels="c.levels" :max="2" />
                </div>
              </div>
              <span class="chip gold-gradient font-semibold" style="color: #5c4300">{{ c.bonusCategory || '加分认定' }}</span>
            </router-link>
          </div>
        </section>

        <!-- 热招队伍（招募信息仅登录可见，游客展示磨砂门） -->
        <section class="glass p-22px">
          <div class="flex items-center justify-between mb-14px">
            <h2 class="text-17px font-bold m-0">🔥 热招队伍</h2>
            <router-link :to="{ name: 'teams' }" class="text-13px color-uestc-500 no-underline">全部 →</router-link>
          </div>
          <template v-if="auth.isLoggedIn">
            <div class="flex flex-col gap-12px">
              <router-link
                v-for="t in home?.hotTeams.slice(0, 4)"
                :key="t.id"
                :to="`/teams/${t.id}`"
                class="no-underline glass-hover rounded-14px p-10px -mx-10px px-10px border border-transparent hover:border-rgba(15,76,140,0.1)"
              >
                <TeamCardMeta
                  :leader="t.leader"
                  :goal="t.goal"
                  :status="t.status"
                  :deadline="t.deadline"
                  :needed-roles="t.neededRoles"
                  :competition="t.competition"
                  :team-id="t.id"
                />
              </router-link>
              <el-empty v-if="!home?.hotTeams.length" description="还没有队伍在招募，来发第一个组队帖吧" :image-size="60" />
            </div>
          </template>
          <FrostedGate
            v-else
            title="招募信息仅对登录同学可见"
            description="登录后查看正在招募的队伍、缺口角色与队长信息"
            style="min-height: 220px"
          >
            <div class="flex flex-col gap-12px p-6px">
              <div v-for="i in 3" :key="i" class="skeleton h-52px"></div>
            </div>
          </FrostedGate>
        </section>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-18px">
        <!-- 按级别入口 -->
        <section class="glass p-22px">
          <h2 class="text-17px font-bold m-0 mb-14px">🏆 按级别浏览</h2>
          <div class="grid grid-cols-2 gap-10px">
            <router-link
              v-for="lv in levelEntries"
              :key="lv.key"
              :to="{ name: 'competitions', query: { levels: lv.key } }"
              class="level-entry"
              :style="{ borderColor: `${lv.color}33` }"
            >
              <span class="w-34px h-34px rounded-10px flex items-center justify-center text-white font-bold" :style="{ background: `linear-gradient(135deg, ${lv.color}, ${lv.color}CC)` }">
                {{ home?.levelCounts?.[lv.key] ?? 0 }}
              </span>
              <span class="text-14px font-semibold color-ink">{{ lv.label }}</span>
            </router-link>
          </div>

          <!-- 本月日历预览 -->
          <div class="mt-18px">
            <div class="flex items-center justify-between mb-8px">
              <h3 class="text-14px font-semibold m-0 color-ink-soft">本月节点</h3>
              <router-link :to="{ name: 'calendar' }" class="text-12px color-uestc-500 no-underline">完整日历 →</router-link>
            </div>
            <div v-if="miniMonth.length" class="flex flex-col gap-6px max-h-150px overflow-auto">
              <div v-for="t in miniMonth.slice(0, 6)" :key="t.id" class="flex items-center gap-8px text-12px">
                <span class="color-ink-faint w-40px">{{ t.endAt ? fmtDate(t.endAt).slice(5) : '待定' }}</span>
                <span class="level-chip" :class="`level-${t.level || t.competitionLevels[0] || 'SCHOOL'}`">{{ t.kind === 'signup' ? '报名' : '赛程' }}</span>
                <span class="truncate color-ink-soft">{{ t.competitionName }}</span>
              </div>
            </div>
            <div v-else class="text-12px color-ink-faint">本月暂无节点</div>
          </div>
        </section>

        <!-- 适合你的竞赛（规则筛选，需登录） -->
        <section class="glass p-22px">
          <h2 class="text-17px font-bold m-0 mb-4px">✨ 适合你的竞赛</h2>
          <p class="text-12px color-ink-faint m-0 mb-12px">按你的年级与在读信息规则筛选，不是玄学推荐</p>
          <template v-if="auth.isLoggedIn">
            <div class="flex flex-col gap-10px">
              <router-link
                v-for="c in home?.recommend"
                :key="c.id"
                :to="`/competitions/${c.id}`"
                class="bonus-row glass-hover"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-14px font-semibold truncate color-ink">{{ c.name }}</div>
                  <div class="text-12px color-ink-faint mt-2px">{{ c.reason }}</div>
                </div>
                <LevelChips :levels="c.levels" :max="2" />
              </router-link>
              <el-empty v-if="!home?.recommend.length" description="暂无匹配，先去完善资料" :image-size="56" />
            </div>
          </template>
          <div v-else class="text-center py-24px">
            <p class="text-13px color-ink-soft">登录后按学院 / 年级筛选适合你的比赛</p>
            <el-button type="primary" round @click="router.push({ name: 'login' })">去登录</el-button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 银杏装饰：缓慢摇曳，低存在感 */
.ginkgo-deco {
  opacity: 0.42;
  filter: saturate(0.92);
  animation: ginkgo-sway 9s ease-in-out infinite alternate;
  z-index: 0;
}
.ginkgo-tr {
  top: -26px;
  right: -30px;
  width: 190px;
}
.ginkgo-line-bl {
  bottom: -12px;
  left: 2%;
  width: 120px;
  opacity: 0.3;
  transform: scaleX(-1) rotate(8deg);
  animation-duration: 11s;
  animation-delay: 1.2s;
}
@keyframes ginkgo-sway {
  from {
    transform: rotate(-1.6deg) translateY(0);
  }
  to {
    transform: rotate(1.8deg) translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ginkgo-deco {
    animation: none;
  }
}

/* 主楼线稿水印：hero 底部，向四周渐隐 */
.building-watermark {
  bottom: -18px;
  width: min(860px, 92%);
  opacity: 0.13;
  z-index: 0;
  -webkit-mask-image: radial-gradient(85% 120% at 50% 50%, #000 45%, transparent 100%);
  mask-image: radial-gradient(85% 120% at 50% 50%, #000 45%, transparent 100%);
}

.ddl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  transition: all 0.18s ease-out;
}
.ddl-badge {
  width: 46px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 0;
  border-radius: 10px;
  color: #0f4c8c;
  background: rgba(15, 76, 140, 0.08);
  flex-shrink: 0;
}
.ddl-badge.ddl-warn {
  color: #8a5800;
  background: rgba(245, 185, 1, 0.18);
}
.ddl-badge.ddl-urgent {
  color: #c0392b;
  background: rgba(217, 60, 60, 0.1);
  animation: pulse-dot 1.6s infinite;
}
.bonus-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  transition: all 0.18s ease-out;
}
.level-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid;
  text-decoration: none;
  transition: all 0.18s ease-out;
}
.level-entry:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 10px 24px rgba(15, 76, 140, 0.12);
}
/* ---------- Hero 按钮：玻璃卡片工艺的成对入口（深蓝 / 银杏黄，同尺寸同格式） ---------- */
.hero-btn {
  min-width: 148px;
  height: 42px;
  padding: 0 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    transform 0.2s var(--ease-out),
    box-shadow 0.2s var(--ease-out),
    background-color 0.2s var(--ease-out);
}
.hero-btn svg {
  width: 15px;
  height: 15px;
}
.hero-btn-blue {
  background: linear-gradient(135deg, #0c3d70 0%, #0f4c8c 55%, #1f63a0 100%);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 -1px 0 rgba(6, 31, 59, 0.35),
    0 10px 26px rgba(15, 76, 140, 0.32);
}
.hero-btn-blue:hover {
  transform: translateY(-2px);
  background: linear-gradient(135deg, #0f4c8c 0%, #1f63a0 55%, #2e7cd6 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -1px 0 rgba(6, 31, 59, 0.3),
    0 16px 34px rgba(15, 76, 140, 0.42);
}
.hero-btn-gold {
  background: linear-gradient(135deg, #d99f00 0%, #f5b901 55%, #ffd34e 100%);
  border-color: rgba(255, 255, 255, 0.45);
  color: #4a3600;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 rgba(140, 102, 0, 0.3),
    0 10px 26px rgba(217, 159, 0, 0.32);
}
.hero-btn-gold:hover {
  transform: translateY(-2px);
  background: linear-gradient(135deg, #e8ad10 0%, #ffc61e 55%, #ffdd70 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -1px 0 rgba(140, 102, 0, 0.25),
    0 16px 34px rgba(217, 159, 0, 0.42);
}
.hero-btn:active {
  transform: translateY(0);
}
</style>
