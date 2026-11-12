#!/usr/bin/env node
/**
 * W11-2b · hub 本地音频生成 job（生产化）
 *
 * 输入：~/hub/_scratch/campaigns/<campaignId>/input/book.json（W11-2a 落盘）
 * 输出：~/hub/_archive/audio-campaigns/<campaignId>/<bookId>/
 *   manifest.json / result.json / stats.json / ch-*.mp3 / ch-*.timings.json
 *
 * 用法：
 *   node hub-audio-campaign.mjs --campaign <id> [--input <book.json>] [--voice am_michael]
 *     [--max-chapters 60] [--fail-chapter ch-03] [--delete-input] [--out-root <dir>]
 *
 * 边界：不接 R2／索引；不打印正文；单章 3 次重试；断点续跑按 sha256。
 * 依赖：~/hub/bin/node_modules -> my-reader-deps/reader/node_modules；
 *       代码从 MY_READER_REPO（默认 ~/hub/library/fw/my-reader）导入。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { KokoroTTS, env } from 'kokoro-js'

const HOME = os.homedir()
const HUB = process.env.HUB_ROOT || path.join(HOME, 'hub')
const REPO = process.env.MY_READER_REPO || path.join(HUB, 'library/fw/my-reader')
const MODEL_ROOT = process.env.KOKORO_MODEL_ROOT || path.join(HUB, 'models/kokoro-82m')
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const MODEL_DIR = path.join(MODEL_ROOT, MODEL_ID)
const SCRATCH = process.env.HUB_SCRATCH || path.join(HUB, '_scratch')
const ARCHIVE_ROOT = process.env.HUB_AUDIO_ARCHIVE || path.join(HUB, '_archive/audio-campaigns')
const MAX_CHAPTERS_CAP = 60
const MAX_ATTEMPTS = 3
const VOICES = new Set(['am_michael', 'af_heart'])

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function has(name) { return process.argv.includes(name) }
function die(code, msg) { console.error(msg); process.exit(code) }

if (has('--help') || has('-h')) {
  console.log(`用法：node hub-audio-campaign.mjs --campaign <id> [--input <book.json>] [--voice am_michael|af_heart]
  [--max-chapters 60] [--fail-chapter ch-03] [--delete-input] [--out-root <dir>] [--base-commit <sha>]`)
  process.exit(0)
}

const campaignId = arg('--campaign') || process.env.CAMPAIGN_ID
if (!campaignId || !/^[A-Za-z0-9._-]{1,64}$/.test(campaignId)) {
  die(2, 'BAD_CAMPAIGN_ID：--campaign 必填，且只允许 [A-Za-z0-9._-]{1,64}')
}
const inputPath = arg('--input') || path.join(SCRATCH, 'campaigns', campaignId, 'input/book.json')
const outRoot = path.resolve(arg('--out-root') || ARCHIVE_ROOT)
const failChapter = String(arg('--fail-chapter') || process.env.FAIL_CHAPTER || '')
const baseCommit = arg('--base-commit') || process.env.BASE_COMMIT || 'local'
const maxChapters = Math.min(Math.max(1, Number(arg('--max-chapters') || MAX_CHAPTERS_CAP)), MAX_CHAPTERS_CAP)

if (!fs.existsSync(inputPath)) die(2, `INPUT_MISSING：${inputPath}`)

const book = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const bookId = String(book.bookId || '')
if (!/^[A-Za-z0-9._-]{1,64}$/.test(bookId)) die(2, `BAD_BOOK_ID：${bookId || '(空)'}`)
if (!Array.isArray(book.chapters) || book.chapters.length === 0) die(2, 'BAD_BOOK：chapters 为空')
const voice = String(arg('--voice') || process.env.VOICE || book.voice || 'am_michael')
if (!VOICES.has(voice)) die(2, `BAD_VOICE：${voice}（允许 am_michael / af_heart）`)

const selected = book.chapters.slice(0, maxChapters)
const capped = selected.length < book.chapters.length
const order = selected.map((c) => String(c.id))
const inputSha256 = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex')

const bookDir = path.join(outRoot, campaignId, bookId)
fs.mkdirSync(bookDir, { recursive: true })
const manifestPath = path.join(bookDir, 'manifest.json')
const resultPath = path.join(bookDir, 'result.json')
const statsPath = path.join(bookDir, 'stats.json')
const lockPath = path.join(bookDir, '.lock')

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}
function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, p)
}
function shaFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}
function writeFileAtomic(p, buf) {
  const tmp = `${p}.tmp-${process.pid}`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, p)
}

let lockAcquired = false
function releaseLock() {
  if (!lockAcquired) return
  try { fs.rmSync(lockPath, { force: true }) } catch {}
  lockAcquired = false
}
function acquireLock() {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(lockPath, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      fs.closeSync(fd)
      lockAcquired = true
      return
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let pid = 0
      try { pid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid) || 0 } catch {}
      let alive = false
      if (pid > 0) { try { process.kill(pid, 0); alive = true } catch {} }
      if (!alive) { fs.rmSync(lockPath, { force: true }); continue }
      die(1, `CAMPAIGN_LOCKED：${lockPath}（pid ${pid}）`)
    }
  }
  die(1, `CAMPAIGN_LOCKED：${lockPath}`)
}
process.on('exit', releaseLock)
process.on('SIGINT', () => { releaseLock(); process.exit(130) })
process.on('SIGTERM', () => { releaseLock(); process.exit(143) })

const audioPost = await import(pathToFileURL(path.join(REPO, 'reader/src/generate/audioPost.js')))
const audioEncode = await import(pathToFileURL(path.join(REPO, 'reader/src/generate/audioEncode.js')))
const audioCloud = await import(pathToFileURL(path.join(REPO, 'reader/src/utils/audioCloud.js')))
const { planChapter, stitchChapter, concatF32 } = audioPost
const { encodeMp3, isMp3Header } = audioEncode
const { timingsOf } = audioCloud

const lamePath = path.join(REPO, 'reader/public/vendor/lame.min.js')
if (!fs.existsSync(lamePath)) die(2, `LAME_MISSING：${lamePath}`)
vm.runInThisContext(fs.readFileSync(lamePath, 'utf8'))
const lame = globalThis.lamejs
if (!lame || typeof lame.Mp3Encoder !== 'function') die(2, 'lamejs not loaded')

if (!fs.existsSync(MODEL_DIR)) die(2, `MODEL_MISSING：${MODEL_DIR}`)
env.allowLocalModels = true
env.localModelPath = MODEL_ROOT + path.sep
env.allowRemoteModels = false

const HF_PREFIX = `https://huggingface.co/${MODEL_ID}/resolve/main/`
const origFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  if (url.startsWith(HF_PREFIX)) {
    const rel = decodeURIComponent(url.slice(HF_PREFIX.length).split('?')[0])
    const p = path.join(MODEL_DIR, rel)
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p)
      const type = rel.endsWith('.json') ? 'application/json' : 'application/octet-stream'
      return new Response(buf, { status: 200, headers: { 'content-type': type } })
    }
    return new Response('not found: ' + rel, { status: 404 })
  }
  return origFetch(input, init)
}

acquireLock()

const prevManifest = loadJson(manifestPath, null)
const prevResult = loadJson(resultPath, null)
const manifest = prevManifest || {
  campaignId,
  bookId,
  baseCommit,
  voice,
  model: MODEL_ID,
  dtype: 'fp32',
  createdAt: new Date().toISOString(),
  chapters: [],
}
manifest.campaignId = campaignId
manifest.bookId = bookId
manifest.baseCommit = baseCommit
manifest.voice = voice
manifest.model = MODEL_ID
manifest.dtype = 'fp32'
manifest.inputSha256 = inputSha256

const byChapter = new Map((manifest.chapters || []).map((c) => [String(c.chapterId), c]))
const outputs = Array.isArray(prevResult && prevResult.outputs) ? prevResult.outputs.slice() : []

function writeManifest() {
  manifest.chapters = order.map((id) => byChapter.get(id)).filter(Boolean)
  writeJsonAtomic(manifestPath, manifest)
}
function writeResult() {
  writeJsonAtomic(resultPath, { campaignId, bookId, outDir: bookDir, outputs })
}
function removeOutputs(chapterId) {
  for (let i = outputs.length - 1; i >= 0; i--) {
    if (outputs[i].chapterId === chapterId) outputs.splice(i, 1)
  }
}
function upsertOutputs(chapterId, mp3Rel, timingsRel, mp3Bytes, timingsBytes, sha) {
  removeOutputs(chapterId)
  outputs.push({ kind: 'mp3', path: mp3Rel, sha256: sha, bytes: mp3Bytes, chapterId })
  outputs.push({ kind: 'timings', path: timingsRel, bytes: timingsBytes, chapterId })
}

let processed = 0, skipped = 0, doneNew = 0, failedNew = 0
let failedTotal = 0
let totalSynthMs = 0, totalAudioSec = 0, totalMp3Bytes = 0

const t0 = performance.now()
const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'cpu' })
const loadMs = performance.now() - t0

try {
  for (const chapter of selected) {
    processed++
    const chapterId = String(chapter.id)
    const mp3Path = path.join(bookDir, chapterId + '.mp3')
    const timingsPath = path.join(bookDir, chapterId + '.timings.json')
    const mp3Rel = path.relative(bookDir, mp3Path)
    const timingsRel = path.relative(bookDir, timingsPath)
    const prev = byChapter.get(chapterId)
    if (prev && prev.status === 'done' && fs.existsSync(mp3Path) && fs.existsSync(timingsPath) && shaFile(mp3Path) === prev.sha256) {
      skipped++
      console.log(chapterId, 'skip (resume, sha ok)')
      continue
    }

    let ok = false
    let lastErr = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (failChapter && failChapter === chapterId) throw new Error('forced failure')
        const items = planChapter(chapter)
        const paras = []
        const cs = performance.now()
        for (const it of items) {
          const parts = []
          for (const chunk of it.chunks) {
            const raw = await tts.generate(chunk, { voice, speed: 1 })
            parts.push((raw && raw.audio) ? raw.audio : new Float32Array(0))
          }
          paras.push({ id: it.id, audio: concatF32(parts) })
        }
        const synthMs = performance.now() - cs
        const stitched = stitchChapter(paras)
        const mp3 = encodeMp3(stitched.samples, { lame })
        if (!isMp3Header(mp3)) throw new Error('mp3 header missing for ' + chapterId)
        const mp3Buf = Buffer.from(mp3)
        const timings = timingsOf(stitched)
        const timingsBuf = Buffer.from(JSON.stringify(timings))
        writeFileAtomic(mp3Path, mp3Buf)
        writeFileAtomic(timingsPath, timingsBuf)
        const sha = crypto.createHash('sha256').update(mp3Buf).digest('hex')
        const chars = items.reduce((n, it) => n + it.text.length, 0)
        byChapter.set(chapterId, {
          chapterId, mp3: mp3Rel, timings: timingsRel, sha256: sha,
          bytes: mp3Buf.length, chars, status: 'done', attempts: attempt,
          updatedAt: new Date().toISOString(),
        })
        upsertOutputs(chapterId, mp3Rel, timingsRel, mp3Buf.length, timingsBuf.length, sha)
        writeManifest()
        writeResult()
        totalSynthMs += synthMs
        totalAudioSec += stitched.duration
        totalMp3Bytes += mp3Buf.length
        doneNew++
        console.log(chapterId, 'chars=' + chars, 'audio=' + stitched.duration + 's', 'synth=' + (synthMs / 1000).toFixed(1) + 's', 'mp3=' + mp3Buf.length + 'B', 'attempt=' + attempt)
        ok = true
        break
      } catch (e) {
        lastErr = String((e && e.message) || e)
        console.error(chapterId, 'attempt', attempt, 'failed:', lastErr)
      }
    }

    if (!ok) {
      byChapter.set(chapterId, {
        chapterId, status: 'failed', error: lastErr, attempts: MAX_ATTEMPTS,
        updatedAt: new Date().toISOString(),
      })
      removeOutputs(chapterId)
      writeManifest()
      writeResult()
      failedNew++
      console.log(chapterId, 'FAILED after', MAX_ATTEMPTS, 'attempts')
    }
  }

  writeManifest()
  writeResult()
  const doneTotal = manifest.chapters.filter((c) => c.status === 'done').length
  failedTotal = manifest.chapters.filter((c) => c.status === 'failed').length
  const stats = {
    campaignId,
    bookId,
    voice,
    model: MODEL_ID,
    dtype: 'fp32',
    book_chapters: book.chapters.length,
    max_chapters: maxChapters,
    chapters_total: selected.length,
    capped,
    processed,
    skipped,
    done_new: doneNew,
    failed_new: failedNew,
    done_total: doneTotal,
    failed_total: failedTotal,
    load_ms: Math.round(loadMs),
    synth_ms: Math.round(totalSynthMs),
    audio_sec: +totalAudioSec.toFixed(2),
    rtf: totalAudioSec > 0 ? +(totalSynthMs / 1000 / totalAudioSec).toFixed(3) : 0,
    mp3_bytes: totalMp3Bytes,
    max_rss_mb: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    input_sha256: inputSha256,
    archive_root: outRoot,
    out_dir: bookDir,
    finished_at: new Date().toISOString(),
  }
  writeJsonAtomic(statsPath, stats)
  console.log(JSON.stringify(stats, null, 2))

  if (has('--delete-input')) {
    try { fs.rmSync(inputPath, { force: true }) } catch {}
    try { fs.rmdirSync(path.dirname(inputPath)) } catch {}
  }
} finally {
  releaseLock()
}

process.exit(failedTotal > 0 ? 1 : 0)
