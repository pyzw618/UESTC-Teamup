<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';

// html:false 禁用原始 HTML，linkify 自动识别链接，breaks 让单换行即断行
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const props = defineProps<{ source: string }>();
const html = computed(() => md.render(props.source || ''));
</script>

<template>
  <div class="md-body" v-html="html"></div>
</template>

<style scoped>
.md-body {
  font-size: 14px;
  line-height: 1.8;
  color: var(--ink-soft);
  word-break: break-word;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  color: var(--ink);
  margin: 14px 0 8px;
  font-weight: 700;
}
.md-body :deep(h1) { font-size: 18px; }
.md-body :deep(h2) { font-size: 16px; }
.md-body :deep(h3) { font-size: 15px; }
.md-body :deep(p) { margin: 0 0 8px; }
.md-body :deep(p:last-child) { margin-bottom: 0; }
.md-body :deep(ul),
.md-body :deep(ol) { margin: 4px 0 8px; padding-left: 22px; }
.md-body :deep(li) { margin: 2px 0; }
.md-body :deep(a) { color: var(--uestc-blue); text-decoration: none; }
.md-body :deep(a:hover) { text-decoration: underline; }
.md-body :deep(code) {
  background: rgba(15, 76, 140, 0.07);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 13px;
}
.md-body :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 12px;
  border-left: 3px solid rgba(15, 76, 140, 0.35);
  background: rgba(15, 76, 140, 0.05);
  color: var(--ink-soft);
}
.md-body :deep(strong) { color: var(--ink); }
.md-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #e3e8ee;
  padding: 4px 10px;
}
.md-body :deep(hr) {
  border: none;
  border-top: 1px solid #e3e8ee;
  margin: 10px 0;
}
</style>
