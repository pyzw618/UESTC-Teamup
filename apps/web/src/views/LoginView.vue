<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const mode = ref<'code' | 'password'>('code');

/* ---------- 验证码登录（两步） ---------- */
const email = ref('');
const code = ref('');
const sending = ref(false);
const cooldown = ref(0);
const emailValid = computed(() => /^\d{8,16}@std\.uestc\.edu\.cn$/.test(email.value.trim()));

let timer: ReturnType<typeof setInterval> | null = null;
function startCooldown() {
  cooldown.value = 60;
  timer = setInterval(() => {
    cooldown.value--;
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

async function sendCode() {
  if (!emailValid.value) {
    ElMessage.warning('请输入成电校园邮箱（学号@std.uestc.edu.cn）');
    return;
  }
  sending.value = true;
  try {
    const res = await api.post<{ message?: string }>('/auth/send-code', { email: email.value.trim() });
    step.value = 2;
    startCooldown();
    ElMessage.success(res.message || '验证码已发送');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '发送失败，请稍后再试');
  } finally {
    sending.value = false;
  }
}

/* ---------- 密码登录 ---------- */
const password = ref('');
const passwordLogging = ref(false);

async function loginWithPassword() {
  if (!emailValid.value) {
    ElMessage.warning('请输入成电校园邮箱（学号@std.uestc.edu.cn）');
    return;
  }
  if (!password.value) {
    ElMessage.warning('请输入密码');
    return;
  }
  passwordLogging.value = true;
  try {
    await api.post('/auth/login-password', { email: email.value.trim(), password: password.value });
    await afterLogin();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '登录失败');
  } finally {
    passwordLogging.value = false;
  }
}

/* ---------- 忘记密码 ---------- */
const forgotVisible = ref(false);
const fpEmail = ref('');
const fpCode = ref('');
const fpNewPassword = ref('');
const fpSending = ref(false);
const fpSubmitting = ref(false);
const fpCooldown = ref(0);
const fpDevCode = ref('');

async function sendForgotCode() {
  if (!/^\d{8,16}@std\.uestc\.edu\.cn$/.test(fpEmail.value.trim())) {
    ElMessage.warning('请输入成电校园邮箱');
    return;
  }
  fpSending.value = true;
  try {
    const res = await api.post<{ message?: string }>('/auth/forgot-password', { email: fpEmail.value.trim() });
    startFpCooldown();
    ElMessage.success(res.message || '找回验证码已发送');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '发送失败');
  } finally {
    fpSending.value = false;
  }
}

let fpTimer: ReturnType<typeof setInterval> | null = null;
function startFpCooldown() {
  fpCooldown.value = 60;
  fpTimer = setInterval(() => {
    fpCooldown.value--;
    if (fpCooldown.value <= 0 && fpTimer) {
      clearInterval(fpTimer);
      fpTimer = null;
    }
  }, 1000);
}

async function submitReset() {
  fpSubmitting.value = true;
  try {
    await api.post('/auth/reset-password', {
      email: fpEmail.value.trim(),
      code: fpCode.value.trim(),
      newPassword: fpNewPassword.value,
    });
    forgotVisible.value = false;
    mode.value = 'password';
    password.value = '';
    ElMessage.success('密码已重置，请使用新密码登录');
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '重置失败');
  } finally {
    fpSubmitting.value = false;
  }
}

/* ---------- 登录后引导 ---------- */
const step = ref<1 | 2>(1);
const loggingIn = ref(false);
const setPwdVisible = ref(false);
const setPwdValue = ref('');
const setPwdSubmitting = ref(false);

async function afterLogin() {
  await auth.refresh();
  const u = auth.user;
  // 首次登录（未设密码）引导设置密码，可跳过
  if (u && !u.hasPassword) {
    setPwdVisible.value = true;
    return;
  }
  finishLogin();
}

function finishLogin() {
  ElMessage.success('欢迎回来！');
  const redirect = (route.query.redirect as string) || (auth.isAdmin ? '/admin/competitions' : '/');
  router.push(redirect);
}

async function submitSetPassword() {
  setPwdSubmitting.value = true;
  try {
    await api.post('/auth/password', { newPassword: setPwdValue.value });
    await auth.refresh();
    setPwdVisible.value = false;
    ElMessage.success('密码已设置，以后可用密码登录');
    finishLogin();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '设置失败');
  } finally {
    setPwdSubmitting.value = false;
  }
}

function skipSetPassword() {
  setPwdVisible.value = false;
  finishLogin();
}

/* ---------- 验证码登录提交 ---------- */
async function loginWithCode() {
  if (code.value.trim().length !== 6) {
    ElMessage.warning('请输入 6 位验证码');
    return;
  }
  loggingIn.value = true;
  try {
    await api.post('/auth/login', { email: email.value.trim(), code: code.value.trim() });
    code.value = '';
    await afterLogin();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '登录失败');
  } finally {
    loggingIn.value = false;
  }
}

function backToEmail() {
  step.value = 1;
  code.value = '';
}
</script>

<template>
  <div class="page-wrap relative flex items-center justify-center" style="min-height: calc(100vh - 220px)">
    <!-- 主楼线稿背景（转绘浅蓝，右下角渐隐） -->
    <img
      src="/brand/building-side-blue.png"
      alt=""
      aria-hidden="true"
      class="login-watermark pointer-events-none select-none absolute hidden md:block"
    />

    <div class="glass glass-strong relative z-1 w-full max-w-420px p-36px animate-appear-zoom">
      <div class="text-center mb-22px">
        <img src="/brand/badge-96.png" alt="电子科技大学校徽" class="w-52px h-52px rounded-full mx-auto mb-12px drop-shadow-[0_3px_10px_rgba(15,76,140,0.3)]" />
        <h1 class="text-22px font-bold m-0 color-ink">登录 UESTC TeamUp</h1>
        <p class="text-13px color-ink-soft mt-6px mb-0">电子科技大学竞赛组队平台</p>
        <p class="text-12px m-0 mt-8px tracking-2px color-ink-faint">求实求真 · 大气大为</p>
      </div>

      <!-- 登录方式切换 -->
      <div class="mode-tabs mb-18px">
        <button class="mode-tab" :class="{ active: mode === 'code' }" @click="mode = 'code'">验证码登录</button>
        <button class="mode-tab" :class="{ active: mode === 'password' }" @click="mode = 'password'">密码登录</button>
      </div>

      <!-- 验证码登录：第一步邮箱 -->
      <div v-if="mode === 'code' && step === 1" class="flex flex-col gap-16px">
        <div>
          <div class="text-13px color-ink-soft mb-6px">校园邮箱</div>
          <el-input
            v-model="email"
            size="large"
            placeholder="2024080909015@std.uestc.edu.cn"
            @keyup.enter="sendCode"
          />
          <div class="text-12px color-ink-faint mt-6px">仅支持 @std.uestc.edu.cn 后缀，登录即注册</div>
        </div>
        <el-button type="primary" size="large" round :loading="sending" @click="sendCode">
          {{ sending ? '发送中…' : '获取验证码' }}
        </el-button>
      </div>

      <!-- 验证码登录：第二步验证码 -->
      <div v-else-if="mode === 'code'" class="flex flex-col gap-16px">
        <div>
          <div class="text-13px color-ink-soft mb-6px">
            验证码已发送至 <b class="color-ink">{{ email }}</b>
            <a class="ml-6px cursor-pointer color-uestc-500" @click="backToEmail">更换邮箱</a>
          </div>
          <el-input
            v-model="code"
            size="large"
            maxlength="6"
            placeholder="6 位验证码"
            class="code-input"
            @keyup.enter="loginWithCode"
          />
        </div>
        <el-button type="primary" size="large" round :loading="loggingIn" @click="loginWithCode">
          {{ loggingIn ? '登录中…' : '登录' }}
        </el-button>
        <div class="text-center">
          <el-button link type="primary" :disabled="cooldown > 0" @click="sendCode">
            {{ cooldown > 0 ? `${cooldown}s 后可重新发送` : '重新发送验证码' }}
          </el-button>
        </div>
      </div>

      <!-- 密码登录 -->
      <div v-else class="flex flex-col gap-16px">
        <div>
          <div class="text-13px color-ink-soft mb-6px">校园邮箱</div>
          <el-input v-model="email" size="large" placeholder="2024080909015@std.uestc.edu.cn" />
        </div>
        <div>
          <div class="flex items-center justify-between mb-6px">
            <span class="text-13px color-ink-soft">密码</span>
            <a class="text-12px color-uestc-500 cursor-pointer" @click="forgotVisible = true">忘记密码？</a>
          </div>
          <el-input
            v-model="password"
            size="large"
            type="password"
            show-password
            placeholder="密码"
            @keyup.enter="loginWithPassword"
          />
          <div class="text-12px color-ink-faint mt-6px">首次使用？切换到验证码登录，登录后可设置密码</div>
        </div>
        <el-button type="primary" size="large" round :loading="passwordLogging" @click="loginWithPassword">
          {{ passwordLogging ? '登录中…' : '登录' }}
        </el-button>
      </div>
    </div>

    <!-- 忘记密码 -->
    <el-dialog v-model="forgotVisible" title="找回密码" width="440px">
      <div class="flex flex-col gap-14px">
        <div>
          <div class="text-13px color-ink-soft mb-6px">校园邮箱</div>
          <div class="flex gap-8px">
            <el-input v-model="fpEmail" placeholder="学号@std.uestc.edu.cn" />
            <el-button :loading="fpSending" :disabled="fpCooldown > 0" @click="sendForgotCode">
              {{ fpCooldown > 0 ? `${fpCooldown}s` : '发送验证码' }}
            </el-button>
          </div>
        </div>
        <div>
          <div class="text-13px color-ink-soft mb-6px">邮件验证码</div>
          <el-input v-model="fpCode" maxlength="6" placeholder="6 位验证码" />
        </div>
        <div>
          <div class="text-13px color-ink-soft mb-6px">新密码（8-64 位）</div>
          <el-input v-model="fpNewPassword" type="password" show-password placeholder="新密码" />
        </div>
        <div class="text-12px color-ink-faint">重置成功后即可用新密码登录</div>
      </div>
      <template #footer>
        <el-button @click="forgotVisible = false">取消</el-button>
        <el-button type="primary" :loading="fpSubmitting" @click="submitReset">重置密码</el-button>
      </template>
    </el-dialog>

    <!-- 首次登录设置密码（可跳过） -->
    <el-dialog
      v-model="setPwdVisible"
      title="设置登录密码"
      width="420px"
      :close-on-click-modal="false"
    >
      <div class="flex flex-col gap-12px">
        <div class="text-13px color-ink-soft">
          设置密码后，以后可以直接用「密码登录」，无需每次收验证码。
        </div>
        <el-input
          v-model="setPwdValue"
          type="password"
          show-password
          size="large"
          placeholder="8-64 位密码"
        />
      </div>
      <template #footer>
        <el-button @click="skipSetPassword">跳过，稍后在个人中心设置</el-button>
        <el-button type="primary" :loading="setPwdSubmitting" @click="submitSetPassword">设置密码</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.code-input :deep(.el-input__inner) {
  letter-spacing: 10px;
  text-align: center;
  font-size: 20px;
  font-weight: 600;
}

.mode-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(15, 76, 140, 0.06);
}
.mode-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  font-size: 14px;
  color: var(--ink-soft);
  cursor: pointer;
  transition: all 0.18s ease-out;
}
.mode-tab.active {
  background: #fff;
  color: var(--uestc-blue);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 76, 140, 0.12);
}

.login-watermark {
  right: -40px;
  bottom: -70px;
  width: min(560px, 70%);
  opacity: 0.1;
  -webkit-mask-image: radial-gradient(80% 80% at 60% 55%, #000 40%, transparent 100%);
  mask-image: radial-gradient(80% 80% at 60% 55%, #000 40%, transparent 100%);
}
</style>
