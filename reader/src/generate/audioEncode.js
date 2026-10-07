/**
 * 第 17 步 · 块 C2 —— WAV(PCM) → mp3 编码（48 kbps CBR）
 *
 * 为什么单列一个文件：`lamejs` 是 **LGPL-3.0**，而本仓库是专有（All rights reserved）。
 * Ferrari 2026-10-06 裁 **选项 B**：把 lamejs 当**独立、未改动**的文件用，**运行时动态加载**，
 * 不打包进主包 —— 这是「使用者可替换该库」的最小边界。落地就三点：
 *   1. 仓库只存原样副本 `reader/public/vendor/lame.min.js`（与 `node_modules/lamejs/lame.min.js`
 *      逐字节相同；verify-generate.mjs 有「未改动」断言）；
 *   2. 浏览器里 `loadLame()` 用 <script> 动态取回全局 `lamejs`（`public/` 原样进 dist，不转译）；
 *   3. 本文件只碰 `globalThis.lamejs`，**不 import 那个包** —— 打包器无从把它并进主包。
 *
 * ⚠️ 为什么取原样副本、而不是 `import('lamejs')`：npm 包的 main（`src/js/index.js`）在 node 下
 *   **必炸** —— `src/js/Lame.js` 引用全局 `MPEGMode` 却从没 require 它（`ReferenceError:
 *   MPEGMode is not defined`，2026-10-07 实测）。能跑的只有合并后的 `lame.min.js` / `lame.all.js`。
 *   所以「独立未改动文件 ＋ 动态加载」既是许可边界，也是**唯一能用的取法**。
 *
 * 口径与内置书一致：**单声道 24 kHz / 48 kbps CBR**（`generator/pipeline/tts.py` 出的内置 mp3
 * 也是 48 kbps）。48 kbps 一章（约 12–13 min）≈ 5 MB，R2 免费 10 GB 够约 2,000 章；
 * 未编码的 WAV 一章 ≈ 62 MB，只够约 160 章 —— 见 Phase1 §13.2。
 */
import { SAMPLE_RATE } from './audioPost.js'

export const MP3_KBPS = 48
/** 原样副本的公开路径（Vite 把 `public/` 原样拷进 dist） */
export const LAME_VENDOR_PATH = '/vendor/lame.min.js'
/** lamejs 一次 encodeBuffer 最多吃 1152 个样本（与库内 maxSamples 初值同源） */
export const FRAME_SAMPLES = 1152

let lamePromise = null

/**
 * 动态取回 lamejs（浏览器）。解析出带 Mp3Encoder 的全局对象。
 * 失败的 promise **不缓存** —— 否则一次网络抖动会让本次会话永久起不来。
 */
export function loadLame({ src = LAME_VENDOR_PATH, doc = globalThis.document } = {}) {
  const existing = globalThis.lamejs
  if (existing && existing.Mp3Encoder) return Promise.resolve(existing)
  if (lamePromise) return lamePromise
  lamePromise = new Promise((resolve, reject) => {
    if (!doc || typeof doc.createElement !== 'function') {
      reject(new Error('loadLame: 没有 document —— node 下请把实现注入 encodeMp3({ lame })'))
      return
    }
    const s = doc.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => {
      const L = globalThis.lamejs
      if (L && L.Mp3Encoder) resolve(L)
      else reject(new Error('loadLame: ' + src + ' 已加载但全局 lamejs 缺失'))
    }
    s.onerror = () => reject(new Error('loadLame: 加载失败 ' + src))
    ;(doc.head || doc.documentElement).appendChild(s)
  })
  lamePromise.catch(() => { lamePromise = null })
  return lamePromise
}

/** Float32 [-1,1] → Int16 PCM（夹幅与 audioPost.encodeWav 同一口径） */
export function toInt16(samples) {
  const n = samples ? samples.length : 0
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function concatBytes(parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

/**
 * 24 kHz 单声道 PCM → mp3 字节。
 * @param {Float32Array} samples
 * @param {{sampleRate?:number, kbps?:number, lame?:{Mp3Encoder:Function}}} [opts]
 *   `lame` 注入实现（node 测试用）；省略则取 `globalThis.lamejs`（浏览器，先 await loadLame()）。
 * @returns {Uint8Array}
 */
export function encodeMp3(samples, { sampleRate = SAMPLE_RATE, kbps = MP3_KBPS, lame = null } = {}) {
  const L = lame || globalThis.lamejs
  if (!L || typeof L.Mp3Encoder !== 'function') {
    throw new Error('encodeMp3: lamejs 未就绪（浏览器先 await loadLame()；node 传 opts.lame）')
  }
  const pcm = toInt16(samples)
  const enc = new L.Mp3Encoder(1, sampleRate, kbps)
  const parts = []
  for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) {
    const frame = enc.encodeBuffer(pcm.subarray(i, i + FRAME_SAMPLES))
    if (frame && frame.length) parts.push(new Uint8Array(frame))
  }
  const tail = enc.flush()
  if (tail && tail.length) parts.push(new Uint8Array(tail))
  return concatBytes(parts)
}

/** mp3 帧同步头（0xFF Ex）：产物「是不是一路 mp3」的最省事判据 */
export function isMp3Header(bytes) {
  return !!(bytes && bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
}