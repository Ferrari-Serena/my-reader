// Lazy Chinese dictionary for the word popup.
//
// Data lives in public/dict-zh/ (26 letter shards + manifest + irregular table),
// built by tools/build-zh-dict.mjs from ECDICT via ChanMo/LexiBridge (MIT).
// See THIRD_PARTY.md.
//
// lookup(word) never throws: on miss, 404, timeout or network error it resolves
// to null and the caller falls back to /api/dict. Definitive misses are cached
// for the session; transport errors get a short TTL so a flaky network does not
// hide a word for the rest of the session.

const BASE_URL = `${import.meta.env?.BASE_URL || '/'}dict-zh/`
const FETCH_TIMEOUT_MS = 8000
const ERROR_TTL_MS = 45_000

const shards = new Map() // letter -> Map(word -> record) | null (404)
const shardInflight = new Map() // letter -> Promise
const shardErrors = new Map() // letter -> retry-after timestamp
const misses = new Map() // word -> { until, version }

let manifest = null
let manifestPromise = null
let versionByLetter = null
let irregular = null
let irregularPromise = null

function fetchJson(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { signal: ctrl.signal, credentials: 'same-origin' })
    .then(res => {
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`)
        err.status = res.status
        throw err
      }
      return res.json()
    })
    .finally(() => clearTimeout(timer))
}

function loadManifest() {
  if (manifest) return Promise.resolve(manifest)
  if (!manifestPromise) {
    manifestPromise = fetchJson(`${BASE_URL}manifest.json`)
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
function loadShard(letter) {
  if (shards.has(letter)) return Promise.resolve(shards.get(letter))
  if (shardInflight.has(letter)) return shardInflight.get(letter)
  const retryAfter = shardErrors.get(letter)
  if (retryAfter && retryAfter > Date.now()) return Promise.reject(new Error('shard backoff'))

  const task = (async () => {
    await loadManifest()
    const version = shardVersion(letter)
    try {
      const data = await fetchJson(`${BASE_URL}${letter}.json${version ? `?v=${version}` : ''}`)
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

function loadIrregular() {
  if (irregular) return Promise.resolve(irregular)
  if (!irregularPromise) {
    irregularPromise = fetchJson(`${BASE_URL}irregular.json`)
      .then(data => (irregular = new Map(Object.entries(data))))
      .catch(() => {
        irregularPromise = null
        return new Map()
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

async function recordOf(word) {
  const map = await loadShard(word[0])
  return map ? map.get(word) || null : null
}

async function resolve(word) {
  const direct = await recordOf(word)
  if (direct) return { key: word, record: direct }

  const table = await loadIrregular()
  const base = table.get(word)
  if (base) {
    const record = await recordOf(base)
    if (record) return { key: base, record }
  }

  for (const guess of stems(word)) {
    if (guess === word) continue
    const record = await recordOf(guess)
    if (record) return { key: guess, record }
  }
  return null
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

/**
 * Look up a clicked word in the bundled Chinese dictionary.
 * @param {string} input surface form as rendered in the book
 * @returns {Promise<{word: string, phonetic: string, partOfSpeech: string, definitions: string[]}|null>}
 */
export async function lookup(input) {
  const word = normalizeWord(input)
  if (word.length < 2 || !/^[a-z]/.test(word)) return null

  const version = versionKey()
  const miss = misses.get(word)
  if (miss && miss.version === version && (miss.until === Infinity || miss.until > Date.now())) {
    return null
  }

  try {
    const hit = await resolve(word)
    if (!hit) {
      misses.set(word, { until: Infinity, version })
      return null
    }
    return toEntry(hit.key, hit.record)
  } catch {
    misses.set(word, { until: Date.now() + ERROR_TTL_MS, version })
    return null
  }
}
