<script setup lang="ts">
import { computed } from 'vue';
import { Level, LevelLabel } from '@teamup/shared';

const props = defineProps<{ levels: string[]; max?: number }>();

const shown = computed(() =>
  props.levels
    .slice(0, props.max ?? 3)
    .map((l) => ({ key: l, label: LevelLabel[l as Level] ?? l })),
);
</script>

<template>
  <span class="inline-flex gap-4px flex-wrap items-center">
    <span v-for="l in shown" :key="l.key" class="level-chip" :class="`level-${l.key}`">{{ l.label }}</span>
    <span v-if="levels.length > shown.length" class="level-chip level-SCHOOL">+{{ levels.length - shown.length }}</span>
  </span>
</template>
