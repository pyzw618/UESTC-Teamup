<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import UserAvatar from '../../components/UserAvatar.vue';

const route = useRoute();
const auth = useAuthStore();

const tabs = [
  { path: '/me/profile', label: '资料编辑' },
  { path: '/me/teams', label: '我的招募帖' },
  { path: '/me/favorites', label: '我的关注' },
];
</script>

<template>
  <div class="page-wrap max-w-900px mx-auto">
    <section class="glass p-20px mb-16px flex items-center gap-14px animate-appear">
      <UserAvatar :name="auth.user?.nickname || auth.user?.studentNo || 'U'" :size="56" />
      <div class="flex-1">
        <div class="text-18px font-bold color-ink">
          {{ auth.user?.nickname || '同学' }}
          <el-tag v-if="auth.user?.role === 'ADMIN'" size="small" type="warning" round>管理员</el-tag>
          <el-tag v-else-if="auth.user?.role === 'CONTRIBUTOR'" size="small" type="success" round>贡献者</el-tag>
        </div>
        <div class="text-13px color-ink-faint mt-2px">
          {{ auth.user?.college || '学院未填写' }} · {{ auth.user?.grade || '—' }} 级 · {{ auth.user?.major || '专业未填写' }}
        </div>
      </div>
      <el-tag v-if="!auth.user?.nickname" type="warning" effect="plain" round>资料待补全</el-tag>
    </section>

    <el-tabs :model-value="route.path" class="me-tabs">
      <el-tab-pane
        v-for="t in tabs"
        :key="t.path"
        :name="t.path"
      >
        <template #label>
          <router-link :to="t.path" class="no-underline">{{ t.label }}</router-link>
        </template>
      </el-tab-pane>
    </el-tabs>

    <router-view />
  </div>
</template>

<style scoped>
.me-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}
.me-tabs :deep(.el-tabs__item.is-active a) {
  color: var(--uestc-blue);
  font-weight: 600;
}
.me-tabs a {
  color: var(--ink-soft);
}
</style>
