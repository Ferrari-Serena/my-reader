import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue()],
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
