#!/usr/bin/env node
// Build public/dict-zh/{a..z}.json + manifest.json from a LexiBridge en-zh-Hans pack.
//
// Usage:
//   node tools/build-zh-dict.mjs --src <repo>/packs/en-zh-Hans/dict.json
//     [--out public/dict-zh] [--irregular <repo>/engines/en-irregular.js]
//     [--commit <sha>] [--built-at <iso>] [--expect-words <n>]
//     [--omit-word] [--strict-size] [--quiet]
//
// Deterministic: shard keys are sorted, manifest.builtAt defaults to the source
// commit date (not the wall clock), so a rebuild over the same commit is
// byte-identical except when --built-at is passed explicitly.
//
// Data: ECDICT (MIT) via ChanMo/LexiBridge (MIT). See THIRD_PARTY.md.
// parseDefinition() is adapted from LexiBridge lexicon.js (MIT, ChanMo).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const READER_ROOT = path.resolve(HERE, '..')
const MAX_SHARD_BYTES = 300 * 1024

const USAGE = `build-zh-dict — LexiBridge dict.json -> public/dict-zh

  --src <file>        packs/en-zh-Hans/dict.json (required)
  --out <dir>         output dir (default: <reader>/public/dict-zh)
  --irregular <file>  engines/en-irregular.js (default: <repo>/engines/en-irregular.js)
  --commit <sha>      LexiBridge commit (default: git rev-parse in the source repo)
  --built-at <iso>    manifest.builtAt (default: source commit date, else source mtime)
  --expect-words <n>  fail when the entry count differs
  --omit-word         omit "w" when it equals the shard key (smaller shards)
  --strict-size       exit 1 when a shard exceeds 300 KiB
  --quiet             only print the summary line
`

function fail(message) {
  console.error(`build-zh-dict: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {
    out: path.join(READER_ROOT, 'public', 'dict-zh'),
    quiet: false,
    omitWord: false,
    strictSize: false,
    expectWords: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      return value
    }
    if (arg === '--src') out.src = path.resolve(next())
    else if (arg === '--out') out.out = path.resolve(next())
    else if (arg === '--irregular') out.irregular = path.resolve(next())
    else if (arg === '--commit') out.commit = next()
    else if (arg === '--built-at') out.builtAt = next()
    else if (arg === '--expect-words') out.expectWords = Number(next())
    else if (arg === '--omit-word') out.omitWord = true
    else if (arg === '--strict-size') out.strictSize = true
    else if (arg === '--quiet') out.quiet = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE)
      process.exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  if (!out.src) fail(`--src is required\n\n${USAGE}`)
  return out
}

// --- Word matching, adapted from LexiBridge lexicon.js (MIT) ----------------

const POS_ABBR = 'n|v|vt|vi|a|ad|adj|adv|art|prep|conj|pron|num|int|interj|aux|abbr'
const POS_WORD = 'noun|verb|adjective|adverb|preposition|conjunction|pronoun|exclamation|determiner|number'
const POS_RE = new RegExp(
  `(?:^|\\s)((?:${POS_ABBR})\\.(?:\\s*[&/]\\s*(?:${POS_ABBR})\\.)*|(?:${POS_WORD})(?=\\s))`, 'g')
const POS_SHORT = {
  a: 'adj.', ad: 'adv.', noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
  preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', exclamation: 'int.',
  determiner: 'det.', number: 'num.',
}

function shortPos(pos) {
  return pos.split(/\s*([&/])\s*/).map(p => POS_SHORT[p.replace(/\.$/, '')] ?? p).join('')
}

// "[əˈbændən] v. 1. 抛弃 2. 离弃 n. 放纵" ->
// {phonetic: "əˈbændən", groups: [{pos: "v.", senses: ["抛弃", "离弃"]}, ...]}
function parseDefinition(text) {
  let rest = String(text ?? '').trim().replace(/^\d+\s+(?=\[)/, '')
  let phonetic = null
  const ph = rest.match(/^\[([^\]]*)\]\s*/)
  if (ph) {
    phonetic = ph[1].trim() || null
    rest = rest.slice(ph[0].length)
  }
  const marks = [...rest.matchAll(POS_RE)]
  const parts = []
  if (!marks.length || marks[0].index > 0) {
    parts.push({ pos: null, body: rest.slice(0, marks[0]?.index ?? rest.length) })
  }
  marks.forEach((m, i) => {
    const start = m.index + m[0].length
    parts.push({ pos: shortPos(m[1]), body: rest.slice(start, marks[i + 1]?.index ?? rest.length) })
  })
  const groups = parts.map(({ pos, body }) => {
    const senses = body.split(/(?:^|\s)\d+\.\s*/).map(s => s.trim()).filter(Boolean)
    return { pos, senses }
  }).filter(g => g.senses.length || g.pos)
  return { phonetic, groups }
}

function normalizeWord(word) {
  return String(word).replace(/^\uFEFF/, '').replace(/\u2019/g, "'").trim().toLowerCase()
}

// --- Source ----------------------------------------------------------------

function readSource(file) {
  const raw = fs.readFileSync(file)
  let text = raw.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const crlf = (text.match(/\r\n/g) || []).length
  if (crlf) text = text.replace(/\r\n/g, '\n')
  const bytes = Buffer.from(text, 'utf8')
  return { text, bytes, sha1: crypto.createHash('sha1').update(bytes).digest('hex'), crlf }
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function tryGit(repo, args) {
  try {
    return git(repo, args)
  } catch {
    return null
  }
}

function readIrregular(file, dict) {
  if (!file || !fs.existsSync(file)) return { table: new Map(), dropped: 0, found: false }
  const src = fs.readFileSync(file, 'utf8')
  const m = src.match(/Object\.entries\(\{([\s\S]*?)\}\)/)
  if (!m) fail(`cannot parse ${file}`)
  const parsed = JSON.parse(`{${m[1]}}`)
  const table = new Map()
  let dropped = 0
  for (const [form, base] of Object.entries(parsed)) {
    const f = normalizeWord(form)
    const b = normalizeWord(base)
    if (f === b || !dict.has(b)) dropped++
    else table.set(f, b)
  }
  return { table, dropped, found: true }
}

function readEcdict(repoRoot) {
  const lock = path.join(repoRoot, 'tools', 'sources.lock.json')
  if (!fs.existsSync(lock)) return null
  try {
    const data = JSON.parse(fs.readFileSync(lock, 'utf8'))
    const url = data.ecdict?.url || ''
    const commit = (url.match(/[0-9a-f]{40}/) || [null])[0]
    if (!commit) return null
    return { repo: 'https://github.com/skywind3000/ECDICT', commit, license: data.ecdict.license || 'MIT' }
  } catch {
    return null
  }
}

// --- Build -----------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const source = readSource(opts.src)
  let data
  try {
    data = JSON.parse(source.text)
  } catch (e) {
    fail(`source is not valid JSON: ${e.message}`)
  }

  const entries = Object.entries(data)
  if (opts.expectWords !== null && entries.length !== opts.expectWords) {
    fail(`expected ${opts.expectWords} entries, got ${entries.length}`)
  }

  const dict = new Map()
  const grouped = new Map()
  let normalizedEscapes = 0
  let duplicates = 0
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeWord(rawKey)
    if (!/^[a-z][a-z'-]*$/.test(key)) fail(`unsupported key: ${JSON.stringify(rawKey)}`)
    if (dict.has(key)) { duplicates++; continue }

    let value = String(rawValue ?? '')
    if (/\\[rn]/.test(value)) normalizedEscapes++
    value = value.replace(/\\[rn]/g, ' ').replace(/\s+/g, ' ').trim()

    const { phonetic, groups } = parseDefinition(value)
    const t = []
    for (const g of groups) {
      if (g.senses.length) t.push((g.pos ? `${g.pos} ` : '') + g.senses.join('；'))
    }
    if (!t.length && value) t.push(value.replace(/^\[[^\]]*\]\s*/, ''))

    const record = opts.omitWord
      ? { p: phonetic || '', t }
      : { w: key, p: phonetic || '', t }
    dict.set(key, record)
    if (!grouped.has(key[0])) grouped.set(key[0], [])
    grouped.get(key[0]).push(key)
  }
  if (duplicates) fail(`${duplicates} duplicate keys after normalization`)

  const letters = [...grouped.keys()].sort()
  if (letters.length !== 26) fail(`expected 26 shards, got ${letters.length}: ${letters.join('')}`)

  const repoRoot = path.resolve(path.dirname(opts.src), '..', '..')
  const irregularPath = opts.irregular || path.join(repoRoot, 'engines', 'en-irregular.js')
  const irregular = readIrregular(irregularPath, dict)

  const commit = opts.commit || tryGit(repoRoot, ['rev-parse', 'HEAD']) || 'unknown'
  const builtAt = opts.builtAt
    || (commit !== 'unknown' ? tryGit(repoRoot, ['show', '-s', '--format=%cI', commit]) : null)
    || fs.statSync(opts.src).mtime.toISOString()

  fs.mkdirSync(opts.out, { recursive: true })
  const shards = []
  let shardBytes = 0
  for (const letter of letters) {
    const words = grouped.get(letter).sort()
    const shard = {}
    for (const word of words) shard[word] = dict.get(word)
    const buf = Buffer.from(`${JSON.stringify(shard)}\n`, 'utf8')
    fs.writeFileSync(path.join(opts.out, `${letter}.json`), buf)
    shardBytes += buf.length
    shards.push({
      letter,
      file: `${letter}.json`,
      words: words.length,
      bytes: buf.length,
      sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    })
  }

  const irregularSorted = {}
  for (const form of [...irregular.table.keys()].sort()) {
    irregularSorted[form] = irregular.table.get(form)
  }
  const irregularBuf = Buffer.from(`${JSON.stringify(irregularSorted)}\n`, 'utf8')
  fs.writeFileSync(path.join(opts.out, 'irregular.json'), irregularBuf)

  const manifest = {
    schemaVersion: 1,
    generatedBy: 'tools/build-zh-dict.mjs',
    builtAt,
    record: opts.omitWord
      ? { p: 'phonetic (IPA, may be empty)', t: 'definitions, POS-prefixed strings' }
      : { w: 'word form (equals the key)', p: 'phonetic (IPA, may be empty)', t: 'definitions, POS-prefixed strings' },
    source: {
      repo: 'https://github.com/ChanMo/LexiBridge',
      commit,
      path: 'packs/en-zh-Hans/dict.json',
      eol: 'LF',
      bytes: source.bytes.length,
      sha1: source.sha1,
      words: dict.size,
      ecdict: readEcdict(repoRoot),
    },
    irregular: {
      file: 'irregular.json',
      entries: irregular.table.size,
      bytes: irregularBuf.length,
      sha1: crypto.createHash('sha1').update(irregularBuf).digest('hex'),
    },
    shards,
    totals: {
      words: dict.size,
      shards: shards.length,
      shardBytes,
      irregularBytes: irregularBuf.length,
      bytes: shardBytes + irregularBuf.length,
    },
  }
  fs.writeFileSync(path.join(opts.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const oversized = shards.filter(s => s.bytes > MAX_SHARD_BYTES)
  const max = shards.reduce((a, b) => (b.bytes > a.bytes ? b : a), shards[0])
  if (!opts.quiet) {
    for (const s of shards) {
      process.stdout.write(`${s.letter} ${String(s.words).padStart(5)} words ${String(s.bytes).padStart(8)} B\n`)
    }
    process.stdout.write(`irregular ${String(irregular.table.size).padStart(4)} entries ${String(irregularBuf.length).padStart(7)} B (dropped ${irregular.dropped})\n`)
    process.stdout.write(`source ${source.bytes.length} B (LF), ${source.crlf} CRLF normalized, ${normalizedEscapes} literal-escape values\n`)
  }
  process.stdout.write(
    `OK ${shards.length} shards, ${dict.size} words, `
    + `shards ${shardBytes} B + irregular ${irregularBuf.length} B = ${manifest.totals.bytes} B, `
    + `max ${max.letter}.json ${max.bytes} B (${(max.bytes / 1024).toFixed(1)} KiB)\n`)

  if (oversized.length) {
    const list = oversized.map(s => `${s.letter}.json ${(s.bytes / 1024).toFixed(1)} KiB`).join(', ')
    console.error(`build-zh-dict: over ${MAX_SHARD_BYTES} B: ${list}`)
    if (opts.strictSize) process.exit(1)
  }
}

main()
