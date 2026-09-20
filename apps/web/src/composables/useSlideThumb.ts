import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/**
 * 分段控件 / 导航胶囊的「滑块」动画：
 * 在容器内放一个绝对定位的 thumb 元素，绑定返回的 thumbStyle，
 * 切换时对当前激活项测量 offsetLeft / offsetWidth，thumb 靠 CSS transition 滑过去。
 *
 * 要求：容器 position: relative；thumb 与激活项按 itemSelector 匹配（如 '.seg-switch-item.active'）。
 */
export function useSlideThumb(
  container: Ref<HTMLElement | null>,
  source: () => unknown,
  itemSelector: string,
) {
  const left = ref(0);
  const width = ref(0);
  const ready = ref(false);

  function measure() {
    const root = container.value;
    const item = root?.querySelector<HTMLElement>(itemSelector);
    if (!root || !item || !item.offsetWidth) {
      ready.value = false;
      return;
    }
    left.value = item.offsetLeft;
    width.value = item.offsetWidth;
    ready.value = true;
  }

  let ro: ResizeObserver | null = null;
  onMounted(() => {
    measure();
    if (container.value && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(container.value);
    }
    window.addEventListener('resize', measure);
    // 字体异步加载完成后文字宽度可能变化，补测一次
    document.fonts?.ready?.then(() => measure());
  });
  onBeforeUnmount(() => {
    ro?.disconnect();
    window.removeEventListener('resize', measure);
  });
  watch(source, () => nextTick(measure));

  const thumbStyle = computed(() => ({
    transform: `translateX(${left.value}px)`,
    width: `${width.value}px`,
    opacity: ready.value ? '1' : '0',
  }));

  return { thumbStyle, measure };
}
