<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';
import { fmtDate } from '../../api/types';
import { useAuthStore } from '../../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const favorites = ref<
  {
    targetType: string;
    targetId: string;
    createdAt: string;
    competition: { id: string; name: string } | null;
    team: { id: string; goal: string; status: string; competition: { id: string; name: string } } | null;
  }[]
>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    favorites.value = await api.get('/favorites');
  } finally {
    loading.value = false;
  }
});

async function unfav(f: (typeof favorites.value)[number]) {
  await api.post('/favorites', { targetType: f.targetType, targetId: f.targetId });
  favorites.value = favorites.value.filter((x) => x !== f);
}

async function unfavByIndex(index: number) {
  const f = favorites.value[index];
  if (!f) return;
  await api.post('/favorites', { targetType: f.targetType, targetId: f.targetId });
  favorites.value.splice(index, 1);
}

// 关注竞赛 = 接收 DDL 提醒（PAGES.md §4.3）
void auth;
void unfav;
</script>

<template>
  <div v-loading="loading" class="min-h-200px">
    <div class="text-13px color-ink-soft mb-12px">
      💡 关注的竞赛会在报名截止前 7 / 3 / 1 天收到站内提醒
    </div>
    <div class="flex flex-col gap-10px">
      <div
        v-for="(f, i) in favorites"
        :key="`${f.targetType}-${f.targetId}`"
        class="glass px-16px py-12px flex items-center gap-10px flex-wrap"
      >
        <template v-if="f.targetType === 'COMPETITION' && f.competition">
          <span class="chip" style="background: rgba(15,76,140,0.08); color: var(--uestc-blue)">竞赛关注</span>
          <span class="text-14px font-semibold color-ink cursor-pointer" @click="router.push(`/competitions/${f.competition.id}`)">
            {{ f.competition.name }}
          </span>
        </template>
        <template v-else-if="f.targetType === 'TEAM' && f.team">
          <span class="chip" style="background: rgba(245,185,1,0.14); color: #8a5800">队伍收藏</span>
          <span class="text-14px font-semibold color-ink cursor-pointer" @click="router.push(`/teams/${f.team.id}`)">
            {{ f.team.competition.name }}
          </span>
        </template>
        <template v-else>
          <span class="text-13px color-ink-faint">已失效的收藏</span>
        </template>
        <span class="text-12px color-ink-faint ml-auto">{{ fmtDate(f.createdAt) }}</span>
        <el-button size="small" link type="danger" @click="unfavByIndex(i)">取消</el-button>
      </div>
      <el-empty v-if="!loading && !favorites.length" description="还没有关注任何竞赛或队伍" :image-size="56" />
    </div>
  </div>
</template>
