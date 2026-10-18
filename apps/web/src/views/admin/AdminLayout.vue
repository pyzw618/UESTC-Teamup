<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

interface Tab { path: string; label: string; adminOnly?: boolean }

const tabs: Tab[] = [
  { path: '/admin/competitions', label: '竞赛管理' },
  { path: '/admin/teams', label: '招募帖管理', adminOnly: true },
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

/**
 * 标签切换统一走 tab-change 而不是只依赖标签里的 router-link：
 * el-tabs 的点击热区是整个标签项（含左右内边距），而 router-link 只裹住文字，
 * 点内边距时蓝条会跟着动、页面却不动（标签与内容不一致）。
 */
function goTab(name: unknown) {
  if (typeof name === 'string' && name !== route.path) router.push(name);
}
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

    <el-tabs :model-value="route.path" class="admin-tabs" @tab-change="goTab">
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
/* 窄屏（手机后台）标签总宽超过一屏时，Element Plus 默认 overflow:hidden 会直接裁掉
   右侧标签（它自己的左右箭头依赖内部探测，这里实测不出现），后两个标签等于点不到。
   放开横向滚动即可左右滑动查看；隐藏滚动条保持胶囊视觉。 */
.admin-tabs :deep(.el-tabs__nav-scroll) {
  overflow-x: auto;
  scrollbar-width: none;
}
.admin-tabs :deep(.el-tabs__nav-scroll)::-webkit-scrollbar {
  display: none;
}
</style>
