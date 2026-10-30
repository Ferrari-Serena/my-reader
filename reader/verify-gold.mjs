/**
 * 金标 runner（W-08 · E2 验收用）——把 gold-100.json 跑一遍，出通过率／失败题／疑似同义干扰项。
 *
 * 用法：
 *   node verify-gold.mjs --gold <gold-100.json 的绝对路径>
 *   GOLD_PATH=<路径> node verify-gold.mjs
 *
 * 判定口径（W-08 §3.3 · D-7）：
 *   - 正确率 ≥ 90%，且
 *   - 无「同题两解」（任一题的干扰项与答案同义 ⇒ 整份不通过，不按比例折算）。
 *
 * 覆盖口径：题目由 quizGen 现生成。`generateQuestions` 按 TYPE_MIX 抽题型、且每次随机，
 * 单轮覆盖不全 ⇒ 本 runner 跑多轮取并集（轮数 = ROUNDS），并在报告里单列「金标条目没被
 * 生成出对应题型」的数量——**覆盖不足不等于答错**，两者分开报。
 *
 * 不触网、不挂组件、不改任何文件。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateQuestions, generatePhraseQuestions } from './src/quizGen.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUNDS = 80

function argOf(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : ''
}
const goldPath = argOf('--gold') || process.env.GOLD_PATH || ''
if (!goldPath) {
  console.error('用法: node verify-gold.mjs --gold <gold-100.json>')
  process.exit(2)
}

const gold = JSON.parse(readFileSync(goldPath, 'utf8'))
const pool = gold.pool || {}
const items = gold.items || []

// ─── 词典分片：只为 pool.words 建条目 ───────────────────────────────
const shardCache = new Map()
function shardOf(letter) {
  if (shardCache.has(letter)) return shardCache.get(letter)
  let data = null
  try {
    data = JSON.parse(readFileSync(join(__dirname, 'public/dict-zh', `${letter}.json`), 'utf8'))
  } catch { data = null }
  shardCache.set(letter, data)
  return data
}
function entryOf(word) {
  const w = String(word || '').toLowerCase()
  const shard = shardOf(w[0])
  const rec = shard ? shard[w] : null
  if (!rec || !Array.isArray(rec.t) || !rec.t.length) return null
  return {
    word: w,
    snapshot: {
      text: w,
      phonetic: rec.p || '',
      partOfSpeech: '',
      definitions: rec.t.slice(),
    },
  }
}

const entries = []
const missingWords = []
for (const w of pool.words || []) {
  const e = entryOf(w)
  if (e) entries.push(e)
  else missingWords.push(w)
}
const allEntries = entries.slice()

// ─── 词组 ─────────────────────────────────────────────────────────
let phraseDict = {}
try {
  phraseDict = JSON.parse(readFileSync(join(__dirname, 'public/data/phrases.json'), 'utf8'))
} catch { phraseDict = {} }

const phraseObjs = []
const missingPhrases = []
for (const p of pool.phrases || []) {
  const key = String(p || '').toLowerCase().trim()
  const rec = phraseDict[key]
  if (!rec || !Array.isArray(rec.defs) || !rec.defs.length) { missingPhrases.push(p); continue }
  phraseObjs.push({ phrase: key, defs: rec.defs.slice(), verb: rec.verb || '', particle: rec.particle || '' })
}

// ─── 生成（多轮取并集）─────────────────────────────────────────────
const byKey = new Map() // `${type}::${word}` -> q；同一键保留首个
function absorb(qs) {
  for (const q of qs) {
    const key = `${q.type}::${String(q.word || q.phrase || '').toLowerCase()}`
    if (!byKey.has(key)) byKey.set(key, q)
  }
}
for (let r = 0; r < ROUNDS; r++) {
  if (entries.length) absorb(generateQuestions(entries.slice(), allEntries, [], entries.length))
  if (phraseObjs.length) absorb(generatePhraseQuestions(phraseObjs.slice(), phraseObjs.length))
}

// ─── 比对 ─────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/^[a-z]{1,6}\.\s*/u, '')      // 去掉 vt./n./a. 之类词性前缀
  .replace(/[\s\p{P}\p{S}]/gu, '')       // 去空白与标点

const same = (a, b) => {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

const KIND_TO_TYPE = {
  choice_word: 'wordChoice',
  choice_def: 'definitionChoice',
  spelling: 'plainCloze',
  phrase: null, // 词组题有两种 type，按 word/phrase 键找
}

const failed = []
const noQuestion = []
const synonymSuspects = []
let checked = 0, passed = 0

for (const it of items) {
  const answer = String(it.answer ?? '')
  const accept = Array.isArray(it.accept) ? it.accept.slice() : []
  const acceptAll = [answer, ...accept].filter(Boolean)
  const key = String(it.input ?? '').toLowerCase()

  let q = null
  if (it.kind === 'phrase') {
    q = byKey.get(`phraseCloze::${key}`) || byKey.get(`phraseDefChoice::${key}`) ||
        byKey.get(`phraseDefinition::${key}`) || byKey.get(`phraseChoice::${key}`) || null
    if (!q) {
      for (const [k, v] of byKey) {
        if (String(v.word || v.phrase || '').toLowerCase() === key) { q = v; break }
      }
    }
  } else {
    q = byKey.get(`${KIND_TO_TYPE[it.kind]}::${key}`) || null
  }

  if (!q) { noQuestion.push(it); continue }
  checked++

  let ok = false
  if (it.kind === 'choice_word') {
    ok = Array.isArray(q.options) && q.options[q.answerIndex] === q.word &&
      new Set(q.options).size === q.options.length
  } else if (it.kind === 'choice_def') {
    const correct = Array.isArray(q.options) ? q.options[q.answerIndex] : ''
    ok = acceptAll.some(a => same(a, correct))
    // 同义干扰项：非答案项里，有与答案同义的
    if (Array.isArray(q.options)) {
      for (let i = 0; i < q.options.length; i++) {
        if (i === q.answerIndex) continue
        if (same(q.options[i], correct)) {
          synonymSuspects.push({ id: it.id, word: it.input, answer: correct, other: q.options[i] })
          break
        }
      }
    }
  } else if (it.kind === 'spelling') {
    ok = String(q.answer || '').toLowerCase() === answer.toLowerCase()
  } else if (it.kind === 'phrase') {
    ok = [q.answer, q.word, q.phrase, q.options?.[q.answerIndex]]
      .filter(Boolean)
      .some(v => String(v).toLowerCase() === answer.toLowerCase())
  }

  if (ok) passed++
  else failed.push({ id: it.id, kind: it.kind, input: it.input, answer, got: q })
}

// ─── 报告 ─────────────────────────────────────────────────────────
const total = items.length
const rate = checked ? passed / checked : 0
const noSynonym = synonymSuspects.length === 0
const pass = checked > 0 && rate >= 0.9 && noSynonym

console.log('')
console.log('═══ 金标 runner ═══')
console.log(`金标 ${total} 条 ｜ 生成出对应题型 ${checked} 条 ｜ 通过 ${passed} 条 ｜ 失败 ${failed.length} 条`)
console.log(`覆盖不足（没生成出对应题型）：${noQuestion.length} 条`)
console.log(`通过率（按已覆盖计）：${(rate * 100).toFixed(1)}%  ｜ 阈值 ≥90%`)
console.log(`疑似同义干扰项：${synonymSuspects.length} 条  ｜ 要求 0 条`)
if (missingWords.length) console.log(`词典缺词（池内）：${missingWords.length} 条 ${missingWords.slice(0, 5).join(', ')}`)
if (missingPhrases.length) console.log(`词典缺词组（池内）：${missingPhrases.length} 条 ${missingPhrases.slice(0, 5).join(', ')}`)

if (failed.length) {
  console.log('\n--- 失败题（前 20）---')
  for (const f of failed.slice(0, 20)) {
    console.log(`  ${f.id} [${f.kind}] ${f.input}  期望=${JSON.stringify(f.answer)} 实得=${JSON.stringify(f.got?.options?.[f.got?.answerIndex] ?? f.got?.answer ?? f.got?.word ?? null)}`)
  }
}
if (synonymSuspects.length) {
  console.log('\n--- 疑似同义干扰项（前 10）---')
  for (const s of synonymSuspects.slice(0, 10)) {
    console.log(`  ${s.id} ${s.word}: 答案「${s.answer}」 vs 干扰「${s.other}」`)
  }
}
if (noQuestion.length) {
  console.log('\n--- 覆盖不足（前 10）---')
  for (const n of noQuestion.slice(0, 10)) console.log(`  ${n.id} [${n.kind}] ${n.input}`)
}

console.log('')
console.log(pass ? '判定：通过（≥90% 且无同义干扰项）' : '判定：不通过')
console.log('')
console.log('⚠ 本 runner 只证明两件事：①题目的正确答案与金标答案一致；②没有与答案同义的干扰项。')
console.log('  金标答案本身取自同一份 dict-zh／phrases，**所以 100% 不是独立证据**；')
console.log('  D-6 的「双标／抽检」是人的判断，不在本 runner 射程内。')
process.exit(pass ? 0 : 1)
