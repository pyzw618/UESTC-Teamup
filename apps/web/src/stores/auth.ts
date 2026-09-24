import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, setUnauthorizedHandler } from '../api/client';

export interface MeUser {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  skills: { skill: string; level: number | null }[];
  studentNo?: string;
  email?: string;
  role?: string;
  /** 是否已设置密码（决定"密码登录"与资料页引导） */
  hasPassword?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<MeUser | null>(null);
  const loaded = ref(false);

  const isLoggedIn = computed(() => !!user.value);
  const isAdmin = computed(() => user.value?.role === 'ADMIN');

  async function bootstrap() {
    if (loaded.value) return;
    try {
      const res = await api.get<{ user: MeUser | null }>('/auth/me');
      user.value = res?.user ?? null;
    } catch {
      user.value = null;
    } finally {
      loaded.value = true;
    }
  }

  async function refresh() {
    loaded.value = false;
    await bootstrap();
  }

  async function logout() {
    // M8：接口失败也要清本地登录态，保证"永远能登出"
    try {
      await api.post('/auth/logout');
    } catch {
      /* 忽略：会话可能已失效 */
    } finally {
      user.value = null;
    }
  }

  return { user, loaded, isLoggedIn, isAdmin, bootstrap, refresh, logout };
});

// M7：全局 401 处理（回调注册模式，client.ts 不依赖 store/router）。
// /auth/* 的 401（游客 bootstrap、登录流程）已在 client 侧排除，不会误伤登录页。
setUnauthorizedHandler(() => {
  try {
    const auth = useAuthStore();
    auth.user = null;
  } catch {
    /* pinia 尚未就绪时仅做跳转 */
  }
  const { pathname, search } = window.location;
  if (!pathname.startsWith('/login')) {
    window.location.href = `/login?redirect=${encodeURIComponent(pathname + search)}`;
  }
});
