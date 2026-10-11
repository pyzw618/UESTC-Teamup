import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 移动端断点探测（与 UnoCSS `md:` 768px、全局 CSS `max-width: 768px` 对齐）。
 * 用 matchMedia 而非 resize 监听：浏览器自动合并触发，且旋转屏/分屏拖拽都能响应。
 */
export function useIsMobile() {
  const isMobile = ref(false);
  let mql: MediaQueryList | null = null;
  const update = () => {
    isMobile.value = !!mql?.matches;
  };
  onMounted(() => {
    mql = window.matchMedia('(max-width: 767.9px)');
    update();
    mql.addEventListener('change', update);
  });
  onBeforeUnmount(() => {
    mql?.removeEventListener('change', update);
  });
  return isMobile;
}
