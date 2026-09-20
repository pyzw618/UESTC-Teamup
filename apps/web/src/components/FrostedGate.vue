<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

/**
 * 磨砂玻璃门：队友招募信息仅登录可见。
 * slot 放"玻璃后面的模糊内容预览"，覆盖层用 backdrop-blur + 提示文案 + 登录按钮。
 */
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    buttonText?: string;
  }>(),
  {
    title: '招募信息仅对登录同学可见',
    description: '登录后即可查看队伍详情、缺口角色与联系方式',
    buttonText: '登录 / 注册',
  },
);

const router = useRouter();
const route = useRoute();

function goLogin() {
  router.push({ name: 'login', query: { redirect: route.fullPath } });
}
</script>

<template>
  <div class="gate relative overflow-hidden rounded-2xl">
    <!-- 玻璃后面的模糊内容 -->
    <div class="gate-backdrop pointer-events-none select-none" aria-hidden="true">
      <slot />
    </div>

    <!-- 磨砂覆盖层 -->
    <div class="gate-overlay absolute inset-0 flex flex-col items-center justify-center gap-10px px-20px text-center">
      <div class="lock-badge">
        <el-icon :size="20"><i-ep-lock /></el-icon>
      </div>
      <div class="text-15px font-bold color-ink">{{ title }}</div>
      <div class="text-13px color-ink-soft">{{ description }}</div>
      <el-button type="primary" round @click="goLogin">{{ buttonText }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.gate-backdrop {
  filter: blur(7px);
  opacity: 0.75;
  transform: scale(1.02);
}
.gate-overlay {
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.55), rgba(255, 249, 232, 0.45));
  border: 1px solid rgba(255, 255, 255, 0.65);
  z-index: 1;
}
.lock-badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #0c3d70, #0f4c8c 55%, #1f63a0);
  box-shadow: 0 6px 18px rgba(15, 76, 140, 0.3);
}
</style>
