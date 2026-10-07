/**
 * BYO 朗读音频 —— 生成后的纯逻辑（第 17 步 · 块 C「网页端生成器」）
 *
 * 口径**照搬 `generator/pipeline/tts.py`**（唯一权威，不要凭记忆改）：
 *   · 采样率 **24000 Hz**（Kokoro 固定输出）
 *   · 段落之间插 **0.35 s** 静音；**段落内**因 510 token 上限切出的块**直接拼接、不插静音**
 *   · 章节**标题也朗读**，排在整章第一段（不记入 timings）—— 与内置书 mp3 内容一致
 *   · `timings = { duration, paragraphs: { 段落id: 起始秒 } }`，秒数一律**两位小数**
 *
 * 为什么这段在浏览器端重做一遍：D17 把合成搬到了用户设备（服务端零算力），
 * 但 timings／音频必须与内置书**同形**，前端（`reader/src/utils/audioIndex.js`、
 * `ReaderView` 的段落定位播放）才能零改动复用。
 *
 * 本文件是**纯函数**（不碰 DOM / 网络 / WebGPU），可直接在 node 里断言（见 verify-generate.mjs）。
 */

export const SAMPLE_RATE = 24000
export const PARAGRAPH_SILENCE_SEC = 0.35
/**
 * 单个 TTS 调用的字符预算。
 * ⚠️ Kokoro 单次上限 **510 token**，而 `kokoro-js` 的 `generate()` 是 `truncation: true`
 * —— 超限**直接截断丢字**（不像 python 的 `pipeline()` 会自动分块）。所以必须先切块，
 * 再逐块 generate，最后段内直接拼接。按字符留足余量（英文约 4 字符/token，留一半）。
 */
export const TTS_CHUNK_CHARS = 400

const round2 = n => Math.round(n * 100) / 100

/** 段内多块（以及静音）的直接拼接（不插静音） */
export function concatF32(parts) {
  const list = (parts || []).filter(a => a && a.length)
  if (!list.length) return new Float32Array(0)
  let n = 0
  for (const a of list) n += a.length
  const out = new Float32Array(n)
  let off = 0
  for (const a of list) { out.set(a, off); off += a.length }
  return out
}

/**
 * 把一段文本切成若干「一次 generate 调用」的块（段内块之间**不插静音**）。
 *   · 先按句末切（. ? ! 及其后的引号/括号）
 *   · 再把整句贪心归并到 ≤ maxChars
 *   · 单句仍超预算 → 退到 , ; : 断；再不行硬切
 * 返回的块顺序拼接即原文（除首尾空白外不丢字符）。
 */
export function splitForTts(text, maxChars = TTS_CHUNK_CHARS) {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!src) return []
  // 预算下限 40：过碎的块会毁掉韵律，也给调用方一个可预期的地板
  const budget = Math.max(40, Number(maxChars) || TTS_CHUNK_CHARS)
  if (src.length <= budget) return [src]

  const sentences = src.match(/[^.!?]+[.!?]+["'\u201d\u2019)\]]*\s*|[^.!?]+$/g) || [src]

  const out = []
  let buf = ''
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = '' }
  for (const raw of sentences) {
    const piece = raw.trim()
    if (!piece) continue
    if (piece.length > budget) {
      flush()
      for (const part of hardSplit(piece, budget)) out.push(part)
      continue
    }
    if ((buf ? buf + ' ' + piece : piece).length > budget) flush()
    buf = buf ? buf + ' ' + piece : piece
  }
  flush()
  return out
}

/** 单句超预算时的退路：优先在 , ; : 后断，仍超则按字符硬切 */
function hardSplit(text, budget) {
  const soft = text.split(/(?<=[,;:])\s+/)
  const out = []
  let buf = ''
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = '' }
  for (const seg of soft) {
    if (seg.length > budget) {
      flush()
      for (let i = 0; i < seg.length; i += budget) {
        const s = seg.slice(i, i + budget).trim()
        if (s) out.push(s)
      }
      continue
    }
    if ((buf ? buf + ' ' + seg : seg).length > budget) flush()
    buf = buf ? buf + ' ' + seg : seg
  }
  flush()
  return out
}

/**
 * 章级拼接（照搬 tts.py 的 `synthesize_chapter`）：
 *   · 段间插 gap 静音；段内块已由调用方 concatF32 拼好，传进来就是一段
 *   · 每段（id 非 null）在**插入静音之后**记录起始秒；标题段 id=null，不记
 * @param {{id: string|null, audio: Float32Array}[]} paragraphs 按顺序（标题在首位、id=null）
 */
export function stitchChapter(paragraphs, {
  sampleRate = SAMPLE_RATE, gapSec = PARAGRAPH_SILENCE_SEC,
} = {}) {
  const sr = sampleRate
  const gap = Math.max(0, Math.round(gapSec * sr))
  const list = (paragraphs || []).filter(p => p && p.audio && p.audio.length)
  const pieces = []
  const offsets = {}
  let n = 0
  for (const p of list) {
    if (pieces.length) {
      if (gap) { pieces.push(new Float32Array(gap)); n += gap }
    }
    if (p.id !== null && p.id !== undefined) offsets[String(p.id)] = round2(n / sr)
    pieces.push(p.audio)
    n += p.audio.length
  }
  return { samples: concatF32(pieces), offsets, duration: round2(n / sr) }
}

/**
 * 一章 → 生成作业清单（标题在前、空段跳过、每段切好块）。
 * @returns {{id:string|null, text:string, chunks:string[]}[]}
 */
export function planChapter(chapter, { readTitle = true, maxChars = TTS_CHUNK_CHARS } = {}) {
  const items = []
  const title = String(chapter?.title ?? '').trim()
  if (readTitle && title) items.push({ id: null, text: title, chunks: splitForTts(title, maxChars) })
  for (const p of chapter?.paragraphs || []) {
    const text = String(p?.text ?? '').trim()
    if (!text) continue
    items.push({ id: p?.id ?? null, text, chunks: splitForTts(text, maxChars) })
  }
  return items.filter(it => it.chunks.length)
}

/** 24 kHz 单声道 16-bit PCM WAV（浏览器下载试听用；上传前还要转 mp3，见块 C2） */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const n = samples ? samples.length : 0
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  ascii(36, 'data'); dv.setUint32(40, n * 2, true)
  let off = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buf
}

/** 音频秒数 ÷ 合成耗时秒数（越大越快；>1 = 比实时快） */
export function realtimeFactor(audioSec, synthMs) {
  if (!(synthMs > 0)) return 0
  return round2(audioSec / (synthMs / 1000))
}

export { round2 }