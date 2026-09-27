<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const auth = useAuthStore();

interface Tab { path: string; label: string; adminOnly?: boolean }

const tabs: Tab[] = [
  { path: '/admin/competitions', label: '竞赛管理' },
  { path: '/admin/reports', label: '举报处理', adminOnly: true },
  { path: '/admin/users', label: '用户管理', adminOnly: true },
  { path: '/admin/announcements', label: '系统公告', adminOnly: true },
  { path: '/admin/corrections', label: '纠错处理', adminOnly: true },
  { path: '/admin/revisions', label: '版本回滚', adminOnly: true },
  { path: '/admin/feedback', label: '反馈管理', adminOnly: true },
];

/** Issue 2：CONTRIBUTOR 只有竞赛编辑权限，后台仅展示「竞赛管理」标签 */
const visibleTabs = computed(() => tabs.filter((t) => !t.adminOnly || auth.isAdmin));
const isAdmin = computed(() => auth.isAdmin);
</script>

<template>
  <div class="page-wrap max-w-1100px mx-auto">
    <div class="flex items-end justify-between mb-14px flex-wrap gap-10px">
      <div>
        <h1 class="text-28px font-extrabold m-0">管理后台</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">
          {{ isAdmin ? '全自动发布模式的监督与恢复通道' : '贡献者模式：你可以编辑竞赛信息与维护补充字段，修改自动留痕' }}
        </p>
      </div>
      <div class="flex items-center gap-8px">
        <span v-if="isAdmin" class="chip" style="background: rgba(217,60,60,0.08); color: #c0392b">🔴 采集子系统未接入 —— 数据暂由人工录入与用户纠错维护</span>
        <el-tag v-else size="small" effect="plain" round type="warning">CONTRIBUTOR</el-tag>
      </div>
    </div>

    <el-tabs :model-value="route.path" class="admin-tabs">
      <el-tab-pane v-for="t in visibleTabs" :key="t.path" :name="t.path">
        <template #label>
          <router-link :to="t.path" class="no-underline">{{ t.label }}</router-link>
        </template>
      </el-tab-pane>
    </el-tabs>

    <router-view />
  </div>
</template>

<style scoped>
.admin-tabs :deep(.el-tabs__item.is-active a) {
  color: var(--uestc-blue);
  font-weight: 600;
}
.admin-tabs a {
  color: var(--ink-soft);
}
</style>
