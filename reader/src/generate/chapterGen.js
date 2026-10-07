/**
 * 第 17 步（D17／D20）· 块 D —— 「生成一章并上传」的**编排**：合成 → mp3 → 上传。
 *
 * 它把三件重活串成一次用户动作 —— engine（kokoro-js）＋ audioEncode（lamejs 动态加载）
 * ＋ audioUpload（三次 PUT）—— 并把每一步的失败**装成同一个回执形状**，让面板不必知道
 * 底下分了几层：
 *
 *   { ok, step, status, reason, message?, substep?, index?, duration?, mp3Bytes?,
 *     synthMs?, totalChunks?, rtf? }
 *   step ∈ input | model | synth | encode | upload | cancelled | done
 *   失败时 `step` 指向炸在哪一层、`reason` 是短码、`message` 是原话（给人看）。
 *
 * 四条硬口径（别在调用方再写一遍）：
 *   ① **恒不抛**（与 audioUpload／fetchCloudIndex 同姿态）—— 面板一个 try 都不用写；
 *   ② **不静默降级**：设备闸在面板（`audioGenGate.shouldOfferGeneration`，判据 6）。这里默认
 *      `device='webgpu'`／`dtype='fp16'` —— 块 C3 实测最佳档（RTF 0.84 → 平均章 ≈ 17 min）。
 *      没有 WebGPU 就**别调**这个函数；传 wasm 是**显式**选择（探针才这么干）：§13.7
 *      「后端优先 WebGPU，不可用时不静默降级」；
 *   ③ **失败不上传**：合成／编码炸了，连一记 PUT 都不发（索引最后写是 audioUpload 的事）；
 *   ④ **配额与限流不在这里消化**：403／429 原样透出 `status` ＋ `substep`，由面板退回
 *      浏览器 TTS（§13.2 配额口径 —— 不报错、不白屏）。
 *
 * ⚠️ engine.js（kokoro-js）**动态**引，两个理由：① 主包不许静态引本目录（verify-generate.mjs
 * 的卫生断言）；② node 自检要能在**不加载 kokoro-js** 的前提下把编排与失败分流全跑一遍 ——
 * 所以三件重活都留了注入缝（`loadModelFn`／`generateChapterFn`／`encodeFn`），与
 * `fetchImpl` / `时间` 那几处的做法一致。
 */
import { realtimeFactor } from './audioPost.js'
import { encodeMp3, loadLame } from './audioEncode.js'
import { uploadChapterAudio } from './audioUpload.js'
import { timingsOf } from '../utils/audioCloud.js'

/** kokoro-js 那一坨只在真要合成时才拉（见头注 ⚠️） */
let engineMod = null
async function engine() {
  if (!engineMod) engineMod = await import('./engine.js')
  return engineMod
}

const msgOf = (e) => String((e && e.message) || e || '')
const fail = (step, reason, extra) => ({ ok: false, step, status: 0, reason, ...(extra || {}) })

/**
 * @param {{bookId:string, chapterId:string, chapter:object, voice?:string,
 *          device?:string, dtype?:string, tts?:object,
 *          loadModelFn?:Function, generateChapterFn?:Function, encodeFn?:Function,
 *          fetchImpl?:Function, timeoutMs?:number,
 *          onStage?:(stage:string)=>void, onProgress?:Function, onPlan?:Function,
 *          onChunk?:Function, shouldCancel?:()=>boolean}} o
 * @returns {Promise<object>} 见头注；`ok:true` 时带 `index`（合并后的就绪清单，面板据此热切）
 */
export async function generateChapterAudio({
  bookId, chapterId, chapter, voice = '', device = 'webgpu', dtype = 'fp16', tts = null,
  loadModelFn = null, generateChapterFn = null, encodeFn = null,
  fetchImpl = globalThis.fetch, timeoutMs = undefined,
  onStage = null, onProgress = null, onPlan = null, onChunk = null, shouldCancel = null,
} = {}) {
  if (!bookId || !chapterId || !chapter) return fail('input', 'bad-input')
  const stage = (s) => { try { if (onStage) onStage(s) } catch { /* 进度回调自己出错不该毁掉生成 */ } }

  // ① 模型 —— 外部已给实例就跳过（面板复用／探针场景）
  let inst = tts
  if (!inst) {
    stage('model')
    try {
      const load = loadModelFn || (async (o) => (await engine()).loadModel(o))
      const r = await load({ device, dtype, onProgress })
      inst = r && r.tts
      if (!inst) return fail('model', 'model-failed', { message: 'loadModel 没回实例' })
    } catch (e) {
      return fail('model', 'model-failed', { message: msgOf(e) })
    }
  }

  // ② 合成 —— 切块／段间静音／timings 口径全在 engine，这里不重复
  stage('synth')
  let stitched
  try {
    const gen = generateChapterFn || (async (o) => (await engine()).generateChapter(o))
    const args = { tts: inst, chapter, onPlan, onChunk, shouldCancel }
    if (voice) args.voice = voice // 空串 → 不传：让 engine 用它自己的 DEFAULT_VOICE（音色常量只有一份）
    stitched = await gen(args)
  } catch (e) {
    return fail('synth', 'synth-failed', { message: msgOf(e) })
  }
  const dur = (stitched && stitched.duration) || 0
  if (stitched && stitched.cancelled) return fail('cancelled', 'cancelled', { duration: dur })
  if (!stitched || !stitched.samples || !stitched.samples.length) {
    return fail('synth', 'empty-audio', { duration: dur })
  }

  // ③ mp3 —— lamejs 原样副本（动态加载全局），48 kbps 就是上传口径
  stage('encode')
  let mp3
  try {
    const enc = encodeFn || (async (samples) => encodeMp3(samples, { lame: await loadLame() }))
    mp3 = await enc(stitched.samples)
  } catch (e) {
    return fail('encode', 'encode-failed', { message: msgOf(e) })
  }
  if (!mp3 || !mp3.byteLength) return fail('encode', 'empty-audio')

  // ④ 上传 —— mp3 → timings → GET 索引 → 合并 → PUT 索引（索引最后写是 audioUpload 的硬约定）
  stage('upload')
  const up = await uploadChapterAudio({
    bookId, chapterId, mp3, timings: timingsOf(stitched), fetchImpl, timeoutMs,
  })
  if (!up.ok) return fail('upload', up.reason, { status: up.status, substep: up.step })

  return {
    ok: true, step: 'done', status: up.status || 200, reason: '',
    index: up.index, duration: dur, mp3Bytes: mp3.byteLength,
    synthMs: stitched.synthMs, totalChunks: stitched.totalChunks,
    rtf: realtimeFactor(dur, stitched.synthMs),
  }
}