<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { RoleType, RoleTypeLabel, TeamGoal, TeamGoalLabel } from '@teamup/shared';
import { api, qs } from '../../api/client';
import { fmtDate, type TeamListItem } from '../../api/types';
import TeamCardMeta from '../../components/TeamCardMeta.vue';
import FrostedGate from '../../components/FrostedGate.vue';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const filters = reactive({
  competitionId: (route.query.competitionId as string) || '',
  roles: (route.query.roles as string)?.split(',').filter(Boolean) || [] as string[],
  goal: (route.query.goal as string) || '',
  includeClosed: false,
  sort: 'LATEST',
});
const page = ref(1);
const total = ref(0);
const items = ref<TeamListItem[]>([]);
const loading = ref(true);

const roleOptions = Object.values(RoleType).map((r) => ({ value: r, label: RoleTypeLabel[r] }));
const goalOptions = Object.values(TeamGoal).map((g) => ({ value: g, label: TeamGoalLabel[g] }));

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: TeamListItem[]; total: number }>(
      `/teams${qs({
        competitionId: filters.competitionId || undefined,
        roles: filters.roles.length ? filters.roles : undefined,
        goal: filters.goal || undefined,
        statuses: filters.includeClosed ? ['RECRUITING', 'NEGOTIATING', 'FULL', 'COMPETING'] : undefined,
        sort: filters.sort,
        page: page.value,
        pageSize: 12,
      })}`,
    );
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

watch(filters, () => {
  page.value = 1;
  load();
});
watch(page, load);
onMounted(() => {
  if (auth.isLoggedIn) load();
  else loading.value = false;
});
</script>

<template>
  <div class="page-wrap">
    <div class="flex items-end justify-between mb-18px flex-wrap gap-10px">
      <div>
        <h1 class="text-28px font-extrabold m-0">队友招募</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">结构化组队卡 · 状态自动更新 · 站内闭环沟通</p>
      </div>
      <el-button v-if="auth.isLoggedIn" type="primary" size="large" round @click="router.push({ name: 'team-new' })">
        + 发布组队
      </el-button>
      <el-button v-else size="large" round @click="router.push({ name: 'login', query: { redirect: '/teams/new' } })">
        登录后发布组队
      </el-button>
    </div>

    <!-- 游客：整块磨砂玻璃门 -->
    <FrostedGate
      v-if="!auth.isLoggedIn"
      title="队友招募信息仅对登录同学可见"
      description="登录后可浏览全部招募队伍、筛选缺口角色、查看组队要求。还没注册？校园邮箱验证码即可登录。"
    >
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-14px pb-6px">
        <div v-for="i in 6" :key="i" class="h-150px"></div>
      </div>
    </FrostedGate>

    <template v-else>
      <!-- 筛选条 -->
      <div class="glass p-14px mb-16px flex items-center gap-12px flex-wrap">
        <el-select
          v-model="filters.roles"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="缺口角色"
          clearable
          style="min-width: 190px"
        >
          <el-option v-for="r in roleOptions" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
        <el-select v-model="filters.goal" placeholder="目标" clearable style="width: 130px">
          <el-option v-for="g in goalOptions" :key="g.value" :value="g.value" :label="g.label" />
        </el-select>
        <el-select v-model="filters.sort" style="width: 150px">
          <el-option value="LATEST" label="最新发布" />
          <el-option value="DEADLINE" label="招募截止临近" />
        </el-select>
        <el-checkbox v-model="filters.includeClosed">
          <span class="text-13px">显示已满员 / 已解散</span>
        </el-checkbox>
        <span class="text-12px color-ink-faint ml-auto hidden md:inline">默认不显示满员与解散队伍，拒绝僵尸帖</span>
      </div>

      <div v-loading="loading" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-14px min-h-300px">
        <div
          v-for="(t, i) in items"
          :key="t.id"
          class="glass glass-hover p-18px flex flex-col gap-10px cursor-pointer animate-row-enter"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.04}s` }"
          @click="router.push(`/teams/${t.id}`)"
        >
          <div class="flex items-center justify-between gap-8px">
            <span
              class="text-14px font-bold color-uestc-600 truncate"
              @click.stop="router.push(`/competitions/${t.competition.id}`)"
            >{{ t.competition.name }} →</span>
          </div>
          <TeamCardMeta
            :leader="t.leader"
            :goal="t.goal"
            :status="t.status"
            :deadline="t.deadline"
            :open-roles="t.openRoles"
            :member-count="t.memberCount"
            :team-size="t.teamSize"
            :current-size="t.currentSize"
            :expired="t.expired"
            :team-id="t.id"
          />
          <div class="text-12px color-ink-faint mt-auto">
            发布于 {{ fmtDate(t.createdAt) }}
          </div>
        </div>
        <el-empty v-if="!loading && !items.length" description="没有符合条件的队伍 —— 换个筛选条件，或发布第一个组队帖" class="col-span-full" />
      </div>

      <div class="flex justify-center mt-18px">
        <el-pagination v-model:current-page="page" :total="total" :page-size="12" layout="prev, pager, next" />
      </div>
    </template>
  </div>
</template>
