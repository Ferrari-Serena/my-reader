// Lazy Chinese dictionary for the word popup.
//
// Data lives in public/dict-zh/ (26 letter shards + manifest + irregular table),
// built by tools/build-zh-dict.mjs from ECDICT via ChanMo/LexiBridge (MIT).
// See THIRD_PARTY.md.
//
// lookup(word) never throws. It resolves to one of four shapes (dict-zh 冻结包 §三·6):
//   { status: 'hit',   result: 'direct'|'irregular'|'stem', entry }
//   { status: 'miss',  reason: 'miss_dict'|'miss_empty'|'miss_shard' }
//   { status: 'error', reason: 'miss_net' }
// A record that exists but yields no definitions is miss_empty, not a hit.
// Definitive misses are cached for the session; transport errors get a short TTL
// so a flaky network does not hide a word for the rest of the session.
//
// `signal` is the caller's end-to-end deadline (ReaderView, 8 s from click). It
// covers manifest/direct/irregular/stems; the per-request FETCH_TIMEOUT_MS below
// is only the single-request safety net.

const BASE_URL = `${import.meta.env?.BASE_URL || '/'}dict-zh/`
const FETCH_TIMEOUT_MS = 8000
const ERROR_TTL_MS = 45_000

// A shard that answered 404, or an irregular table that could not be loaded.
// Distinct from a shard that loaded but lacks the word (definitive miss_dict).
const SHARD_MISSING = Symbol('zh-shard-missing')

const shards = new Map() // letter -> Map(word -> record) | null (404)
const shardInflight = new Map() // letter -> Promise
const shardErrors = new Map() // letter -> retry-after timestamp
const misses = new Map() // word -> { until, version }

let manifest = null
let manifestPromise = null
let versionByLetter = null
let irregular = null
let irregularPromise = null

function fetchJson(url, signal) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const relay = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', relay, { once: true })
  }
  return fetch(url, { signal: ctrl.signal, credentials: 'same-origin' })
    .then(res => {
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`)
        err.status = res.status
        throw err
      }
      return res.json()
    })
    .finally(() => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', relay)
    })
}

// 外部 deadline 到点后立即让调用方拿到 rejection，即使共享中的 fetch 还没被底层取消。
function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    const err = new Error('aborted')
    err.name = 'AbortError'
    return Promise.reject(err)
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      err => { signal.removeEventListener('abort', onAbort); reject(err) }
    )
  })
}

function loadManifest(signal) {
  if (manifest) return Promise.resolve(manifest)
  if (!manifestPromise) {
    manifestPromise = fetchJson(`${BASE_URL}manifest.json`, signal)
      .then(data => (manifest = data))
      .catch(() => {
        manifestPromise = null
        return null
      })
  }
  return manifestPromise
}

function shardVersion(letter) {
  if (!manifest) return ''
  if (!versionByLetter) {
    versionByLetter = new Map()
    for (const shard of manifest.shards || []) {
      versionByLetter.set(shard.letter, String(shard.sha1 || '').slice(0, 8))
    }
  }
  return versionByLetter.get(letter) || ''
}

// Resolves to the shard Map, or null when the shard is a permanent 404.
// Throws on transport errors so the caller can apply the short TTL.
function loadShard(letter, signal) {
  if (shards.has(letter)) return Promise.resolve(shards.get(letter))
  if (shardInflight.has(letter)) return shardInflight.get(letter)
  const retryAfter = shardErrors.get(letter)
  if (retryAfter && retryAfter > Date.now()) return Promise.reject(new Error('shard backoff'))

  const task = (async () => {
    await loadManifest(signal)
    const version = shardVersion(letter)
    try {
      const data = await fetchJson(`${BASE_URL}${letter}.json${version ? `?v=${version}` : ''}`, signal)
      const map = new Map(Object.entries(data))
      shards.set(letter, map)
      shardErrors.delete(letter)
      return map
    } catch (err) {
      if (err.status === 404) {
        shards.set(letter, null)
        return null
      }
      shardErrors.set(letter, Date.now() + ERROR_TTL_MS)
      throw err
    } finally {
      shardInflight.delete(letter)
    }
  })()

  shardInflight.set(letter, task)
  return task
}

function loadIrregular(signal) {
  if (irregular) return Promise.resolve(irregular)
  if (!irregularPromise) {
    irregularPromise = fetchJson(`${BASE_URL}irregular.json`, signal)
      .then(data => (irregular = new Map(Object.entries(data))))
      .catch(() => {
        irregularPromise = null
        return null // 表没取到 ⇒ miss_shard 一侧，不能据此断言 miss_dict
      })
  }
  return irregularPromise
}

// Inflected form -> base-form guesses, same rules as LexiBridge lexicon.js.
function stems(word) {
  const out = []
  const add = s => { if (s.length >= 3) out.push(s) }
  const undouble = s => (s.length >= 2 && s.at(-1) === s.at(-2) ? s.slice(0, -1) : null)
  if (word.endsWith("'s")) return [word.slice(0, -2)]
  if (word.endsWith('ies') || word.endsWith('ied')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('es')) add(word.slice(0, -2))
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1))
  if (word.endsWith('ed')) {
    const s = word.slice(0, -2)
    add(s)
    add(`${s}e`)
    if (undouble(s)) add(undouble(s))
  }
  if (word.endsWith('ing')) {
    const s = word.slice(0, -3)
    add(s)
    add(`${s}e`)
    if (undouble(s)) add(undouble(s))
  }
  return out
}

export function normalizeWord(input) {
  return String(input ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z']+$/, '')
    .replace(/'+$/, '')
    .toLowerCase()
}

async function recordOf(word, signal) {
  const map = await abortable(loadShard(word[0], signal), signal)
  if (!map) return SHARD_MISSING // 该字母片 404：没取到，不能断言未收
  return map.get(word) || null
}

async function resolve(word, signal) {
  let missing = false

  const direct = await recordOf(word, signal)
  if (direct === SHARD_MISSING) missing = true
  else if (direct) return { key: word, record: direct, result: 'direct' }

  const table = await loadIrregular(signal)
  if (!table) missing = true
  else {
    const base = table.get(word)
    if (base) {
      const record = await abortable(recordOf(base, signal), signal)
      if (record === SHARD_MISSING) missing = true
      else if (record) return { key: base, record, result: 'irregular' }
    }
  }

  for (const guess of stems(word)) {
    if (guess === word) continue
    const record = await abortable(recordOf(guess, signal), signal)
    if (record === SHARD_MISSING) { missing = true; continue }
    if (record) return { key: guess, record, result: 'stem' }
  }

  return missing ? SHARD_MISSING : null
}

const POS_PREFIX = /^((?:n|v|vt|vi|a|ad|adj|adv|art|prep|conj|pron|num|int|interj|aux|abbr)\.)\s/

function toEntry(key, record) {
  const definitions = Array.isArray(record?.t) ? record.t.slice() : []
  const pos = definitions.length ? POS_PREFIX.exec(definitions[0]) : null
  return {
    word: record?.w || key,
    phonetic: record?.p || '',
    partOfSpeech: pos ? pos[1] : '',
    definitions,
  }
}

function versionKey() {
  return manifest?.source?.commit || ''
}

function cacheMiss(word, version, value, until) {
  misses.set(word, { until, version, value })
  return value
}

/**
 * Look up a clicked word in the bundled Chinese dictionary.
 * @param {string} input surface form as rendered in the book
 * @param {{offline?:boolean, signal?:AbortSignal}} [options]
 *   offline: 明确离线时，传输失败归 miss_shard（不能断言词典未收）
 *   signal:  端到端 deadline（从点击算起，8 s），到点 abort 归 miss_net
 * @returns {Promise<
 *   {status:'hit',result:'direct'|'irregular'|'stem',entry:object}|
 *   {status:'miss',reason:'miss_dict'|'miss_empty'|'miss_shard'}|
 *   {status:'error',reason:'miss_net'}
 * >}
 */
export async function lookup(input, options = {}) {
  const { offline = false, signal } = options || {}
  const word = normalizeWord(input)
  // a／I 这类在 ReaderView 已被长度闸挡住；这里保持同一口径，不把无字母输入当「网络错」。
  if (word.length < 2 || !/^[a-z]/.test(word)) {
    return { status: 'miss', reason: 'miss_dict' }
  }

  const version = versionKey()
  const miss = misses.get(word)
  if (miss && miss.version === version && (miss.until === Infinity || miss.until > Date.now())) {
    return miss.value
  }

  if (signal && signal.aborted) return { status: 'error', reason: 'miss_net' }

  try {
    const hit = await abortable(resolve(word, signal), signal)
    if (hit === SHARD_MISSING) return { status: 'miss', reason: 'miss_shard' }
    if (!hit) {
      // direct/irregular/stems 用到的每个 shard 都已加载，词不在片内。
      return cacheMiss(word, version, { status: 'miss', reason: 'miss_dict' }, Infinity)
    }

    const entry = toEntry(hit.key, hit.record)
    if (!entry.definitions.length) {
      // record 在但零释义：不算 hit，不发 zh_shown。
      return cacheMiss(word, version, { status: 'miss', reason: 'miss_empty' }, Infinity)
    }
    return { status: 'hit', result: hit.result, entry }
  } catch {
    const value = offline
      ? { status: 'miss', reason: 'miss_shard' }
      : { status: 'error', reason: 'miss_net' }
    // 传输错误只挡 45 s，别让一次抖动把词藏一整个会话。
    return cacheMiss(word, version, value, Date.now() + ERROR_TTL_MS)
  }
}

/** 重试入口：清掉该词被缓存下来的 miss（词组/网络恢复后重查用）。 */
export function clearMiss(input) {
  misses.delete(normalizeWord(input))
}

/** 重试入口：清掉某字母片的传输错误退避（404 的 null 缓存不动）。 */
export function clearShardError(letter) {
  shardErrors.delete(String(letter ?? '').toLowerCase())
}
