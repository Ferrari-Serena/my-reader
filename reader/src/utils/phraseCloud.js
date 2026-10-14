/**
 * 词组「运行时云端终判」纯逻辑（浏览器与 Node 测试共用，不 import Vue）。
 *
 * 判定链：静态标注 → L1 cue → 本地缓存 → 云端终判。
 * 本文件只做最后一跳的请求载荷净化、响应校验、本地缓存与静默降级；
 * 不发请求的判定（是否要问云端）也放在这里，便于直接断言。
 */

export const CLOUD_PATH = '/api/phrase/resolve'
export const CLOUD_TIMEOUT_MS = 8000
export const CLOUD_CACHE_PREFIX = 'mr.phrase.cloud.'
export const CLOUD_CACHE_MAX = 200

const MAX_ID = 128
const MAX_PHRASE = 80
const MAX_SENTENCE = 1200
const MAX_SENSES = 12

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
  const out = []
  for (const s of raw) {
    if (!s || !Number.isInteger(s.rank) || typeof s.zh !== 'string' || !s.zh.trim()) continue
    if (seen.has(s.rank)) continue
    seen.add(s.rank)
    out.push({ rank: s.rank, zh: s.zh.slice(0, 160).trim() })
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

/** 本地缓存键。句子只存在本机 localStorage，不上送、不出设备。 */
export function cloudCacheKey(payload) {
  return stableString([
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

function storageKey(payload) {
  return CLOUD_CACHE_PREFIX + cloudCacheKey(payload)
}

/** 读取本地缓存；命中回整数 rank，未命中/损坏回 undefined（与「未定 null」区分）。 */
export function readCloudCache(storage, payload) {
  if (!storage) return undefined
  let raw
  try {
    raw = storage.getItem(storageKey(payload))
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
export function writeCloudCache(storage, payload, rank) {
  if (!storage || !Number.isInteger(rank)) return
  try {
    storage.setItem(storageKey(payload), JSON.stringify({ rank, at: Date.now() }))
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
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key || !key.startsWith(CLOUD_CACHE_PREFIX)) continue
      let at = 0
      try {
        const rec = JSON.parse(storage.getItem(key) || '{}')
        at = Number.isFinite(rec.at) ? rec.at : 0
      } catch { at = 0 }
      rows.push({ key, at })
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

  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  const cached = readCloudCache(storage, payload)
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
      return res.status === 503 ? { status: 'unavailable', rank: null } : { status: 'error', rank: null }
    }
    const data = await res.json()
    const rank = cloudRankFromResponse(data, payload.senses)
    if (rank === null) return { status: 'uncertain', rank: null }
    writeCloudCache(storage, payload, rank)
    return { status: 'cloud', rank }
  } catch {
    return { status: 'offline', rank: null }
  } finally {
    clearTimeout(timer)
  }
}
