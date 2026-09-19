<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 36 });

const palette = [
  ['#0F4C8C', '#1F63A0'],
  ['#D99F00', '#F5B901'],
  ['#4A7FB5', '#8AB4E2'],
  ['#0C3D70', '#2E7CD6'],
  ['#8C6600', '#FFD34E'],
];

const bg = computed(() => {
  let h = 0;
  for (const c of props.name) h = (h * 31 + c.charCodeAt(0)) % 997;
  const [a, b] = palette[h % palette.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
});

const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || 'U');
const isLight = computed(() => bg.value.includes('FFD34E') || bg.value.includes('F5B901'));
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full font-semibold text-white select-none shrink-0"
    :style="{ width: `${size}px`, height: `${size}px`, background: bg, fontSize: `${size * 0.42}px`, color: isLight ? '#5c4300' : '#fff' }"
    :title="name"
  >{{ initial }}</span>
</template>
