import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api/client';

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
    await api.post('/auth/logout');
    user.value = null;
  }

  return { user, loaded, isLoggedIn, isAdmin, bootstrap, refresh, logout };
});
