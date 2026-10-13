/**
 * §5.7 词组义项数据闸：验证产品 phrases.json 的 senses 形状、JS L1 口径与 dr-jekyll ch.01 基准。
 * 不依赖浏览器、不触网。运行目录：reader/。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolvePhraseSense } from './src/composables/usePhrases.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0
let fail = 0
function t(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`)
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const phrases = readJson(join(__dirname, 'public/data/phrases.json'))
const probe = readJson(join(__dirname, '..', 'generator/output/ch01_probe.json'))
const l1 = readJson(join(__dirname, '..', 'generator/output/ch01_l1.json'))

// ═══ 1. 产品形状：只验有 senses 的条目 ═══
console.log('\n[phrases.json senses 形状]')
const withSenses = Object.entries(phrases).filter(([, entry]) => entry.senses?.length)
t('产品至少包含 320 条带 senses 的词组', withSenses.length >= 320,
  `实得 ${withSenses.length}`)

let senseCount = 0
let badSense = []
for (const [base, entry] of withSenses) {
  if (typeof entry.literal !== 'string') badSense.push(`${base}: literal 缺失或非字符串`)
  for (const sense of entry.senses || []) {
    senseCount++
    if (!Number.isInteger(sense.rank)) badSense.push(`${base}#${sense.rank}: rank 非整数`)
    if (typeof sense.zh !== 'string' || !sense.zh.trim()) badSense.push(`${base}#${sense.rank}: zh 缺失`)
    if (typeof sense.pattern !== 'string' || !sense.pattern.trim()) badSense.push(`${base}#${sense.rank}: pattern 缺失`)
    if (typeof sense.cue !== 'string') badSense.push(`${base}#${sense.rank}: cue 缺失`)
    if (sense.reviewed !== true) badSense.push(`${base}#${sense.rank}: reviewed !== true`)
    if (!(Array.isArray(sense.examples) && sense.examples.length) && !sense.examples_gap) {
      badSense.push(`${base}#${sense.rank}: 无例句且无 examples_gap`)
    }
    if (sense.cue) {
      try {
        new RegExp(sense.cue, 'i')
      } catch {
        badSense.push(`${base}#${sense.rank}: cue 在 JS RegExp 中无法编译`)
      }
    }
  }
}
t('义项总数符合人工层规模（≥870）', senseCount >= 870, `实得 ${senseCount}`)
t('所有义项形状与例句缺口声明齐全', badSense.length === 0, badSense.slice(0, 5).join(' | '))

// ═══ 2. JS L1 与 Python l1_probe 同口径 ═══
console.log('\n[resolvePhraseSense JS/Python 同口径]')
const probeByBase = new Map(probe.hits.map(hit => [hit.base, hit]))
let jsMismatch = []
for (const row of l1.rows) {
  const entry = phrases[row.base]
  const hit = probeByBase.get(row.base)
  if (!entry?.senses?.length || !hit) {
    jsMismatch.push(`${row.base}: 缺少产品 senses 或 probe 句子`)
    continue
  }
  const got = resolvePhraseSense(entry, hit.sentence)
  if (got.state !== row.state || got.rank !== row.rank) {
    jsMismatch.push(`${row.base}: 得 ${got.state}/${got.rank}，期望 ${row.state}/${row.rank}`)
  }
}
t('ch.01 16 处 JS L1 与 Python 三态/rank 全同', jsMismatch.length === 0, jsMismatch.join(' | '))

// ═══ 3. dr-jekyll ch.01 基准门 ═══
console.log('\n[ch.01 基准门]')
t('ch.01 高置信 unique 12/12，且误标 0', l1.meta.unique === 12 && l1.meta.unique_wrong === 0,
  JSON.stringify({ unique: l1.meta.unique, wrong: l1.meta.unique_wrong }))
t('ch.01 zero ≤ 2', l1.meta.zero <= 2, `zero=${l1.meta.zero}`)
t('ch.01 multi 不涨', l1.meta.multi === 0, `multi=${l1.meta.multi}`)
t('ch.01 gate_pass 为 true', l1.meta.gate_pass === true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
