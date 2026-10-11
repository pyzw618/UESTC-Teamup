<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarkdownView from '../components/MarkdownView.vue';
import { useSlideThumb } from '../composables/useSlideThumb';
import aboutMd from './about/docs/about.md?raw';
import termsMd from './about/docs/terms.md?raw';
import privacyMd from './about/docs/privacy.md?raw';
import dataSourcesMd from './about/docs/data-sources.md?raw';

const route = useRoute();
const router = useRouter();

/**
 * 页脚四份说明文档的正文（Markdown，?raw 引入，MarkdownView 渲染时 html:false 防注入）。
 * 通过 ?doc= 查询参数定位文档，页脚四个链接各指向其中一篇。
 */
const docs = [
  { key: 'about', label: '关于', source: aboutMd },
  { key: 'terms', label: '用户协议', source: termsMd },
  { key: 'privacy', label: '隐私政策', source: privacyMd },
  { key: 'data', label: '数据来源说明', source: dataSourcesMd },
];

function readDocKey(raw: unknown): string {
  const key = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  return docs.some((d) => d.key === key) ? key : 'about';
}

const activeKey = ref(readDocKey(route.query.doc));
// 站内其它入口带 ?doc= 跳转时同步（如 /about?doc=privacy）
watch(
  () => route.query.doc,
  (v) => {
    activeKey.value = readDocKey(v);
  },
);

function switchDoc(key: string) {
  activeKey.value = key;
  router.replace({ query: { ...route.query, doc: key === 'about' ? undefined : key } });
}

const source = computed(() => docs.find((d) => d.key === activeKey.value)?.source ?? '');

const tabsRef = ref<HTMLElement | null>(null);
const { thumbStyle: tabThumbStyle } = useSlideThumb(tabsRef, () => activeKey.value, '.seg-switch-item.active');
</script>

<template>
  <div class="page-wrap max-w-760px mx-auto">
    <h1 class="text-26px font-extrabold m-0">关于本站</h1>

    <div ref="tabsRef" class="seg-switch about-tabs mt-18px mb-16px">
      <span class="seg-switch-thumb" aria-hidden="true" :style="tabThumbStyle"></span>
      <button
        v-for="d in docs"
        :key="d.key"
        class="seg-switch-item"
        :class="{ active: activeKey === d.key }"
        @click="switchDoc(d.key)"
      >{{ d.label }}</button>
    </div>

    <div class="glass p-24px md:p-28px">
      <MarkdownView :source="source" />
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 768px) {
  /* 窄屏四个标签放不下时横向滑动（seg-switch 本体不换行） */
  .about-tabs {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .about-tabs::-webkit-scrollbar {
    display: none;
  }
  .about-tabs .seg-switch-item {
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
