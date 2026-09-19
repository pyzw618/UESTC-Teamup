<template>
  <footer class="app-footer relative overflow-hidden">
    <!-- 图书馆线稿装饰（转绘深蓝，底部渐隐） -->
    <img
      src="/brand/library-blue.png"
      alt=""
      aria-hidden="true"
      class="footer-watermark pointer-events-none select-none"
    />

    <div class="relative z-1">
      <div class="flex items-center justify-center gap-6px mb-8px">
        <img src="/brand/badge-blue-96.png" alt="电子科技大学校徽" class="w-20px h-20px opacity-80" />
        <span class="motto tracking-1px">求实求真 · 大气大为</span>
      </div>
      <div>
        <a href="#" @click.prevent>关于</a>·<a href="#" @click.prevent>用户协议</a>·<a href="#" @click.prevent>隐私政策</a>·<a
          href="#"
          @click.prevent
        >数据来源说明</a>
      </div>
      <div class="mt-6px">UESTC TeamUp · 电子科技大学竞赛组队平台 · 数据仅供校内同学参考</div>
    </div>
  </footer>
</template>

<style scoped>
.footer-watermark {
  position: absolute;
  left: 50%;
  bottom: -12px;
  transform: translateX(-50%);
  width: min(720px, 86%);
  opacity: 0.09;
  -webkit-mask-image: radial-gradient(75% 110% at 50% 65%, #000 40%, transparent 100%);
  mask-image: radial-gradient(75% 110% at 50% 65%, #000 40%, transparent 100%);
}

.motto {
  font-size: 12px;
  color: var(--uestc-blue);
  opacity: 0.65;
  font-weight: 600;
  letter-spacing: 3px;
}
</style>
