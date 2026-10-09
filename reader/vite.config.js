import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'
import { readFileSync } from 'node:fs'

// 构建版本号（反馈诊断用）：CI 上取 commit 短号，本机开发回 'dev'。
// `__APP_VERSION__` 由 vite 在构建时**文本替换** —— 代码里必须用 `typeof` 兜底
// （裸 node 跑单测时这个标识符不存在，见 utils/feedback.js 的 appVersion）。
const BUILD_ID = String(process.env.GITHUB_SHA || '').slice(0, 12) || 'dev'

// 第 14 步 块 A：Service Worker 的壳预缓存清单在**构建期**注入（源码里的两个占位符见 sw.js 头部）。
// 清单只放「壳」：产物 chunk ＋ 图标/清单 ＋ phrases.json；书 JSON 与音频走运行时按需缓存。
const SW_TEMPLATE = new URL('./sw.js', import.meta.url)
const PUBLIC_SHELL = [
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/data/phrases.json'
]

function mrSwPrecache() {
  return {
    name: 'mr-sw-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = new Set(PUBLIC_SHELL)
      for (const [name, out] of Object.entries(bundle)) {
        if (/\.(js|css|html)$/.test(name)) files.add('/' + name)
        else if (out.type === 'asset' && /\.(svg|png|json)$/.test(name)) files.add('/' + name)
      }
      const source = readFileSync(SW_TEMPLATE, 'utf8')
      for (const token of ['__SW_BUILD__', '__SW_PRECACHE__']) {
        const hits = source.split(token).length - 1
        if (hits !== 1) {
          this.error(`sw.js 模板的 ${token} 必须恰好出现 1 次（实得 ${hits}）—— 多了会注错地方（比如注进注释），少了等于没注入`)
        }
      }
      const rendered = source
        .replace('__SW_BUILD__', BUILD_ID)
        .replace('__SW_PRECACHE__', JSON.stringify([...files].sort(), null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: rendered })
    }
  }
}

export default defineConfig({
  plugins: [vue(), mrSwPrecache()],
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
