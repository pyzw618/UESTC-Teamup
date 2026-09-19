import { defineConfig, presetIcons, presetUno, transformerDirectives, transformerVariantGroup } from 'unocss';

/**
 * UESTC TeamUp 设计 token
 * 配色取自成电校徽：深蓝（主色）+ 银杏黄（点缀）及其渐变
 */
export default defineConfig({
  presets: [presetUno(), presetIcons({ scale: 1.2 })],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  theme: {
    colors: {
      uestc: {
        50: '#EEF5FC',
        100: '#DCE9F7',
        200: '#B7D2EE',
        300: '#8AB4E2',
        400: '#4A7FB5',
        500: '#1F63A0',
        600: '#0F4C8C', // 校徽深蓝（主色）
        700: '#0C3D70',
        800: '#0A2E55',
        900: '#061F3B',
      },
      ginkgo: {
        50: '#FFF9E8',
        100: '#FFF0C6',
        200: '#FFE28A',
        300: '#FFD34E',
        400: '#F5B901', // 银杏黄（点缀主色）
        500: '#D99F00',
        600: '#B38300',
        700: '#8C6600',
      },
      ink: {
        DEFAULT: '#16283A',
        soft: '#5A6B7E',
        faint: '#93A3B5',
      },
    },
  },
  shortcuts: {
    'glass-card':
      'rounded-2xl bg-white/65 backdrop-blur-16px border border-white/60 shadow-[0_8px_32px_rgba(15,76,140,0.08)] transition-all duration-200 ease-out',
    'glass-card-hover':
      'hover:transform hover:translate-y--2px hover:shadow-[0_14px_40px_rgba(15,76,140,0.14)] hover:bg-white/78',
    'glass-panel': 'rounded-3xl bg-white/55 backdrop-blur-20px border border-white/60 shadow-[0_10px_36px_rgba(15,76,140,0.09)]',
    'chip': 'inline-flex items-center gap-4px rounded-full px-10px py-2px text-12px leading-18px',
    'anim-appear': 'animate-appear',
    'anim-fade-up': 'animate-landing-fade-up',
  },
  safelist: [
    'level-INTERNATIONAL',
    'level-NATIONAL',
    'level-PROVINCIAL',
    'level-SCHOOL',
    'gold-gradient',
    'blue-gradient',
  ],
});
