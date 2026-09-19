<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();

const tabs = [
  { path: '/admin/competitions', label: '竞赛管理' },
  { path: '/admin/reports', label: '举报处理' },
  { path: '/admin/users', label: '用户管理' },
  { path: '/admin/announcements', label: '系统公告' },
  { path: '/admin/corrections', label: '纠错处理' },
  { path: '/admin/revisions', label: '版本回滚' },
];
</script>

<template>
  <div class="page-wrap max-w-1100px mx-auto">
    <div class="flex items-end justify-between mb-14px flex-wrap gap-10px">
      <div>
        <h1 class="text-28px font-extrabold m-0">管理后台</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">全自动发布模式的监督与恢复通道</p>
      </div>
      <div class="flex items-center gap-8px">
        <span class="chip" style="background: rgba(217,60,60,0.08); color: #c0392b">🔴 采集子系统未接入 —— 数据暂由人工录入与用户纠错维护</span>
      </div>
    </div>

    <el-tabs :model-value="route.path" class="admin-tabs">
      <el-tab-pane v-for="t in tabs" :key="t.path" :name="t.path">
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
