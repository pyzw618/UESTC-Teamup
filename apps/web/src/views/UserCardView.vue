<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import { TeamStatusLabel, TeamGoalLabel, type TeamStatus, type TeamGoal } from '@teamup/shared';
import { type TeamSummary } from '../api/types';
import UserAvatar from '../components/UserAvatar.vue';

interface PublicCard {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  bio: string | null;
  skills: { skill: string; level: number | null }[];
  contact?: string | null;
}

const route = useRoute();

const user = ref<PublicCard | null>(null);
const teams = ref<(TeamSummary & { competition?: { name: string } })[]>([]);
const loading = ref(true);
/** A3：名片接口与招募帖接口分开容错 —— 子资源 401/失败不再拖垮整页 */
const userError = ref<'NOT_FOUND' | 'ERROR' | null>(null);
const teamsState = ref<'LOADED' | 'UNAUTHORIZED' | 'ERROR'>('LOADED');

onMounted(async () => {
  // 两个请求独立 catch：/users/:id 失败才进整页错误态；/users/:id/teams 失败仅隐藏该区块
  const [u, t] = await Promise.allSettled([
    api.get<PublicCard>(`/users/${route.params.id}`),
    api.get<(TeamSummary & { competition?: { name: string } })[]>(`/users/${route.params.id}/teams`, { silent401: true }),
  ]);
  if (u.status === 'fulfilled') user.value = u.value;
  else userError.value = u.reason instanceof ApiError && u.reason.code === 404 ? 'NOT_FOUND' : 'ERROR';
  if (t.status === 'fulfilled') {
    teams.value = t.value;
    teamsState.value = 'LOADED';
  } else {
    teamsState.value = t.reason instanceof ApiError && t.reason.code === 401 ? 'UNAUTHORIZED' : 'ERROR';
  }
  loading.value = false;
});

const statusLabel = (s: string) => TeamStatusLabel[s as TeamStatus] ?? s;
const goalLabel = (g: string) => TeamGoalLabel[g as TeamGoal] ?? g;
</script>

<template>
  <div class="page-wrap max-w-680px mx-auto">
    <div v-if="loading" class="skeleton h-240px"></div>
    <div v-else-if="userError" class="glass p-28px">
      <el-empty
        :description="userError === 'NOT_FOUND' ? '用户不存在' : '名片加载失败，请稍后重试'"
        :image-size="80"
      >
        <el-button type="primary" round @click="$router.push('/')">返回首页</el-button>
      </el-empty>
    </div>
    <template v-else-if="user">
      <!-- 公开名片：不含学号（A1），校园身份由校园邮箱验证表达 -->
      <section class="glass p-28px animate-appear">
        <div class="flex items-center gap-16px flex-wrap">
          <UserAvatar :name="user.nickname || user.college || 'U'" :size="72" />
          <div class="flex-1 min-w-0">
            <h1 class="text-22px font-extrabold m-0 color-ink">{{ user.nickname || '同学' }}</h1>
            <div class="text-14px color-ink-soft mt-4px">
              <template v-if="user.college">{{ user.college }}</template>
              <template v-if="user.grade"> · {{ user.grade }} 级</template>
              <template v-if="user.major"> · {{ user.major }}</template>
              <template v-if="!user.college && !user.grade && !user.major"> · 这位同学还没完善资料</template>
            </div>
            <div v-if="user.contact" class="text-13px color-ink-soft mt-4px">联系方式：{{ user.contact }}</div>
          </div>
        </div>

        <div v-if="user.bio" class="mt-18px">
          <h2 class="text-14px font-bold m-0 mb-8px">自我介绍</h2>
          <p class="text-14px leading-relaxed color-ink-soft m-0 whitespace-pre-wrap">{{ user.bio }}</p>
        </div>

        <div v-if="user.skills.length" class="mt-18px">
          <h2 class="text-14px font-bold m-0 mb-8px">技能标签</h2>
          <div class="flex gap-8px flex-wrap">
            <span v-for="s in user.skills" :key="s.skill" class="chip" style="background: rgba(15,76,140,0.07); color: var(--uestc-blue)">
              {{ s.skill }}
              <span class="color-ink-faint">{{ s.level ? '★'.repeat(s.level) : '' }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- B4：这里展示的是 TA 作为队长发布的招募帖，不是「正在参与的队伍」 -->
      <section class="glass p-22px mt-16px">
        <h2 class="text-15px font-bold m-0 mb-12px">📢 TA 发布的招募帖</h2>

        <div v-if="teamsState === 'LOADED'" class="flex flex-col gap-10px">
          <div
            v-for="t in teams"
            :key="t.id"
            class="rounded-14px p-12px cursor-pointer"
            style="background: rgba(255,255,255,0.5)"
            @click="$router.push(`/teams/${t.id}`)"
          >
            <div class="text-14px font-semibold color-ink">{{ t.competition?.name || '队伍' }}</div>
            <div class="text-12px color-ink-faint mt-2px">
              状态：{{ statusLabel(t.status) }} · 目标：{{ goalLabel(t.goal) }}
              <template v-if="t.intentCount"> · 🙋 {{ t.intentCount }} 人想组队</template>
            </div>
          </div>
          <el-empty v-if="!teams.length" description="暂无发布中的招募帖" :image-size="54" />
        </div>

        <!-- A3：受保护子资源 401 只影响本区块，给出明确的登录引导而非整页失败 -->
        <div v-else-if="teamsState === 'UNAUTHORIZED'" class="rounded-14px p-16px text-center" style="background: rgba(15,76,140,0.04)">
          <div class="text-13px color-ink-soft mb-10px">登录后可查看 TA 发布的招募帖</div>
          <el-button type="primary" size="small" round @click="$router.push({ name: 'login', query: { redirect: route.fullPath } })">
            去登录
          </el-button>
        </div>
        <div v-else class="text-13px color-ink-faint">招募帖加载失败，请稍后刷新重试</div>
      </section>
    </template>
  </div>
</template>
