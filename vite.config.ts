import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages 项目页子路径部署：https://514215834.github.io/TinyPuzzle/
  base: '/TinyPuzzle/',
  build: {
    target: 'es2019',
    outDir: 'dist',
  },
  plugins: [
    // PWA（F-206）：可安装、示例图离线可玩，自动更新
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TinyPuzzle · 在线拼图',
        short_name: 'TinyPuzzle',
        description: '上传一张图片，在浏览器里把它变成你的拼图',
        lang: 'zh-CN',
        theme_color: '#141627',
        background_color: '#141627',
        display: 'standalone',
        start_url: '.',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
