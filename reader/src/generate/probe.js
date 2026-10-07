/**
 * 第 17 步 · 块 C／D —— kokoro-js 网页端生成**探针**（不进主包）
 *
 * 只被 `reader/kokoro-probe.html` 引用；主应用一行都不引 kokoro-js
 * （见 verify-generate.mjs 的「主包卫生」断言）。用途：在真机上量
 * 「能不能跑 / 跑多快 / 吃多少内存」，并把一章合成成与内置书同形的音频 ＋ timings。
 *
 * 块 D 起：合成逻辑（镜像路由／模型加载／逐 chunk 合成）已抽到 `./engine.js`，
 * 本文件只剩「页面接线」—— 阅读器的「生成这一章」面板与探针共用同一份引擎。
 *
 * 口径（与 audioPost.js / tts.py 同源）：24 kHz、段间 0.35 s、标题也朗读、
 * 段内按 TTS_CHUNK_CHARS 切块后直接拼接（kokoro-js 的 generate 是 truncation:true，超限会丢字）。
 *
 * 块 C2 已接：mp3 编码（`lamejs` 原样副本 `/vendor/lame.min.js` 动态加载，48 kbps）—— 本页
 * 除了 WAV／timings，还出一份 mp3 并显示体积（「一章到底多大」）。上传 UI 归块 D 的面板。
 */
import {
  SAMPLE_RATE, planChapter, encodeWav, realtimeFactor,
} from './audioPost.js'
import { MP3_KBPS, encodeMp3, loadLame } from './audioEncode.js'
import {
  DEFAULT_VOICE, MIRRORED_DTYPES,
  installMirrorRouting, ensureMirror, mirrorEnabled, setLogger,
  hasWebGPU, describeGpu, deviceOptions, dtypeOptions,
  loadModel as loadKokoro, currentTts, generateChapter, mb,
} from './engine.js'

const FALLBACK_BOOKS = [
  { id: 'dr-jekyll-and-mr-hyde', title: 'The Strange Case of Dr Jekyll and Mr Hyde' },
  { id: 'sat-practice', title: 'SAT Vocabulary Practice' },
]

const $ = (id) => document.getElementById(id)
const setText = (id, s) => { const e = $(id); if (e) e.textContent = s }
const logLines = []
function log(msg) {
  logLines.push(msg)
  const el = $('log')
  if (el) { el.textContent = logLines.join('\n'); el.scrollTop = el.scrollHeight }
}

let bookData = null      // { title, chapters: [{id,title,paragraphs}] }
let chapter = null       // { id, title, paragraphs }
let busy = false
let cancelled = false
let wavUrl = '', timingsUrl = '', mp3Url = ''

// ── ① 设备闸 ────────────────────────────────────────────────────────────────
function fillSelect(el, values, pick) {
  if (!el) return
  el.innerHTML = ''
  for (const v of values) {
    const o = document.createElement('option')
    o.value = String(v.value ?? v)
    o.textContent = String(v.label ?? v)
    el.appendChild(o)
  }
  if (pick !== undefined) el.value = String(pick)
}

function detectDevice() {
  const gpu = hasWebGPU()
  setText('deviceStatus', gpu
    ? 'WebGPU: 可用（navigator.gpu 存在）→ 优先 webgpu'
    : 'WebGPU: 不可用（无 navigator.gpu）→ 只能 wasm（会明显更慢）')
  $('deviceStatus').className = 'mono ' + (gpu ? 'ok' : 'warn')
  const devices = deviceOptions()
  fillSelect($('deviceSel'), devices, devices[0])
  refreshDtypes()
  setText('gpuStatus', '当前显卡：读取中…')
  describeGpu().then((s) => { setText('gpuStatus', '当前显卡：' + s); log('[gpu] ' + s) })
  log(`[device] webgpu=${gpu} · ua=${navigator.userAgent}`)
}

function refreshDtypes() {
  const use = dtypeOptions($('deviceSel').value)
  fillSelect($('dtypeSel'), use, use[0])
}

// ── ② 模型加载 ──────────────────────────────────────────────────────────────
function onProgress(p) {
  if (!p) return
  if (p.status === 'progress' && p.total) {
    const pct = ((p.loaded / p.total) * 100).toFixed(0)
    setText('modelStatus', `下载 ${p.file || ''} ${pct}%  (${mb(p.loaded)}/${mb(p.total)})`)
  } else if (p.status) {
    setText('modelStatus', `${p.status} ${p.file || ''}`)
  }
}

async function loadModel() {
  if (busy) return
  const device = $('deviceSel').value
  const dtype = $('dtypeSel').value
  if (mirrorEnabled() && !MIRRORED_DTYPES.includes(dtype)) {
    setText('modelStatus', '❌ 本地镜像里没有 ' + dtype + ' 档 —— 已镜像：' + MIRRORED_DTYPES.join('/'))
    return
  }
  busy = true
  $('loadModelBtn').disabled = true
  $('genBtn').disabled = true
  setText('modelStatus', '加载中…（首次要下模型权重，之后走浏览器缓存）')
  try {
    const r = await loadKokoro({ device, dtype, onProgress })
    if (r.cached) {
      log('[model] 已是当前配置，跳过')
      refreshGenBtn()
      return
    }
    const voices = r.voices.length ? r.voices : [DEFAULT_VOICE]
    fillSelect($('voiceSel'), voices, voices.includes(DEFAULT_VOICE) ? DEFAULT_VOICE : voices[0])
    const secs = (r.ms / 1000).toFixed(1)
    setText('modelStatus', `✅ 就绪 · ${secs}s · device=${device} dtype=${dtype} · ${voices.length} 个 voice`)
    log(`[model] 就绪 ${secs}s，voices=${voices.length}`)
    refreshGenBtn()
  } catch (e) {
    setText('modelStatus', '❌ 加载失败：' + (e && e.message))
    log('[model] 失败 ' + (e && e.stack || e))
  } finally {
    busy = false
    $('loadModelBtn').disabled = false
  }
}

// ── ③ 选章 ──────────────────────────────────────────────────────────────────
async function loadBuiltinBooks() {
  let books = FALLBACK_BOOKS
  try {
    const r = await fetch('/books/book-index.json')
    if (r.ok) {
      const j = await r.json()
      if (Array.isArray(j.books) && j.books.length) books = j.books.map(b => ({ id: b.id, title: b.title }))
    }
  } catch { /* 用兜底清单 */ }
  fillSelect($('bookSel'), books.map(b => ({ value: b.id, label: `${b.title} (${b.id})` })))
}

async function loadByoBooks() {
  try {
    const mod = await import('../storage/bookAdapter.js')
    const metas = await mod.listByoBooks()
    if (!metas.length) { fillSelect($('byoSel'), [{ value: '', label: '（本机没有 BYO 书）' }]); return }
    fillSelect($('byoSel'), metas.map(m => ({ value: m.bookId, label: `${m.title || 'Untitled'} (${m.bookId})` })))
  } catch (e) {
    fillSelect($('byoSel'), [{ value: '', label: '（读本机书库失败）' }])
    log('[byo] ' + (e && e.message))
  }
}

async function fetchBuiltinBookData(bookId) {
  const r = await fetch(`/books/${bookId}/chapters.json`)
  if (!r.ok) throw new Error(`chapters.json ${r.status}`)
  const j = await r.json()
  return { title: j.title, chapters: j.chapters || [] }
}

async function loadByoBookData(bookId) {
  const mod = await import('../storage/bookAdapter.js')
  const rec = await mod.loadBook(bookId)
  if (!rec) throw new Error('本机没有这本书')
  return { title: rec.title, chapters: rec.chapters || [] }
}

function pasteChapter() {
  const raw = String($('pasteText').value || '').trim()
  if (!raw) throw new Error('粘贴框是空的')
  const blocks = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  const title = blocks.length > 1 ? '' : ''
  return {
    title,
    paragraphs: blocks.map((text, i) => ({ id: `p-${String(i + 1).padStart(3, '0')}`, text })),
  }
}

async function loadChapterData() {
  const source = $('sourceSel').value
  if (source === 'paste') return pasteChapter()
  if (source === 'builtin') {
    const id = $('bookSel').value
    bookData = await fetchBuiltinBookData(id)
  } else {
    const id = $('byoSel').value
    if (!id) throw new Error('先选一本 BYO 书')
    bookData = await loadByoBookData(id)
  }
  fillSelect($('chapterSel'), bookData.chapters.map((c, i) => ({ value: String(i), label: `${c.id} — ${c.title || ''}` })))
  return bookData.chapters[0]
}

async function loadChapter() {
  try {
    chapter = await loadChapterData()
    if (!chapter) throw new Error('这本书没有章节')
    const items = planChapter(chapter, { readTitle: true })
    const paras = items.filter(it => it.id !== null).length
    const chunks = items.reduce((n, it) => n + it.chunks.length, 0)
    setText('chapterInfo', `章：${chapter.id || '(paste)'} — ${chapter.title || ''}\n段落 ${paras} · 合成调用 ${chunks} 次（标题单独一次）`)
    log(`[chapter] ${chapter.id || 'paste'} · 段落 ${paras} · 调用 ${chunks}`)
    refreshGenBtn()
  } catch (e) {
    chapter = null
    setText('chapterInfo', '❌ ' + (e && e.message))
    refreshGenBtn()
  }
}

// ── ④ 生成 ──────────────────────────────────────────────────────────────────
function refreshGenBtn() { $('genBtn').disabled = busy || !currentTts() || !chapter }

async function generate() {
  if (busy || !currentTts() || !chapter) return
  busy = true; cancelled = false
  $('genBtn').disabled = true; $('cancelBtn').disabled = false; $('loadModelBtn').disabled = true
  const voice = $('voiceSel').value || DEFAULT_VOICE
  const startHeap = heapMB()
  try {
    const stitched = await generateChapter({
      tts: currentTts(), chapter, voice,
      onPlan: ({ paragraphs, chunks }) => log(`[gen] voice=${voice} · 段落 ${paragraphs} · 调用 ${chunks}`),
      onChunk: ({ index, total, paragraphId, chars, ms, seconds, elapsedMs }) => {
        log(`  ${paragraphId ?? '(标题)'} [${index}/${total}] ${chars}c → ${seconds.toFixed(1)}s 音频 / ${ms.toFixed(0)}ms`)
        setText('genStatus', `生成中 ${index}/${total} 调用 · 已 ${(elapsedMs / 1000).toFixed(0)}s · heap ${heapMB()} MB`)
      },
      shouldCancel: () => cancelled,
    })

    // 试听
    const wav = encodeWav(stitched.samples, SAMPLE_RATE)
    if (wavUrl) URL.revokeObjectURL(wavUrl)
    wavUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    $('audio').src = wavUrl

    // timings（与内置书同形）
    const timings = { duration: stitched.duration, paragraphs: stitched.offsets }
    if (timingsUrl) URL.revokeObjectURL(timingsUrl)
    const tj = new Blob([JSON.stringify(timings)], { type: 'application/json' })
    timingsUrl = URL.createObjectURL(tj)
    const dlT = $('dlTimings'); dlT.href = timingsUrl; dlT.download = `${chapter.id || 'chapter'}.timings.json`; dlT.hidden = false
    const dlW = $('dlWav'); dlW.href = wavUrl; dlW.download = `${chapter.id || 'chapter'}.wav`; dlW.hidden = false

    // mp3（块 C2）：走原样副本 /vendor/lame.min.js 动态加载的 lamejs（LGPL 边界，选项 B），
    // 48 kbps 就是上传口径 —— 这里量的是「一章到底多大」。
    let mp3Bytes = 0
    try {
      const tEnc = performance.now()
      const lame = await loadLame()
      const mp3 = encodeMp3(stitched.samples, { lame })
      mp3Bytes = mp3.length
      if (mp3Url) URL.revokeObjectURL(mp3Url)
      mp3Url = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }))
      const dlM = $('dlMp3'); dlM.href = mp3Url; dlM.download = `${chapter.id || 'chapter'}.mp3`; dlM.hidden = false
      log(`[mp3] ${MP3_KBPS} kbps · ${mb(mp3.length)} · 编码 ${(performance.now() - tEnc).toFixed(0)}ms`)
    } catch (e) {
      log('[mp3] 编码失败（不影响 WAV 试听）：' + (e && e.message))
    }

    const rtf = realtimeFactor(stitched.duration, stitched.synthMs)
    setText('genStatus', stitched.cancelled ? '已取消（以下是已生成部分）' : '✅ 完成')
    setText('metrics',
      `音频 ${stitched.duration.toFixed(1)}s (${(stitched.duration / 60).toFixed(1)} min) · WAV ${mb(wav.byteLength)} · mp3 ${mp3Bytes ? mb(mp3Bytes) : '—'}\n` +
      `合成 ${(stitched.synthMs / 1000).toFixed(1)}s · 实时倍率 ${rtf}× （>1 = 比实时快）\n` +
      `段落 timings ${Object.keys(stitched.offsets).length} 条 · heap ${startHeap} → ${heapMB()} MB\n` +
      `device=${$('deviceSel').value} dtype=${$('dtypeSel').value} voice=${voice}`)
    log(`[gen] 完成：音频 ${stitched.duration}s · 合成 ${(stitched.synthMs / 1000).toFixed(1)}s · ${rtf}×`)
  } catch (e) {
    setText('genStatus', '❌ 生成失败：' + (e && e.message))
    log('[gen] 失败 ' + (e && e.stack || e))
  } finally {
    busy = false
    $('cancelBtn').disabled = true; $('loadModelBtn').disabled = false
    refreshGenBtn()
  }
}

function heapMB() {
  const m = performance.memory
  return m ? (m.usedJSHeapSize / 1048576).toFixed(0) : 'n/a'
}

// ── 事件绑定 + 启动 ─────────────────────────────────────────────────────────
function bind() {
  $('deviceSel').addEventListener('change', refreshDtypes)
  $('loadModelBtn').addEventListener('click', loadModel)
  $('loadChapterBtn').addEventListener('click', loadChapter)
  $('genBtn').addEventListener('click', generate)
  $('cancelBtn').addEventListener('click', () => { cancelled = true; log('[gen] 取消请求已发出') })
  $('sourceSel').addEventListener('change', () => {
    const s = $('sourceSel').value
    $('builtinWrap').hidden = s !== 'builtin'
    $('byoWrap').hidden = s !== 'byo'
    $('pasteWrap').hidden = s !== 'paste'
    $('chapterSel').innerHTML = ''
    chapter = null; refreshGenBtn()
  })
}

/**
 * headless 自跑钩子：`?auto=1&device=wasm&dtype=q8&text=Hello.`
 * 只需要一次最小合成，把读数写进 <html data-probe-result>，供命令行探活（不改 UI 行为）。
 */
async function autoRun() {
  const q = new URLSearchParams(location.search)
  if (q.get('auto') !== '1') return
  try {
    const dev = q.get('device') || 'wasm'
    const dt = q.get('dtype') || 'q8'
    $('deviceSel').value = dev
    refreshDtypes()
    $('dtypeSel').value = dt
    document.documentElement.dataset.probeAuto = 'loading'
    await loadModel()
    const inst = currentTts()
    if (!inst) throw new Error('模型未就绪（见 #modelStatus）')
    const text = q.get('text') || 'Hello from the my-reader audio probe.'
    const t0 = performance.now()
    const raw = await inst.generate(text, { voice: $('voiceSel').value || DEFAULT_VOICE })
    const ms = performance.now() - t0
    const samples = raw && raw.audio ? raw.audio : new Float32Array(0)
    const wav = encodeWav(samples, (raw && raw.sampling_rate) || SAMPLE_RATE)
    document.documentElement.dataset.probeResult =
      `ok samples=${samples.length} sr=${raw && raw.sampling_rate} ms=${ms.toFixed(0)} wavBytes=${wav.byteLength}`
  } catch (e) {
    document.documentElement.dataset.probeError = String((e && e.message) || e)
  }
}

async function main() {
  setLogger(log)
  installMirrorRouting()
  bind()
  detectDevice()
  // 就绪信号：模块图（含 kokoro-js）已加载并执行 —— 先于书单加载，便于 headless 探活
  document.documentElement.dataset.probeReady = '1'
  const onMirror = await ensureMirror()
  refreshDtypes()
  log(onMirror
    ? '[mirror] 本地模型镜像已启用（离线跑；档位只列已镜像的）'
    : '[mirror] 未发现本地镜像 → 走远端 HF（首次下 90 MB+，国内可能很慢）')
  await loadBuiltinBooks()
  await loadByoBooks()
  log('[probe] 就绪。步骤：① 加载模型 → ② 载入章节 → ③ 生成。')
  await autoRun()
}

main().catch((e) => {
  log('[probe] 启动失败 ' + (e && e.stack || e))
  document.documentElement.dataset.probeError = String(e && e.message || e)
})