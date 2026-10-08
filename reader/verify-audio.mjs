/**
 * 第 17 步（D17）· 块 D —— BYO 云端音频**读取侧**的验证（不依赖浏览器、不触网）
 *   utils/audioCloud.js — 路径 ＋ 就绪索引读取（fetchCloudIndex）＋ 索引／timings 口径
 * 为什么单开一个文件：这段在**主包**里（播放器每开一本书都要走一次），与 `src/generate/`
 * （懒加载、不进主包）是两侧 —— `verify-generate.mjs` 管生成侧，这里管读取侧。
 * 用法: node verify-audio.mjs
 */

import {
  AUDIO_ROUTE, INDEX_TIMEOUT_MS,
  chapterAudioPath, bookIndexPath, chapterAudioUrl, chapterTimingsUrl,
  timingsOf, mergeAudioIndex, indexUsable, fetchCloudIndex,
} from './src/utils/audioCloud.js'
import { chapterHasAudio, tocMissingAudio } from './src/utils/audioIndex.js'
import {
  AUDIO_ROUTE as WRITE_ROUTE, chapterAudioPath as writePath,
  mergeAudioIndex as writeMerge, timingsOf as writeTimings,
} from './src/generate/audioUpload.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const mkRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (body === undefined) throw new Error('no body'); return body },
})
function fakeFetch(handler) {
  const calls = []
  const impl = async (url, init = {}) => { calls.push({ url, method: init.method || 'GET' }); return handler(url, init) }
  impl.calls = calls
  return impl
}

// ═══ ① 路径与 URL ═══
console.log('\n[audioCloud — 路径与 URL]')
t('AUDIO_ROUTE = /api/book/', AUDIO_ROUTE === '/api/book/')
t('章产物路径', chapterAudioPath('bk_0011223344556677', 'ch-01.mp3') === '/api/book/bk_0011223344556677/audio/ch-01.mp3'
  && chapterAudioPath('bk_1', 'ch-01.timings.json') === '/api/book/bk_1/audio/ch-01.timings.json')
t('URL 参数被编码（bookId 里的斜杠不进路径）', chapterAudioPath('a/b', 'c.mp3') === '/api/book/a%2Fb/audio/c.mp3')
t('索引路径', bookIndexPath('bk_1') === '/api/book/bk_1/audio-index.json')
t('章音频 URL', chapterAudioUrl('bk_1', 'ch-01') === '/api/book/bk_1/audio/ch-01.mp3')
t('章 timings URL', chapterTimingsUrl('bk_1', 'ch-01') === '/api/book/bk_1/audio/ch-01.timings.json')

// 读侧路径必须与服务端路由同源 —— 任何一边改名，这里立刻红
const workerSrc = readFileSync(join(__dirname, '../worker/src/bookaudio.js'), 'utf8')
const routeMatch = /ROUTE_PREFIX = '([^']+)'/.exec(workerSrc)
t('与 worker/src/bookaudio.js 的 ROUTE_PREFIX 一致', !!routeMatch && routeMatch[1] === AUDIO_ROUTE, routeMatch ? routeMatch[1] : '(未读到)')
t('服务端也认 audio-index.json 这个名字', /INDEX_FILE = 'audio-index\.json'/.test(workerSrc))

// ═══ ② 读侧与写侧同源（防漂）═══
console.log('\n[audioCloud — 读侧与写侧同源（防漂）]')
t('AUDIO_ROUTE 同一个值', WRITE_ROUTE === AUDIO_ROUTE)
t('chapterAudioPath 是**同一个函数对象**（写侧只是再导出）', writePath === chapterAudioPath)
t('mergeAudioIndex 是同一个函数对象', writeMerge === mergeAudioIndex)
t('timingsOf 是同一个函数对象', writeTimings === timingsOf)

// ═══ ③ indexUsable ═══
console.log('\n[audioCloud — indexUsable：拿错书的清单宁缺勿错]')
t('null／数组 → 不认', indexUsable(null, 'bk_1') === false && indexUsable([1], 'bk_1') === false)
t('book 对得上 → 认', indexUsable({ book: 'bk_1', withAudio: [] }, 'bk_1') === true)
t('book 对不上 → 不认', indexUsable({ book: 'bk_2', withAudio: [] }, 'bk_1') === false)
t('没有 book 字段 → 认（老清单／手写清单）', indexUsable({ withAudio: [] }, 'bk_1') === true)

// ═══ ④ 索引与 timings 口径 ═══
console.log('\n[audioCloud — 索引合并与 timings 口径]')
t('合并进空索引', eq(mergeAudioIndex(null, 'ch-01', 'bk_1'), { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
t('读-改-写：保留别的章与 missing 原因', eq(
  mergeAudioIndex({ book: 'bk_1', withAudio: ['ch-01'], missing: { 'ch-02': 'unrecorded' } }, 'ch-03', 'bk_1'),
  { book: 'bk_1', withAudio: ['ch-01', 'ch-03'], missing: { 'ch-02': 'unrecorded' } }))
t('timingsOf 只带 duration ＋ paragraphs', eq(timingsOf({ duration: 1, offsets: { a: 0 } }), { duration: 1, paragraphs: { a: 0 } }))

// ═══ ⑤ fetchCloudIndex ═══
console.log('\n[audioCloud — fetchCloudIndex：恒不抛；401／404 都不是「错」]')
{
  const f = fakeFetch(() => mkRes(200, { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
  const r = await fetchCloudIndex('bk_1', { fetchImpl: f })
  t('200 → ok ＋ index', r.ok === true && eq(r.index, { book: 'bk_1', withAudio: ['ch-01'], missing: {} }))
  t('请求的是 audio-index.json、用 GET', f.calls.length === 1 && f.calls[0].method === 'GET' && f.calls[0].url === bookIndexPath('bk_1'))
  t('URL 里不含 code（D16）', !/code=/.test(f.calls[0].url))
}
{
  const r = await fetchCloudIndex('bk_1', { fetchImpl: fakeFetch(() => mkRes(404)) })
  t('404 → ok:false ／ status 404（还没生成过音频，正常态）', r.ok === false && r.status === 404)
}
{
  const r = await fetchCloudIndex('bk_1', { fetchImpl: fakeFetch(() => mkRes(401)) })
  t('401 → ok:false ／ status 401（未登录；静默退回浏览器朗读）', r.ok === false && r.status === 401)
}
{
  const r = await fetchCloudIndex('bk_1', { fetchImpl: fakeFetch(() => mkRes(200, undefined)) })
  t('200 但 JSON 坏 → ok:true ／ index:null（不当错误）', r.ok === true && r.index === null)
}
{
  const r = await fetchCloudIndex('bk_1', { fetchImpl: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e } })
  t('超时／abort → status 0 ／ reason timeout', r.ok === false && r.status === 0 && r.reason === 'timeout')
}
{
  const r = await fetchCloudIndex('bk_1', { fetchImpl: async () => { throw new Error('net') } })
  t('网络错 → status 0 ／ reason network', r.ok === false && r.status === 0 && r.reason === 'network')
}
{
  const f = fakeFetch(() => mkRes(200, {}))
  const r = await fetchCloudIndex('', { fetchImpl: f })
  t('空 bookId → bad-input 且一发不发', r.reason === 'bad-input' && f.calls.length === 0)
}
t('索引超时是有限正值（不是 0／Infinity）', Number.isFinite(INDEX_TIMEOUT_MS) && INDEX_TIMEOUT_MS > 0)

// ═══ ⑥ D25 —— 「清空该书音频」的读侧口径 ═══
console.log('\n[audioCloud — D25 清空音频后的读侧口径：正文仍可读、书仍在架]')
{
  const bid = 'bk_a1b2c3d4e5f60718'
  // 服务端 `DELETE /api/book/<bookId>/audio` 回写的那一份（worker/src/bookaudio.js 的 clearBookAudio）
  const cleared = { book: bid, withAudio: [], missing: {} }
  t('清空后的索引仍被认（book 对得上 → 不会当成拿错书）', indexUsable(cleared, bid) === true)
  t('清空后的索引：不逐章标「无音频」（与「整本没音频」的老口径一致，章表不刷屏）',
    eq(tocMissingAudio(cleared), {}))
  t('清空后的索引：单章判定「不妄断」→ 仍按有音频处理（播放器去试 mp3，失败退回浏览器朗读）',
    chapterHasAudio(cleared, 'ch-01') === true)
  t('因此正文仍可读、书仍在架（清空只删 user/<code>/<bookId>/，不碰书体与本地书架）',
    chapterHasAudio(cleared, 'ch-07') === true && tocMissingAudio(cleared)['ch-07'] === undefined)
  t('清空 ≠ 不许再生成：清空后重新生成的章就是「未生成」的章，索引从空长回来',
    eq(mergeAudioIndex(cleared, 'ch-07', bid), { book: bid, withAudio: ['ch-07'], missing: {} }))
  t('清空音频的路由族 = AUDIO_ROUTE（不是删书路由 /api/sync/book/…）',
    AUDIO_ROUTE === '/api/book/' && !AUDIO_ROUTE.includes('sync'))
  t('清空音频的 URL 形状 = AUDIO_ROUTE ＋ <bookId> ＋ "/audio"（与 worker 的 clearAll 形状对齐）',
    `${AUDIO_ROUTE}${bid}/audio` === '/api/book/bk_a1b2c3d4e5f60718/audio')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)