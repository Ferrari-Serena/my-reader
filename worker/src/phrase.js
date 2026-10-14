/**
 * my-reader 词组「运行时云端终判」Worker 端点。
 *
 * POST /api/phrase/resolve
 * body: {
 *   bookId, chapterId, paragraphId, start, end, phrase, sentence,
 *   senses: [{ rank, zh }]
 * }
 *
 * 判定的最后一跳：前端已经把静态标注 / L1 cue 解决不了的多义词组发上来，
 * 这里调一次 OpenAI-compatible 聊天模型，让模型从候选义项里选一个 rank。
 *
 * 响应：
 *   200 { status:'cloud', rank }       已确定（可能是 D1 缓存命中）
 *   200 { status:'uncertain', rank:null } 模型也判断不了
 *   400 { status:'invalid' }           载荷形状不合法
 *   401 { status:'unauthorized' }      BYO 书未登录
 *   503 { status:'unavailable' }       未配置模型密钥/地址/模型名
 *
 * 隐私边界：
 * - 请求里的 `sentence` 只在模型调用内存里出现，**不落 D1**。
 * - D1 缓存键是 SHA-256 摘要（对公开书加 `public:` 前缀；BYO 书加 `user:<userId>:` 前缀），
 *   因此 BYO 书的命中**绝不跨用户共享**，公开内置书才共享。
 */

import { corsFor } from './cors.js'
import { sessionUserId } from './authapi.js'
import { isBookId } from './sync.js'

export const ROUTE_PATH = '/api/phrase/resolve'

export const MAX_BODY_BYTES = 16 * 1024
export const MAX_ID = 128
export const MAX_PHRASE = 80
export const MAX_SENTENCE = 1200
export const MAX_SENSES = 12
export const MAX_SENSE_ZH = 160

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  })
}

function bounded(v, max) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length <= max ? s : s.slice(0, max)
}

/**
 * 与 reader/src/utils/phraseCloud.js 的 cleanSenses/buildCloudPayload 同口径净化。
 * 前端净化只是省请求，这里必须再验一遍：客户端不可信。
 */
export function cleanPhraseSenses(raw) {
  if (!Array.isArray(raw)) return null
  const seen = new Set()
  const out = []
  for (const s of raw) {
    if (!s || !Number.isInteger(s.rank) || typeof s.zh !== 'string' || !s.zh.trim()) return null
    if (seen.has(s.rank)) return null
    seen.add(s.rank)
    out.push({ rank: s.rank, zh: s.zh.slice(0, MAX_SENSE_ZH).trim() })
    if (out.length > MAX_SENSES) return null
  }
  return out
}

/** 把 body 净化成白名单载荷；不合法返回 { error }。 */
export function parsePhrasePayload(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'invalid body' }
  const senses = cleanPhraseSenses(raw.senses)
  if (!senses || senses.length < 2) return { error: 'at least two senses required' }

  const payload = {
    bookId: bounded(raw.bookId, MAX_ID),
    chapterId: bounded(raw.chapterId, MAX_ID),
    paragraphId: bounded(raw.paragraphId, MAX_ID),
    phrase: bounded(raw.phrase, MAX_PHRASE),
    sentence: bounded(raw.sentence, MAX_SENTENCE),
    senses,
  }
  if (!payload.bookId || !payload.chapterId || !payload.paragraphId || !payload.phrase || !payload.sentence) {
    return { error: 'missing required field' }
  }
  if (!Number.isInteger(raw.start) || !Number.isInteger(raw.end)) return { error: 'invalid span' }
  if (raw.start < 0 || raw.end < raw.start) return { error: 'invalid span' }
  payload.start = raw.start
  payload.end = raw.end
  return { payload }
}

/** 稳定串化：字段顺序固定，与前端 cloudCacheKey 保持同一套可复算性。 */
export function canonicalPhrasePayload(payload) {
  return JSON.stringify([
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

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 缓存键：摘要里不含可读句子；BYO 注入 userId 隔开租户，公开书共享。 */
export async function phraseCacheKey(payload, userId = '') {
  const scope = userId ? `user:${userId}:` : 'public:'
  return scope + await sha256Hex(canonicalPhrasePayload(payload))
}

/** 模型配置：地址 + 密钥 + 模型名三者齐备才算可用。 */
export function phraseLlmConfig(env) {
  const base = String((env && env.PHRASE_LLM_BASE_URL) || '').trim().replace(/\/+$/, '')
  const key = String((env && env.PHRASE_LLM_API_KEY) || '').trim()
  const model = String((env && env.PHRASE_LLM_MODEL) || '').trim()
  return { base, key, model, ready: !!(base && key && model) }
}

/** 从模型输出里抽 rank；只认候选表里的整数。 */
export function rankFromModelText(text, senses) {
  if (typeof text !== 'string') return null
  const nums = text.match(/\d+/g) || []
  for (const n of nums) {
    const rank = Number(n)
    if (senses.some(s => s.rank === rank)) return rank
  }
  return null
}

/**
 * 一次模型调用。恒不抛；失败回 { ok:false, status, detail }。
 * 默认走 OpenAI-compatible `/chat/completions`，可用 `fetchImpl` 注入测试替身。
 */
export async function callPhraseLlm(env, payload, opts = {}) {
  const cfg = phraseLlmConfig(env)
  if (!cfg.ready) return { ok: false, status: 503, detail: 'phrase LLM not configured' }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const candidateLines = payload.senses.map(s => `${s.rank}. ${s.zh}`).join('\n')
  const body = JSON.stringify({
    model: cfg.model,
    temperature: 0,
    max_tokens: 24,
    messages: [
      {
        role: 'system',
        content: 'You choose the dictionary sense used in context. Reply with only the sense rank integer.'
      },
      {
        role: 'user',
        content: `Phrase: ${payload.phrase}\nSentence: ${payload.sentence}\nCandidates:\n${candidateLines}`
      }
    ]
  })

  let res
  try {
    res = await fetchImpl(cfg.base, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/json'
      },
      body,
    })
  } catch (e) {
    return { ok: false, status: 0, detail: String((e && e.message) || e) }
  }

  if (!res.ok) return { ok: false, status: res.status, detail: `upstream ${res.status}` }
  let data = null
  try {
    data = await res.json()
  } catch {
    return { ok: false, status: res.status, detail: 'non-json upstream' }
  }
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : ''
  const rank = rankFromModelText(text, payload.senses)
  if (rank === null) return { ok: true, rank: null }
  return { ok: true, rank }
}

/** 主入口：不匹配返回 null，匹配返回 Response。 */
export async function handlePhraseResolve(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== ROUTE_PATH) return null

  const cors = corsFor(request, env)
  if (request.method !== 'POST') {
    return json(cors, { status: 'invalid', error: 'method not allowed' }, 405, { Allow: 'POST' })
  }

  let text
  try {
    text = await request.text()
  } catch {
    return json(cors, { status: 'invalid', error: 'invalid body' }, 400)
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json(cors, { status: 'invalid', error: 'body too large' }, 413)
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return json(cors, { status: 'invalid', error: 'invalid json' }, 400)
  }

  const parsed = parsePhrasePayload(raw)
  if (!parsed.payload) {
    return json(cors, { status: 'invalid', error: parsed.error }, 400)
  }
  const payload = parsed.payload

  // BYO 书必须登录；公开内置书按当前产品口径免登录。
  let userId = ''
  if (isBookId(payload.bookId)) {
    userId = await sessionUserId(request, env)
    if (!userId) return json(cors, { status: 'unauthorized', error: 'login required' }, 401)
  }

  const cfg = phraseLlmConfig(env)
  if (!cfg.ready) {
    return json(cors, { status: 'unavailable', error: 'phrase LLM not configured' }, 503)
  }

  let cacheKey
  try {
    cacheKey = await phraseCacheKey(payload, userId)
  } catch (e) {
    console.error('phrase cache key failed:', e && e.message)
    return json(cors, { status: 'unavailable', error: 'cache key failed' }, 500)
  }

  // 1. D1 缓存（公开书共享；BYO 的键已按 user 分隔）。
  try {
    const row = await env.DB
      .prepare('SELECT rank FROM phrase_cloud_cache WHERE cache_key = ?')
      .bind(cacheKey)
      .first()
    if (row && payload.senses.some(s => s.rank === row.rank)) {
      return json(cors, { status: 'cloud', rank: row.rank, source: 'cache' })
    }
  } catch (e) {
    console.error('phrase cache read failed:', e && e.message)
  }

  // 2. 模型终判。
  const r = await callPhraseLlm(env, payload)
  if (!r.ok) {
    if (r.status === 503) return json(cors, { status: 'unavailable', error: r.detail }, 503)
    console.error('phrase llm failed:', r.status, r.detail)
    return json(cors, { status: 'unavailable', error: 'upstream failed' }, 502)
  }
  if (r.rank === null) {
    return json(cors, { status: 'uncertain', rank: null })
  }

  // 3. 写缓存；写失败不阻断响应。
  try {
    await env.DB
      .prepare('INSERT OR IGNORE INTO phrase_cloud_cache (cache_key, rank, created_at) VALUES (?, ?, ?)')
      .bind(cacheKey, r.rank, Date.now())
      .run()
  } catch (e) {
    console.error('phrase cache write failed:', e && e.message)
  }

  return json(cors, { status: 'cloud', rank: r.rank, source: 'model' })
}
