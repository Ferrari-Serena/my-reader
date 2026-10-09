import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

// 构建版本号（反馈诊断用）：CI 上取 commit 短号，本机开发回 'dev'。
// `__APP_VERSION__` 由 vite 在构建时**文本替换** —— 代码里必须用 `typeof` 兜底
// （裸 node 跑单测时这个标识符不存在，见 utils/feedback.js 的 appVersion）。
const BUILD_ID = String(process.env.GITHUB_SHA || '').slice(0, 12) || 'dev'

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID)
  },
  // 自定义域名（my-reader.ferrari11.com）直接部署在根目录；import.meta.env.BASE_URL 自动为 '/'
  // 旧 GitHub Pages 子路径: 如需恢复 ferari-serena.github.io/my-reader/，改回 '/my-reader/'
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // 本地 dev：/api/* 代理到线上 Worker。应用里用的是同源相对路径，没有这段 dev 下点词/朗读全挂。
  server: {
    proxy: {
      '/api': { target: 'https://my-reader.ferrari11.com', changeOrigin: true }
    }
  }
})
