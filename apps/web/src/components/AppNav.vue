<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import UserAvatar from './UserAvatar.vue';
import { api } from '../api/client';
import { useSlideThumb } from '../composables/useSlideThumb';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const keyword = ref('');
const unread = ref(0);

const navs = [
  { name: 'radar', label: '竞赛雷达', path: '/competitions', match: ['/competitions', '/calendar'] },
  { name: 'match', label: '队友招募', path: '/teams', match: ['/teams'] },
];

const activeName = computed(() => {
  for (const n of navs) if (n.match.some((m) => route.path.startsWith(m))) return n.name;
  return route.path === '/' ? 'home' : '';
});

const navRef = ref<HTMLElement | null>(null);
const { thumbStyle: navThumbStyle } = useSlideThumb(navRef, () => activeName.value, '.nav-item.active');

async function search() {
  if (!keyword.value.trim()) return;
  router.push({ name: 'competitions', query: { q: keyword.value.trim() } });
}

async function refreshUnread() {
  await auth.bootstrap();
  if (!auth.isLoggedIn) return;
  try {
    const d = await api.get<{ unread: number }>('/notifications/unread-count');
    unread.value = d.unread;
  } catch {
    /* ignore */
  }
}
void refreshUnread();
setInterval(refreshUnread, 30_000);

async function doLogout() {
  await auth.logout();
  router.push({ name: 'home' });
}
</script>

<template>
  <header class="sticky top-0 z-50 pt-14px px-16px">
    <div class="nav-capsule mx-auto max-w-1080px flex items-center gap-8px px-14px py-8px">
      <!-- Logo（校徽） -->
      <router-link :to="{ name: 'home' }" class="flex items-center gap-8px shrink-0 no-underline">
        <img src="/brand/badge-48.png" alt="电子科技大学校徽" class="w-30px h-30px rounded-full drop-shadow-[0_2px_6px_rgba(15,76,140,0.25)]" />
        <span class="font-bold text-16px color-uestc-600 hidden sm:inline">UESTC TeamUp</span>
      </router-link>

      <!-- 主导航 -->
      <nav ref="navRef" class="nav-links flex items-center gap-2px mx-auto">
        <span class="nav-thumb" aria-hidden="true" :style="navThumbStyle"></span>
        <router-link
          :to="{ name: 'home' }"
          class="nav-item"
          :class="{ active: activeName === 'home' }"
        >首页</router-link>
        <router-link
          v-for="n in navs"
          :key="n.name"
          :to="n.path"
          class="nav-item"
          :class="{ active: activeName === n.name }"
        >{{ n.label }}</router-link>
      </nav>

      <!-- 搜索 -->
      <div class="hidden md:flex items-center relative">
        <el-input
          v-model="keyword"
          placeholder="搜索竞赛…"
          size="default"
          class="w-140px search-input"
          clearable
          @keyup.enter="search"
        />
      </div>

      <!-- 右侧：通知 + 头像胶囊（圆柱体：左侧头像 + 右侧"个人中心"） -->
      <div class="flex items-center gap-8px shrink-0">
        <template v-if="auth.isLoggedIn">
          <el-tooltip content="消息中心" placement="bottom" :disabled="unread === 0">
            <button class="bell-btn" :class="{ 'has-unread': unread > 0 }" @click="router.push({ name: 'notifications' })">
              <span class="bell-aura" aria-hidden="true"></span>
              <svg class="bell-icon" :class="{ ringing: unread > 0 }" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 3a6.5 6.5 0 0 0-6.5 6.5v3.2c0 .5-.2 1-.55 1.38l-1.2 1.28c-.6.64-.15 1.7.74 1.7h15.02c.89 0 1.34-1.06.74-1.7l-1.2-1.28a1.88 1.88 0 0 1-.55-1.37V9.5A6.5 6.5 0 0 0 12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <span v-if="unread > 0" class="bell-badge">
                <span class="bell-badge-glare" aria-hidden="true"></span>
                {{ unread > 99 ? '99+' : unread }}
              </span>
            </button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="(c: string) => c === 'logout' ? doLogout() : router.push(c)">
            <span class="user-pill cursor-pointer flex items-center gap-8px">
              <UserAvatar :name="auth.user?.nickname || auth.user?.studentNo || 'U'" :size="28" />
              <span class="text-13px font-semibold color-ink">个人中心</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="/me/profile">个人中心</el-dropdown-item>
                <el-dropdown-item command="/me/teams">我的队伍</el-dropdown-item>
                <el-dropdown-item command="/me/favorites">我的关注</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="/admin/competitions" divided>管理后台</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
        <el-button v-else type="primary" round size="default" @click="router.push({ name: 'login' })">
          登录
        </el-button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.nav-links {
  position: relative;
}
/* 导航滑块：切换页面时渐变胶囊从旧项滑到新项 */
.nav-thumb {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #0c3d70, #0f4c8c 55%, #1f63a0);
  box-shadow: 0 3px 10px rgba(15, 76, 140, 0.3);
  transition:
    transform 0.32s var(--ease-out),
    width 0.32s var(--ease-out),
    opacity 0.2s ease-out;
  pointer-events: none;
}
.nav-item {
  position: relative;
  z-index: 1;
  padding: 7px 16px;
  border-radius: 999px;
  font-size: 14px;
  color: var(--ink-soft);
  text-decoration: none;
  transition: color 0.15s ease-out;
  white-space: nowrap;
}
.nav-item:hover {
  color: var(--uestc-blue);
}
.nav-item.active {
  color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .nav-thumb {
    transition: none;
  }
}
/* ---------- 消息铃铛（图标 + 未读动效：旋转光环 + 扫光 + 摇铃，动效移植自参考站） ---------- */
.bell-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(15, 76, 140, 0.12);
  background: rgba(255, 255, 255, 0.7);
  color: var(--ink-soft);
  cursor: pointer;
  transition: all 0.15s ease-out;
}
.bell-btn:hover {
  color: var(--uestc-blue);
  background: #fff;
  transform: translateY(-1px);
}
.bell-icon {
  width: 19px;
  height: 19px;
  position: relative;
  z-index: 1;
}
.bell-icon.ringing {
  transform-origin: 50% 4px;
  animation: bell-swing 1.6s ease-in-out infinite;
}
@keyframes bell-swing {
  0%, 100% { transform: rotate(0deg); }
  12% { transform: rotate(13deg); }
  28% { transform: rotate(-11deg); }
  44% { transform: rotate(7deg); }
  60% { transform: rotate(-5deg); }
  75% { transform: rotate(2deg); }
}
/* 未读时：旋转光环（sl-number-badge-spin） */
.bell-aura {
  display: none;
  position: absolute;
  inset: -3px;
  border-radius: 14px;
  z-index: 0;
}
.bell-btn.has-unread {
  color: var(--uestc-blue);
  border-color: rgba(15, 76, 140, 0.3);
}
.bell-btn.has-unread .bell-aura {
  display: block;
  background: conic-gradient(from 0deg, rgba(245, 185, 1, 0.55), rgba(15, 76, 140, 0.4), rgba(245, 185, 1, 0.55));
  filter: blur(5px);
  opacity: 0.75;
  animation: badge-aura-spin 2.6s linear infinite;
}
@keyframes badge-aura-spin {
  to { transform: rotate(360deg); }
}
/* 数字徽章 + 扫光（sl-number-badge-glare） */
.bell-badge {
  position: absolute;
  top: -6px;
  right: -7px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: linear-gradient(135deg, #e05252, #c0392b);
  border: 1.5px solid #fff;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  z-index: 2;
  overflow: hidden;
}
.bell-badge-glare {
  position: absolute;
  top: 0;
  left: 0;
  width: 60%;
  height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.85), transparent);
  animation: badge-glare 1.8s ease-in-out infinite;
}
@keyframes badge-glare {
  0% { transform: translateX(-140%); }
  55% { transform: translateX(240%); }
  100% { transform: translateX(240%); }
}
@media (prefers-reduced-motion: reduce) {
  .bell-icon.ringing, .bell-aura, .bell-badge-glare {
    animation: none;
  }
}

/* ---------- 头像胶囊（圆柱体：左头像 + 右"个人中心"） ---------- */
.user-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 14px 3px 4px;
  border-radius: 999px;
  border: 1px solid rgba(15, 76, 140, 0.12);
  background: rgba(255, 255, 255, 0.7);
  transition: all 0.15s ease-out;
}
.user-pill:hover {
  background: #fff;
  box-shadow: 0 4px 14px rgba(15, 76, 140, 0.14);
  transform: translateY(-1px);
}
.search-input :deep(.el-input__wrapper) {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.6);
}
@media (max-width: 768px) {
  header {
    padding-top: 10px;
  }
  .nav-item {
    padding: 6px 10px;
    font-size: 13px;
  }
}
</style>
