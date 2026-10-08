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
  GEN_PAGE_NOTES, GEN_PACE_NOTE, GEN_POLL_MS,
  MAX_CHAPTER_CHARS, CH_STATE_LABEL, chapterRowState, quotaLeftText,
  fetchGenStatus, submitGenChapters, clearBookAudioRemote,
  SHELF_NOTE_LINES, SHELF_NOTE_COLLAPSED, SHELF_NOTE_KEYS,
  withAudioCount, shelfIndexStale, genEntryTo,
  loadShelfNoteOpen, markShelfNoteSeen, saveShelfNoteOpen,
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

// ═══ ⑩ D-2 生成页要的四条纯逻辑（单章上限 / 行状态 / 徽标 / 额度短语）═══
console.log('\n[genApi — D-2 生成页：单章上限 / 行状态 / 徽标 / 额度短语]')
t('单章字符上限 = 40,000（与 worker 的 MAX_CHAPTER_CHARS 同值手抄）', MAX_CHAPTER_CHARS === 40000)
t('超过上限的章先停：`tooLong`、不可勾（服务端**一定**跳过，先拦在 UI）',
  chapterRowState(null, false, MAX_CHAPTER_CHARS + 1) === CH_STATE.tooLong
  && chapterRowState(null, false, MAX_CHAPTER_CHARS + 1) !== CH_STATE.todo
  && !chapterSelectable(chapterRowState(null, false, MAX_CHAPTER_CHARS + 1))
  && chapterRowState({ status: 'todo' }, false, MAX_CHAPTER_CHARS + 1) === CH_STATE.tooLong)
t('恰好等于上限仍可生成（上限是「大于才算超」）', chapterRowState(null, false, MAX_CHAPTER_CHARS) === CH_STATE.todo)
t('**先看索引**：已经生成出来的长章仍是「已生成」（不因长度翻脸）',
  chapterRowState({ status: 'done' }, true, MAX_CHAPTER_CHARS + 50000) === CH_STATE.ready)
t('其余一律走 chapterGenState，不另立一套判定',
  chapterRowState({ status: 'running' }, false, 1000) === CH_STATE.running
  && chapterRowState({ status: 'pending' }, false, 1000) === CH_STATE.queued
  && chapterRowState({ status: 'failed' }, false, 1000) === CH_STATE.failed
  && chapterRowState({ status: 'purged' }, false, 1000) === CH_STATE.todo
  && chapterRowState(null, false, 1000) === CH_STATE.todo)
t('没有行、索引也没有 = todo（可勾）', chapterSelectable(chapterRowState(null, false, 1000)))
t('徽标表覆盖**全部**状态（少一个就是画出一个空徽标）',
  Object.values(CH_STATE).every((k) => typeof CH_STATE_LABEL[k] === 'string' && CH_STATE_LABEL[k].length > 0)
  && CH_STATE_LABEL[CH_STATE.ready] === '已生成' && CH_STATE_LABEL[CH_STATE.tooLong] === '太长')
t('额度短语：有数报数 / 用尽说尽 / 读不到不编数字',
  quotaLeftText({ chaptersLeft: 3 }) === '今天剩余 3 章'
  && quotaLeftText({ chaptersLeft: 0 }).includes('用完')
  && quotaLeftText(null).includes('稍后可见') && !/\d/.test(quotaLeftText(null))
  && quotaLeftText(null) !== quotaLeftText({ chaptersLeft: 3 }))

// ═══ ⑪ 生成页本体（第 17 步 D-2 · src/views/GenerateAudioView.vue）来源级 ═══
// 组件渲染不在这一层（那靠 Playwright 真机）；这里查的是**埋在组件里就测不到**的那几条：
// 判定与文案有没有绕开 genApi 自己写一套、有没有画出前端自算的假进度、一次提交上限在哪拦。
console.log('\n[D-2 生成页 — 判定只走 genApi、不画假进度、上限先拦]')
{
  const view = readFileSync(join(__dirname, 'src/views/GenerateAudioView.vue'), 'utf8')
  const route = readFileSync(join(__dirname, 'src/router/index.js'), 'utf8')
  const app = readFileSync(join(__dirname, 'src/App.vue'), 'utf8')

  t('路由：/generate/:bookId ＋ 懒加载 ＋ name GenerateAudio',
    route.includes("path: '/generate/:bookId'") && route.includes("name: 'GenerateAudio'")
    && /name: 'GenerateAudio',\s*\n\s*component: \(\) => import\('\.\.\/views\/GenerateAudioView\.vue'\)/.test(route))
  t('生成页不在 tabbar 白名单里（同「导入」：是个要收心的流程），但顶栏给了一条回去的路',
    app.includes("'GenerateAudio'") && /GenerateAudio: 'Audio'/.test(app))
  t('只引 genApi 一条判定入口（章级状态／徽标／额度／排队／提交回执全走它）',
    view.includes("from '../utils/genApi.js'")
    && ['chapterRowState', 'chapterSelectable', 'CH_STATE_LABEL', 'quotaLeftText', 'queueLine',
      'rangeSelection', 'submitGenChapters', 'submitResultLine', 'skipReasonText', 'GEN_PAGE_NOTES',
      'GEN_POLL_MS', 'MAX_CHAPTERS_PER_SUBMIT'].every((n) => view.includes(n)))
  t('不静态引 src/generate/（构建级卫生的来源级那一半）',
    !/from\s+['"][^'"]*generate\//.test(view) && !view.includes("import('"))
  t('不引端上那套（闸／编排／引擎都不在这一页）',
    !view.includes('audioGenGate') && !view.includes('chapterGen') && !view.includes('engine.js'))
  t('三条常规说明直接印 GEN_PAGE_NOTES（文案不在组件里抄一遍）',
    view.includes('v-for="n in GEN_PAGE_NOTES"'))
  t('进度只复读服务端：章级已完成数 ＋ queueLine 的排队位次',
    view.includes('已完成 {{ doneCount }}/{{ activeTotal }} 章') && view.includes('{{ queueText }}'))
  t('**没有**前端自算秒数／百分比的假进度条（D21-g）',
    !/\bpct\b/.test(view) && !view.includes('gen-bar-wait') && !view.includes('estimateRemainingMs')
    && !view.includes('etaMs') && !view.includes('预估剩余'))
  t('分母只算没被清空作废的章（purged 行不算）',
    /summary\.value\.done \+ summary\.value\.pending \+ summary\.value\.running \+ summary\.value\.failed/.test(view))
  t('章级状态走 chapterRowState（先看索引）＋ 徽标走 CH_STATE_LABEL',
    view.includes('chapterRowState(row, readySet.value.has(ch.id), ch.chars)')
    && view.includes('CH_STATE_LABEL[state]'))
  t('可勾判定走 chapterSelectable（已生成／在跑的章不给勾）', view.includes('chapterSelectable(state)'))
  t('区间勾选走 rangeSelection（不自己拼区间）',
    view.includes('rangeSelection(chapters.value, rangeFrom.value, rangeTo.value)'))
  t('一次最多 MAX_CHAPTERS_PER_SUBMIT 章：勾超先拦，别等一个 400',
    /cur\.length >= MAX_CHAPTERS_PER_SUBMIT/.test(view))
  t('底部＝「本次将生成 N 章（今天剩余 M 章）」',
    view.includes('本次将生成 {{ selectedIds.length }} 章（{{ quotaText }}）'))
  t('额度不够先拦（403 前就说明白，不让用户白等）',
    view.includes('blockedByQuota') && view.includes('今天的额度不够'))
  t('提交走 submitGenChapters；回执走 submitResultLine ＋ 逐条 skipReasonText',
    view.includes('await submitGenChapters(id, selectedIds.value)')
    && view.includes('submitResultLine(r.data)') && view.includes('skipReasonText(s.reason)'))
  t('轮询：节拍走 GEN_POLL_MS ＋ 空闲停表 ＋ 后台不发 ＋ 卸载收表',
    view.includes('GEN_POLL_MS') && view.includes("document.visibilityState === 'hidden'")
    && /onBeforeUnmount\(stopPoll\)/.test(view)
    && /if \(pollTimer\) \{ clearInterval\(pollTimer\); pollTimer = null \}/.test(view))
  t('只有「有在排队／在跑」才起表（空闲不空转）',
    /function startPoll\(\) \{\s*\n\s*stopPoll\(\)\s*\n\s*pollOnce\(\)\s*\n\s*pollTimer = setInterval\(pollOnce, GEN_POLL_MS\)/.test(view)
    && view.includes('if (d && inFlight.value) startPoll()'))
  t('台账说 done 比手上索引多 → 补拉一次真索引（别的设备刚生成完）',
    view.includes('r.data.summary.done > readySet.value.size') && view.includes('await pullIndex()'))
  t('过期答复丢弃（换了书就不写回）', view.includes('if (id !== bookId.value) return'))
  t('404 ＝ 确知为空（`indexKnown`），别的错才叫「不知道」',
    view.includes('res.status === 404') && view.includes('indexKnown.value = true'))
  t('未登录 → 引导登录（不画生成界面，D21-j）',
    view.includes('needLogin') && view.includes('to="/account"'))
  t('书不在本机 / 非 BYO → 说清原因 ＋ 给一条回书架的路',
    view.includes('这本书不在本机') && view.includes('to="/books"')
    && view.includes('loadByoRecord') && view.includes('isBookId'))
  // 只查**模板**（脚本那段头注释里写着「不提供『重新生成』」，那是说明、不是按钮）
  const tpl = view.split('<script setup>')[0]
  t('不提供「重新生成」按钮（D21-l：要换就清空音频再来）',
    !tpl.includes('重新生成') && !/regenerate/i.test(tpl))
}

// ═══ ⑫ My Books 常驻条＋书级入口（第 17 步 D-3 · genApi 新件 ＋ BookListView／BookCard）═══
// 同 ⑪：组件渲染靠真机，这里查「埋在组件里就测不到」的那几条 —— 文案与判定有没有绕开 genApi
// 自己写一套、什么时候才发请求、未登录会不会空转、书架页有没有把懒加载那块拖进主包。
console.log('\n[D-3 My Books — 常驻条／索引新鲜度／折叠记忆／入口三态落到书卡]')
{
  t('withAudioCount 只数 withAudio；形状坏 → 0（不妄断）',
    withAudioCount({ withAudio: ['ch-01', 'ch-02'] }) === 2
    && withAudioCount({ withAudio: [] }) === 0
    && withAudioCount(null) === 0 && withAudioCount({ withAudio: 'ch-01' }) === 0)

  t('shelfIndexStale：没缓存 + 台账 done>0 → 要拉（别的设备刚生成完）',
    shelfIndexStale({ done: 2 }, null) === true)
  t('shelfIndexStale：都没生成过（done 0、没缓存）→ 不拉（0 就是 0）',
    shelfIndexStale({ done: 0 }, null) === false && shelfIndexStale({}, null) === false)
  t('shelfIndexStale：缓存与台账一致 → 不拉（省一次往返）',
    shelfIndexStale({ done: 3 }, 3) === false)
  t('shelfIndexStale：台账 done=0 但缓存有 3 → 要拉（这本被清空过，缓存是旧账）',
    shelfIndexStale({ done: 0 }, 3) === true)
  t('shelfIndexStale：台账比缓存多 → 要拉（真索引才是「已生成 x/y」的口径）',
    shelfIndexStale({ done: 4 }, 2) === true)

  t('入口三态 → 路径：未登录去账号页，其余去生成页',
    genEntryTo('login', BID) === '/account' && genEntryTo('start', BID) === `/generate/${BID}`
    && genEntryTo('busy', BID) === `/generate/${BID}` && genEntryTo('partial', BID) === `/generate/${BID}`)

  t('常驻条文案：≥3 句、写「体验期免费」、**不写死章数**（D21-e）',
    SHELF_NOTE_LINES.length >= 3 && SHELF_NOTE_LINES.join('').includes('体验期免费')
    && !/\d/.test(SHELF_NOTE_LINES.join('')) && !/\d/.test(SHELF_NOTE_COLLAPSED))
  t('常驻条说清「默认是机械音 ＋ 封面下方可生成」；收起那一行也不是空的',
    SHELF_NOTE_LINES.join('').includes('浏览器 TTS') && SHELF_NOTE_LINES.join('').includes('封面下方')
    && SHELF_NOTE_COLLAPSED.length > 10 && SHELF_NOTE_COLLAPSED.includes('体验期免费'))

  const fakeStore = () => ({
    m: {},
    getItem(k) { return k in this.m ? this.m[k] : null },
    setItem(k, v) { this.m[k] = v },
  })
  {
    const s = fakeStore()
    t('折叠记忆：首次（什么都没记过）→ 展开（D21-m 的「首次展开」）', loadShelfNoteOpen(s) === true)
    markShelfNoteSeen(s)
    t('折叠记忆：「首次展开」只给一次 —— 标记看过之后默认收起', loadShelfNoteOpen(s) === false)
    saveShelfNoteOpen(true, s)
    t('折叠记忆：用户手动展开过 → 以他为准（不被「看过了」压回去）', loadShelfNoteOpen(s) === true)
    saveShelfNoteOpen(false, s)
    t('折叠记忆：用户手动收起 → 以他为准', loadShelfNoteOpen(s) === false)
    t('折叠记忆的键名固定（新件也走 localStorage，不另起一套）',
      SHELF_NOTE_KEYS.seen === 'reader-gen-note-seen' && SHELF_NOTE_KEYS.open === 'reader-gen-note-open')
  }
  {
    const boom = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    t('存储被挡住（隐私模式）→ 恒不抛：当首次展开，写也不炸',
      loadShelfNoteOpen(boom) === true
      && (markShelfNoteSeen(boom), saveShelfNoteOpen(false, boom), true))
    t('没有 localStorage（Node／老浏览器）→ 也恒不抛、当首次展开',
      loadShelfNoteOpen(undefined) === true
      && (markShelfNoteSeen(undefined), saveShelfNoteOpen(true, undefined), true))
  }

  const list = readFileSync(join(__dirname, 'src/views/BookListView.vue'), 'utf8')
  const card = readFileSync(join(__dirname, 'src/components/BookCard.vue'), 'utf8')

  t('书卡吃 `:gen="genOf(book)"`；三态与路径都由 genApi 算（genEntryState／genEntryTo）',
    list.includes(':gen="genOf(book)"') && list.includes('genEntryState({')
    && list.includes('genEntryTo(e.kind, book.id)'))
  t('常驻条直接印 SHELF_NOTE_LINES／SHELF_NOTE_COLLAPSED（文案不在组件里抄一遍）',
    list.includes('v-for="n in SHELF_NOTE_LINES"') && list.includes('{{ SHELF_NOTE_COLLAPSED }}'))
  t('常驻条可折叠：首次展开 ＋ 点过记住（D21-m）',
    list.includes('loadShelfNoteOpen()') && list.includes('markShelfNoteSeen()')
    && list.includes('saveShelfNoteOpen(noteOpen.value)'))
  t('未登录／没书 → 一发不请求（入口退到「登录后可生成」，D21-j）',
    /if \(!auth\.user\.value \|\| !myBooks\.value\.length\) \{ genInfo\.value = \{\}; stopGenPoll\(\); return \}/.test(list))
  t('逐本问、限并发 4（书架最多 20 本自带书，别一次占满连接）',
    list.includes('Math.min(4, queue.length)'))
  t('「生成中」只认服务端台账（pending＋running），不自己编进度／秒数',
    /v\.summary\.pending \+ v\.summary\.running/.test(list) && !/\bpct\b/.test(list)
    && !list.includes('预估剩余') && !list.includes('etaMs'))
  t('台账与本机缓存对不上才补拉真索引（shelfIndexStale）；404 判成「确知为空」',
    list.includes('shelfIndexStale(summary, count)') && list.includes('ci.status === 404')
    && list.includes('saveAudioIndex(bookId, ci.index)'))
  t('轮询：GEN_POLL_MS ＋ 只问在跑的书 ＋ 后台不发 ＋ 卸载收表',
    list.includes('GEN_POLL_MS') && list.includes("document.visibilityState === 'hidden'")
    && /onBeforeUnmount\(stopGenPoll\)/.test(list)
    && /if \(genPollTimer\) \{ clearInterval\(genPollTimer\); genPollTimer = null \}/.test(list)
    && /const ids = genBusyIds\.value/.test(list))
  t('书架页不静态引 src/generate/（构建级卫生的来源级那一半）',
    !/from\s+['"][^'"]*generate\//.test(list))
  t('书卡：生成入口是 router-link，且挂在卡片 link **之外**（a 不能嵌 a，iOS Safari 会连导航触发）',
    card.includes('v-if="gen"') && card.includes(':to="gen.to"') && card.includes('{{ gen.label }}')
    && card.indexOf('class="book-gen"') > card.indexOf('</router-link>'))
  t('书卡不自己判定、不引 genApi 之外的东西（判定与文案只有一份）',
    !/genEntryState\s*\(/.test(card) && !card.includes('withAudioCount')
    && !/from\s+['"][^'"]*genApi/.test(card))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
