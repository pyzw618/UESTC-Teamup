<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from './stores/auth';
import { api } from './api/client';
import AppNav from './components/AppNav.vue';
import AppFooter from './components/AppFooter.vue';

const auth = useAuthStore();
void auth.bootstrap();

// 系统公告：进入网站后弹出（背景加阴影遮罩），可选"今日不再弹出"
const announcement = ref<{ id: string; title: string; content: string } | null>(null);
const announcementVisible = ref(false);

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function loadAnnouncement() {
  try {
    const a = await api.get<{ id: string; title: string; content: string }>('/announcements/active');
    if (a && localStorage.getItem('announce-dismissed-date') !== today()) {
      announcement.value = a;
      announcementVisible.value = true;
    }
  } catch {
    /* ignore */
  }
}
void loadAnnouncement();

function closeAnnouncement() {
  announcementVisible.value = false;
}

// 今日不再弹出：记录当天日期，跨天恢复弹出
function dismissForToday() {
  localStorage.setItem('announce-dismissed-date', today());
  announcementVisible.value = false;
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <AppNav />
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <AppFooter />

    <!-- 系统公告弹窗 -->
    <el-dialog
      v-model="announcementVisible"
      width="460px"
      :show-close="false"
      align-center
      class="announce-dialog"
    >
      <template #header>
        <div class="announce-head">
          <span class="announce-chip">📢 系统公告</span>
          <h2 class="announce-title">{{ announcement?.title }}</h2>
        </div>
      </template>
      <p class="announce-content">{{ announcement?.content }}</p>
      <template #footer>
        <div class="announce-footer">
          <el-button text type="primary" @click="dismissForToday">今日不再弹出</el-button>
          <el-button type="primary" round @click="closeAnnouncement">我知道了</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.announce-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.announce-chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #8a5800;
  background: linear-gradient(135deg, rgba(245, 185, 1, 0.18), rgba(255, 211, 78, 0.18));
  border: 1px solid rgba(217, 159, 0, 0.35);
}
.announce-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: var(--ink);
}
.announce-content {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--ink-soft);
  white-space: pre-wrap;
}
.announce-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>

<style>
/* 弹窗玻璃化 + 遮罩阴影加深（全局类，由 el-dialog inheritAttrs 透传） */
.announce-dialog {
  border-radius: 18px;
  border: 1px solid rgba(232, 232, 232, 0.9);
  box-shadow:
    0 24px 64px rgba(15, 40, 80, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}
.announce-dialog .el-dialog__header {
  padding-bottom: 8px;
}
/* 弹窗遮罩：背景增加一层阴影 */
.el-overlay.is-message-box .el-overlay-message-box,
.el-overlay {
  backdrop-filter: blur(3px);
  background-color: rgba(10, 30, 60, 0.45);
}
</style>
