<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';
import { fmtDate, type TeamListItem } from '../../api/types';
import TeamCardMeta from '../../components/TeamCardMeta.vue';

interface MyTeamItem extends TeamListItem {
  /** B2：所属竞赛为手动新建的 DRAFT（待审核），招募帖暂不可被发现 */
  competitionPending?: boolean;
}

const router = useRouter();

const teams = ref<MyTeamItem[]>([]);
const loading = ref(true);

/** 归档仓库：已解散的帖子 */
const archived = computed(() => teams.value.filter((t) => t.status === 'DISBANDED'));
const active = computed(() => teams.value.filter((t) => t.status !== 'DISBANDED'));

onMounted(async () => {
  try {
    teams.value = await api.get<MyTeamItem[]>('/teams/me/teams');
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
        <div class="flex items-center justify-between mb-8px gap-8px">
          <span class="text-14px font-bold color-uestc-600 truncate">{{ t.competition.name }}</span>
          <span class="shrink-0 flex gap-6px items-center">
            <el-tag v-if="t.competitionPending" size="small" effect="plain" round type="warning">竞赛待审核</el-tag>
            <el-tag size="small" effect="plain" round>我发布的</el-tag>
          </span>
        </div>
        <div v-if="t.competitionPending" class="text-12px mb-8px" style="color: #8a5800">
          ⏳ 新竞赛正在等待管理员审核，审核发布前这条招募不会出现在公共发现列表
        </div>
        <TeamCardMeta
          :leader="t.leader"
          :goal="t.goal"
          :status="t.status"
          :deadline="t.deadline"
          :needed-roles="t.neededRoles"
          :member-count="t.memberCount"
          :target-size="t.targetSize"
          :intent-count="t.intentCount"
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
            :intent-count="t.intentCount"
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
