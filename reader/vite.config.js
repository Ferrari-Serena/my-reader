import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue()],
  // 自定义域名（www.ferrari11.com）直接部署在根目录；import.meta.env.BASE_URL 自动为 '/'
  // 旧 GitHub Pages 子路径: 如需恢复 ferari-serena.github.io/my-reader/，改回 '/my-reader/'
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
