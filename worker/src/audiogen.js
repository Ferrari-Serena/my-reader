/**
 * my-reader 第 17 步 · 块 C —— 服务端合成（DeepInfra Kokoro-82M）＋ D1 任务表 ＋ cron 巡检
 *
 * 设计定案见 Phase1 §13.9（**D24**）与开工实测 §13.10。一句话：
 *   **一章一任务**（键 =（账号, bookId, 章号））＋ **只靠 cron 每分钟轮询**（不做「提交即触发」：
 *   `waitUntil` 只续 30 s，短于一章 1–2 分钟）＋ **串行**（章内串行、章间串行、不同账号不并跑）。
 *
 * 路由（会话闸与 `/api/book/*` 同一份判定 = syncgate.js 的 sessionTenant）：
 *   POST /api/gen/book/<bookId>   提交章节（JSON `{ chapters: ["ch-01", …] }`）→ 写任务表、立即返回
 *   GET  /api/gen/book/<bookId>   状态（章级 + 排队位次 + 剩余额度）—— 服务端复读，关页再回来仍在
 * 两条都**不含 code**（租户由会话反推 `users.sync_code`）；带 `?code=` → 400。
 *
 * 合成管线（主路 B · 并块、不插静音）：
 *   取章正文（R2 `books/<code>/<bookId>.json` 的 chapters[].paragraphs[].text）
 *     → 按段落累计切块（每块 ≤9,000 字符；块边界必落段落上）
 *     → 每块 1 次 DeepInfra 调用（mp3 ＋ return_timestamps）
 *     → 逐块剥 ID3v2／Xing／LAME 头（时长按帧数算：MPEG2 LSF，576 样本 ＝ 24 ms）
 *     → 按帧数拼接（块产物留内存，≤5 块 ≈ 19.6 MB ≪ isolate 128 MB），终产物一次 put
 *     → 词级时标**先按块缩放**（k = 本块音频时长 ÷ 本块词表跨度）**再按已拼帧偏移合并**
 *     → 段落起点按**贪心文本对齐**（跳纯标点 token）
 *     → 写 user/<code>/<bookId>/<ch>.mp3 ＋ <ch>.timings.json → 翻 audio-index.json（no-store）
 *   两条时标修正是 2026-10-08 实测结论（§13.10 e），**不照做 timings 就是错的**。
 *
 * 平台口径（2026-10-08 实测，§13.10）：整章 cron invocation `cpuTime` 73–76 ms、`outcome=ok`
 *   ⇒ Free 的 10 ms 没咬（实测硬上限 ~2 s，≈26× 余量）。**Free 的子请求 50／invocation 是硬闸**：
 *   本文件按「≤5 块/章 ⇒ 一章一次 invocation 装得下」设计，并另有动态预算兜底（见 SUBREQ_BUDGET）。
 *
 * 配额双闸（D21-d，按账号、按 UTC 日）：5 章/天 ＋ ≤80,000 字符/天。**不排队、不次日自动续**；
 *   超限直接 403 并给出剩余额度。**内部失败重试不扣用户额度**（同一章同一行，配额只算一次）。
 *   「重新生成」不提供（D21-h）：已完成的章重复提交只回报 `already-done`；永久失败的章可重提
 *   （同一行重置为 pending，不新增配额）；要换成别的章内容就删音频再来（D25 的「清空该书音频」）。
 *   **2026-10-08 裁 A（D25-f）**给「删音频再来」补上了落点：书级清空把该书的 `done`／`failed`
 *   行改成 `purged`（**不删行**），重提走 `SQL_TASK_REPURGE`（`purged` → `pending`、attempts 归零、
 *   **`created_at` 重置到本次**）⇒ 配额照记在当天。作废与清空由 `bookaudio.js` 的
 *   `clearBookAudio` 调用本文件的 `purgeBookTasks` 同趟做（有章在跑就回 409、谁也不许清）。
 *
 * 不配 Queue、不用 env.AI 绑定：DeepInfra key 走 Worker secret `DEEPINFRA_API_KEY`。
 */

import { corsFor } from './cors.js'
import { sessionTenant } from './syncgate.js'
import { isBookId } from './sync.js'
import { bookObjectKey } from './booksync.js'
import { audioObjectKey, INDEX_FILE } from './bookaudio.js'

export const ROUTE_PREFIX = '/api/gen/'

/** 每分钟一 tick（D24-b）—— 必须挂在**本就存在**的 my-reader-tts 上（新 worker 的 cron 冷启动实测 ≈80 min） */
export const TICK_CRON = '* * * * *'
/** 注销冷静期真删的既有触发器（wrangler.toml 里那条）；scheduled() 按 event.cron 分派，别合流 */
export const PURGE_CRON = '17 3 * * *'

/** 单块字符上限：DeepInfra 单请求 text 硬限 10,000，留余量 */
export const BLOCK_CHARS = 9000
/** 单块绝对上限（切块时的兜底；单段超限就单独成块、由 DeepInfra 挡下并上报） */
export const MAX_BLOCK_CHARS = 10000
/** 单章正文字符上限（D23：超过就明确停 ＋ 给可读原因，不排队、不切分） */
export const MAX_CHAPTER_CHARS = 40000
/** 单章产物守卫值（D23：32 MiB；正常永不触发，不是硬切分线） */
export const MAX_CHAPTER_BYTES = 32 * 1024 * 1024
/** 日配额双闸（D21-d，按账号、按 UTC 日） */
export const DAILY_CHAPTERS = 5
export const DAILY_CHARS = 80000
/** 单任务最多起跑次数：≥3 不再重试（转 failed） */
export const MAX_ATTEMPTS = 3
/** `running` 心跳超此值判死（5 分钟）—— cron invocation 可重叠，靠它回收僵尸任务 */
export const STALE_MS = 5 * 60 * 1000
/** 一个 tick 最多处理几章（同一账号）—— D24-c 的 K = 3 */
export const K_PER_TICK = 3
/** 一个 tick 的墙钟预算（cron duration 上限 15 min，留余量） */
export const TICK_WALL_BUDGET_MS = 10 * 60 * 1000
/** 一个 invocation 的子请求预算（Free = 50/invocation；45 留余量给兜底路径） */
export const SUBREQ_BUDGET = 45
/** 默认音色／语速（D21-c 的口径：Phase 1 不开放选择） */
export const DEFAULT_VOICE = 'am_michael'
export const DEFAULT_SPEED = 1
export const DI_URL = 'https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M'

const NO_STORE = 'no-store'
const CHAPTER_ID_RE = /^ch-[0-9]+$/

// ── 任务状态（行落在 audio_tasks；表与两列的头注见 migrations/0005、0006）────────

/** 行还在、音频已经被「清空该书音频」清掉（D25-f）：可重提，且配额照记在当天 */
export const TASK_PURGED = 'purged'
/** 「还没跑完」（在排队 ／ 正在跑）—— 清空音频拿它当闸；其余状态都不算 */
export function isPendingStatus(st) {
  const v = String(st || '')
  return v === 'pending' || v === 'running'
}

// ── D1 语句（导出供自检直接跑；语义断言见 verify-audiogen.mjs）────────────────

/** 提交一行（幂等：同章重复提交撞主键 → changes=0；不重复计费、不重复写） */
export const SQL_TASK_INSERT = `INSERT OR IGNORE INTO audio_tasks
  (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
/** 某书现有任务（提交时判「已排队／已完成」，状态查询也用它） */
export const SQL_TASKS_FOR_BOOK = `SELECT chapter_id, title, char_count, status, attempts,
    created_at, updated_at, started_at, finished_at, error, bytes, audio_ms
  FROM audio_tasks WHERE code = ? AND book_id = ? ORDER BY chapter_id`
/** 日配额求和（章数 = 行数；字符 = SUM(char_count)）；[dayStart, dayStart+1d) */
export const SQL_QUOTA_SUM = `SELECT COUNT(*) AS chapters, COALESCE(SUM(char_count), 0) AS chars
  FROM audio_tasks WHERE code = ? AND created_at >= ? AND created_at < ?`
/** 永久失败的章可重提：同一行重置为 pending（不新增配额，见文件头） */
export const SQL_TASK_REQUEUE = `UPDATE audio_tasks SET status = 'pending', attempts = 0,
    error = NULL, started_at = NULL, heartbeat = NULL, updated_at = ?
  WHERE code = ? AND book_id = ? AND chapter_id = ? AND status = 'failed'`
/** 清空后重提（D25-f）：`purged` → `pending`，attempts 归零，**`created_at` 重置到本次**
 *  —— 配额按 `created_at` 的归属日求和，不重置就等于把这次重提的额度挂到过去某一天。
 *  只认 `purged`（`failed` 走 SQL_TASK_REQUEUE、`done` 是 already-done），故重提是幂等的。 */
export const SQL_TASK_REPURGE = `UPDATE audio_tasks
  SET status = 'pending', attempts = 0, error = NULL, started_at = NULL, heartbeat = NULL,
    finished_at = NULL, bytes = NULL, audio_ms = NULL, purged_at = NULL,
    title = ?, char_count = ?, created_at = ?, updated_at = ?
  WHERE code = ? AND book_id = ? AND chapter_id = ? AND status = 'purged'`
/** 清空该书音频：`done`／`failed` 的行作废成 `purged` ＋ 落 `purged_at`（**不删行**，配额靠行记）。
 *  `NOT EXISTS` 守卫让「读到没有在跑的、写之前被 cron 抢先认领」这种时序也伤不到在跑的任务。 */
export const SQL_PURGE_BOOK_TASKS = `UPDATE audio_tasks
  SET status = 'purged', purged_at = ?, updated_at = ?
  WHERE code = ? AND book_id = ? AND status IN ('done', 'failed')
    AND NOT EXISTS (SELECT 1 FROM audio_tasks
      WHERE code = ? AND book_id = ? AND status IN ('pending', 'running'))`
/** 领任务①：全局最老的 pending（它定义了本 tick 的账号） */
export const SQL_NEXT_PENDING = `SELECT code, book_id, chapter_id, char_count
  FROM audio_tasks WHERE status = 'pending'
  ORDER BY created_at, code, book_id, chapter_id LIMIT 1`
/** 领任务②：**某个账号**待跑清单（本 tick 只跑一个账号 → 串行；按先来先服务）
 *  ⚠️ 一次读一小把、而不是「跑完一枚再查下一枚」：失败会把任务打回 pending，
 *  若每轮重新查最老的 pending，同一枚会在**同一个 tick 内被连着重试 3 次** ——
 *  一次瞬时抖动就把重试额度烧光、任务直接判死。故本 tick 试过的章记进 `tried` 跳过。 */
export const SQL_PENDING_FOR_LIST = `SELECT book_id, chapter_id, char_count
  FROM audio_tasks WHERE code = ? AND status = 'pending'
  ORDER BY created_at, book_id, chapter_id LIMIT ?`
/** 原子认领（租约）：只有 `pending` 能被领；**查 changes 判有没有领到**（防 cron 重叠双启） */
export const SQL_CLAIM = `UPDATE audio_tasks
  SET status = 'running', attempts = attempts + 1, started_at = ?, heartbeat = ?, updated_at = ?, error = NULL
  WHERE code = ? AND book_id = ? AND chapter_id = ? AND status = 'pending'`
/** 跑章期间每完成一块写一次；守卫 `status='running'`（被判死回收后就不再写） */
export const SQL_HEARTBEAT = `UPDATE audio_tasks SET heartbeat = ?, updated_at = ?
  WHERE code = ? AND book_id = ? AND chapter_id = ? AND status = 'running'`
/** 成功 */
export const SQL_TASK_DONE = `UPDATE audio_tasks SET status = 'done', finished_at = ?, updated_at = ?,
    heartbeat = ?, bytes = ?, audio_ms = ?, error = NULL
  WHERE code = ? AND book_id = ? AND chapter_id = ?`
/** 失败：还有重试额度就回 pending，否则转 failed（**不计用户额度**：还是那一行） */
export const SQL_TASK_FAIL = `UPDATE audio_tasks
  SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?, updated_at = ?
  WHERE code = ? AND book_id = ? AND chapter_id = ?`
/** 回收僵尸（心跳超时）：还有额度 → 回 pending */
export const SQL_RECYCLE_RETRY = `UPDATE audio_tasks SET status = 'pending', error = ?, updated_at = ?
  WHERE status = 'running' AND heartbeat < ? AND attempts < ?`
/** 回收僵尸：额度用尽 → failed */
export const SQL_RECYCLE_DEAD = `UPDATE audio_tasks SET status = 'failed', error = ?, updated_at = ?
  WHERE status = 'running' AND heartbeat < ? AND attempts >= ?`
/** 排队位次：比我这条更早、且还没跑完的任务数 */
export const SQL_QUEUE_AHEAD = `SELECT COUNT(*) AS n FROM audio_tasks
  WHERE status IN ('pending', 'running') AND created_at < ?`

// ── MPEG 帧扫描（DeepInfra 固定出 MPEG2 LSF Layer III / 24 kHz / 单声道）──────

const BITRATE_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SAMPLE_RATE_V2 = [22050, 24000, 16000, 0]

/** 读位置 i 处的 MPEG 帧长（字节）；不是合法 V2L3 帧头 → 0 */
export function frameSize(b, i) {
  if (i + 4 > b.length) return 0
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0
  const ver = (b[i + 1] >> 3) & 0x03
  const layer = (b[i + 1] >> 1) & 0x03
  if (ver !== 2 || layer !== 1) return 0
  const br = BITRATE_V2L3[(b[i + 2] >> 4) & 0x0f]
  const sr = SAMPLE_RATE_V2[(b[i + 2] >> 2) & 0x03]
  if (!br || !sr) return 0
  const pad = (b[i + 2] >> 1) & 0x01
  return Math.floor((72 * br * 1000) / sr) + pad
}

export function frameSampleRate(b, i) {
  return SAMPLE_RATE_V2[(b[i + 2] >> 2) & 0x03] || 0
}

/**
 * 跳过 ID3v2、找到第一个音频帧头；Xing／Info／LAME 那种「信息帧」也要跳过。
 * 返回 { start, headBytes }（headBytes = 被剥掉多少字节）；找不到回 null。
 */
export function locateFrames(b) {
  let i = 0
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const sz = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
    i = Math.min(10 + sz, b.length)
  }
  let start = -1
  const stop = Math.min(b.length - 4, i + 8192)
  for (let k = i; k < stop; k++) {
    if (b[k] === 0xff && (b[k + 1] & 0xe0) === 0xe0 && frameSize(b, k)) { start = k; break }
  }
  if (start < 0) return null
  const fs = frameSize(b, start)
  let tag = ''
  const end = Math.min(start + 40, b.length)
  for (let k = start + 4; k < end; k++) tag += String.fromCharCode(b[k])
  if (tag.indexOf('Xing') >= 0 || tag.indexOf('Info') >= 0 || tag.indexOf('LAME') >= 0) start += fs
  return { start, headBytes: start }
}

/** 从 start 起逐帧扫；返回 { frames, end, resync, sr }，end = 最后一个完整帧之后的位置 */
export function scanFrames(b, start) {
  let i = start
  let frames = 0
  let resync = 0
  const sr = frameSampleRate(b, start)
  while (i + 4 <= b.length) {
    const fs = frameSize(b, i)
    if (!fs || i + fs > b.length) {
      resync++
      if (resync > 16) break
      i++
      continue
    }
    frames++
    i += fs
  }
  return { frames, end: i, resync, sr }
}

/** 剥一块：头 → 帧区 ＋ 时长（按帧数算：MPEG2 LSF 每帧 576 样本） */
export function stripBlock(bytes) {
  const loc = locateFrames(bytes)
  if (!loc) return { error: 'no mp3 frames' }
  const cnt = scanFrames(bytes, loc.start)
  return {
    audio: bytes.subarray(loc.start, cnt.end),
    frames: cnt.frames,
    ms: cnt.sr ? (cnt.frames * 576 * 1000) / cnt.sr : cnt.frames * 24,
    sr: cnt.sr,
    headBytes: loc.headBytes,
    resync: cnt.resync,
    restBytes: bytes.length - cnt.end,
  }
}

/** base64 → 字节（新引擎有 fromBase64 就走它，否则 atob 兜底） */
export function decodeB64(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k)
  return out
}

/**
 * 分块：按段落累计，单块 ≤ limit 字符，**块边界必落段落上**（绝不切在句子中间）。
 * 单段自己就超 MAX_BLOCK_CHARS 时单独成块 —— 由 DeepInfra 422 挡下、当章失败上报。
 */
export function chunkBlocks(paras, limit = BLOCK_CHARS) {
  const blocks = []
  let from = 0
  while (from < paras.length) {
    let to = from
    let chars = 0
    while (to < paras.length) {
      const add = paras[to].length + (to > from ? 2 : 0) // 段间 '\n\n'
      if (chars + add > limit && to > from) break
      if (chars + add > MAX_BLOCK_CHARS) break
      chars += add
      to++
    }
    if (to === from) to = from + 1
    blocks.push({ from, to, chars, text: paras.slice(from, to).join('\n\n') })
    from = to
  }
  return blocks
}

// ── 段落起点 ─────────────────────────────────────────────────────────────────

/** 纯标点 token（模型会把 , ; . “ ” : 也单独吐成词） */
const PUNCT_ONLY = /^[^A-Za-z0-9]+$/
const normTok = (v) => String(v).toLowerCase().replace(/[^a-z0-9']/g, '')

/**
 * 段落起点（秒）：**跳纯标点 token、按归一化文本贪心对齐**（最多 4 词前瞻，
 * 容忍模型把 `asleep—street` 这类合成词切成两词）。
 *
 * ⚠️ 不能按「空白分词数累加」：模型把标点也单吐成词（dr-jekyll ch-01：模型 2,834 词 vs
 * 空白分词 2,391 词），按分词数累加实测**末段偏 +130.76 s**（Phase1 §13.10 e②）。
 *
 * @param {string[]} paras  段落正文（按序）
 * @param {{start:number,end:number,text:string}[]} words  词级时标（已按块缩放、已合并偏移）
 * @param {string} chapterId  章 id（用于默认段落 id 的编号段）
 * @param {string[]} [paraIds]  段落 id（给就用它；不给按 chId 推 `p-<nn>-<iii>`）
 */
export function mapParagraphStarts(paras, words, chapterId, paraIds) {
  const tag = String(chapterId).replace(/^ch-/, '')
  const out = {}
  const rep = { modelWords: words.length, tokens: 0, contentWords: 0, splits: 0, misses: 0, samples: [] }
  let wi = 0
  const skipPunct = () => { while (wi < words.length && PUNCT_ONLY.test(words[wi].text)) wi++ }
  for (let i = 0; i < paras.length; i++) {
    const toks = paras[i].split(/\s+/).filter(Boolean)
    rep.tokens += toks.length
    skipPunct()
    const pid = (Array.isArray(paraIds) && paraIds[i]) ? String(paraIds[i]) : 'p-' + tag + '-' + String(i + 1).padStart(3, '0')
    out[pid] = wi < words.length ? +words[wi].start.toFixed(2) : null
    for (const t of toks) {
      skipPunct()
      if (wi >= words.length) { rep.misses++; break }
      if (normTok(words[wi].text) === normTok(t)) { wi++; rep.contentWords++; continue }
      let hit = -1
      for (let k = wi + 1; k < Math.min(words.length, wi + 4); k++) {
        if (!PUNCT_ONLY.test(words[k].text) && normTok(words[k].text) === normTok(t)) { hit = k; break }
      }
      if (hit >= 0) {
        rep.splits++
        if (rep.samples.length < 5) rep.samples.push({ kind: 'split', token: t, at: wi })
        wi = hit + 1
      } else {
        rep.misses++
        if (rep.samples.length < 5) rep.samples.push({ kind: 'miss', token: t, got: String(words[wi].text) })
        wi++
      }
      rep.contentWords++
    }
  }
  return { paragraphs: out, report: rep }
}

// ── 合成内核 ─────────────────────────────────────────────────────────────────

/** 一次 DeepInfra 调用。恒不抛由调用方兜；返回 { status, ok, body } */
export async function diCall(env, text, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const res = await fetchImpl(DI_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.DEEPINFRA_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      preset_voice: [opts.voice || DEFAULT_VOICE],
      output_format: 'mp3',
      return_timestamps: true,
      speed: Number.isFinite(opts.speed) ? opts.speed : DEFAULT_SPEED,
    }),
  })
  let body = null
  try { body = await res.json() } catch (e) { body = { error: String((e && e.message) || e) } }
  return { status: res.status, ok: res.ok, body }
}

/**
 * 一章 → { mp3, timings, stats }（并块主路 B；不插静音）。
 * 恒不抛：失败回 `{ ok: false, error, rows }`（调用方按章记失败、可重试）。
 *
 * @param {{env:object, paras:string[], paraIds?:string[], chapterId:string,
 *          voice?:string, speed?:number, fetchImpl?:Function,
 *          onBlock?:Function}} o  onBlock(i, n) 每完成一块回调一次（任务表心跳挂这里）
 */
export async function synthesizeChapter(o) {
  const env = o.env
  const paras = o.paras
  const chapterId = o.chapterId
  const fetchImpl = o.fetchImpl || globalThis.fetch
  const wall0 = Date.now()
  const blocks = chunkBlocks(paras)
  const rows = []
  const pieces = []
  const words = []
  let offsetMs = 0
  let totalFrames = 0

  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi]
    let res
    try {
      res = await diCall(env, blk.text, { voice: o.voice, speed: o.speed, fetchImpl })
    } catch (e) {
      rows.push({ i: bi, chars: blk.chars, error: 'fetch failed: ' + String((e && e.message) || e) })
      return { ok: false, error: 'deepinfra unreachable', rows }
    }
    if (!res.ok) {
      rows.push({ i: bi, chars: blk.chars, status: res.status, error: String((res.body && res.body.detail) || '') })
      return { ok: false, error: 'deepinfra failed (HTTP ' + res.status + ')', rows }
    }
    const dataUrl = String(res.body.audio || '')
    const cut = dataUrl.indexOf(',')
    if (cut < 0) {
      rows.push({ i: bi, chars: blk.chars, error: 'no audio in response' })
      return { ok: false, error: 'deepinfra returned no audio', rows }
    }
    let st
    try {
      st = stripBlock(decodeB64(dataUrl.slice(cut + 1)))
    } catch (e) {
      rows.push({ i: bi, chars: blk.chars, error: 'decode failed: ' + String((e && e.message) || e) })
      return { ok: false, error: 'audio decode failed', rows }
    }
    if (st.error) {
      rows.push({ i: bi, chars: blk.chars, error: st.error })
      return { ok: false, error: st.error, rows }
    }

    // 词级时标：先按「本块音频时长 ÷ 本块词表跨度」线性缩放，再累加已拼音频偏移。
    // 模型时标实测偏快 2.1–2.7%（每块速率还不一样），不缩放时块末词 end 之后还留着实音频。
    const bw = Array.isArray(res.body.words) ? res.body.words : []
    const shift = offsetMs / 1000
    const audioSec = st.ms / 1000
    const lastEnd = bw.length ? Number(bw[bw.length - 1].end) || 0 : 0
    const kw = lastEnd > 0.05 ? audioSec / lastEnd : 1
    for (const w of bw) {
      words.push({
        start: +(Number(w.start) * kw + shift).toFixed(3),
        end: +(Number(w.end) * kw + shift).toFixed(3),
        text: String(w.text || ''),
      })
    }
    pieces.push(st.audio)
    rows.push({
      i: bi, from: blk.from, to: blk.to, chars: blk.chars,
      frames: st.frames, ms: +st.ms.toFixed(1), sr: st.sr,
      headBytes: st.headBytes, resync: st.resync, restBytes: st.restBytes,
      words: bw.length, wordScale: +kw.toFixed(5),
    })
    offsetMs += st.ms
    totalFrames += st.frames
    if (typeof o.onBlock === 'function') await o.onBlock(bi + 1, blocks.length)
  }

  let totalBytes = 0
  for (const p of pieces) totalBytes += p.length
  const mp3 = new Uint8Array(totalBytes)
  let off = 0
  for (const p of pieces) { mp3.set(p, off); off += p.length }

  if (mp3.length > MAX_CHAPTER_BYTES) {
    return { ok: false, error: 'chapter audio too large (' + mp3.length + ' B)', rows }
  }

  const mapped = mapParagraphStarts(paras, words, chapterId, o.paraIds)
  const durationSec = +(offsetMs / 1000).toFixed(2)
  return {
    ok: true,
    mp3,
    timings: { duration: durationSec, paragraphs: mapped.paragraphs },
    stats: {
      chapterId, blocks: rows,
      totals: {
        blocks: blocks.length,
        chars: paras.reduce((a, t) => a + t.length, 0),
        bytes: mp3.length,
        mb: +(mp3.length / 1048576).toFixed(3),
        frames: totalFrames,
        audioSec: durationSec,
        words: words.length,
        wallMs: Date.now() - wall0,
      },
      align: mapped.report,
    },
  }
}

// ── 书体 / 章正文 ────────────────────────────────────────────────────────────

/** 从 BYO 书体里取一章的 { title, paras, paraIds }；找不到回 null */
export function chapterOfBook(body, chapterId) {
  const chapters = Array.isArray(body && body.chapters) ? body.chapters : []
  const ch = chapters.find((c) => c && String(c.id) === String(chapterId))
  if (!ch) return null
  const raw = Array.isArray(ch.paragraphs) ? ch.paragraphs : []
  const paras = []
  const paraIds = []
  for (const p of raw) {
    const text = typeof p === 'string' ? p : String((p && p.text) || '')
    if (!text) continue
    paras.push(text)
    paraIds.push(typeof p === 'string' ? '' : String((p && p.id) || ''))
  }
  return { title: String(ch.title || ''), paras, paraIds }
}

/** 章正文字符数（配额用；与切块口径一致：段落长度求和，不含段间 \n\n） */
export function chapterCharCount(ch) {
  if (!ch) return 0
  let n = 0
  for (const t of ch.paras) n += t.length
  return n
}

/** 读 BYO 书体（R2 `books/<code>/<bookId>.json`）；没有回 null、坏 JSON 回 { bad: true } */
async function readBookBody(env, code, bookId) {
  let obj
  try {
    obj = await env.AUDIO.get(bookObjectKey(code, bookId))
  } catch (e) {
    return { error: 'storage read failed: ' + String((e && e.message) || e) }
  }
  if (!obj) return null
  let text
  try { text = await obj.text() } catch (e) { return { error: 'body unreadable' } }
  try { return JSON.parse(text) } catch { return { bad: true } }
}

// ── 配额 ─────────────────────────────────────────────────────────────────────

function limitOf(raw, dflt) {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}
/** UTC 日起点（口径写死在文件头：按 UTC 日算，不跟用户本地时区飘） */
export function dayStart(now) { return Math.floor(now / 86400000) * 86400000 }

/** 当日已用配额（章数 ＋ 字符数）。读表失败 → 回 null（**fail-open**：不因读表失败挡住用户） */
export async function quotaUsed(env, code, now) {
  const from = dayStart(now)
  try {
    const row = await env.DB.prepare(SQL_QUOTA_SUM).bind(code, from, from + 86400000).first()
    return { chapters: Number(row && row.chapters) || 0, chars: Number(row && row.chars) || 0 }
  } catch (e) {
    console.error('audio quota sum failed (fail-open):', e && e.message)
    return null
  }
}

/** 剩余额度（读不到就当满额 —— 与 fail-open 同向：宁可放过，不误拦） */
export async function quotaLeft(env, code, now) {
  const used = await quotaUsed(env, code, now)
  const maxCh = limitOf(env.AUDIO_GEN_MAX_CHAPTERS_PER_DAY, DAILY_CHAPTERS)
  const maxChr = limitOf(env.AUDIO_GEN_MAX_CHARS_PER_DAY, DAILY_CHARS)
  if (!used) return { chaptersLeft: maxCh, charsLeft: maxChr, chaptersUsed: 0, charsUsed: 0, unknown: true }
  return {
    chaptersLeft: Math.max(0, maxCh - used.chapters),
    charsLeft: Math.max(0, maxChr - used.chars),
    chaptersUsed: used.chapters,
    charsUsed: used.chars,
  }
}

// ── 清空音频 → 行作废（D25-f，2026-10-08 Ferrari 裁 A）────────────────────────

/**
 * 清空该书音频**之前**把 D1 的行作废。**恒不抛**。返回 `{ ok, refused, open, purged, error }`：
 *   · `refused: true`（`open > 0`：还有 pending／running）→ 调用方**不许清**（回 409）。
 *     中途清空会把在跑那一章的 mp3 写回一个刚清空的目录 —— 用户看到「清了又有」。
 *   · `ok: true` ＋ `purged` ＝ 被改成 `purged` 的行数（0 也正常：重复清空是收敛的）。
 *   · `ok: false`（读表／写表失败）→ 调用方**也不许清**（回 503）：作废与清空必须同进同退。
 *     行留着 `done` 而音频没了，这一章就再没人能生成（服务端判 already-done、没有回头的路）。
 *
 * **不删行、只改状态**是配额的地基：日配额按行求和（SQL_QUOTA_SUM），删了行就变成
 * 「清空 + 重提 = 白拿额度」。`SQL_PURGE_BOOK_TASKS` 自带 NOT EXISTS 守卫，读表与写表之间
 * 即使插进一次 cron 认领，也不会误伤在跑的任务。
 */
export async function purgeBookTasks(env, code, bookId, now = Date.now()) {
  const readOpen = async () => {
    const rows = ((await env.DB.prepare(SQL_TASKS_FOR_BOOK).bind(code, bookId).all()).results) || []
    return rows.filter((r) => isPendingStatus(r.status)).length
  }
  let open
  try {
    open = await readOpen()
  } catch (e) {
    console.error('purge book tasks read failed:', e && e.message)
    return { ok: false, refused: false, open: 0, purged: 0, error: 'db read failed' }
  }
  if (open > 0) return { ok: false, refused: true, open, purged: 0, error: 'tasks running' }

  let purged
  try {
    const r = await env.DB.prepare(SQL_PURGE_BOOK_TASKS).bind(now, now, code, bookId, code, bookId).run()
    purged = Number(r && r.meta && r.meta.changes) || 0
  } catch (e) {
    console.error('purge book tasks failed:', e && e.message)
    return { ok: false, refused: false, open: 0, purged: 0, error: 'db write failed' }
  }

  // `purged === 0` 有两种可能：①全本本来就没东西可作废（收敛）②**读表之后、写表之前**被 cron
  // 抢先认领了，NOT EXISTS 守卫把那次 UPDATE 挡成 0 行。②要是被当成①，我们就会以为「没什么
  // 可作废」然后照样把 R2 清掉 —— 在跑那一章随后把 mp3 写回来（用户看到「清了又有」）。
  // 故这里复读一次把它认出来（这一步只在 0 行时多花一次读，正常清空不受影响）。
  if (purged === 0) {
    try {
      open = await readOpen()
    } catch (e) {
      console.error('purge book tasks re-read failed:', e && e.message)
      return { ok: false, refused: false, open: 0, purged: 0, error: 'db read failed' }
    }
    if (open > 0) return { ok: false, refused: true, open, purged: 0, error: 'tasks running' }
  }
  return { ok: true, refused: false, open: 0, purged, error: null }
}

// ── 索引合并（与 reader utils/audioCloud.js 的 mergeAudioIndex 同口径，服务端一份）──

export function mergeAudioIndex(index, chapterId, bookId) {
  const id = String(chapterId || '')
  const base = (index && typeof index === 'object' && !Array.isArray(index)) ? index : {}
  const withAudio = Array.isArray(base.withAudio) ? base.withAudio.map(String) : []
  if (id && !withAudio.includes(id)) withAudio.push(id)
  const missing = (base.missing && typeof base.missing === 'object' && !Array.isArray(base.missing)) ? { ...base.missing } : {}
  if (id) delete missing[id]
  return { book: String(base.book || bookId || ''), withAudio, missing }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  })
}

/**
 * 主入口：匹配就返回 Response，不匹配返回 null（让主路由继续 fallthrough）。
 * 只接 GET / POST；OPTIONS 由主路由在最前面答掉（预检到不了这里）。
 */
export async function handleAudioGen(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null
  const method = request.method
  if (method !== 'GET' && method !== 'POST') return null

  const cors = corsFor(request, env)

  // 会话闸先于路径形状判定（与 bookaudio 同一份判定、同一套顺序理由）
  const g = await sessionTenant(request, env, url)
  if (!g.acct) return json(cors, { error: g.error }, g.status)

  const raw = url.pathname.slice(ROUTE_PREFIX.length)
  const parts = raw.split('/')
  if (parts.length !== 2 || parts[0] !== 'book') {
    return json(cors, { error: 'invalid path' }, 400)
  }
  let bookId = parts[1]
  try { bookId = decodeURIComponent(bookId) } catch { /* 非法编码按原样 */ }
  if (!isBookId(bookId)) return json(cors, { error: 'invalid bookId' }, 400)

  const code = g.acct.code
  const now = Date.now()
  if (method === 'GET') return genStatus(env, cors, code, bookId, now)
  return genSubmit(request, env, cors, code, bookId, now)
}

/** GET /api/gen/book/<bookId> —— 服务端复读的进度 ＋ 排队位次 ＋ 剩余额度（D21-g） */
async function genStatus(env, cors, code, bookId, now) {
  let rows
  try {
    rows = ((await env.DB.prepare(SQL_TASKS_FOR_BOOK).bind(code, bookId).all()).results) || []
  } catch (e) {
    console.error('gen status read failed:', e && e.message)
    return json(cors, { error: 'db read failed' }, 500, { 'Cache-Control': NO_STORE })
  }
  const chapters = {}
  const summary = { total: 0, pending: 0, running: 0, done: 0, failed: 0, purged: 0 }
  let oldestOpen = null
  for (const r of rows) {
    const st = String(r.status || '')
    const id = String(r.chapter_id)
    chapters[id] = {
      status: st,
      title: String(r.title || ''),
      chars: Number(r.char_count) || 0,
      attempts: Number(r.attempts) || 0,
      bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
      audioMs: r.audio_ms === null || r.audio_ms === undefined ? null : Number(r.audio_ms),
      error: r.error ? String(r.error) : null,
      updatedAt: r.updated_at ? new Date(Number(r.updated_at)).toISOString() : null,
      finishedAt: r.finished_at ? new Date(Number(r.finished_at)).toISOString() : null,
    }
    if (summary[st] !== undefined) summary[st]++
    summary.total++
    if (isPendingStatus(st)) {
      const at = Number(r.created_at) || 0
      if (oldestOpen === null || at < oldestOpen) oldestOpen = at
    }
  }
  let queueAhead = 0
  if (oldestOpen !== null) {
    try {
      const q = await env.DB.prepare(SQL_QUEUE_AHEAD).bind(oldestOpen).first()
      queueAhead = Number(q && q.n) || 0
    } catch { /* 位次读不到就报 0：它是展示项，不是判定项 */ }
  }
  const quota = await quotaLeft(env, code, now)
  return json(cors, {
    ok: true, bookId, chapters, summary,
    queue: { ahead: queueAhead, position: queueAhead + 1 },
    quota,
  }, 200, { 'Cache-Control': NO_STORE })
}

/** POST /api/gen/book/<bookId> —— 提交章节（写表 ＋ 立即返回；首章起跑 ≤60 s） */
async function genSubmit(request, env, cors, code, bookId, now) {
  let payload
  try { payload = await request.json() } catch { return json(cors, { error: 'invalid json' }, 400) }
  const want = payload && payload.chapters
  if (!Array.isArray(want) || want.length === 0) {
    return json(cors, { error: 'chapters must be a non-empty array' }, 400)
  }
  if (want.length > DAILY_CHAPTERS) {
    return json(cors, { error: 'too many chapters in one request', max: DAILY_CHAPTERS }, 400)
  }
  const ids = []
  for (const v of want) {
    const id = String(v || '')
    if (!CHAPTER_ID_RE.test(id)) return json(cors, { error: 'invalid chapterId', chapterId: id }, 400)
    if (!ids.includes(id)) ids.push(id)
  }

  const body = await readBookBody(env, code, bookId)
  if (body === null) return json(cors, { error: 'book not found', bookId }, 404)
  if (body && body.error) return json(cors, { error: body.error }, 500)
  if (body && body.bad) return json(cors, { error: 'book body is not valid json' }, 500)

  // 逐章判：不在书里 / 超章长上限 → skipped；可提交的按 (是否已有行) 分流
  let existing = []
  try {
    existing = ((await env.DB.prepare(SQL_TASKS_FOR_BOOK).bind(code, bookId).all()).results) || []
  } catch (e) {
    console.error('gen submit read tasks failed:', e && e.message)
    return json(cors, { error: 'db read failed' }, 500)
  }
  const byId = new Map(existing.map((r) => [String(r.chapter_id), r]))

  const skipped = []
  const fresh = []
  const requeue = []
  const repurge = []
  for (const id of ids) {
    const ch = chapterOfBook(body, id)
    if (!ch) { skipped.push({ chapterId: id, reason: 'unknown-chapter' }); continue }
    const chars = chapterCharCount(ch)
    if (chars === 0) { skipped.push({ chapterId: id, reason: 'empty-chapter' }); continue }
    if (chars > limitOf(env.AUDIO_GEN_MAX_CHAPTER_CHARS, MAX_CHAPTER_CHARS)) {
      skipped.push({ chapterId: id, reason: 'chapter-too-long', chars })
      continue
    }
    const prev = byId.get(id)
    const st = prev ? String(prev.status) : ''
    if (st === 'done') { skipped.push({ chapterId: id, reason: 'already-done' }); continue }
    if (st === 'pending') { skipped.push({ chapterId: id, reason: 'already-queued' }); continue }
    if (st === 'running') { skipped.push({ chapterId: id, reason: 'already-running' }); continue }
    if (st === 'failed') { requeue.push({ chapterId: id, chars }); continue }
    if (st === 'purged') {
      // 清空后再生成（D25-f）：同一行改回 pending ＝ 「重新排队」；带上它的创建日供配额算
      repurge.push({ chapterId: id, chars, title: ch.title, createdAt: Number(prev.created_at) || 0 })
      continue
    }
    fresh.push({ chapterId: id, chars, title: ch.title })
  }

  // 配额闸：全有或全无。两笔账：
  //   ① **新增行**（fresh）—— 一行一章，占今天的格子；
  //   ② **清空后重提**（repurge）—— SQL_TASK_REPURGE 会把那一行的 `created_at` 重置到今天，
  //      所以它今天也要占一格。创建日**已经在今天**的那些行，`SQL_QUOTA_SUM` 早就把它们算进
  //      used 了，不能再算一遍（否则「今天生成的、清空后又想生成」会被自己的旧格子挡死）。
  //   「重提失败的章」（requeue）不吃配额：同一行、同一创建日、本来就算过了。
  const quota = await quotaLeft(env, code, now)
  const from = dayStart(now)
  const recharge = repurge.filter((c) => c.createdAt < from)
  const newChapters = fresh.length + recharge.length
  const newChars = fresh.reduce((a, c) => a + c.chars, 0) + recharge.reduce((a, c) => a + c.chars, 0)
  if (newChapters > 0 && (newChapters > quota.chaptersLeft || newChars > quota.charsLeft)) {
    return json(cors, {
      error: 'daily quota exceeded',
      requested: { chapters: newChapters, chars: newChars },
      chaptersLeft: quota.chaptersLeft,
      charsLeft: quota.charsLeft,
    }, 403)
  }

  const queued = []
  for (const c of fresh) {
    try {
      const r = await env.DB.prepare(SQL_TASK_INSERT)
        .bind(code, bookId, c.chapterId, c.title, c.chars, now, now).run()
      if (r && r.meta && r.meta.changes) queued.push({ chapterId: c.chapterId, chars: c.chars })
      else skipped.push({ chapterId: c.chapterId, reason: 'already-queued' })
    } catch (e) {
      console.error('task insert failed:', e && e.message)
      return json(cors, { error: 'db write failed' }, 500)
    }
  }
  const requeued = []
  for (const c of requeue) {
    try {
      const r = await env.DB.prepare(SQL_TASK_REQUEUE).bind(now, code, bookId, c.chapterId).run()
      if (r && r.meta && r.meta.changes) requeued.push({ chapterId: c.chapterId, chars: c.chars })
      else skipped.push({ chapterId: c.chapterId, reason: 'already-done' })
    } catch (e) {
      console.error('task requeue failed:', e && e.message)
    }
  }
  // 清空后重提（D25-f）：与失败重提**同一个回执字段**（前端那句「重新排队 N 章」对两者都对）
  for (const c of repurge) {
    try {
      const r = await env.DB.prepare(SQL_TASK_REPURGE)
        .bind(c.title || '', c.chars, now, now, code, bookId, c.chapterId).run()
      if (r && r.meta && r.meta.changes) requeued.push({ chapterId: c.chapterId, chars: c.chars })
      else skipped.push({ chapterId: c.chapterId, reason: 'already-queued' })
    } catch (e) {
      console.error('task repurge failed:', e && e.message)
    }
  }

  const after = await quotaLeft(env, code, now)
  return json(cors, {
    ok: true, bookId, queued, requeued, skipped,
    quota: after,
    note: 'queued; first chapter starts within ~60s',
  })
}

// ── cron 巡检（D24-b／c）────────────────────────────────────────────────────

/**
 * 一个 tick：① 回收僵尸 ② 领任务（D1 原子认领）③ 跑章（串行、同一账号、≤K 章）④ 写死。
 * **恒不抛**（cron 里抛出去只会留一条噪音日志）：出错记 console.error 并如实回计数。
 * @param {object} opts  { fetchImpl?, limitK? }（自检注入用）
 */
export async function runAudioGenTick(env, now = Date.now(), opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const limitK = Number.isFinite(opts.limitK) ? opts.limitK : K_PER_TICK
  const out = { recycled: 0, dead: 0, chapters: [], claimed: 0, done: 0, failed: 0 }

  // ① 回收僵尸（心跳超 5 分钟）：还有额度回 pending，用尽转 failed
  try {
    const a = await env.DB.prepare(SQL_RECYCLE_RETRY)
      .bind('worker died mid-chapter (stale heartbeat)', now, now - STALE_MS, MAX_ATTEMPTS).run()
    out.recycled = Number(a && a.meta && a.meta.changes) || 0
    const b = await env.DB.prepare(SQL_RECYCLE_DEAD)
      .bind('worker died mid-chapter (attempts exhausted)', now, now - STALE_MS, MAX_ATTEMPTS).run()
    out.dead = Number(b && b.meta && b.meta.changes) || 0
  } catch (e) {
    console.error('audio gen recycle failed:', e && e.message)
  }

  // ② 领第一枚 —— 它定义了本 tick 的账号（D24-c：一个 tick 一个账号、串行）
  let first
  try {
    first = await env.DB.prepare(SQL_NEXT_PENDING).first()
  } catch (e) {
    console.error('audio gen claim read failed:', e && e.message)
    return out
  }
  if (!first) return out
  const code = String(first.code)

  const wall0 = Date.now()
  const bookCache = new Map()
  let spent = 3 // 回收 2 条 + 书体读 1 次的余量
  let tried = 0

  // 待跑清单一次读一小把（limitK + 3 留重领被抢的余量）；**本 tick 试过的章跳过** ——
  // 否则失败回 pending 后会被同一次 invocation 立刻再领（3 次重试在一个 tick 内烧光）。
  let cands = []
  try {
    const r = await env.DB.prepare(SQL_PENDING_FOR_LIST).bind(code, limitK + 3).all()
    cands = (r && r.results) || []
  } catch (e) {
    console.error('audio gen pending list failed:', e && e.message)
    return out
  }

  /** 「bookId/chapterId」——本 tick 已领过的标记（含失败回 pending 的那一枚） */
  const seen = new Set()

  for (const task of cands) {
    if (out.claimed >= limitK) { out.stopped = 'tick-limit'; break }
    if (Date.now() - wall0 > TICK_WALL_BUDGET_MS) { out.stopped = 'wall-budget'; break }

    const bookId = String(task.book_id)
    const chapterId = String(task.chapter_id)
    const sig = bookId + '/' + chapterId
    if (seen.has(sig)) continue

    // 子请求预算：块数上界 = ceil(字符 ÷ 9,000) + 1；每章另有 6 次固定开销（认领／心跳／
    // 三次 R2 写／一次索引读）。Free 是 50/invocation —— 逼近就先停，余下留给下一 tick。
    const blocksEst = Math.ceil((Number(task.char_count) || 0) / BLOCK_CHARS) + 1
    if (tried > 0 && spent + blocksEst + 6 > SUBREQ_BUDGET) { out.stopped = 'subreq-budget'; break }
    tried++

    // 原子认领：只有 pending 能被领 → changes=0 说明被别人抢先（cron 可重叠）
    let claimed = 0
    try {
      const r = await env.DB.prepare(SQL_CLAIM).bind(now, now, now, code, bookId, chapterId).run()
      claimed = Number(r && r.meta && r.meta.changes) || 0
    } catch (e) {
      console.error('audio gen claim failed:', e && e.message)
      break
    }
    spent++
    if (!claimed) continue
    out.claimed++
    seen.add(sig)

    const beat = async () => {
      spent++
      try {
        await env.DB.prepare(SQL_HEARTBEAT).bind(Date.now(), Date.now(), code, bookId, chapterId).run()
      } catch (e) {
        console.error('audio gen heartbeat failed:', e && e.message)
      }
    }

    const rec = await processOne(env, code, bookId, chapterId, { fetchImpl, bookCache, beat })
    spent += 3 // R2 写：mp3 ＋ timings ＋ index
    out.chapters.push({ bookId, chapterId, ok: rec.ok, error: rec.error || null, bytes: rec.bytes || 0 })
    if (rec.ok) out.done++
    else out.failed++
  }

  return out
}

/**
 * 跑一枚已认领的任务：读书体 → 合成 → 写 mp3／timings／index → 标记 done。
 * 失败按 SQL_TASK_FAIL 处理（≤3 次回 pending）。恒不抛。
 */
async function processOne(env, code, bookId, chapterId, ctx) {
  const fail = async (error) => {
    try {
      await env.DB.prepare(SQL_TASK_FAIL)
        .bind(MAX_ATTEMPTS, String(error).slice(0, 300), Date.now(), code, bookId, chapterId).run()
    } catch (e) {
      console.error('audio gen mark-fail failed:', e && e.message)
    }
    return { ok: false, error }
  }

  let body = ctx.bookCache.get(bookId)
  if (body === undefined) {
    body = await readBookBody(env, code, bookId)
    ctx.bookCache.set(bookId, body)
  }
  if (body === null) return fail('book body missing')
  if (body && body.error) return fail(body.error)
  if (body && body.bad) return fail('book body is not valid json')

  const ch = chapterOfBook(body, chapterId)
  if (!ch) return fail('chapter not in book body')
  if (!ch.paras.length) return fail('empty chapter')

  const synth = await synthesizeChapter({
    env, paras: ch.paras, paraIds: ch.paraIds, chapterId,
    voice: DEFAULT_VOICE, speed: DEFAULT_SPEED,
    fetchImpl: ctx.fetchImpl,
    onBlock: ctx.beat,
  })
  if (!synth.ok) return fail(synth.error)

  const chKey = (f) => audioObjectKey(code, bookId, f)
  try {
    await env.AUDIO.put(chKey(chapterId + '.mp3'), synth.mp3, { httpMetadata: { contentType: 'audio/mpeg' } })
    await env.AUDIO.put(chKey(chapterId + '.timings.json'), JSON.stringify(synth.timings), {
      httpMetadata: { contentType: 'application/json' },
    })
  } catch (e) {
    return fail('storage write failed: ' + String((e && e.message) || e))
  }

  // 索引最后写：mp3／timings 没到齐就翻，等于把「还没传完」当就绪播给用户（点下去 404）
  try {
    let index = null
    const idxObj = await env.AUDIO.get(chKey(INDEX_FILE))
    if (idxObj) { try { index = JSON.parse(await idxObj.text()) } catch { index = null } }
    const merged = mergeAudioIndex(index, chapterId, bookId)
    await env.AUDIO.put(chKey(INDEX_FILE), JSON.stringify(merged), {
      httpMetadata: { contentType: 'application/json' },
    })
  } catch (e) {
    return fail('index write failed: ' + String((e && e.message) || e))
  }

  const fin = Date.now()
  try {
    await env.DB.prepare(SQL_TASK_DONE)
      .bind(fin, fin, fin, synth.mp3.length, Math.round(synth.timings.duration * 1000), code, bookId, chapterId)
      .run()
  } catch (e) {
    return fail('db mark-done failed: ' + String((e && e.message) || e))
  }
  return { ok: true, bytes: synth.mp3.length, audioMs: Math.round(synth.timings.duration * 1000) }
}
