/**
 * dict-zh 客户端事件通道（冻结包 §六「新增模块」）。
 *
 * 为什么单独一件：四个事件散在点击／渲染／动作回调里，若各自处理 session、批量、
 * 哈希，会把查词主流程搅乱。收进这里后调用方只在正确时机调 zhEnter／zhLookup／
 * zhShown／zhAction，主流程不 await、不 catch、不受网络影响。
 *
 * 为什么 fire-and-forget：埋点不该拖慢弹窗，也不该把「事件没发出去」升级成用户
 * 可见的错误。失败一律丢，不重试——断网时重试只会让队列越堆越旧。唯一的例外是
 * 429：服务端已明确说在限流，本会话后续上报直接停掉（§五 客户端前置）。
 *
 * 为什么 hashWord 由外部注入：隐私边界是「原词不出设备」，且哈希前还要按 §15.3
 * 归一化（小写、’→'、破折号、去首尾标点，§二·6）。归一化器在 zhDict.js，注入让
 * 调用方把「归一化 + SHA-256」一起交进来；本模块不 import 词典、不自己算哈希。
 * 未注入时事件丢弃不发送（宁缺勿错）；注入值不是 64 位小写 hex 时单条丢弃。
 *
 * 字段名严格用 §五 zh_events 的列名；缺的字段不补默认值。`anon` v0 恒为 ''——
 * DA-5 定死本版没有稳定匿名 id，列与索引键位保留、客户端不生成。
 */

export const ZH_EVENTS_ROUTE = '/api/zh/events'
export const SESSION_STORAGE = 'mr-zh-session'
/** 与 worker 的 session 校验同形（§五：8–64、[A-Za-z0-9_-]） */
export const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/

/** 队列上限 50；单批上限 20 对齐 BE 的「≤20 条／8KB」 */
export const MAX_QUEUE = 50
export const MAX_BATCH = 20
/** 首条入队后最多攒这么久；满 20 条优先立即发 */
export const FLUSH_DELAY_MS = 1000

export const VIA_VALUES = ['byo', 'builtin', 'note', 'phrase']
export const RESULT_VALUES = ['direct', 'irregular', 'stem', 'miss_dict', 'miss_empty', 'miss_shard', 'miss_net']
export const ACTION_VALUES = ['save', 'close', 'speak', 'remove', 'online']
export const SOURCE_VALUES = ['zh', 'mw', 'builtin']

const HASH_RE = /^[0-9a-f]{64}$/

let queue = []
let timer = null
/** 429 之后本会话不再上报（§五 明文要求） */
let stopped = false
/** sessionStorage 不可用时，标签页生命周期内就靠这一份 */
let memorySession = ''
let hashWord = null
let fetchImpl = null
let warnedNoHash = false

/** 默认静默；只在 Vite 开发构建里出声（§五：400 开发期 console.warn） */
const defaultLogger = (...args) => {
  try {
    if (import.meta.env?.DEV && typeof console !== 'undefined') console.warn('[zhEvents]', ...args)
  } catch { /* 非 Vite 环境没有 import.meta.env */ }
}

let logger = defaultLogger

function log(...args) {
  try { logger(...args) } catch { /* 日志本身不许影响上报 */ }
}

// ── ① session（标签页级：重载保留，关标签失效）────────────────────────────

function safeSessionStorage() {
  try { return globalThis.sessionStorage || null } catch { return null }
}

/** randomUUID 不可用时的兜底：时间戳＋随机，凑够 32 位 hex */
function fallbackSessionId() {
  let s = Date.now().toString(16)
  for (let i = 0; i < 4 && s.length < 32; i++) s += Math.random().toString(16).slice(2)
  return (s + '0'.repeat(32)).slice(0, 32)
}

function newSessionId() {
  try {
    const c = globalThis.crypto
    if (c && typeof c.randomUUID === 'function') {
      const id = c.randomUUID()
      if (SESSION_RE.test(id)) return id
    }
  } catch { /* 非安全上下文里 randomUUID 存在但会抛 */ }
  return fallbackSessionId()
}

/**
 * 取本标签页的 session；第一次调用时生成并落到 sessionStorage。
 * 存不下（隐私模式／被禁）也照样返回同一份内存值——事件照发，不报错。
 */
export function currentSession() {
  if (memorySession) return memorySession
  let store = null
  try {
    store = safeSessionStorage()
    const raw = store && typeof store.getItem === 'function' ? store.getItem(SESSION_STORAGE) : null
    if (typeof raw === 'string' && SESSION_RE.test(raw)) {
      memorySession = raw
      return raw
    }
  } catch { /* 读不到就当没有 */ }
  memorySession = newSessionId()
  try {
    if (store && typeof store.setItem === 'function') store.setItem(SESSION_STORAGE, memorySession)
  } catch { /* 存不住就用内存这份 */ }
  return memorySession
}

// ── ② 注入点（哈希／日志／fetch）──────────────────────────────────────────

/**
 * 注入「归一化 + SHA-256」函数：`(word) => hex64 | Promise<hex64>`。
 * 不注入就不发——模块自己不会兜底去传原词（隐私边界优先于数据完整）。
 * 同步／异步都收；拒绝或形状不对时单条丢弃，不影响队列里的其他事件。
 */
export function setHashWord(fn) {
  hashWord = typeof fn === 'function' ? fn : null
}

/** 测试／诊断用日志注入；不传回默认（生产静默、开发期 warn） */
export function setLogger(fn) {
  logger = typeof fn === 'function' ? fn : defaultLogger
}

/** 测试用网络注入；不传回 globalThis.fetch */
export function setFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : null
}

// ── ③ 事件构造（字段只取 §五 列名，不补默认值）────────────────────────────

function clampMs(v) {
  return Math.min(60000, Math.max(0, Math.round(v)))
}

function acceptHash(e, ts, fields, hash) {
  if (stopped) return false
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    log('bad-hash')
    return false
  }
  return enqueue({ e, ts, word_hash: hash, ...fields })
}

/**
 * 公共入口：先取 ts（事件发生时刻，不是哈希完成时刻），再交给注入的哈希。
 * 异步哈希期间原词只活在闭包里；完成后才入队，失败就丢这一条。
 */
function emitEvent(e, word, fields) {
  if (stopped) return false
  if (!hashWord) {
    if (!warnedNoHash) {
      warnedNoHash = true
      log('hash-word-not-set')
    }
    return false
  }
  if (typeof word !== 'string' || !word.trim()) {
    log('bad-word')
    return false
  }
  const ts = Date.now()
  let hashed
  try {
    hashed = hashWord(word)
  } catch (err) {
    log('hash-failed', err)
    return false
  }
  if (hashed && typeof hashed.then === 'function') {
    hashed.then(h => acceptHash(e, ts, fields, h), err => log('hash-failed', err))
    return true
  }
  return acceptHash(e, ts, fields, hashed)
}

/**
 * zh_enter：点词入口（长度闸之后、尚未查任何词典）发一次。
 * `word` 是必需的：§五 的 zh_enter 行带 word_hash；note／phrase 两种早退也各发一次，
 * 只在统计时按 via 剔除，不在客户端替统计层做取舍。
 */
export function zhEnter({ word, via } = {}) {
  if (!VIA_VALUES.includes(via)) {
    log('bad-via', via)
    return false
  }
  return emitEvent('zh_enter', word, { via })
}

/**
 * zh_lookup：lookupZh 返回后立即发（含 miss）。
 * 不带 shard——首字母加时间可重建被点词首字母序列（裁决 9）；result + ms 已够排障。
 * ms 越界按端点同口径截断（负数→0、>60000→60000），不让一条坏读数拖垮整批。
 */
export function zhLookup({ word, result, ms } = {}) {
  if (!RESULT_VALUES.includes(result)) {
    log('bad-result', result)
    return false
  }
  const n = Number(ms)
  if (!Number.isFinite(n)) {
    log('bad-ms')
    return false
  }
  return emitEvent('zh_lookup', word, { result, ms: clampMs(n) })
}

/**
 * zh_shown：真渲染中文释义时由调用方发。
 * 模块不判断 defsCount > 0——「0 条算 miss_empty、不算显示」是口径层的判定，
 * 这里如实带值，0 也能上报，免得把上游的判定问题藏进埋点层。
 */
export function zhShown({ word, result, defsCount } = {}) {
  if (!RESULT_VALUES.includes(result)) {
    log('bad-result', result)
    return false
  }
  const n = Number(defsCount)
  if (!Number.isInteger(n) || n < 0) {
    log('bad-defs-count')
    return false
  }
  return emitEvent('zh_shown', word, { result, defs_count: n })
}

/**
 * zh_action：存词／关闭／朗读／移除／外链。
 * dwellMs 缺省就不带这一格（BE 对 close 缺值按 0 处理）；带了但不像数就丢这条。
 */
export function zhAction({ word, action, source, dwellMs } = {}) {
  if (!ACTION_VALUES.includes(action)) {
    log('bad-action', action)
    return false
  }
  if (!SOURCE_VALUES.includes(source)) {
    log('bad-source', source)
    return false
  }
  const fields = { action, source }
  if (dwellMs !== undefined && dwellMs !== null) {
    const n = Number(dwellMs)
    if (!Number.isFinite(n)) {
      log('bad-dwell')
      return false
    }
    fields.dwell_ms = Math.max(0, Math.round(n))
  }
  return emitEvent('zh_action', word, fields)
}

/** 对外统一入口（§五：组件侧只需 emit／flush）；未知名直接丢 */
export function emit(name, fields = {}) {
  switch (name) {
    case 'zh_enter': return zhEnter(fields)
    case 'zh_lookup': return zhLookup(fields)
    case 'zh_shown': return zhShown(fields)
    case 'zh_action': return zhAction(fields)
    default:
      log('bad-event', name)
      return false
  }
}

// ── ④ 队列与发送 ──────────────────────────────────────────────────────────

function clearFlushTimer() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/** 定时器只由「队列从空变非空」那一条启动；后续入队不重置，保证首条最多等 1 s */
function scheduleFlush() {
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, FLUSH_DELAY_MS)
}

function enqueue(event) {
  if (stopped) return false
  const wasEmpty = queue.length === 0
  queue.push(event)
  if (queue.length > MAX_QUEUE) {
    const excess = queue.length - MAX_QUEUE
    queue.splice(0, excess)
    log('queue-full', excess)
  }
  if (queue.length >= MAX_BATCH) {
    clearFlushTimer()
    flush()
    return true
  }
  if (wasEmpty) scheduleFlush()
  return true
}

function send(batch, keepalive) {
  const body = JSON.stringify({ anon: '', session: currentSession(), events: batch })
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }
  if (keepalive) init.keepalive = true

  let pending
  try {
    const f = fetchImpl || globalThis.fetch
    if (typeof f !== 'function') throw new Error('fetch unavailable')
    pending = f(ZH_EVENTS_ROUTE, init)
  } catch (err) {
    log('send-failed', err)
    return
  }
  if (!pending || typeof pending.then !== 'function') return
  // 只看结果做「停不停」，不 await、不重试、不把失败抛给调用方
  pending.then((res) => {
    const status = Number(res && res.status) || 0
    if (status === 429) {
      stopped = true
      log('rate-limited', status)
    } else if (!(res && res.ok)) {
      log('send-failed', status)
    }
  }, err => log('send-failed', err))
}

/**
 * 立即发掉队列（正常由定时器／满 20 条调用；页面隐藏与 pagehide 时再补一次 keepalive）。
 * 返回本次实际送出的条数（同步值，不是网络结果——调用方不需要 await）。
 */
export function flush({ keepalive = false } = {}) {
  clearFlushTimer()
  if (stopped) return 0
  let sent = 0
  while (queue.length) {
    const batch = queue.splice(0, MAX_BATCH)
    send(batch, keepalive)
    sent += batch.length
  }
  return sent
}

// ── ⑤ 生命周期补发 ────────────────────────────────────────────────────────

/** 标签页被切走／关掉时，普通 fetch 可能被浏览器掐断；keepalive 让最后一批尽量出门 */
function installLifecycleHooks() {
  const win = typeof window !== 'undefined' ? window : null
  if (!win || typeof win.addEventListener !== 'function') return
  win.addEventListener('pagehide', () => flush({ keepalive: true }))
  const doc = typeof document !== 'undefined' ? document : null
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden' || doc.hidden === true) flush({ keepalive: true })
    })
  }
}

installLifecycleHooks()

// ── ⑥ 测试钩子 ────────────────────────────────────────────────────────────

/** 单测用：清空队列与注入，回到刚加载时的状态（sessionStorage 与生命周期监听保留） */
export function resetZhEvents() {
  clearFlushTimer()
  queue = []
  stopped = false
  memorySession = ''
  hashWord = null
  logger = defaultLogger
  fetchImpl = null
  warnedNoHash = false
}
