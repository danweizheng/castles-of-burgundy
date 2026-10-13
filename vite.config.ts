import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// 部署在静态托管的子路径时改这里；用相对路径可以让 GitHub Pages / Cloudflare Pages
// 都能直接工作，不必绑死仓库名。
export default defineConfig({
  base: './',

  plugins: [
    react(),
    VitePWA({
      // 单人游戏：宁可让用户手动确认刷新，也不要在对局中途被自动更新打断
      registerType: 'prompt',
      manifest: {
        name: '勃艮第城堡 · 单人版',
        short_name: '勃艮第',
        description: '单人离线版勃艮第城堡，含 AI 对手',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#16110c',
        theme_color: '#16110c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 全量预缓存：目标是飞机模式下也能完整打完一局，
        // 所以不允许任何运行时才去网络取的关键资源。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
