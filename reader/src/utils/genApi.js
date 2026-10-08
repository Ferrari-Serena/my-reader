/**
 * 第 17 步块 D · 服务端合成（块 C）的**客户端**：提交章节 / 查进度 / 清空该书音频。
 *
 *   POST /api/gen/book/<bookId>   { chapters: [...] } → { queued, requeued, skipped, quota }
 *   GET  /api/gen/book/<bookId>                      → { chapters, summary, queue, quota }
 *   DELETE /api/book/<bookId>/audio                  → 清空该书音频（D25；**不是**删书路由）
 *
 * 为什么放 `utils/`（主包）而不是 `src/generate/`：「这本书有没有章在排队」是**播放器每次
 * 开书都要问一次**的请求（pending 热切），而主包**不许静态引 `src/generate/`**（体积 ＋
 * lamejs 的 LGPL 边界，见 `verify-generate.mjs` 的卫生断言）。本文件只做「请求 ＋ 纯判定」，
 * 与 `utils/audioCloud.js` 同姿态：**恒不抛**，拿不到就退回「没有在跑」，绝不自己编状态。
 *
 * 口径只在两处：服务端契约（`worker/src/audiogen.js`）与本文件。UI 文案与三态判定都走这里，
 * 免得 My Books 常驻条、生成页、播放器各写一套慢慢漂开。
 *
 * ⚠️ **URL 一律不含 code**（D16）：租户由会话反推；未登录 401、账号没认领主码 403。
 */
import { AUDIO_ROUTE } from './audioCloud.js'

export const GEN_ROUTE = '/api/gen/book/'
/** 单次请求超时（提交与状态都用它；清空也一样 —— 都是小请求） */
export const GEN_TIMEOUT_MS = 10000

/**
 * 阅读器「云端就绪 → 就地热切」的轮询节拍（§13.2：5–10 s）。
 * 章内那块 GenAudioPanel 撤掉之后（第 17 步块 D-1），这条轮询由 `ReaderView` 用本模块跑。
 */
export const GEN_POLL_MS = 6000
/** 一次提交最多几章 —— 与 worker 的 `DAILY_CHAPTERS` **同值手抄**（超了服务端回 400） */
export const MAX_CHAPTERS_PER_SUBMIT = 5
/** 章 id 形状 —— 与 worker 的 `CHAPTER_ID_RE` 同形（`ch-01` / `ch-100`） */
export const CHAPTER_ID_RE = /^ch-\d+$/

export function genStatusPath(bookId) { return `${GEN_ROUTE}${encodeURIComponent(bookId)}` }
/** D25 的「清空该书音频」路径 —— 走**音频**路由，不是 `/api/sync/book/…`（那条连正文一起删） */
export function clearBookAudioPath(bookId) { return `${AUDIO_ROUTE}${encodeURIComponent(bookId)}/audio` }

export function isValidChapterId(id) { return CHAPTER_ID_RE.test(String(id || '')) }

// ── 纯逻辑① 勾选 → 载荷 ─────────────────────────────────────────────────────

/**
 * 章节多选 → 提交载荷（D21-c 的「单章／多章／区间」最终都归到这里）。
 * 去重、丢掉形状不对的、按上限截断（服务端也会挡，这里先挡是为了**别让用户白等一个 400**）。
 */
export function selectionPayload(chapterIds) {
  const picked = []
  let dropped = 0
  for (const raw of Array.isArray(chapterIds) ? chapterIds : []) {
    const id = String(raw || '')
    if (!isValidChapterId(id)) { dropped++; continue }
    if (picked.includes(id)) continue
    if (picked.length >= MAX_CHAPTERS_PER_SUBMIT) { dropped++; continue }
    picked.push(id)
  }
  if (!picked.length) return { ok: false, chapters: [], dropped, error: '请至少勾选一章' }
  return { ok: true, chapters: picked, dropped }
}

/** 连续区间（D21-c 的「区间」）：给两个端点章 id → 中间全部（含端点）；端点认不出 → [] */
export function rangeSelection(chapters, fromId, toId) {
  const ids = (Array.isArray(chapters) ? chapters : []).map((c) => String((c && c.id) || ''))
  const a = ids.indexOf(String(fromId || ''))
  const b = ids.indexOf(String(toId || ''))
  if (a < 0 || b < 0) return []
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return ids.slice(lo, hi + 1)
}

// ── 纯逻辑② 状态归一（形状坏 → 空壳，不妄断）───────────────────────────────

function num(v, dflt = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/** 额度归一：`chaptersLeft` 认不出就是 null（UI 写「稍后可见」，不编数字） */
export function normalizeQuota(q) {
  const o = (q && typeof q === 'object' && !Array.isArray(q)) ? q : {}
  return {
    chaptersLeft: o.chaptersLeft === null || o.chaptersLeft === undefined ? null : num(o.chaptersLeft, 0),
    charsLeft: o.charsLeft === null || o.charsLeft === undefined ? null : num(o.charsLeft, 0),
    chaptersUsed: num(o.chaptersUsed),
    charsUsed: num(o.charsUsed),
    unknown: !!o.unknown,
  }
}

/** `GET` 的答复 → 归一形态（章表 ＋ 汇总 ＋ 队列 ＋ 额度） */
export function normalizeGenStatus(body, bookId = '') {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {}
  const raw = (b.chapters && typeof b.chapters === 'object' && !Array.isArray(b.chapters)) ? b.chapters : {}
  const chapters = {}
  for (const [id, v] of Object.entries(raw)) {
    const row = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
    chapters[String(id)] = {
      status: String(row.status || ''),
      title: String(row.title || ''),
      chars: num(row.chars),
      attempts: num(row.attempts),
      error: row.error ? String(row.error) : null,
    }
  }
  const s = (b.summary && typeof b.summary === 'object') ? b.summary : {}
  const q = (b.queue && typeof b.queue === 'object') ? b.queue : {}
  return {
    bookId: String(b.bookId || bookId || ''),
    chapters,
    summary: {
      total: num(s.total), pending: num(s.pending), running: num(s.running),
      done: num(s.done), failed: num(s.failed),
    },
    queue: { ahead: num(q.ahead), position: num(q.position) },
    quota: normalizeQuota(b.quota),
  }
}

/** `POST` 的答复 → 归一形态（三份名单 ＋ 额度） */
export function normalizeSubmit(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {}
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => ({
    chapterId: String((x && x.chapterId) || ''),
    reason: String((x && x.reason) || ''),
    chars: num(x && x.chars),
  }))
  return { queued: list(b.queued), requeued: list(b.requeued), skipped: list(b.skipped), quota: normalizeQuota(b.quota) }
}

/** `DELETE` 的答复 → 归一形态 */
export function normalizeClear(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {}
  return {
    ok: b.ok !== false,
    bookId: String(b.bookId || ''),
    removedAudioObjects: num(b.removedAudioObjects, -1),
    indexCleared: !!b.indexCleared,
  }
}

// ── 纯逻辑③ 章级状态（生成页勾选 ＋ 播放器提示共用）──────────────────────────

export const CH_STATE = {
  ready: 'ready',      // 索引里有音频 —— 能播就是能播
  running: 'running',  // 服务端正在跑这一章
  queued: 'queued',    // 排队中
  failed: 'failed',    // 跑挂了（可重新提交，不重复扣额度）
  stale: 'stale',      // 队列行说 done，但索引里**没有**音频
  todo: 'todo',        // 从没提交过
}

/**
 * 章级状态。优先级：**先看索引**（有音频就是 ready，别被队列行抢），再看队列行。
 *
 * `purged`（服务端 D25-f 已裁 A）：清空该书音频时，该书 `done`／`failed` 的行被**改成**
 * `purged`（行不删，配额靠行记）⇒ 这一章回到「可重新生成」，映射到 `todo`（可勾、可提）。
 *
 * `stale`（行说 done、音频没了）现在**正常路径上不会再出现**了（有 `purged` 兜住）；留着它
 * 是给两种情况当安全网：① 清空时 D1 抖了、作废没跑成；② 接口新旧不一致的窗口期。
 * 真出现也不妄断：当作「**可重新生成**」，绝不当「已生成」—— 否则播放器会去点一个并不
 * 存在的 mp3（服务端此时仍会判 already-done，属于已知的降级）。
 */
export function chapterGenState(row, hasAudio) {
  if (hasAudio) return CH_STATE.ready
  const st = String((row && row.status) || '')
  if (st === 'pending') return CH_STATE.queued
  if (st === 'running') return CH_STATE.running
  if (st === 'failed') return CH_STATE.failed
  if (st === 'purged') return CH_STATE.todo
  if (st === 'done') return CH_STATE.stale
  return CH_STATE.todo
}

/** 这一章现在能不能勾（todo／stale／failed 可以；已就绪、排队中、在跑的不行） */
export function chapterSelectable(state) {
  return state === CH_STATE.todo || state === CH_STATE.stale || state === CH_STATE.failed
}

/** 这一章此刻在排队／生成中吗（播放器据此显示 pending ＋ 轮询热切） */
export function isChapterPending(gen, chapterId) {
  const row = gen && gen.chapters && gen.chapters[String(chapterId || '')]
  const st = String((row && row.status) || '')
  return st === 'pending' || st === 'running'
}

// ── 纯逻辑④ 文案（D21-e／f／g／l）───────────────────────────────────────────

/**
 * My Books 的入口三态 ＋ 常驻条（D21-b／f／m）。返回 `{ kind, label, done, total, busy }`：
 *   `none`    非 BYO 书（公开书不给生成入口，D21-i）
 *   `login`   未登录（点了一律引导登录，D21-j）
 *   `start`   一章音频都没有 → 「去生成音频 →」
 *   `busy`    有章在排队／跑 → 「生成中 2/5 · 点看进度」（D21-f 的三态之一）
 *   `partial` 有音频、此刻没在跑 → 「已生成 3/10 章 · 继续生成」
 * `done` ＝ 已就绪章数（索引 withAudio），`total` ＝ 这本书的章数。
 */
export function genEntryState({ isByo, loggedIn, chapterCount, withAudioCount, summary } = {}) {
  if (!isByo) return { kind: 'none', label: '', done: 0, total: 0, busy: 0 }
  if (!loggedIn) return { kind: 'login', label: '登录后可生成真人朗读', done: 0, total: 0, busy: 0 }
  const total = Math.max(0, num(chapterCount))
  const done = Math.max(0, num(withAudioCount))
  const busy = Math.max(0, num(summary && summary.pending)) + Math.max(0, num(summary && summary.running))
  if (busy > 0) return { kind: 'busy', label: `生成中 ${done}/${done + busy} · 点看进度`, done, total, busy }
  if (done > 0) {
    const left = Math.max(0, total - done)
    return {
      kind: 'partial', done, total, busy: 0,
      label: left > 0 ? `已生成 ${done}/${total} 章 · 继续生成` : `已生成 ${done}/${total} 章 · 重新生成或清空`,
    }
  }
  return { kind: 'start', label: '去生成音频 →', done: 0, total, busy: 0 }
}

/** 剩余额度一句话（D21-e：**不写死具体章数**、也不承诺永久免费 —— 只写「体验期免费」） */
export function quotaLine(quota) {
  const q = normalizeQuota(quota)
  if (q.chaptersLeft === null) return '今日额度稍后可见（体验期免费，单账号每日限额）'
  if (q.chaptersLeft <= 0) return '今天的额度用完了 —— 明天再来，或先清空某本书的音频腾空间'
  return `今天还可生成 ${q.chaptersLeft} 章（体验期免费，单账号每日限额）`
}

/** 排队位次一句话（只报服务端复读的真数字，不自算秒数 —— D21-g） */
export function queueLine(queue) {
  const ahead = Math.max(0, num(queue && queue.ahead))
  if (ahead === 0) return '正在生成你的章节（约 1–2 分钟／章）'
  return `前面还有 ${ahead} 个任务在排队（一次跑一章，约 1–2 分钟／章）`
}

/** 提交被跳过的原因 → 一句人话（服务端 `skipped[].reason` 的字典） */
export const SKIP_HINT = {
  'unknown-chapter': '这本书里没有这一章',
  'empty-chapter': '这一章没有正文',
  'chapter-too-long': '这一章太长，超过单章上限',
  'already-done': '已经有音频了',
  'already-queued': '已经在排队了',
  'already-running': '正在生成中',
}

export function skipReasonText(reason) {
  return SKIP_HINT[String(reason || '')] || '没有通过服务端的检查'
}

/** 提交结果 → 一句话（生成页顶部的反馈行） */
export function submitResultLine(data) {
  const d = normalizeSubmit(data)
  const parts = []
  if (d.queued.length) parts.push(`已排队 ${d.queued.length} 章`)
  if (d.requeued.length) parts.push(`重新排队 ${d.requeued.length} 章`)
  if (d.skipped.length) {
    const why = d.skipped[0] ? skipReasonText(d.skipped[0].reason) : ''
    parts.push(`跳过 ${d.skipped.length} 章${why ? `（${why}）` : ''}`)
  }
  return parts.length ? parts.join('，') : '没有可提交的章节'
}

/** 单章耗时口径（D21-l：约 1–2 分钟／章；**不是**前端自算进度） */
export const GEN_PACE_NOTE = '约 1–2 分钟／章；可以关掉页面，后端继续生成。'
/** 生成页常规说明三句（D21-l） */
export const GEN_PAGE_NOTES = [
  '体验期免费（单账号每日限额）。',
  GEN_PACE_NOTE,
  '生成的音频只存在你自己的账号空间，仅个人使用。',
]

// ── 网络（恒不抛；拿不到就退回「没有在跑」）─────────────────────────────────

async function requestJson(fetchImpl, url, init, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(url, { ...(init || {}), signal: ctrl ? ctrl.signal : undefined })
    const status = num(res && res.status)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: !!(res && res.ok), status, body }
  } catch (e) {
    return {
      ok: false, status: 0, body: null,
      reason: (e && e.name === 'AbortError') ? 'timeout' : 'network',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 查这本书的生成状态。**恒不抛**：
 *   200 → `{ ok:true, status, data }`
 *   401 → `{ ok:false, status:401 }`（未登录；静默，不报错）
 *   `{status:0, reason:'timeout'|'network'}` → 当作「没有在跑」，失败不影响阅读
 */
export async function fetchGenStatus(bookId, { fetchImpl = globalThis.fetch, timeoutMs = GEN_TIMEOUT_MS } = {}) {
  if (!bookId) return { ok: false, status: 0, reason: 'bad-input', data: null }
  const r = await requestJson(fetchImpl, genStatusPath(bookId), { method: 'GET' }, timeoutMs)
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason || 'http', data: null }
  return { ok: true, status: r.status, data: normalizeGenStatus(r.body, bookId) }
}

/** 提交章节（`POST`）。`error` 直接取服务端那句（额度超限／书不见了等） */
export async function submitGenChapters(bookId, chapterIds, { fetchImpl = globalThis.fetch, timeoutMs = GEN_TIMEOUT_MS } = {}) {
  const payload = selectionPayload(chapterIds)
  if (!bookId) return { ok: false, status: 0, reason: 'bad-input', error: null, data: null }
  if (!payload.ok) return { ok: false, status: 0, reason: 'bad-selection', error: payload.error, data: null }
  const r = await requestJson(fetchImpl, genStatusPath(bookId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapters: payload.chapters }),
  }, timeoutMs)
  return {
    ok: r.ok, status: r.status, reason: r.reason || null,
    error: (r.body && r.body.error) || null,
    data: r.ok ? normalizeSubmit(r.body) : null,
  }
}

/** 清空该书音频（D25）。**只删音频**：正文与笔记不动 */
export async function clearBookAudioRemote(bookId, { fetchImpl = globalThis.fetch, timeoutMs = GEN_TIMEOUT_MS } = {}) {
  if (!bookId) return { ok: false, status: 0, reason: 'bad-input', error: null, data: null }
  const r = await requestJson(fetchImpl, clearBookAudioPath(bookId), { method: 'DELETE' }, timeoutMs)
  return {
    ok: r.ok, status: r.status, reason: r.reason || null,
    error: (r.body && r.body.error) || null,
    data: r.ok ? normalizeClear(r.body) : null,
  }
}
