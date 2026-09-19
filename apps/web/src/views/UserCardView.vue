<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import { fmtDate, type TeamSummary } from '../api/types';
import UserAvatar from '../components/UserAvatar.vue';
import { useAuthStore } from '../stores/auth';

interface PublicCard {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  bio: string | null;
  skills: { skill: string; level: number | null }[];
  studentNo?: string;
}

const route = useRoute();
const auth = useAuthStore();

const user = ref<PublicCard | null>(null);
const teams = ref<(TeamSummary & { competition?: { name: string } })[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [u, t] = await Promise.all([
      api.get<PublicCard>(`/users/${route.params.id}`),
      api.get<(TeamSummary & { competition?: { name: string } })[]>(`/users/${route.params.id}/teams`),
    ]);
    user.value = u;
    teams.value = t;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-wrap max-w-680px mx-auto">
    <div v-if="loading" class="skeleton h-240px"></div>
    <template v-else-if="user">
      <!-- 半匿名名片：学号仅同队/管理员可见 -->
      <section class="glass p-28px animate-appear">
        <div class="flex items-center gap-16px flex-wrap">
          <UserAvatar :name="user.nickname || user.college || 'U'" :size="72" />
          <div class="flex-1 min-w-0">
            <h1 class="text-22px font-extrabold m-0 color-ink">
              {{ user.nickname || '同学' }}
              <span v-if="user.studentNo" class="text-13px font-normal color-ink-faint ml-6px">学号 {{ user.studentNo }}</span>
            </h1>
            <div class="text-14px color-ink-soft mt-4px">
              <template v-if="user.college">{{ user.college }}</template>
              <template v-if="user.grade"> · {{ user.grade }} 级</template>
              <template v-if="user.major"> · {{ user.major }}</template>
              <template v-if="!user.college && !user.grade && !user.major"> · 这位同学还没完善资料</template>
            </div>
            <div v-if="user.studentNo" class="text-12px color-ink-faint mt-2px">你们是同队队友，可见完整信息</div>
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

      <!-- 正在参与的队伍 -->
      <section class="glass p-22px mt-16px">
        <h2 class="text-15px font-bold m-0 mb-12px">👥 正在参与的队伍</h2>
        <div class="flex flex-col gap-10px">
          <div
            v-for="t in teams"
            :key="t.id"
            class="rounded-14px p-12px cursor-pointer"
            style="background: rgba(255,255,255,0.5)"
            @click="$router.push(`/teams/${t.id}`)"
          >
            <div class="text-14px font-semibold color-ink">{{ t.competition?.name || '队伍' }}</div>
            <div class="text-12px color-ink-faint mt-2px">
              状态：{{ t.status }} · 目标：{{ t.goal }}
            </div>
          </div>
          <el-empty v-if="!teams.length" description="暂无参与的队伍" :image-size="54" />
        </div>
      </section>
    </template>
  </div>
</template>
