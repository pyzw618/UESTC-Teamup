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
        <router-link :to="{ name: 'about', query: { doc: 'about' } }">关于</router-link>·<router-link
          :to="{ name: 'about', query: { doc: 'terms' } }"
        >用户协议</router-link>·<router-link
          :to="{ name: 'about', query: { doc: 'privacy' } }"
        >隐私政策</router-link>·<router-link
          :to="{ name: 'about', query: { doc: 'data' } }"
        >数据来源说明</router-link>·<a
          href="https://github.com/pyzw618/UESTC-Teamup"
          target="_blank"
          rel="noopener noreferrer"
          class="github-link"
          title="GitHub 仓库"
          aria-label="GitHub 仓库"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
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

/* GitHub 图标链接：对齐文字行高，颜色跟随页脚链接（main.css .app-footer a） */
.github-link svg {
  width: 15px;
  height: 15px;
  vertical-align: -2px;
}
</style>
