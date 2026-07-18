/**
 * 核心逻辑端到端验证（不依赖浏览器）：
 *   1. fsrs.js — 卡片创建/评分/到期队列/日期序列化
 *   2. spelling.js — 拼写比对/差异标注
 *   3. quizGen.js — 四种题型生成/干扰项/词组题
 * 用法: node verify-core.mjs
 */

import { createCard, rate, isDue, buildQueue, nextDueAt } from './src/fsrs.js'
import { checkSpelling, levenshtein } from './src/utils/spelling.js'
import { generateQuestions, generatePhraseQuestions } from './src/quizGen.js'
import { readFileSync } from 'fs'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

// ═══ 1. FSRS ═══
console.log('\n[fsrs.js]')
const card = createCard()
t('createCard 可 JSON 序列化', typeof JSON.parse(JSON.stringify(card)).due === 'string')
t('新卡立即到期', isDue(card))

const rated = rate(card, 3) // Good
t('评分后 due 是 ISO 字符串', typeof rated.due === 'string')
t('评分后 reps=1', rated.reps === 1)
t('Good 后短期内不再到期或状态推进', rated.state >= 1)

const easyCard = rate(rate(card, 4), 4) // Easy x2 → 长间隔
t('Easy 连评后 due 在未来', new Date(easyCard.due) > new Date())

// localStorage 往返模拟
const roundTrip = JSON.parse(JSON.stringify(rated))
const rerated = rate(roundTrip, 1) // Again on revived card
t('往返后的卡可再评分（字符串日期容忍）', typeof rerated.due === 'string' && rerated.lapses >= 0)

// buildQueue
const words = {
  aaa: { word: 'aaa', addedAt: '2026-01-01', srs: null, snapshot: { definitions: ['def a'] } },
  bbb: { word: 'bbb', addedAt: '2026-01-02', srs: { ...card }, snapshot: { definitions: ['def b'] } },
  ccc: { word: 'ccc', addedAt: '2026-01-03', srs: easyCard, snapshot: { definitions: ['def c'] } },
  ddd: { word: 'ddd', addedAt: '2026-01-04', srs: null, snapshot: { definitions: [] } }, // 无释义
}
const { due, fresh } = buildQueue(words)
t('到期卡只含 bbb（ccc 未到期）', due.length === 1 && due[0].word === 'bbb')
t('新卡只含 aaa（ddd 无释义被排除）', fresh.length === 1 && fresh[0].word === 'aaa')
t('nextDueAt 返回最早 due', nextDueAt(words) instanceof Date)

// ═══ 2. Spelling ═══
console.log('\n[spelling.js]')
t('完全正确', checkSpelling('eloquent', 'eloquent').correct)
t('大小写/空白容忍', checkSpelling('  Eloquent ', 'eloquent').correct)
t('差一字母 → distance 1', checkSpelling('eloquant', 'eloquent').distance === 1)
t('乱拼 → 不正确', !checkSpelling('xyz', 'eloquent').correct)
t('diff 标注错误位置', checkSpelling('eloquant', 'eloquent').diff.some(d => d.pos === 5))
t('levenshtein 对称', levenshtein('abc', 'abd') === 1)

// ═══ 3. quizGen ═══
console.log('\n[quizGen.js]')
const satDict = JSON.parse(readFileSync('./public/books/sat-practice/dictionary.json', 'utf8'))
const satChapters = JSON.parse(readFileSync('./public/books/sat-practice/chapters.json', 'utf8'))
const entries = Object.entries(satDict.words).slice(0, 300).map(([w, d]) => ({
  word: w,
  snapshot: { lemma: d.lemma, partOfSpeech: d.partOfSpeech, definitions: d.definitions, level: d.level }
}))

const qs = generateQuestions(entries.slice(0, 40), entries, satChapters.chapters, 20)
t('生成了题目', qs.length > 0)
t('数量不超过请求值', qs.length <= 20)

const mcqs = qs.filter(q => q.options)
const inputs = qs.filter(q => !q.options)
t('含选择题', mcqs.length > 0)
for (const q of mcqs) {
  if (q.options.length !== 4) { t(`题目 ${q.word} 选项数=4`, false); break }
}
t('所有选择题 4 选项', mcqs.every(q => q.options.length === 4))
t('answerIndex 有效', mcqs.every(q => q.answerIndex >= 0 && q.answerIndex < 4))
t('正确答案在选项中', mcqs.filter(q => q.type === 'sentenceCloze' || q.type === 'wordChoice')
  .every(q => q.options[q.answerIndex].toLowerCase() === q.word.toLowerCase()))
t('选项无重复', mcqs.every(q => new Set(q.options.map(o => o.toLowerCase())).size === 4))
t('输入题有答案和提示', inputs.every(q => q.answer && q.hint))

const clozeQs = qs.filter(q => q.type === 'sentenceCloze')
console.log(`  (题型分布: cloze=${clozeQs.length}, wordChoice=${qs.filter(q=>q.type==='wordChoice').length}, defChoice=${qs.filter(q=>q.type==='definitionChoice').length}, plainCloze=${inputs.length})`)
t('句子填空题干含空格线', clozeQs.every(q => q.stem.includes('_______')))
t('句子填空题干不含答案词', clozeQs.every(q => !new RegExp(`\\b${q.word}\\b`, 'i').test(q.stem)))

// 词组题
const phrasesData = JSON.parse(readFileSync('./public/data/phrases.json', 'utf8'))
const phraseList = Object.entries(phrasesData).map(([phrase, e]) => ({ phrase, ...e }))
const pqs = generatePhraseQuestions(phraseList, 10)
t('词组题生成', pqs.length > 0)
t('词组题干扰项为同动词', pqs.every(q => {
  const answerVerb = q.options[q.answerIndex].split(' ')[0]
  return q.options.every(o => o.split(' ')[0] === answerVerb)
}))

// 小词池降级
const tiny = entries.slice(0, 5)
const tinyQs = generateQuestions(tiny, tiny, [], 20)
t('小词池不崩溃且缩减', Array.isArray(tinyQs) && tinyQs.length <= 5)

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
