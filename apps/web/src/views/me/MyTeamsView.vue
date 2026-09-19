<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';
import { fmtDate, type TeamListItem } from '../../api/types';
import TeamCardMeta from '../../components/TeamCardMeta.vue';

const router = useRouter();

const teams = ref<TeamListItem[]>([]);
const loading = ref(true);

/** 归档仓库：已解散的帖子 */
const archived = computed(() => teams.value.filter((t) => t.status === 'DISBANDED'));
const active = computed(() => teams.value.filter((t) => t.status !== 'DISBANDED'));

onMounted(async () => {
  try {
    teams.value = await api.get<TeamListItem[]>('/teams/me/teams');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="min-h-200px">
    <!-- 进行中 -->
    <h3 v-if="active.length" class="text-14px font-bold color-ink-soft m-0 mb-10px">进行中</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
      <div
        v-for="t in active"
        :key="t.id"
        class="glass glass-hover p-16px cursor-pointer"
        @click="router.push(`/teams/${t.id}`)"
      >
        <div class="flex items-center justify-between mb-8px">
          <span class="text-14px font-bold color-uestc-600 truncate">{{ t.competition.name }}</span>
          <el-tag size="small" effect="plain" round>我发布的</el-tag>
        </div>
        <TeamCardMeta
          :leader="t.leader"
          :goal="t.goal"
          :status="t.status"
          :deadline="t.deadline"
          :needed-roles="t.neededRoles"
          :member-count="t.memberCount"
          :target-size="t.targetSize"
          :comment-count="t.commentCount"
          :expired="t.expired"
          :team-id="t.id"
        />
        <div class="text-12px color-ink-faint mt-8px">
          创建于 {{ fmtDate(t.createdAt || '') }}
        </div>
      </div>
      <el-empty v-if="!loading && !teams.length" description="还没有发布过招募帖" class="col-span-full" />
    </div>

    <!-- 归档仓库（已解散） -->
    <template v-if="archived.length">
      <el-divider class="!my-20px">
        <span class="text-13px color-ink-faint">🗄 归档仓库（已解散）</span>
      </el-divider>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-14px opacity-75">
        <div
          v-for="t in archived"
          :key="t.id"
          class="glass p-16px cursor-pointer"
          @click="router.push(`/teams/${t.id}`)"
        >
          <div class="flex items-center justify-between mb-8px">
            <span class="text-14px font-bold color-ink-soft truncate">{{ t.competition.name }}</span>
            <el-tag size="small" effect="plain" round type="info">已归档</el-tag>
          </div>
          <TeamCardMeta
            :leader="t.leader"
            :goal="t.goal"
            :status="t.status"
            :deadline="t.deadline"
            :needed-roles="t.neededRoles"
            :member-count="t.memberCount"
            :target-size="t.targetSize"
            :comment-count="t.commentCount"
            :expired="t.expired"
            :team-id="t.id"
          />
          <div class="text-12px color-ink-faint mt-8px">
            创建于 {{ fmtDate(t.createdAt || '') }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
