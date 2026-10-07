/**
 * 第 17 步 · 块 C —— 生成后处理纯逻辑验证（不依赖浏览器）
 *   audioPost.js — 段内切块 / 段间静音拼接 / timings / WAV 编码
 *   audioEncode.js — WAV(PCM) → mp3 48 kbps（lamejs 原样副本 ＋ 动态加载，选项 B）
 *   audioUpload.js — mp3／timings／索引三次 PUT（接块 B 的 /api/book/ 契约）
 * 口径唯一权威 = generator/pipeline/tts.py（24 kHz、段间 0.35 s、标题朗读、秒数两位小数）。
 * 用法: node verify-generate.mjs
 */

import {
  SAMPLE_RATE, PARAGRAPH_SILENCE_SEC, TTS_CHUNK_CHARS,
  splitForTts, concatF32, stitchChapter, planChapter, encodeWav, realtimeFactor, round2,
} from './src/generate/audioPost.js'
import {
  MP3_KBPS, LAME_VENDOR_PATH, FRAME_SAMPLES, encodeMp3, toInt16, loadLame, isMp3Header,
} from './src/generate/audioEncode.js'
import {
  AUDIO_ROUTE, chapterAudioPath, bookIndexPath, timingsOf, mergeAudioIndex, uploadChapterAudio,
} from './src/generate/audioUpload.js'
import {
  detectWebGPU, shouldOfferGeneration, GEN_REASON_HINT, GEN_NOTES, GEN_SCOPE_NOTE,
  GEN_ESTIMATE_NOTE, GEN_ESTIMATE_MINUTES, chapterToken, staleReply, pendingCheckUrl,
  stillPending, estimateRemainingMs, formatEta,
} from './src/generate/audioGenGate.js'
import { generateChapterAudio } from './src/generate/chapterGen.js'
import { chapterHasAudio } from './src/utils/audioIndex.js'
import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const in_dir = 'src/generate/'

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ═══ 常量（与 tts.py 对齐）═══
console.log('\n[audioPost — 常量与 tts.py 同源]')
t('采样率 = 24000', SAMPLE_RATE === 24000)
t('段间静音 = 0.35 s', PARAGRAPH_SILENCE_SEC === 0.35)
t('段内切块预算 = 400 字符（510 token 上限留余量）', TTS_CHUNK_CHARS === 400)
t('round2 两位小数', round2(12.344) === 12.34 && round2(12.346) === 12.35 && round2(2.5) === 2.5)

// ═══ splitForTts ═══
console.log('\n[audioPost — splitForTts：段内切块（超 510 token 会被 kokoro-js 静默截断）]')
t('空串 → []', eq(splitForTts('', 20), []))
t('短文本整段一块', eq(splitForTts('Hello world.', 20), ['Hello world.']))
{
  const src = 'Alpha bravo charlie delta echo. Foxtrot golf hotel india. Juliett kilo lima mike.'
  const chunks = splitForTts(src, 40)
  t('按句归并：三句各成一块（合并会超预算）', chunks.length === 3)
  t('每块不超预算', chunks.every(c => c.length <= 40))
  t('拼回来不丢词（按空白归一）', chunks.join(' ') === src)
}
{
  const src = 'z'.repeat(200) + '.'
  const chunks = splitForTts(src, 40)
  t('无标点长句 → 硬切，每块 ≤ 40 且 ≥ 5 块', chunks.every(c => c.length <= 40) && chunks.length >= 5)
  t('硬切按字符精确，拼回原文一字不差', chunks.join('') === src)
}
{
  // 单句超预算 → 退到逗号断；仍超 → 硬切
  const one = 'a'.repeat(50) + ', ' + 'b'.repeat(50) + ', ' + 'c'.repeat(50) + '.'
  const chunks = splitForTts(one, 60)
  t('单句超预算 → 拆到逗号处', chunks.length >= 3 && chunks.every(c => c.length <= 60))
  t('逗号处的片段被保留', chunks.join(' ').includes('b'.repeat(50)))
}
{
  const src = 'x'.repeat(1000) + '.'
  const chunks = splitForTts(src, 100)
  t('无标点长串 → 硬切且每块 ≤ 100', chunks.every(c => c.length <= 100) && chunks.length >= 10)
}
t('预算下限 40 生效（传 5 也按 40）', splitForTts('y'.repeat(200) + '.', 5).every(c => c.length <= 40))
{
  const chunks = splitForTts('  多  空  白\t换行\n也要归一 ', 400)
  t('空白归一成单空格', chunks.length === 1 && chunks[0] === '多 空 白 换行 也要归一')
}

// ═══ concatF32 ═══
console.log('\n[audioPost — concatF32：段内直接拼接（不插静音）]')
{
  const out = concatF32([new Float32Array([1, 2]), null, new Float32Array([3])])
  t('拼成长度 = 各段之和', out.length === 3)
  t('顺序保留', eq([...out], [1, 2, 3]))
  t('空输入 → 长度 0', concatF32([]).length === 0 && concatF32(null).length === 0)
}

// ═══ stitchChapter ═══
console.log('\n[audioPost — stitchChapter：段间插静音、标题不记 timings]')
{
  const A = (n, v = 0) => new Float32Array(n).fill(v)
  const r = stitchChapter([
    { id: null, audio: A(100) },   // 标题
    { id: 'p1', audio: A(200) },
    { id: 'p2', audio: A(50) },
  ], { sampleRate: 1000, gapSec: 0.35 })

  t('总长 = 100 + 350 + 200 + 350 + 50', r.samples.length === 1050)
  t('标题不产生 timings 项', !('null' in r.offsets) && Object.keys(r.offsets).length === 2)
  t('p1 起点 = 插静音后（0.45 s）', r.offsets.p1 === 0.45)
  t('p2 起点 = 1 s', r.offsets.p2 === 1)
  t('duration = 1050/1000 = 1.05', r.duration === 1.05)
  t('静音段确实是 0（未把音频写进静音位）', r.samples[100] === 0 && r.samples[449] === 0)
  t('p1 音频从 450 开始', r.samples[450] === 200 - 200) // A(200) 填 0
}
{
  const A = (n, v) => new Float32Array(n).fill(v)
  const r = stitchChapter([{ id: 'only', audio: A(24000, 1) }], { sampleRate: 24000, gapSec: 0.35 })
  t('单段不插静音', r.samples.length === 24000 && r.offsets.only === 0)
  t('duration 两位小数', r.duration === 1)
}
t('空章 → 长度 0、duration 0', (() => { const r = stitchChapter([], { sampleRate: 1000 }); return r.samples.length === 0 && r.duration === 0 })())

// ═══ planChapter ═══
console.log('\n[audioPost — planChapter：标题在前、空段跳过]')
{
  const items = planChapter({
    title: 'Story Of The Door',
    paragraphs: [
      { id: 'p-01-001', text: 'hello world' },
      { id: 'p-01-002', text: '   ' },
      { id: 'p-01-003', text: 'second.' },
    ],
  })
  t('标题是第一条且 id=null', items.length === 3 && items[0].id === null && items[0].text === 'Story Of The Door')
  t('空段被跳过', !items.some(it => it.id === 'p-01-002'))
  t('每条都切好 chunks', items.every(it => Array.isArray(it.chunks) && it.chunks.length >= 1))
  t('readTitle=false → 不朗读标题', planChapter({ title: 'T', paragraphs: [{ id: 'p', text: 'x' }] }, { readTitle: false }).length === 1)
}

// ═══ encodeWav ═══
console.log('\n[audioPost — encodeWav：24 kHz 单声道 16-bit PCM]')
{
  const samples = new Float32Array([0, 1, -1, 0.5])
  const buf = encodeWav(samples, 24000)
  const dv = new DataView(buf)
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n))
  t('头 = RIFF/WAVE/fmt /data', str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE' && str(12, 4) === 'fmt ' && str(36, 4) === 'data')
  t('字节数 = 44 + 2×样本数', buf.byteLength === 44 + 8)
  t('RIFF 大小 = 36 + data 大小', dv.getUint32(4, true) === 36 + 8 && dv.getUint32(40, true) === 8)
  t('fmt：PCM=1 / 声道=1 / 采样率=24000', dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === 24000)
  t('byteRate=48000 / blockAlign=2 / bits=16', dv.getUint32(28, true) === 48000 && dv.getUint16(32, true) === 2 && dv.getUint16(34, true) === 16)
  const s = i => dv.getInt16(44 + i * 2, true)
  t('0 → 0；+1 → 32767；-1 → -32768', s(0) === 0 && s(1) === 32767 && s(2) === -32768)
  t('0.5 → 16383（正半幅）', s(3) === 16383)
  t('越界样本被夹住（不溢出）', (() => { const b = new DataView(encodeWav(new Float32Array([2, -2]), 24000)); return b.getInt16(44, true) === 32767 && b.getInt16(46, true) === -32768 })())
}

// ═══ realtimeFactor ═══
console.log('\n[audioPost — realtimeFactor]')
t('60 s 音频 / 30 s 合成 = 2×', realtimeFactor(60, 30000) === 2)
t('30 s 音频 / 60 s 合成 = 0.5×', realtimeFactor(30, 60000) === 0.5)
t('0 耗时 → 0（不除零）', realtimeFactor(10, 0) === 0)

// ═══ audioEncode — lamejs 原样副本（LGPL 边界，选项 B）═══
console.log('\n[audioEncode — lamejs 独立未改动副本（选项 B）]')
{
  const vendor = join(__dirname, 'public/vendor/lame.min.js')
  const upstream = join(__dirname, 'node_modules/lamejs/lame.min.js')
  t('副本已入库 public/vendor/lame.min.js', existsSync(vendor))
  t('上游件在（npm install 可复原）', existsSync(upstream))
  const a = existsSync(vendor) ? readFileSync(vendor) : Buffer.alloc(0)
  const b = existsSync(upstream) ? readFileSync(upstream) : Buffer.alloc(1)
  t('与 node_modules/lamejs/lame.min.js 逐字节相同（未改动）', a.length > 0 && a.equals(b))
  t('LAME_VENDOR_PATH = /vendor/lame.min.js', LAME_VENDOR_PATH === '/vendor/lame.min.js')
  t('MP3_KBPS = 48 ／ FRAME_SAMPLES = 1152（与 tts.py 同档）', MP3_KBPS === 48 && FRAME_SAMPLES === 1152)
}

// ═══ audioEncode — encodeMp3（24 kHz 单声道 48 kbps）═══
console.log('\n[audioEncode — encodeMp3：24 kHz 单声道 48 kbps]')
{
  // ⚠️ npm 包的 main（src/js/index.js）在 node 下必炸：src/js/Lame.js 引用全局 MPEGMode
  //    却没 require 它（ReferenceError: MPEGMode is not defined，2026-10-07 实测）——
  //    能跑的只有合并后的 lame.min.js／lame.all.js。所以这里也照浏览器那样，从原样副本取实现。
  const code = readFileSync(join(__dirname, 'node_modules/lamejs/lame.min.js'), 'utf8')
  const L = new Function(code + '\nreturn lamejs;')()
  t('原样副本能取到 Mp3Encoder（不 import 那个包）', typeof L.Mp3Encoder === 'function')

  t('loadLame 在 node（无 document）下拒绝，不挂起',
    await loadLame().then(() => false, (e) => /document/.test(String(e && e.message))))
  t('没实现就抛（不静默出空文件）',
    (() => { try { encodeMp3(new Float32Array(10)); return false } catch { return true } })())

  const n = 24000
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * 440 * i / 24000) * 0.5
  const mp3 = encodeMp3(s, { lame: L })
  t('产出非空 mp3（Uint8Array）', mp3 instanceof Uint8Array && mp3.length > 0)
  t('帧同步头 0xFF Ex', isMp3Header(mp3))
  t('MPEG-2（24 kHz 家族）＋ Layer III', ((mp3[1] >> 3) & 3) === 2 && ((mp3[1] >> 1) & 3) === 1)
  t('采样率索引 1 = 24000 Hz', ((mp3[2] >> 2) & 3) === 1)
  t('bitrate 索引 6 = MPEG-2/L3 的 48 kbps', ((mp3[2] >> 4) & 15) === 6)
  t('声道模式 3 = 单声道', ((mp3[3] >> 6) & 3) === 3)
  const wavBytes = 44 + n * 2
  t('比 WAV 小 7 倍以上（48 kbps vs 384 kbps 原始 PCM；' + mp3.length + ' vs ' + wavBytes + '）', mp3.length * 7 < wavBytes)
  t('落在 48 kbps 量级（1 s → 4.5–8 KB）', mp3.length > 4500 && mp3.length < 8000)
  t('空样本不抛（回合法空流）', encodeMp3(new Float32Array(0), { lame: L }).length >= 0)
  // 时长换算：mp3 字节 / (kbps*1000/8) ≈ 秒（±帧边界）
  const estSec = mp3.length / (MP3_KBPS * 1000 / 8)
  t('按 48 kbps 反算时长落在 1 s 附近（' + estSec.toFixed(2) + ' s）', estSec > 0.9 && estSec < 1.25)
}
{
  // 夹幅口径必须与 encodeWav 一致，否则试听（WAV）与上传（mp3）响度不同
  const s = new Float32Array([0, 1, -1, 2, -2, 0.5, -0.5])
  const dv = new DataView(encodeWav(s, 24000))
  const wavVals = []
  for (let i = 0; i < s.length; i++) wavVals.push(dv.getInt16(44 + i * 2, true))
  t('toInt16 与 encodeWav 逐样本同口径（含越界夹幅）', eq([...toInt16(s)], wavVals))
}

// ═══ audioUpload — 路径与纯函数 ═══
console.log('\n[audioUpload — 路径 ＋ timings ＋ 索引合并]')
{
  t('AUDIO_ROUTE 与块 B 的 ROUTE_PREFIX 同源', AUDIO_ROUTE === '/api/book/')
  t('mp3 / timings 路径', chapterAudioPath('bk_0011223344556677', 'ch-01.mp3') === '/api/book/bk_0011223344556677/audio/ch-01.mp3'
    && chapterAudioPath('bk_1', 'ch-01.timings.json') === '/api/book/bk_1/audio/ch-01.timings.json')
  t('路径对参数编码（bookId 里的斜杠不进路径）', chapterAudioPath('a/b', 'c.mp3') === '/api/book/a%2Fb/audio/c.mp3')
  t('索引路径', bookIndexPath('bk_1') === '/api/book/bk_1/audio-index.json')
}
{
  const st = { duration: 12.34, offsets: { 'p-02-001': 0, 'p-02-002': 5.5 }, samples: new Float32Array(9) }
  t('timingsOf 取出 duration ＋ paragraphs', eq(timingsOf(st), { duration: 12.34, paragraphs: { 'p-02-001': 0, 'p-02-002': 5.5 } }))
  t('timingsOf 不带 samples（不把 PCM 塞进 JSON）', !('samples' in timingsOf(st)))
  t('timingsOf 空输入 → duration 0 / 空段落', eq(timingsOf(null), { duration: 0, paragraphs: {} }))
}
{
  t('索引缺失 → 新建一份', eq(mergeAudioIndex(null, 'ch-01', 'bk_1'), { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
  const cur = { book: 'bk_1', withAudio: ['ch-01'], missing: { 'ch-02': 'unrecorded' } }
  t('追加新章 ＋ 保留旧章与 missing 原因', eq(mergeAudioIndex(cur, 'ch-03', 'bk_1'),
    { book: 'bk_1', withAudio: ['ch-01', 'ch-03'], missing: { 'ch-02': 'unrecorded' } }))
  t('同一章重复生成 → 去重', eq(mergeAudioIndex(cur, 'ch-01', 'bk_1').withAudio, ['ch-01']))
  t('并入时把该章从 missing 删掉', !('ch-02' in mergeAudioIndex(cur, 'ch-02', 'bk_1').missing))
  t('纯函数：不动入参', eq(cur.withAudio, ['ch-01']) && eq(Object.keys(cur.missing), ['ch-02']))
  t('形状坏（数组）→ 不妄断、建新的', eq(mergeAudioIndex([1, 2], 'ch-01', 'bk_2'), { book: 'bk_2', withAudio: ['ch-01'], missing: {} }))
  t('缺 book 字段 → 用实参补', mergeAudioIndex({ withAudio: [] }, 'ch-01', 'bk_9').book === 'bk_9')
}

// ═══ audioUpload — 三次请求的顺序与短路（假 fetch）═══
console.log('\n[audioUpload — 上传顺序：索引必须最后写、失败不越过]')
const mkRes = (status = 200, body = null) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function fakeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body })
    const h = routes[method + ' ' + url]
    if (h === undefined) return mkRes(404, { error: 'not found' })
    return typeof h === 'function' ? h() : h
  }
  impl.calls = calls
  return impl
}
const chapPath = (b, ch, file) => chapterAudioPath(b, ch + '.' + file)
{
  const f = fakeFetch({
    ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(200, { ok: true }),
    ['PUT ' + chapPath('bk_1', 'ch-01', 'timings.json')]: mkRes(200, { ok: true }),
    ['GET ' + bookIndexPath('bk_1')]: mkRes(404, { error: 'not found' }),
    ['PUT ' + bookIndexPath('bk_1')]: mkRes(200, { ok: true }),
  })
  const r = await uploadChapterAudio({
    bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(2048),
    timings: { duration: 1, paragraphs: {} }, fetchImpl: f,
  })
  t('成功 → ok:true / step:done', r.ok === true && r.step === 'done')
  t('顺序 = mp3 → timings → GET 索引 → PUT 索引', eq(f.calls.map((c) => c.method + ' ' + c.url), [
    'PUT ' + chapPath('bk_1', 'ch-01', 'mp3'),
    'PUT ' + chapPath('bk_1', 'ch-01', 'timings.json'),
    'GET ' + bookIndexPath('bk_1'),
    'PUT ' + bookIndexPath('bk_1'),
  ]))
  t('mp3 体是二进制原样（不被 JSON 包一层）', f.calls[0].body instanceof Uint8Array && f.calls[0].body.byteLength === 2048)
  t('timings 体是 JSON 文本', typeof f.calls[1].body === 'string' && JSON.parse(f.calls[1].body).duration === 1)
  t('索引体 = 合并后的清单（新章进 withAudio）', eq(JSON.parse(f.calls[3].body), { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
  t('返回值带合并后的索引', eq(r.index, { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
}
{
  const f = fakeFetch({
    ['PUT ' + chapPath('bk_1', 'ch-02', 'mp3')]: mkRes(200),
    ['PUT ' + chapPath('bk_1', 'ch-02', 'timings.json')]: mkRes(200),
    ['GET ' + bookIndexPath('bk_1')]: mkRes(200, { book: 'bk_1', withAudio: ['ch-01'], missing: { 'ch-09': 'unrecorded' } }),
    ['PUT ' + bookIndexPath('bk_1')]: mkRes(200),
  })
  await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-02', mp3: new Uint8Array(10), timings: {}, fetchImpl: f })
  const body = JSON.parse(f.calls[3].body)
  t('索引是「读-改-写」：不会把已就绪的 ch-01 抹掉', eq(body.withAudio, ['ch-01', 'ch-02']))
  t('missing 原样保留', eq(body.missing, { 'ch-09': 'unrecorded' }))
}
{
  const f = fakeFetch({ ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(413, { error: 'file too large' }) })
  const r = await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(10), timings: {}, fetchImpl: f })
  t('mp3 413 → step:mp3 / status 413', r.ok === false && r.step === 'mp3' && r.status === 413)
  t('短路：后面一发都不发', f.calls.length === 1)
}
{
  const f = fakeFetch({
    ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(200),
    ['PUT ' + chapPath('bk_1', 'ch-01', 'timings.json')]: mkRes(429),
  })
  const r = await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(10), timings: {}, fetchImpl: f })
  t('timings 429 → step:timings（调用方按 Retry-After 重试）', r.ok === false && r.step === 'timings' && r.status === 429)
  t('索引没写：pending 不误翻成「就绪」', !f.calls.some((c) => c.method === 'PUT' && c.url === bookIndexPath('bk_1')))
}
{
  const f = fakeFetch({
    ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(200),
    ['PUT ' + chapPath('bk_1', 'ch-01', 'timings.json')]: mkRes(200),
    ['GET ' + bookIndexPath('bk_1')]: mkRes(500),
  })
  const r = await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(10), timings: {}, fetchImpl: f })
  t('读索引 500 → step:read-index，且**不发**那记覆盖写（否则抹掉别的章）', r.step === 'read-index' && r.status === 500)
  t('确实没发 PUT 索引', !f.calls.some((c) => c.method === 'PUT' && c.url === bookIndexPath('bk_1')))
}
{
  const f = async () => { const e = new Error('boom'); e.name = 'AbortError'; throw e }
  const r = await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(10), timings: {}, fetchImpl: f })
  t('超时/网络错 → 恒不抛，回 status 0 ＋ reason', r.ok === false && r.status === 0 && r.reason === 'timeout')
}
{
  const f = fakeFetch({})
  t('缺 bookId/章 → bad-input，一发不发',
    (await uploadChapterAudio({ bookId: '', chapterId: 'ch-01', mp3: new Uint8Array(1), fetchImpl: f })).reason === 'bad-input' && f.calls.length === 0)
  t('空音频 → empty-audio',
    (await uploadChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', mp3: new Uint8Array(0), fetchImpl: f })).reason === 'empty-audio')
}
// ═══ 设备闸 / pending 轮询 / 进度与文案（块 D，纯逻辑）═══
console.log('\n[生成器 — 设备闸（判据 6：无 WebGPU 只给看说明，不给按钮）]')
t('navigator.gpu 在 → 算有 WebGPU', detectWebGPU({ gpu: {} }) === true)
t('navigator.gpu 不在 → 不算', detectWebGPU({}) === false)
t('没有 navigator → 不算（服务端/测试环境别报错）', detectWebGPU(null) === false)
{
  t('不是 BYO 书 → 面板都不挂', eq(shouldOfferGeneration({ isByo: false, loggedIn: true, hasWebGPU: true, alreadyReady: false }), { show: false, offer: false, reason: 'not-byo' }))
  t('未登录 → 面板都不挂', eq(shouldOfferGeneration({ isByo: true, loggedIn: false, hasWebGPU: true, alreadyReady: false }), { show: false, offer: false, reason: 'not-logged-in' }))
  t('这章已就绪 → 不挂面板（没有活干）', eq(shouldOfferGeneration({ isByo: true, loggedIn: true, hasWebGPU: true, alreadyReady: true }), { show: false, offer: false, reason: 'already-ready' }))
  const g = shouldOfferGeneration({ isByo: true, loggedIn: true, hasWebGPU: false, alreadyReady: false })
  t('无 WebGPU → **面板照挂**（只给看说明）、按钮不给', g.show === true && g.offer === false && g.reason === 'no-webgpu')
  const ok = shouldOfferGeneration({ isByo: true, loggedIn: true, hasWebGPU: true, alreadyReady: false })
  t('四项齐 → 给按钮，reason 空', ok.show === true && ok.offer === true && ok.reason === '')
  t('空参数 → 不挂（默认全拦，不默认给）', shouldOfferGeneration().show === false)
}
t('每个非空 reason 都有文案（面板不留空白说明）',
  ['not-byo', 'not-logged-in', 'no-webgpu', 'already-ready'].every(r => typeof GEN_REASON_HINT[r] === 'string' && GEN_REASON_HINT[r].length > 10))

console.log('\n[生成器 — pending 轮询（过期答复不许写回 UI）]')
t('chapterToken 拼法', chapterToken('bk_1', 'ch-02') === 'bk_1/ch-02')
t('同一目标 → 不过期', staleReply('bk_1/ch-02', 'bk_1/ch-02') === false)
t('用户切了章 → 过期', staleReply('bk_1/ch-02', 'bk_1/ch-03') === true)
t('用户换了书 → 过期', staleReply('bk_1/ch-02', 'bk_2/ch-02') === true)
t('没给 token（不是轮询来的）→ 不算过期', staleReply('', 'bk_1/ch-02') === false)
t('轮询目标 = 索引路径', pendingCheckUrl('bk_1') === bookIndexPath('bk_1') && pendingCheckUrl('bk_1') === '/api/book/bk_1/audio-index.json')
t('bookId 里的怪字符要编码（别拼出第二条路径）', pendingCheckUrl('a/b?c') === '/api/book/a%2Fb%3Fc/audio-index.json')
{
  const idx = { book: 'bk_1', withAudio: ['ch-01'], missing: { 'ch-09': 'unrecorded' } }
  t('清单还没拿到（404/null）→ 仍在等', stillPending(null, 'ch-01') === true && stillPending(undefined, 'ch-01') === true)
  t('清单里点了名 → 就绪，停轮询', stillPending(idx, 'ch-01') === false)
  t('清单里没有 → 仍在等', stillPending(idx, 'ch-02') === true)
  t('missing 里点名 → 别空转（已判定没有）', stillPending(idx, 'ch-09') === false)
  t('形状不认识（没有 withAudio 数组）→ 仍在等（不误报就绪）', stillPending({ book: 'bk_1' }, 'ch-01') === true)
  t('数组形状坏（withAudio 不是数组）→ 仍在等', stillPending({ withAudio: 'ch-01' }, 'ch-01') === true)
  t('章号是数字也要认（id 一律比字符串）', stillPending({ withAudio: [2] }, 2) === false)
  t('没给章号 → false（没有目标就没得等）', stillPending(idx, '') === false)
  t('与 chapterHasAudio 的唯一关系：它判「没音频」的章，这边也不等',
    chapterHasAudio(idx, 'ch-09') === false && stillPending(idx, 'ch-09') === false)
  t('两者**故意不同**：withAudio 里没有的章，播放器按「能播」兜底、轮询按「还在等」',
    chapterHasAudio(idx, 'ch-02') === true && stillPending(idx, 'ch-02') === true)
}

console.log('\n[生成器 — 进度外推与文案（§13.7 六条 ＋ D20）]')
t('还没跑完第一次调用 → 不外推（0 = 面板显示「估算中」）', estimateRemainingMs(0, 4, 5000) === 0)
t('跑完了 → 0', estimateRemainingMs(4, 4, 5000) === 0)
t('1/4 用了 1000ms → 剩 3000ms（按实测速度外推）', estimateRemainingMs(1, 4, 1000) === 3000)
t('2/5 用了 10000ms → 剩 15000ms', estimateRemainingMs(2, 5, 10000) === 15000)
t('耗时 0 → 不外推', estimateRemainingMs(1, 4, 0) === 0)
t('进度超界不打负数', estimateRemainingMs(9, 4, 1000) === 0)
t('ETA 文案：不足 1 分钟', formatEta(0) === '不到 1 分钟' && formatEta(30000) === '不到 1 分钟')
t('ETA 文案：分钟', formatEta(90000) === '约 2 分钟')
t('ETA 文案：整小时不带 0 分', formatEta(3600000) === '约 1 小时')
t('ETA 文案：小时＋分', formatEta(5400000) === '约 1 小时 30 分钟')
t('六条说明，id 唯一、文案非空（§13.7 原样六条）',
  GEN_NOTES.length === 6 &&
  new Set(GEN_NOTES.map(n => n.id)).size === 6 &&
  GEN_NOTES.every(n => typeof n.text === 'string' && n.text.trim().length > 20) &&
  eq(GEN_NOTES.map(n => n.id), ['desktop', 'first-download', 'foreground', 'mobile', 'scope', 'personal']))
t('个人使用口径必须在（合规句，不许漏）', GEN_NOTES.some(n => /不用于分发/.test(n.text)))
t('粒度（D20）与时长预期都在，且与 15–20 分钟同口径',
  GEN_SCOPE_NOTE.includes('当前打开的这一章') &&
  GEN_ESTIMATE_MINUTES.min === 15 && GEN_ESTIMATE_MINUTES.max === 20 &&
  GEN_ESTIMATE_NOTE.includes('15') && GEN_ESTIMATE_NOTE.includes('20'))

// ═══ chapterGen — 编排：合成 → mp3 → 上传（重活全注入，不加载 kokoro-js）═══
console.log('\n[chapterGen — 编排与失败分流（不加载 kokoro-js）]')
{
  const fakeStitched = (n = 2400) => ({
    samples: new Float32Array(n), offsets: { p1: 0, p2: 1.2 }, duration: 3.5,
    synthMs: 7000, chunks: 3, totalChunks: 3, cancelled: false,
  })
  const okRoutes = (b, ch) => ({
    ['PUT ' + chapPath(b, ch, 'mp3')]: mkRes(200, { ok: true }),
    ['PUT ' + chapPath(b, ch, 'timings.json')]: mkRes(200, { ok: true }),
    ['GET ' + bookIndexPath(b)]: mkRes(404, { error: 'not found' }),
    ['PUT ' + bookIndexPath(b)]: mkRes(200, { ok: true }),
  })
  const CH = { id: 'ch-01', title: 'Chapter 1', paragraphs: [] }

  {
    const stages = []
    const r = await generateChapterAudio({ bookId: '', chapterId: 'ch-01', chapter: CH, onStage: (x) => stages.push(x) })
    t('缺 bookId → input/bad-input，且一个阶段都不进', r.ok === false && r.step === 'input' && r.reason === 'bad-input' && stages.length === 0)
    const r2 = await generateChapterAudio({ bookId: 'bk_1', chapterId: 'ch-01', chapter: null })
    t('缺章节 → 同样拦在 input', r2.step === 'input' && r2.reason === 'bad-input')
  }

  {
    const stages = []
    let genArgs = null
    let encArg = null
    const f = fakeFetch(okRoutes('bk_1', 'ch-01'))
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH,
      loadModelFn: async () => ({ tts: { fake: true } }),
      generateChapterFn: async (a) => { genArgs = a; return fakeStitched() },
      encodeFn: async (x) => { encArg = x; return new Uint8Array(4096) },
      fetchImpl: f, onStage: (x) => stages.push(x),
    })
    t('全绿 → ok:true / step:done', r.ok === true && r.step === 'done' && r.status === 200)
    t('阶段顺序 = model → synth → encode → upload', eq(stages, ['model', 'synth', 'encode', 'upload']))
    t('回执带 index（合并后的就绪清单，面板据此热切）', !!r.index && Array.isArray(r.index.withAudio) && r.index.withAudio.includes('ch-01'))
    t('回执带 duration / mp3Bytes / rtf', r.duration === 3.5 && r.mp3Bytes === 4096 && r.rtf === round2(3.5 / 7))
    t('回执带进度读数（totalChunks / synthMs）', r.totalChunks === 3 && r.synthMs === 7000)
    t('编码拿到的就是合成的 samples（中间没被换过）', encArg instanceof Float32Array && encArg.length === 2400)
    t('voice 没给 → 不往 engine 传 voice 键（音色常量只有一份）', !!genArgs && !('voice' in genArgs))
    t('tts 实例原样传给 engine（不包一层）', genArgs.tts && genArgs.tts.fake === true)
    t('上传顺序 mp3 → timings → GET 索引 → PUT 索引', eq(f.calls.map((c) => c.method + ' ' + c.url), [
      'PUT ' + chapPath('bk_1', 'ch-01', 'mp3'),
      'PUT ' + chapPath('bk_1', 'ch-01', 'timings.json'),
      'GET ' + bookIndexPath('bk_1'),
      'PUT ' + bookIndexPath('bk_1'),
    ]))
    t('timings 体与内置书同形（duration ＋ paragraphs）',
      (() => { const b = JSON.parse(f.calls[1].body); return b.duration === 3.5 && eq(b.paragraphs, { p1: 0, p2: 1.2 }) })())
    t('mp3 体是二进制原样（不被 JSON 包一层）', f.calls[0].body instanceof Uint8Array)
  }

  {
    const stages = []
    let loadCalls = 0
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: { fake: true },
      loadModelFn: async () => { loadCalls++; return { tts: {} } },
      generateChapterFn: async () => fakeStitched(),
      encodeFn: async () => new Uint8Array(100),
      fetchImpl: fakeFetch(okRoutes('bk_1', 'ch-01')),
      onStage: (x) => stages.push(x),
    })
    t('给了 tts 实例 → 不装模型，阶段从 synth 起', r.ok === true && loadCalls === 0 && eq(stages, ['synth', 'encode', 'upload']))
  }

  {
    const stages = []
    const f = fakeFetch({})
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH,
      loadModelFn: async () => { throw new Error('WebGPU 没适配器') },
      generateChapterFn: async () => fakeStitched(),
      encodeFn: async () => new Uint8Array(1),
      fetchImpl: f, onStage: (x) => stages.push(x),
    })
    t('模型炸 → step:model / model-failed ＋ 原话', r.ok === false && r.step === 'model' && r.reason === 'model-failed' && r.message === 'WebGPU 没适配器')
    t('模型炸 → 不合成、不编码、一字节都不发', eq(stages, ['model']) && f.calls.length === 0)
  }

  {
    const f = fakeFetch({})
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: {},
      generateChapterFn: async () => ({ ...fakeStitched(), cancelled: true }),
      encodeFn: async () => new Uint8Array(1), fetchImpl: f,
    })
    t('用户取消 → step:cancelled，且不发任何请求', r.ok === false && r.step === 'cancelled' && f.calls.length === 0)
  }

  {
    // 真中断（2026-10-07 裁「3＋1」）：面板点取消 → abort 信号一路传到这里 →
    // 底下的下载是被 abort 撕掉的，回执必须是 cancelled（**不是** model-failed）
    const stages = []
    const f = fakeFetch({})
    const ctrl = new AbortController()
    let sawSignal = null
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH,
      loadModelFn: async (o2) => { sawSignal = o2.signal; ctrl.abort(); throw new Error('The operation was aborted.') },
      generateChapterFn: async () => fakeStitched(),
      encodeFn: async () => new Uint8Array(1),
      fetchImpl: f, onStage: (x) => stages.push(x), signal: ctrl.signal,
    })
    t('loadModel 拿得到信号（引擎据此在 fetch 层注入）', sawSignal === ctrl.signal)
    t('模型阶段被取消 → step:cancelled，不是 model-failed',
      r.ok === false && r.step === 'cancelled' && r.reason === 'cancelled', JSON.stringify(r))
    t('取消 → 不合成、不编码、一字节都不发', eq(stages, ['model']) && f.calls.length === 0)
  }

  {
    // 下载恰好卡在取消前后：模型装完了但旗子已举 → 一块都不合成
    const stages = []
    const f = fakeFetch({})
    const ctrl = new AbortController()
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH,
      loadModelFn: async () => { ctrl.abort(); return { tts: { fake: true } } },
      generateChapterFn: async () => { stages.push('synth-called'); return fakeStitched() },
      encodeFn: async () => new Uint8Array(1),
      fetchImpl: f, onStage: (x) => stages.push(x), signal: ctrl.signal,
    })
    t('模型装完才发现已取消 → 按 cancelled 收，合成一次都不进',
      r.step === 'cancelled' && eq(stages, ['model']), JSON.stringify(stages))
  }

  {
    const f = fakeFetch({})
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: {},
      generateChapterFn: async () => ({ samples: new Float32Array(0), offsets: {}, duration: 0, synthMs: 1, cancelled: false }),
      encodeFn: async () => new Uint8Array(1), fetchImpl: f,
    })
    t('合成出空音频 → empty-audio，不上传', r.step === 'synth' && r.reason === 'empty-audio' && f.calls.length === 0)
  }
  {
    const f = fakeFetch({})
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: {},
      generateChapterFn: async () => fakeStitched(),
      encodeFn: async () => { throw new Error('lamejs 没了') }, fetchImpl: f,
    })
    t('编码炸 → step:encode / encode-failed ＋ 原话', r.step === 'encode' && r.reason === 'encode-failed' && r.message === 'lamejs 没了')
    t('编码炸 → 不上传', f.calls.length === 0)
  }

  {
    const f = fakeFetch({ ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(403, { error: 'quota' }) })
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: {},
      generateChapterFn: async () => fakeStitched(), encodeFn: async () => new Uint8Array(2048), fetchImpl: f,
    })
    t('上传 403 → step:upload / status 403 / substep:mp3（面板据此退回浏览器 TTS）', r.ok === false && r.step === 'upload' && r.status === 403 && r.substep === 'mp3')
    t('403 只发了一发（短路在 audioUpload 里）', f.calls.length === 1)
  }
  {
    const f = fakeFetch({
      ['PUT ' + chapPath('bk_1', 'ch-01', 'mp3')]: mkRes(200),
      ['PUT ' + chapPath('bk_1', 'ch-01', 'timings.json')]: mkRes(429, {}),
    })
    const r = await generateChapterAudio({
      bookId: 'bk_1', chapterId: 'ch-01', chapter: CH, tts: {},
      generateChapterFn: async () => fakeStitched(), encodeFn: async () => new Uint8Array(2048), fetchImpl: f,
    })
    t('timings 429 → 原样透出 substep:timings / status 429（调用方按 Retry-After 重试）', r.step === 'upload' && r.status === 429 && r.substep === 'timings')
    t('429 时索引没写（pending 不误翻成就绪）', !f.calls.some((c) => c.method === 'PUT' && c.url === bookIndexPath('bk_1')))
  }

  {
    const src = readFileSync(join(__dirname, 'src/generate/chapterGen.js'), 'utf8')
    t('chapterGen 不静态引 engine.js／kokoro-js（重活只在真要合成时才拉）',
      !/from\s+['"][^'"]*engine\.js['"]/.test(src) && !src.includes("'kokoro-js'"))
    t('chapterGen 的 engine 走动态 import', /await import\(['"][^'"]*engine\.js['"]\)/.test(src))
    const eng = readFileSync(join(__dirname, 'src/generate/engine.js'), 'utf8')
    t('engine 有单槽的「本次加载信号」（取消要能掉断正在飞的下载）',
      /let activeModelSignal = null/.test(eng) && /activeModelSignal = signal \|\| null/.test(eng))
    t('engine 收工必清信号（finally），不影响别人',
      /finally \{\s*activeModelSignal = null\s*\}/.test(eng))
    t('只给模型那一坨请求挂信号（别的请求一律不动）',
      /if \(activeModelSignal && isModelUrl\(url\)\)/.test(eng) && /export function isModelUrl/.test(eng))
    t('信号合并有 AbortSignal.any 缺失时的兜底',
      /AbortSignal\.any/.test(eng) && /addEventListener\('abort'/.test(eng))
    t('fetch 路由装在 ensureMirror（面板与探针共用一条路；此前面板那条漏装）',
      /installMirrorRouting\(\)\n\s+if \(!mirrorPromise\)/.test(eng))
  }
}

// ═══ 主包卫生：kokoro-js 一律不得进主包（§13.3 硬要求）═══
console.log('\n[生成器 — 主包卫生（kokoro-js / onnx / lamejs 不得进主包）]')
{
  const BANNED = ['kokoro-js', '@huggingface/transformers', 'onnxruntime-web', 'lamejs', 'phonemizer']
  // 只拦**静态**引：副作用式 `import '…'`／`import x from '…'`／`export … from '…'`。
  // 动态 `import('…')` 不在内 —— 它正是懒加载 chunk 的入口，也就是要**放行**的那条。
  const STATIC_GEN_RE = new RegExp([
    String.raw`^\s*import\s+['"][^'"]*generate\/`,
    String.raw`^\s*import\s[^;]*?from\s+['"][^'"]*generate\/`,
    String.raw`^\s*export\s[^;]*?from\s+['"][^'"]*generate\/`,
  ].join('|'), 'm')
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name)
    if (d.isDirectory()) return d.name === 'generate' ? [] : walk(full)  // 生成器目录本身豁免
    return /\.(js|mjs|vue)$/.test(d.name) ? [full] : []
  })
  const files = walk(join(__dirname, 'src'))
  const hits = []
  for (const f of files) {
    const txt = readFileSync(f, 'utf8')
    const rel = relative(__dirname, f)
    for (const m of BANNED) {
      if (txt.includes(`'${m}`) || txt.includes(`"${m}`)) hits.push(`${rel} → ${m}`)
    }
    // 「禁静态、放行动态」（2026-10-07 Ferrari 裁 A）：三条正则都以 `import`／`export`
    // **紧跟空白**开头，所以 `import(` 天然不命中 —— 这就是放行口。
    if (STATIC_GEN_RE.test(txt)) hits.push(`${rel} → 静态引了 src/generate/`)
  }
  t(`主包源码（除 src/generate/）与生成器**静态**零耦合（动态 import 放行；扫了 ${files.length} 个文件）`, hits.length === 0, hits.join('; '))

  // 正控：放行口**确实在用** —— 否则上面那条可以靠「根本没有面板」蒙过去
  const rvSrc = readFileSync(join(__dirname, 'src/views/ReaderView.vue'), 'utf8')
  t('ReaderView 用 defineAsyncComponent ＋ 动态 import 取生成面板（放行口在用）',
    /defineAsyncComponent\(\s*\(\)\s*=>\s*import\(\s*['"][^'"]*generate\/GenAudioPanel\.vue['"]\s*\)/.test(rvSrc))
  t('生成面板住在 src/generate/ 下（与闸／编排同一个卫生豁免区）',
    readdirSync(join(__dirname, in_dir)).includes('GenAudioPanel.vue'))

  const html = readFileSync(join(__dirname, 'index.html'), 'utf8')
  t('主入口 index.html 不引探针页', !html.includes('kokoro-probe'))
  t('探针页自身确实在 src/generate/ 下', readdirSync(join(__dirname, in_dir)).some(n => n === 'probe.js'))
  t('块 C2 的编码／上传模块也在 src/generate/ 下（卫生豁免区）',
    ['audioEncode.js', 'audioUpload.js'].every((n) => readdirSync(join(__dirname, in_dir)).includes(n)))
  const probeHtml = readFileSync(join(__dirname, 'kokoro-probe.html'), 'utf8')
  t('探针页只引 src/generate/probe.js（kokoro-js 不进主包）', probeHtml.includes('/src/generate/probe.js'))
}

// ═══ 主包卫生 · 构建级：entry chunk 里不许出现生成器（含面板本身）═══
// 来源级那条只证明「没人静态 import」；这一条证明**产物**里真的没有 —— 从入口出发的静态图
// 才是打包器认的图，构造函数、别名、间接 re-export 都绕不过它。
console.log('\n[生成器 — 构建级卫生（entry chunk 不许带生成器：kokoro／lamejs／面板文案）]')
{
  const OUT = '.verify-dist'
  const outPath = join(__dirname, OUT)
  const drop = () => { try { rmSync(outPath, { recursive: true, force: true }) } catch { /* 没建起来就算了 */ } }
  drop()
  let buildErr = null
  try {
    execFileSync(process.execPath,
      [join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
        '--config', 'vite.verify.config.mjs', '--logLevel', 'warn'],
      { cwd: __dirname, stdio: 'pipe' })
  } catch (e) {
    buildErr = e
  }
  if (buildErr) {
    const why = String((buildErr.stdout || '') + (buildErr.stderr || '') || buildErr.message || '').trim().slice(0, 400)
    t('构建成功（构建闸的前提；这条失败时下面几条不作数）', false, why)
  } else {
    const mfPath = [join(outPath, '.vite', 'manifest.json'), join(outPath, 'manifest.json')].find((x) => existsSync(x))
    t('构建产出了 manifest（拿它找 entry chunk，不靠猜文件名）', !!mfPath)
    const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
    const chunk = (f) => readFileSync(join(outPath, f), 'utf8')
    const entries = Object.entries(mf).filter(([, v]) => v.isEntry)
    t('manifest 里恰好一个入口', entries.length === 1, String(entries.length))
    const lazy = Object.entries(mf).filter(([, v]) => !v.isEntry)
    // 针：engine.js 的 MODEL_ID 常量／audioEncode.js 的 vendor 路径／重库名／面板标题。
    // 都是**字符串字面量或属性名**，压缩后照旧活着 —— 不靠注释（注释会被剥掉）。
    const NEEDLES = ['Kokoro-82M', 'lame.min.js', 'onnxruntime', 'kokoro', 'lamejs', 'MPEGMode', '云端音色朗读']
    const hits = []
    for (const [, v] of entries) {
      const txt = chunk(v.file)
      for (const n of NEEDLES) if (txt.includes(n)) hits.push(`${v.file} → ${n}`)
    }
    t(`entry chunk（${entries[0] ? entries[0][1].file : '?'}）不带生成器（kokoro／lamejs／面板都不在）`, hits.length === 0, hits.join('; '))
    // 正控（两条一起才有意义）：面板确实被拆成懒加载 chunk —— 否则上面那条也是空跑
    t('生成面板确实被拆成懒加载 chunk（不是被整体删掉了）', lazy.length > 0)
    t('懒加载 chunk 里找得到面板（正控：证明上面那条抓到的是真货）',
      lazy.some(([, v]) => chunk(v.file).includes('云端音色朗读')))
    t('懒加载 chunk 里找得到引擎（kokoro 也在那一侧）',
      lazy.some(([, v]) => chunk(v.file).includes('Kokoro-82M')))
  }
  drop()
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)