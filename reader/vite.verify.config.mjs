/**
 * 只给**卫生闸**（verify-generate.mjs 的「构建级」一段）用的一次性构建配置 —— 不是生产配置。
 * 生产走 `vite.config.js`；这份与它的差别只有三条，全为了「在一台开发机上跑得起、跑得干净」：
 *
 *   ① `publicDir: false`
 *      生产构建靠 CI 里**没有** `public/models/`（ONNX 镜像 449 MB、已 gitignore）。本机却有 →
 *      不关掉就会把 449 MB 拷进产物（2026-10-07 实测 dist 449.9 MB）。闸只关心 JS chunk，不需要它。
 *   ② `outDir: '.verify-dist'` ＋ `emptyOutDir`
 *      产物落在一个专用目录，闸跑完就删 —— 不碰 `dist`、不留垃圾。
 *   ③ `build.manifest: true`
 *      闸要按 manifest 找**入口 chunk**（而不是猜文件名）。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue()],
  base: '/',
  publicDir: false,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    outDir: '.verify-dist',
    emptyOutDir: true,
    manifest: true
  }
})