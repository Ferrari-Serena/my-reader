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

// 入口与产物目录由**环境变量**给（2026-10-08 第 17 步块 D-1）：
// 卫生闸要比「app 入口的图」与「对照入口的图」两侧 —— 但**不能**塞进同一次构建：
// 实测两个 HTML 入口会**共享 chunk**（kokoro 被塞进 probe chunk，而 app 入口静态
// `import` 了它 ⇒ app 白下 2.2 MB）。所以改成跑两次构建、各查各的图。
const ENTRY = process.env.VERIFY_ENTRY || 'index.html'
const OUT_DIR = process.env.VERIFY_OUT || '.verify-dist'

export default defineConfig({
  plugins: [vue()],
  base: '/',
  publicDir: false,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    manifest: true,
    // ④ 单一入口，由 VERIFY_ENTRY 指定（默认 app 的 index.html；卫生闸另跑一次对照入口
    //   `kokoro-probe.html` —— 那是 dev 探针页，用 `src/generate/probe.js` → engine.js／
    //   audioEncode.js，是「生成器真能被打进产物」的正控载体）。
    rollupOptions: { input: ENTRY }
  }
})