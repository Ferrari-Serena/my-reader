/**
 * 词组「运行时云端终判」纯逻辑（浏览器与 Node 测试共用，不 import Vue）。
 *
 * 判定链：静态标注 → L1 cue → 本地缓存 → 云端终判。
 * 本文件只做最后一跳的请求载荷净化、响应校验、本地缓存与静默降级；
 * 不发请求的判定（是否要问云端）也放在这里，便于直接断言。
 */

export const CLOUD_PATH = '/api/phrase/resolve'
export const CLOUD_CONFIG_PATH = '/api/phrase/config'
export const CLOUD_TIMEOUT_MS = 8000
export const CLOUD_CONFIG_TIMEOUT_MS = 1500
export const CLOUD_CACHE_PREFIX = 'mr.phrase.cloud.v2.'
export const CLOUD_CACHE_MAX = 200
export const CLOUD_CACHE_SCHEMA_VERSION = 'v2'
export const CLOUD_CACHE_MODEL_VERSION = 'm1'
export const CLOUD_CACHE_PROMPT_VERSION = 'p2-abstain'
export const CLOUD_CACHE_LEXICON_VERSION = 'l1'
export const CLOUD_VERSIONS_STORAGE_KEY = 'mr.phrase.cloudVersions.v1'
export const CLOUD_VERSIONS_TTL_MS = 60 * 60 * 1000

const LEGACY_CLOUD_CACHE_PREFIX = 'mr.phrase.cloud.'
const VERSION_FIELDS = ['schema', 'model', 'prompt', 'lexicon']

export const DEFAULT_CLOUD_VERSIONS = Object.freeze({
  schema: CLOUD_CACHE_SCHEMA_VERSION,
  model: CLOUD_CACHE_MODEL_VERSION,
  prompt: CLOUD_CACHE_PROMPT_VERSION,
  lexicon: CLOUD_CACHE_LEXICON_VERSION,
})

let memoryVersions = null

const MAX_ID = 128
const MAX_PHRASE = 80
const MAX_SENTENCE = 1200
const MAX_SENSES = 12
const MAX_SENSE_ID = 200

/** 云端只解决「有多个义项、且 L1/静态标注没给出唯一答案」的情况。 */
export function cloudNeeded(senses, resolution) {
  if (!Array.isArray(senses) || senses.length < 2) return false
  if (!resolution) return true
  return !['unique', 'annotated'].includes(resolution.state)
}

/** 每个义项只保留服务端需要的 rank + zh，避免把前端多余的 cue 结构一并上送。 */
function cleanSenses(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const seenIds = new Set()
  const out = []
  for (const s of raw) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) continue
    if (!Number.isInteger(s.rank) || typeof s.zh !== 'string' || !s.zh.trim()) continue
    const id = s.id.trim().slice(0, MAX_SENSE_ID)
    if (seen.has(s.rank)) continue
    if (seenIds.has(id)) continue
    seen.add(s.rank)
    seenIds.add(id)
    out.push({ id, rank: s.rank, zh: s.zh.slice(0, 160).trim() })
    if (out.length >= MAX_SENSES) break
  }
  return out
}

function boundedString(v, max) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length <= max ? s : s.slice(0, max)
}

/**
 * 把调用方给的对象净化成可安全 POST 的载荷；不合法返回 null。
 * 一律只返回白名单字段，服务端仍会再验一遍（前端净化只是省请求）。
 */
export function buildCloudPayload(input) {
  if (!input || typeof input !== 'object') return null
  const senses = cleanSenses(input.senses)
  if (senses.length < 2) return null
  const bookId = boundedString(input.bookId, MAX_ID)
  const chapterId = boundedString(input.chapterId, MAX_ID)
  const paragraphId = boundedString(input.paragraphId, MAX_ID)
  const phrase = boundedString(input.phrase, MAX_PHRASE)
  const sentence = boundedString(input.sentence, MAX_SENTENCE)
  if (!bookId || !chapterId || !paragraphId || !phrase || !sentence) return null
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end)) return null
  if (input.start < 0 || input.end < input.start) return null
  return {
    bookId,
    chapterId,
    paragraphId,
    start: input.start,
    end: input.end,
    phrase,
    sentence,
    senses,
  }
}

/** 稳定串化：对象键按字典序，避免同一请求因字段顺序不同而生成不同缓存键。 */
function stableString(value) {
  if (Array.isArray(value)) return '[' + value.map(stableString).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableString(value[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function normalizeVersions(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const field of VERSION_FIELDS) {
    const value = typeof raw[field] === 'string' ? raw[field].trim() : ''
    if (!value || value.length > 120) return null
    out[field] = value
  }
  return out
}

/** 测试用：清掉模块内的版本记忆，避免跨用例串味。 */
export function resetCloudVersionsCache() {
  memoryVersions = null
}

/**
 * 取当前缓存代际。优先顺序：
 *   调用方注入 → 本次页面已取过 → localStorage 未过期 → /api/phrase/config → 内置常量。
 * 配置端失败时退回常量，不把「取不到版本」变成「不能判断」。
 */
export async function fetchCloudVersions(opts = {}) {
  const injected = normalizeVersions(opts.versions)
  if (injected) {
    memoryVersions = injected
    return { ...injected }
  }
  if (memoryVersions) return { ...memoryVersions }

  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  try {
    const rec = JSON.parse((storage && storage.getItem(CLOUD_VERSIONS_STORAGE_KEY)) || 'null')
    const cached = normalizeVersions(rec && rec.versions)
    const age = rec && Number.isFinite(rec.at) ? Date.now() - rec.at : -1
    if (cached && age >= 0 && age < CLOUD_VERSIONS_TTL_MS) {
      memoryVersions = cached
      return { ...cached }
    }
  } catch { /* 坏记录当作未命中 */ }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { ...DEFAULT_CLOUD_VERSIONS }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CLOUD_CONFIG_TIMEOUT_MS)
  try {
    const res = await fetchImpl(opts.configPath || CLOUD_CONFIG_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      signal: ctrl.signal,
    })
    if (!res.ok) return { ...DEFAULT_CLOUD_VERSIONS }
    const data = await res.json()
    const next = normalizeVersions(data && data.versions)
    if (!next) return { ...DEFAULT_CLOUD_VERSIONS }
    memoryVersions = next
    try {
      storage && storage.setItem(CLOUD_VERSIONS_STORAGE_KEY, JSON.stringify({ versions: next, at: Date.now() }))
    } catch { /* 存不下只影响下次启动，不影响本次 */ }
    return { ...next }
  } catch {
    return { ...DEFAULT_CLOUD_VERSIONS }
  } finally {
    clearTimeout(timer)
  }
}

/** 本地缓存键。句子只存在本机 localStorage，不上送、不出设备。 */
export function cloudCacheKey(payload, versions = DEFAULT_CLOUD_VERSIONS) {
  const v = normalizeVersions(versions) || DEFAULT_CLOUD_VERSIONS
  return stableString([
    v.schema,
    v.model,
    v.prompt,
    v.lexicon,
    payload.bookId,
    payload.chapterId,
    payload.paragraphId,
    payload.start,
    payload.end,
    payload.phrase,
    payload.sentence,
    payload.senses,
  ])
}

function storageKey(payload, versions) {
  return CLOUD_CACHE_PREFIX + cloudCacheKey(payload, versions)
}

/** 读取本地缓存；命中回整数 rank，未命中/损坏回 undefined（与「未定 null」区分）。 */
export function readCloudCache(storage, payload, versions = DEFAULT_CLOUD_VERSIONS) {
  if (!storage) return undefined
  let raw
  try {
    raw = storage.getItem(storageKey(payload, versions))
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const rec = JSON.parse(raw)
    return Number.isInteger(rec?.rank) ? rec.rank : undefined
  } catch {
    return undefined
  }
}

/** 写本地缓存；容量溢出时按前缀清掉最旧的缓存记录。 */
export function writeCloudCache(storage, payload, rank, versions = DEFAULT_CLOUD_VERSIONS) {
  if (!storage || !Number.isInteger(rank)) return
  try {
    storage.setItem(storageKey(payload, versions), JSON.stringify({ rank, at: Date.now() }))
  } catch {
    return
  }
  pruneCloudCache(storage)
}

/** 按前缀取全部缓存键，只保留最近 MAX 条。 */
export function pruneCloudCache(storage) {
  if (!storage || typeof storage.key !== 'function' || typeof storage.removeItem !== 'function') return
  try {
    const rows = []
    const legacy = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key) continue
      if (key.startsWith(LEGACY_CLOUD_CACHE_PREFIX) && !key.startsWith(CLOUD_CACHE_PREFIX)) {
        legacy.push(key)
        continue
      }
      if (!key.startsWith(CLOUD_CACHE_PREFIX)) continue
      let at = 0
      try {
        const rec = JSON.parse(storage.getItem(key) || '{}')
        at = Number.isFinite(rec.at) ? rec.at : 0
      } catch { at = 0 }
      rows.push({ key, at })
    }
    for (const key of legacy) {
      try { storage.removeItem(key) } catch { /* 忽略单条删除失败 */ }
    }
    if (rows.length <= CLOUD_CACHE_MAX) return
    rows.sort((a, b) => a.at - b.at)
    for (const row of rows.slice(0, rows.length - CLOUD_CACHE_MAX)) {
      try { storage.removeItem(row.key) } catch { /* 忽略单条删除失败 */ }
    }
  } catch { /* 容量清理失败不阻断主流程 */ }
}

/** 云端响应 → 在义项表里可验证的 rank；非法/未定回 null。 */
export function cloudRankFromResponse(data, senses) {
  if (!data || typeof data !== 'object') return null
  if (data.status !== 'cloud' || data.confidence !== 'certain') return null
  if (!Number.isInteger(data.rank)) return null
  return senses.some(s => s.rank === data.rank) ? data.rank : null
}

/**
 * 发一次云端终判。恒不抛：
 *   { status:'cloud', rank }     已确认（含本地缓存命中）
 *   { status:'uncertain' }       服务端判断不了
 *   { status:'unavailable' }     云端没配/不可用
 *   { status:'invalid' }         载荷净化失败
 *   { status:'offline' }         网络/超时错误
 *
 * 不自行判「该不该发」：调用方先用 cloudNeeded 挡住可本地解决的问题。
 */
export async function resolveCloudSense(input, opts = {}) {
  const payload = buildCloudPayload(input)
  if (!payload) return { status: 'invalid', rank: null }

  const versions = await fetchCloudVersions(opts)
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  const cached = readCloudCache(storage, payload, versions)
  if (cached !== undefined) return { status: 'cloud', rank: cached, cached: true }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { status: 'offline', rank: null }
  const apiBase = opts.apiBase || CLOUD_PATH
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : CLOUD_TIMEOUT_MS

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(apiBase, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      if (res.status === 400) return { status: 'invalid', rank: null }
      if (res.status === 401) return { status: 'unauthorized', rank: null }
      if (res.status === 429) return { status: 'rate_limited', rank: null }
      if (res.status === 503) return { status: 'unavailable', rank: null }
      return { status: 'error', rank: null }
    }
    const data = await res.json()
    const rank = cloudRankFromResponse(data, payload.senses)
    if (rank === null) return { status: 'uncertain', rank: null }
    writeCloudCache(storage, payload, rank, versions)
    return { status: 'cloud', rank }
  } catch {
    return { status: 'offline', rank: null }
  } finally {
    clearTimeout(timer)
  }
}
