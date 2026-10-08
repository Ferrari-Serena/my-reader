/**
 * 第 17 步块 D —— 服务端合成的**客户端**（`utils/genApi.js`）的验证（不依赖浏览器、不触网）
 *   utils/genApi.js — 提交章节 / 查状态 / 清空该书音频 ＋ 章级状态、入口三态、文案
 * 为什么单开一个文件：这段在**主包**里（播放器每次开书都要问一次「有没有章在排队」），
 * 与 `verify-generate.mjs`（懒加载的生成侧）是两侧；判定与文案都只有这一份，UI 只负责画。
 * 用法: node verify-genui.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  GEN_ROUTE, GEN_TIMEOUT_MS, MAX_CHAPTERS_PER_SUBMIT, CHAPTER_ID_RE,
  genStatusPath, clearBookAudioPath, isValidChapterId,
  selectionPayload, rangeSelection,
  normalizeQuota, normalizeGenStatus, normalizeSubmit, normalizeClear,
  CH_STATE, chapterGenState, chapterSelectable, isChapterPending,
  genEntryState, quotaLine, queueLine, skipReasonText, submitResultLine,
  GEN_PAGE_NOTES, GEN_PACE_NOTE,
  fetchGenStatus, submitGenChapters, clearBookAudioRemote,
} from './src/utils/genApi.js'
import { AUDIO_ROUTE } from './src/utils/audioCloud.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const BID = 'bk_a1b2c3d4e5f60718'

const mkRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (body === undefined) throw new Error('no body'); return body },
})
function fakeFetch(handler) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body })
    return handler(url, init)
  }
  impl.calls = calls
  return impl
}

// ═══ ① 路径与常量 ═══
console.log('\n[genApi — 路径与常量]')
t('GEN_ROUTE = /api/gen/book/', GEN_ROUTE === '/api/gen/book/')
t('genStatusPath 拼对且不带 code', genStatusPath(BID) === `/api/gen/book/${BID}` && !genStatusPath(BID).includes('code='))
t('清空走**音频**路由（不是删书路由 /api/sync/book/…）',
  clearBookAudioPath(BID) === `${AUDIO_ROUTE}${BID}/audio`
  && clearBookAudioPath(BID) === `/api/book/${BID}/audio`
  && !clearBookAudioPath(BID).includes('/sync/'))
t('单次提交上限 = 5（与 worker 的 DAILY_CHAPTERS 同值）', MAX_CHAPTERS_PER_SUBMIT === 5)
t('章 id 形状认 ch-01 / ch-100',
  isValidChapterId('ch-01') && isValidChapterId('ch-100') && CHAPTER_ID_RE.test('ch-0100'))
t('章 id 形状不认 ch1 / ch-01.mp3 / 空 / 非字符串',
  !isValidChapterId('ch1') && !isValidChapterId('ch-01.mp3') && !isValidChapterId('')
  && !isValidChapterId(null) && !isValidChapterId(undefined) && !isValidChapterId('p-01-001'))
t('超时是有限正值', Number.isFinite(GEN_TIMEOUT_MS) && GEN_TIMEOUT_MS > 0)

// ═══ ② 勾选 → 载荷 ═══
console.log('\n[genApi — selectionPayload：去重／丢坏形状／封顶]')
t('正常勾选', eq(selectionPayload(['ch-01', 'ch-02']), { ok: true, chapters: ['ch-01', 'ch-02'], dropped: 0 }))
t('去重（同一个章勾两次只算一次）',
  eq(selectionPayload(['ch-01', 'ch-01', 'ch-02']).chapters, ['ch-01', 'ch-02']))
t('形状不对的丢掉并计数',
  eq(selectionPayload(['ch-01', 'oops', '']), { ok: true, chapters: ['ch-01'], dropped: 2 }))
t('超过 5 章按上限截断（dropped 如实报）',
  (() => {
    const r = selectionPayload(['ch-01', 'ch-02', 'ch-03', 'ch-04', 'ch-05', 'ch-06', 'ch-07'])
    return r.ok === true && r.chapters.length === 5 && r.dropped === 2 && r.chapters[4] === 'ch-05'
  })())
t('一章都没勾 / 全是坏形状 → ok:false 且带一句提示',
  (() => {
    const a = selectionPayload([])
    const b = selectionPayload(['oops'])
    const c = selectionPayload(null)
    return a.ok === false && !!a.error && b.ok === false && c.ok === false
  })())

// ═══ ③ 区间勾选 ═══
console.log('\n[genApi — rangeSelection：连续区间]')
{
  const chapters = [{ id: 'ch-01' }, { id: 'ch-02' }, { id: 'ch-03' }, { id: 'ch-04' }]
  t('端点含入', eq(rangeSelection(chapters, 'ch-02', 'ch-03'), ['ch-02', 'ch-03']))
  t('反向给端点也认（自动取小到大）', eq(rangeSelection(chapters, 'ch-03', 'ch-01'), ['ch-01', 'ch-02', 'ch-03']))
  t('单个端点 = 单章', eq(rangeSelection(chapters, 'ch-02', 'ch-02'), ['ch-02']))
  t('端点认不出 → 空（不给「半个区间」）',
    eq(rangeSelection(chapters, 'ch-02', 'ch-99'), []) && eq(rangeSelection(null, 'a', 'b'), []))
}

// ═══ ④ 状态归一（形状坏 → 空壳，不妄断）═══
console.log('\n[genApi — 归一：形状坏了也不抛、不编]')
{
  const bad = normalizeGenStatus(null)
  t('null → 空壳（章表空、汇总 0、额度 unknown ⇒ chaptersLeft null）',
    eq(bad.chapters, {}) && bad.summary.total === 0 && bad.quota.chaptersLeft === null)
  const s = normalizeGenStatus({
    bookId: BID,
    chapters: { 'ch-01': { status: 'done', title: 'A', chars: '12', attempts: '2' }, 'ch-02': 'garbage' },
    summary: { total: 2, done: 1, pending: 1 },
    queue: { ahead: 2, position: 3 },
    quota: { chaptersLeft: 3, charsLeft: 1200, chaptersUsed: 2, charsUsed: 900 },
  }, BID)
  t('章表归一（坏行 → 空状态行，不丢键）',
    s.chapters['ch-01'].status === 'done' && s.chapters['ch-01'].chars === 12
    && s.chapters['ch-02'].status === '')
  t('汇总／队列／额度归一',
    s.summary.pending === 1 && s.queue.ahead === 2 && s.queue.position === 3
    && s.quota.chaptersLeft === 3 && s.quota.charsUsed === 900)
  t('额度 unknown 标记透传', normalizeQuota({ unknown: true }).unknown === true)
  t('提交答复归一（三份名单）',
    (() => {
      const d = normalizeSubmit({ queued: [{ chapterId: 'ch-01', chars: 100 }], skipped: [{ chapterId: 'ch-02', reason: 'already-done' }] })
      return d.queued.length === 1 && d.requeued.length === 0 && d.skipped[0].reason === 'already-done'
        && d.skipped[0].chapterId === 'ch-02'
    })())
  t('清空答复归一',
    eq(normalizeClear({ ok: true, bookId: BID, removedAudioObjects: 3, indexCleared: true }),
      { ok: true, bookId: BID, removedAudioObjects: 3, indexCleared: true }))
}

// ═══ ⑤ 章级状态 ═══
console.log('\n[genApi — chapterGenState：索引优先、done+无音频 = stale]')
t('索引里有音频 → ready（哪怕队列行说别的）',
  chapterGenState({ status: 'failed' }, true) === CH_STATE.ready)
t('行 pending → queued ／ running → running',
  chapterGenState({ status: 'pending' }, false) === CH_STATE.queued
  && chapterGenState({ status: 'running' }, false) === CH_STATE.running)
t('行 failed → failed（可重新提交，不重复扣额度）',
  chapterGenState({ status: 'failed' }, false) === CH_STATE.failed)
t('**行说 done、索引里没有音频 → stale（不是 ready）**',
  chapterGenState({ status: 'done' }, false) === CH_STATE.stale
  && chapterGenState({ status: 'done' }, false) !== CH_STATE.ready)
t('没有行 → todo；形状坏 → todo（不妄断成「已生成」）',
  chapterGenState(null, false) === CH_STATE.todo && chapterGenState({}, false) === CH_STATE.todo
  && chapterGenState('garbage', false) === CH_STATE.todo)
// D25-f：服务端清空音频后把行改成 purged ⇒ 这一章必须回到「可生成」（todo），不是 done/stale
t('**行 purged（音频已被清空）→ todo（可重新生成）**，哪怕索引里还没有音频',
  chapterGenState({ status: 'purged' }, false) === CH_STATE.todo
  && chapterGenState({ status: 'purged' }, false) !== CH_STATE.stale
  && chapterSelectable(chapterGenState({ status: 'purged' }, false)))
t('purged 不算「在跑」（播放器不该为它热切轮询）',
  isChapterPending(normalizeGenStatus({ chapters: { 'ch-01': { status: 'purged' } } }), 'ch-01') === false)
t('可勾的只有 todo／stale／failed',
  chapterSelectable(CH_STATE.todo) && chapterSelectable(CH_STATE.stale) && chapterSelectable(CH_STATE.failed)
  && !chapterSelectable(CH_STATE.ready) && !chapterSelectable(CH_STATE.queued)
  && !chapterSelectable(CH_STATE.running))
{
  const gen = normalizeGenStatus({ chapters: { 'ch-01': { status: 'pending' }, 'ch-02': { status: 'running' }, 'ch-03': { status: 'done' } } })
  t('isChapterPending 只认 pending／running（播放器热切用）',
    isChapterPending(gen, 'ch-01') === true && isChapterPending(gen, 'ch-02') === true
    && isChapterPending(gen, 'ch-03') === false && isChapterPending(gen, 'ch-99') === false
    && isChapterPending(null, 'ch-01') === false)
}

// ═══ ⑥ 入口三态（D21-f）═══
console.log('\n[genApi — genEntryState：My Books 入口三态]')
t('非 BYO → none（公开书不给入口，D21-i）',
  genEntryState({ isByo: false, loggedIn: true, chapterCount: 10 }).kind === 'none')
t('未登录 → login（点了一律引导登录，D21-j）',
  genEntryState({ isByo: true, loggedIn: false, chapterCount: 10 }).kind === 'login')
t('一章都没生成 → start「去生成音频 →」',
  (() => { const s = genEntryState({ isByo: true, loggedIn: true, chapterCount: 10, withAudioCount: 0 }); return s.kind === 'start' && s.label === '去生成音频 →' })())
t('有章在排队／跑 → busy「生成中 2/5 · 点看进度」',
  (() => {
    const s = genEntryState({ isByo: true, loggedIn: true, chapterCount: 10, withAudioCount: 2, summary: { pending: 2, running: 1 } })
    return s.kind === 'busy' && s.label === '生成中 2/5 · 点看进度' && s.busy === 3
  })())
t('有音频、此刻没在跑 → partial「已生成 3/10 章 · 继续生成」',
  (() => {
    const s = genEntryState({ isByo: true, loggedIn: true, chapterCount: 10, withAudioCount: 3 })
    return s.kind === 'partial' && s.label === '已生成 3/10 章 · 继续生成' && s.done === 3 && s.total === 10
  })())
t('全部都有音频 → partial 但文案改指向「重新生成或清空」',
  (() => {
    const s = genEntryState({ isByo: true, loggedIn: true, chapterCount: 10, withAudioCount: 10 })
    return s.kind === 'partial' && s.label.includes('重新生成或清空')
  })())
t('章数/索引数缺失不炸（当 0）',
  genEntryState({ isByo: true, loggedIn: true }).kind === 'start')

// ═══ ⑦ 文案（D21-e／g／l）═══
console.log('\n[genApi — 文案：不写死额度、不自算秒数、指向清空音频]')
t('额度有数 → 报数且写「体验期免费」',
  quotaLine({ chaptersLeft: 3 }).includes('3 章') && quotaLine({ chaptersLeft: 3 }).includes('体验期免费'))
t('额度读不到 → 「稍后可见」，**不编数字**',
  quotaLine(null).includes('稍后可见') && !/\d+ 章/.test(quotaLine(null)))
t('额度用尽 → 一句直达「先清空某本书的音频腾空间」（D25 的入口提示）',
  quotaLine({ chaptersLeft: 0 }).includes('用完了') && quotaLine({ chaptersLeft: 0 }).includes('清空'))
t('排队位次：0 → 正在生成；2 → 报真数字',
  queueLine({ ahead: 0 }).includes('正在生成') && queueLine({ ahead: 2 }).includes('2 个任务'))
t('跳过原因 → 人话',
  skipReasonText('already-done') === '已经有音频了'
  && skipReasonText('chapter-too-long').includes('太长')
  && skipReasonText('???').length > 0)
t('提交结果一句话：排队 3 ＋ 跳过 1（带原因）',
  (() => {
    const line = submitResultLine({ queued: [{ chapterId: 'ch-01' }, { chapterId: 'ch-02' }, { chapterId: 'ch-03' }], skipped: [{ chapterId: 'ch-04', reason: 'already-done' }] })
    return line.includes('已排队 3 章') && line.includes('跳过 1 章') && line.includes('已经有音频了')
  })())
t('没有任何名单 → 「没有可提交的章节」', submitResultLine({}).includes('没有可提交'))
t('常规说明三句：体验期免费 ＋ 约 1–2 分钟/章 ＋ 可以关掉页面',
  GEN_PAGE_NOTES.length === 3 && GEN_PAGE_NOTES[0].includes('体验期免费')
  && GEN_PACE_NOTE.includes('1–2 分钟') && GEN_PACE_NOTE.includes('关掉页面'))

// ═══ ⑧ 网络（恒不抛）═══
console.log('\n[genApi — fetchGenStatus / submitGenChapters / clearBookAudioRemote]')
{
  const f = fakeFetch(() => mkRes(200, { bookId: BID, chapters: { 'ch-01': { status: 'pending' } }, summary: { pending: 1 }, quota: { chaptersLeft: 4 } }))
  const r = await fetchGenStatus(BID, { fetchImpl: f })
  t('200 → ok ＋ 归一数据', r.ok === true && r.data.chapters['ch-01'].status === 'pending' && r.data.quota.chaptersLeft === 4)
  t('请求的是状态路径、用 GET、URL 不含 code',
    f.calls.length === 1 && f.calls[0].method === 'GET' && f.calls[0].url === genStatusPath(BID) && !f.calls[0].url.includes('code='))
}
{
  const r401 = await fetchGenStatus(BID, { fetchImpl: fakeFetch(() => mkRes(401)) })
  t('401 → ok:false ／ status 401（未登录；静默退回浏览器朗读）', r401.ok === false && r401.status === 401)
  const r404 = await fetchGenStatus(BID, { fetchImpl: fakeFetch(() => mkRes(404)) })
  t('404 → ok:false ／ status 404', r404.ok === false && r404.status === 404)
}
{
  const r = await fetchGenStatus(BID, { fetchImpl: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e } })
  t('超时 → status 0 ／ reason timeout（不抛）', r.ok === false && r.status === 0 && r.reason === 'timeout')
  const r2 = await fetchGenStatus(BID, { fetchImpl: async () => { throw new Error('net') } })
  t('网络错 → status 0 ／ reason network', r2.ok === false && r2.status === 0 && r2.reason === 'network')
  const f = fakeFetch(() => mkRes(200, {}))
  const r3 = await fetchGenStatus('', { fetchImpl: f })
  t('空 bookId → bad-input 且一发不发', r3.reason === 'bad-input' && f.calls.length === 0)
}
{
  const f = fakeFetch(() => mkRes(200, { ok: true, queued: [{ chapterId: 'ch-01', chars: 11 }], quota: { chaptersLeft: 4 } }))
  const r = await submitGenChapters(BID, ['ch-01'], { fetchImpl: f })
  t('提交 200 → queued 归一 ＋ 走 POST ＋ 体里只有 chapters',
    r.ok === true && r.data.queued.length === 1 && f.calls[0].method === 'POST'
    && eq(JSON.parse(f.calls[0].body), { chapters: ['ch-01'] }))
}
{
  const f = fakeFetch(() => mkRes(403, { error: 'daily quota exceeded', chaptersLeft: 0 }))
  const r = await submitGenChapters(BID, ['ch-01'], { fetchImpl: f })
  t('额度超限 403 → ok:false 且带上服务端那句「daily quota exceeded」',
    r.ok === false && r.status === 403 && r.error === 'daily quota exceeded')
}
{
  const f = fakeFetch(() => mkRes(200, {}))
  const r = await submitGenChapters(BID, ['oops'], { fetchImpl: f })
  t('勾选不合格 → bad-selection 且**不发请求**（别让用户白等一个 400）',
    r.ok === false && r.reason === 'bad-selection' && f.calls.length === 0)
  const r2 = await submitGenChapters(BID, ['ch-01', 'ch-02', 'ch-03', 'ch-04', 'ch-05', 'ch-06'], { fetchImpl: f })
  t('超过 5 章在客户端就截断成 5（避免服务端 400）',
    r2.ok === true && eq(JSON.parse(f.calls[0].body).chapters, ['ch-01', 'ch-02', 'ch-03', 'ch-04', 'ch-05']))
}
{
  const f = fakeFetch(() => mkRes(200, { ok: true, bookId: BID, removedAudioObjects: 3, indexCleared: true }))
  const r = await clearBookAudioRemote(BID, { fetchImpl: f })
  t('清空 200 → DELETE 走**音频**路由 ＋ indexCleared',
    r.ok === true && f.calls[0].method === 'DELETE' && f.calls[0].url === `/api/book/${BID}/audio`
    && r.data.indexCleared === true && r.data.removedAudioObjects === 3)
}
{
  const r = await clearBookAudioRemote(BID, { fetchImpl: fakeFetch(() => mkRes(401)) })
  t('清空未登录 401 → ok:false（不抛）', r.ok === false && r.status === 401)
}
{
  const r = await clearBookAudioRemote(BID, { fetchImpl: async () => { throw new Error('net') } })
  t('清空网络错 → status 0 ／ reason network', r.ok === false && r.status === 0 && r.reason === 'network')
}

// ═══ ⑨ 卫生：主包不许引 src/generate/ ═══
console.log('\n[genApi — 卫生：这一支必须留在主包，不许反向引懒加载块]')
{
  const src = readFileSync(join(__dirname, 'src/utils/genApi.js'), 'utf8')
  t('不引 src/generate/（否则主包体积与 LGPL 边界都会被带坏）',
    !/from\s+['"][^'"]*generate\//.test(src) && !/import\(/.test(src))
  t('只用相对 utils 的依赖（audioCloud 的 AUDIO_ROUTE）',
    src.includes("from './audioCloud.js'"))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
