<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

interface Tab {
  key: string;
  label: string;
  /** 命中这些路径前缀时高亮 */
  match: string[];
  /** 「我的」：未登录去登录页，已登录去个人中心 */
  target: () => string;
}

const tabs: Tab[] = [
  { key: 'competitions', label: '竞赛', match: ['/competitions'], target: () => '/competitions' },
  { key: 'calendar', label: '日历', match: ['/calendar'], target: () => '/calendar' },
  { key: 'teams', label: '组队', match: ['/teams'], target: () => '/teams' },
  { key: 'me', label: '我的', match: ['/me', '/login'], target: () => (auth.isLoggedIn ? '/me/profile' : '/login') },
];

const activeKey = computed(() => {
  for (const t of tabs) if (t.match.some((m) => route.path.startsWith(m))) return t.key;
  return '';
});
</script>

<template>
  <!-- 移动端专属底部导航（ROADMAP P2-2.13：竞赛｜日历｜组队｜我的），桌面端由 AppNav 胶囊接管 -->
  <nav class="bottom-tab-wrap" aria-label="移动端主导航">
    <div class="bottom-tab">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-item"
        :class="{ active: activeKey === t.key }"
        @click="router.push(t.target())"
      >
        <span class="tab-icon" aria-hidden="true">
          <!-- 竞赛雷达 -->
          <svg v-if="t.key === 'competitions'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7" />
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7" />
            <path d="M12 12l4.6-4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          <!-- 日历 -->
          <svg v-else-if="t.key === 'calendar'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" stroke-width="1.7" />
            <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          <!-- 组队 -->
          <svg v-else-if="t.key === 'teams'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="9" cy="8.5" r="3.2" stroke="currentColor" stroke-width="1.7" />
            <path d="M3.5 19.5c.6-3.3 2.8-5.1 5.5-5.1s4.9 1.8 5.5 5.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            <circle cx="16.8" cy="9.5" r="2.5" stroke="currentColor" stroke-width="1.7" />
            <path d="M17.4 14.3c2.1.4 3.4 1.9 3.8 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          <!-- 我的 -->
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="8" r="3.6" stroke="currentColor" stroke-width="1.7" />
            <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        </span>
        <span class="tab-label">{{ t.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.bottom-tab-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0 14px calc(10px + env(safe-area-inset-bottom));
  pointer-events: none;
}
.bottom-tab {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 460px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(22px) saturate(1.4);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 12px 36px rgba(15, 76, 140, 0.2);
}
.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 0 6px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  font-family: inherit;
  cursor: pointer;
  transition: color 0.18s ease-out, background 0.18s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.tab-icon svg {
  width: 21px;
  height: 21px;
  display: block;
}
.tab-label {
  font-size: 11px;
  font-weight: 500;
  line-height: 14px;
}
.tab-item.active {
  background: linear-gradient(135deg, #0c3d70, #0f4c8c 55%, #1f63a0);
  color: #fff;
  box-shadow: 0 4px 12px rgba(15, 76, 140, 0.32);
}
.tab-item.active .tab-label {
  font-weight: 600;
}
/* 桌面端不渲染（AppNav 顶部胶囊接管） */
@media (min-width: 768px) {
  .bottom-tab-wrap {
    display: none;
  }
}
</style>
