<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';
import { fmtDate } from '../../api/types';
import TeamCardMeta from '../../components/TeamCardMeta.vue';

const router = useRouter();

const teams = ref<
  {
    id: string;
    goal: string;
    status: string;
    deadline: string | null;
    createdAt: string;
    isLeader: boolean;
    competition: { id: string; name: string };
    leader: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
    slots: { role: string; filled: boolean }[];
    members: unknown[];
    openRoles: string[];
    _count?: { applications: number };
    pendingCount?: number;
  }[]
>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    teams.value = await api.get<NonNullable<typeof teams.value>>('/teams/me/teams');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="min-h-200px">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
      <div
        v-for="t in teams"
        :key="t.id"
        class="glass glass-hover p-16px cursor-pointer"
        @click="router.push(`/teams/${t.id}`)"
      >
        <div class="flex items-center justify-between mb-8px">
          <span class="text-14px font-bold color-uestc-600 truncate">{{ t.competition.name }}</span>
          <el-tag v-if="t.isLeader" size="small" effect="plain" round>我发起的</el-tag>
        </div>
        <TeamCardMeta
          :leader="t.leader"
          :goal="t.goal"
          :status="t.status"
          :deadline="t.deadline"
          :open-roles="t.openRoles"
          :member-count="(t.members as unknown[]).length"
          :team-id="t.id"
        />
        <div class="text-12px color-ink-faint mt-8px">
          <template v-if="t.isLeader && (t._count?.applications || 0) > 0">
            📥 {{ t._count?.applications }} 条待处理申请 ——
          </template>
          创建于 {{ fmtDate(t.createdAt || '') }}
        </div>
      </div>
      <el-empty v-if="!loading && !teams.length" description="还没有参与任何队伍" class="col-span-full" />
    </div>
  </div>
</template>
