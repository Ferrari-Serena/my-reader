/**
 * 第 17 步 · 块 D —— kokoro-js 端上合成**共享引擎**（不进主包）
 *
 * 谁在引：① 探针 `reader/kokoro-probe.html`（诊断）；② 阅读器的「生成这一章」面板
 * （GenAudioPanel → **动态** `import()`）。主包只准动态引 —— 见 verify-generate.mjs
 * 的「主包卫生」断言（禁静态 import、放行 `import()`；entry chunk 不得出现
 * kokoro／onnxruntime／lamejs）。
 *
 * 口径与 audioPost.js／tts.py 同源：24 kHz、段间 0.35 s、标题也朗读、段内按
 * TTS_CHUNK_CHARS 切块后直接拼接（kokoro-js 的 generate 是 truncation:true，超限会丢字）。
 *
 * 模型来源：优先本地镜像 `reader/public/models/onnx-community/Kokoro-82M-v1.0-ONNX/`
 * （在 fetch 层重写 HF 地址，见下方镜像段）；镜像不在时自动退回远端 HF。
 */
import { KokoroTTS, env } from 'kokoro-js'
import {
  SAMPLE_RATE, TTS_CHUNK_CHARS,
  planChapter, concatF32, stitchChapter,
} from './audioPost.js'

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const DEFAULT_VOICE = 'af_heart' // D15-b：避开内置书的 am_michael
// 档位白名单按 repo 实际存在的文件定（onnx/ 下只有 model.onnx / model_fp16 / model_q4 /
// model_q4f16 / model_quantized / model_q8f16 / model_uint8 / model_uint8f16）：
// `int8`／`bnb4` **repo 里根本没有**，选了必然 404 → 已剔除。
export const DTYPES_BY_DEVICE = {
  webgpu: ['fp32', 'fp16', 'q4f16', 'q8'],
  wasm: ['q8', 'fp32', 'q4'],
}
// 已镜像到本地的档位，以 reader/public/models/<repo>/onnx/ 下实际落盘的文件为准。
// 本地镜像模式下下拉只列这些，避免选到没镜像的档位（本地 404）。
export const MIRRORED_DTYPES = ['fp16', 'q4f16', 'q8']

// ── 本地模型镜像路由（块 C · dev 用）─────────────────────────────────────────
// 背景：kokoro-js 把**音色** URL 硬编码成 huggingface.co（`env` 改不到），模型本体走
// transformers.js 的 env.remoteHost。最省事的收口是在 fetch 层把该 repo 的 HF 地址一律
// 重写到本地镜像 —— 模型 / tokenizer / config / 音色一并覆盖，且不动 kokoro-js 源码。
// 只拦这一个 repo 前缀；其余请求（含 /api/*）原样放行。镜像不在时什么都不改。
export const HF_REPO_PREFIX = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/'
export const MIRROR_PREFIX = '/models/onnx-community/Kokoro-82M-v1.0-ONNX/'
// onnxruntime-web 的 wasm（emscripten glue ＋ .wasm）默认落在 cdn.jsdelivr.net，且由
// transformers.js 用**动态 import** 取（不走 fetch 拦截）—— 本机实测该 CDN 被 reset
// （ERR_CONNECTION_RESET）。dev 就地从 node_modules 取：Vite 会转译 .mjs，而 public/ 下的
// 文件带 ?import 会被 Vite 判 500（Cannot import a file inside /public）。
// 对外分发（真机／线上）没有 node_modules → 必须先自托管到自己的域名／R2（见 §13.7 待办）。
export const ORT_PREFIX = '/node_modules/onnxruntime-web/dist/'

const now = () => (globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : Date.now())
export const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

let logger = null
/** 注入日志出口（探针写页面 log、面板写 console）；任何时刻都能换。 */
export function setLogger(fn) { logger = (typeof fn === 'function') ? fn : null }
const emit = (msg) => { try { if (logger) logger(msg) } catch { /* 日志出口自己出错不拦主流程 */ } }

let mirrorOn = false
let mirrorPromise = null
let routingInstalled = false

/** 把 HF 上这一个 repo 的请求改写到本地镜像（幂等；只装一次）。 */
export function installMirrorRouting() {
  if (routingInstalled) return
  if (typeof globalThis.fetch !== 'function') return
  routingInstalled = true
  const orig = globalThis.fetch
  globalThis.fetch = function (input, init) {
    let target = input
    try {
      const url = (typeof input === 'string') ? input : ((input && input.url) || '')
      if (mirrorOn && url.startsWith(HF_REPO_PREFIX)) {
        const local = MIRROR_PREFIX + url.slice(HF_REPO_PREFIX.length)
        target = (typeof input === 'string') ? local : new Request(local, input)
        emit('[mirror] ' + url.slice(HF_REPO_PREFIX.length))
      }
    } catch { target = input }
    return orig.call(this, target, init)
  }
}

async function detectMirror() {
  // 用 GET 而不是 HEAD：部分 dev server / CDN 对 HEAD 处理不一致（实测 Vite 下 HEAD
  // 会留一条 ERR_ABORTED）；config.json 只有 44 B，直接 GET 最稳。
  try {
    const r = await fetch(MIRROR_PREFIX + 'config.json')
    mirrorOn = !!r.ok
  } catch { mirrorOn = false }
  // 本地 ORT 源命中就改指本地，否则维持 CDN 默认。
  try {
    const o = await fetch(ORT_PREFIX + 'ort-wasm-simd-threaded.jsep.mjs')
    if (o.ok) env.wasmPaths = ORT_PREFIX
  } catch { /* 无本地 ORT 镜像 → 走默认 CDN */ }
  return mirrorOn
}

/** 探测本地镜像（结果缓存；重复调用同一个 promise —— 面板与探针都靠它幂等）。 */
export function ensureMirror() {
  if (!mirrorPromise) mirrorPromise = detectMirror()
  return mirrorPromise
}

export function mirrorEnabled() { return mirrorOn }

// ── 设备 / 显卡 ─────────────────────────────────────────────────────────────
export function hasWebGPU() { return typeof navigator !== 'undefined' && !!navigator.gpu }

// 当前显卡：WebGL 的 UNMASKED_RENDERER 最接近「人看得懂的那块卡」；
// WebGPU 的 adapter.info 只有 vendor／architecture／device，作补充。
export function glRenderer() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''
  } catch { return '' }
}

export async function describeGpu() {
  const parts = []
  const gl = glRenderer()
  if (gl) parts.push(gl)
  if (hasWebGPU()) {
    try {
      const a = await navigator.gpu.requestAdapter()
      if (!a) parts.push('WebGPU: 无适配器')
      else {
        const i = a.info || {}
        const bits = [i.vendor, i.architecture, i.device, i.description].filter(Boolean)
        parts.push('WebGPU adapter: ' + (bits.length ? bits.join(' / ') : '(无 info 字段)'))
      }
    } catch (e) { parts.push('WebGPU requestAdapter 失败: ' + (e && e.message)) }
  }
  return parts.join(' · ') || '(取不到显卡信息)'
}

/** 设备下拉可选项：有 WebGPU 就优先 webgpu（面板／探针共用同一口径）。 */
export function deviceOptions() { return hasWebGPU() ? ['webgpu', 'wasm'] : ['wasm'] }

/** 某设备下的档位可选项；本地镜像时只列已镜像的档。 */
export function dtypeOptions(device, mirrored = mirrorOn) {
  const all = DTYPES_BY_DEVICE[device] || DTYPES_BY_DEVICE.wasm
  if (!mirrored) return all.slice()
  const list = all.filter(d => MIRRORED_DTYPES.includes(d))
  return list.length ? list : all.slice()
}

// ── 模型 ───────────────────────────────────────────────────────────────────
let tts = null
let modelKey = ''

export function currentTts() { return tts }
export function currentModelKey() { return modelKey }
export function resetModel() { tts = null; modelKey = '' }

/**
 * 加载（或复用同配置的）kokoro-js 实例。**抛错由调用方接**。
 * @param {{device?:string, dtype?:string, onProgress?:Function, force?:boolean}} opts
 * @returns {Promise<{tts:object, device:string, dtype:string, key:string,
 *                    cached:boolean, voices:string[], ms:number}>}
 */
export async function loadModel({ device = 'wasm', dtype = 'q8', onProgress = null, force = false } = {}) {
  await ensureMirror()
  if (mirrorOn && !MIRRORED_DTYPES.includes(dtype)) {
    throw new Error('本地镜像里没有 ' + dtype + ' 档 —— 已镜像：' + MIRRORED_DTYPES.join('/'))
  }
  const key = `${MODEL_ID}|${device}|${dtype}`
  const voicesOf = (m) => Object.keys((m && m.voices) || {})
  if (tts && modelKey === key && !force) {
    return { tts, device, dtype, key, cached: true, voices: voicesOf(tts), ms: 0 }
  }
  emit(`[model] from_pretrained(${MODEL_ID}, device=${device}, dtype=${dtype}) …`)
  const t0 = now()
  const inst = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype, device, progress_callback: onProgress || undefined,
  })
  tts = inst
  modelKey = key
  return { tts: inst, device, dtype, key, cached: false, voices: voicesOf(inst), ms: now() - t0 }
}

// ── 合成一章（不含 mp3 编码／上传 —— 那是 chapterGen 的事）───────────────────
/**
 * @param {{tts:object, chapter:object, voice?:string, readTitle?:boolean,
 *          sampleRate?:number, shouldCancel?:()=>boolean,
 *          onChunk?:(info:object)=>void, onPlan?:(info:object)=>void}} opts
 * @returns {Promise<{samples:Float32Array, offsets:object, duration:number,
 *                    groups:Array, chunks:number, totalChunks:number,
 *                    synthMs:number, cancelled:boolean}>}
 *   onPlan({paragraphs,chunks}) 开工前一次；
 *   onChunk({index,total,paragraphId,chars,ms,seconds,audioLen,elapsedMs}) 每完成一次
 *   generate 调一次（index 从 1 数）—— 面板用它画「i/n ＋ 已用时间」。
 */
export async function generateChapter({
  tts: inst, chapter, voice = DEFAULT_VOICE, readTitle = true,
  sampleRate = SAMPLE_RATE, shouldCancel = null, onChunk = null, onPlan = null,
} = {}) {
  if (!inst) throw new Error('模型未加载')
  if (!chapter) throw new Error('没有章节')
  const items = planChapter(chapter, { readTitle })
  const totalChunks = items.reduce((n, it) => n + it.chunks.length, 0)
  if (onPlan) onPlan({ paragraphs: items.length, chunks: totalChunks })
  const t0 = now()
  let done = 0
  let cancelled = false
  const groups = []
  for (const it of items) {
    if (shouldCancel && shouldCancel()) { cancelled = true; break }
    const parts = []
    for (const chunk of it.chunks) {
      if (shouldCancel && shouldCancel()) { cancelled = true; break }
      const tc = now()
      const raw = await inst.generate(chunk, { voice })
      const audio = (raw && raw.audio) ? raw.audio : new Float32Array(0)
      parts.push(audio)
      done++
      const sr = (raw && raw.sampling_rate) || sampleRate
      if (onChunk) {
        onChunk({
          index: done, total: totalChunks, paragraphId: (it.id === null ? null : it.id),
          chars: chunk.length, ms: now() - tc, audioLen: audio.length,
          seconds: audio.length / sr, elapsedMs: now() - t0,
        })
      }
    }
    if (parts.length) groups.push({ id: it.id, audio: concatF32(parts) })
  }
  const synthMs = now() - t0
  const stitched = stitchChapter(groups, { sampleRate })
  return {
    samples: stitched.samples, offsets: stitched.offsets, duration: stitched.duration,
    groups, chunks: done, totalChunks, synthMs, cancelled,
  }
}