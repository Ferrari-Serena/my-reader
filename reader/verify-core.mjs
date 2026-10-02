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
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
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
const satDict = JSON.parse(readFileSync(join(__dirname, 'public/books/sat-practice/dictionary.json'), 'utf8'))
const satChapters = JSON.parse(readFileSync(join(__dirname, 'public/books/sat-practice/chapters.json'), 'utf8'))
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

// 上面两条是对**随机抽样**的 every 断言，抽样没抽到就发现不了问题。下面是**确定性回归**：
// 逐词强制只出 sentenceCloze（maxCount=1 → 类型分配里 sentenceCloze 占 1 题），
// 一次都不许出现「没有填空线」或「题干里印着答案」。
// 老实现按原形挖空，屈折形命中的句子（abandon → "Many poor countries are abandoning autocracy."）
// 挖不出空，题干变成一句完整的话、答案原样露着 —— 就是靠这条兜住的。
{
  const bad = []
  let produced = 0
  for (const e of entries.slice(0, 60)) {
    for (const q of generateQuestions([e], entries, satChapters.chapters, 1)) {
      if (q.type !== 'sentenceCloze') continue
      produced++
      if (!q.stem.includes('_______')) bad.push(`${q.word}: 无填空线`)
      else if (new RegExp(`\\b${q.word}\\b`, 'i').test(q.stem)) bad.push(`${q.word}: 题干含答案`)
    }
  }
  t(`确定性回归：逐词强出的 ${produced} 道 sentenceCloze 全部有空格线且不含答案`,
    produced > 0 && bad.length === 0, bad.slice(0, 5).join(' | '))
}

// 词组题
const phrasesData = JSON.parse(readFileSync(join(__dirname, 'public/data/phrases.json'), 'utf8'))
const phraseList = Object.entries(phrasesData).map(([phrase, e]) => ({ phrase, ...e }))
const pqs = generatePhraseQuestions(phraseList, 10)
t('词组题生成', pqs.length > 0)
t('词组题干扰项为同动词', pqs.every(q => {
  const answerVerb = q.options[q.answerIndex].split(' ')[0]
  return q.options.every(o => o.split(' ')[0] === answerVerb)
}))

// 词组题：先筛再取样之后，不再出现「0 题」或「凑不满」
{
  let zero = 0
  for (let i = 0; i < 30; i++) {
    if (generatePhraseQuestions(phraseList, 10).length === 0) zero++
  }
  t('词组题 30 次抽样没有一次为空', zero === 0)
  t('词组题能凑满请求数', generatePhraseQuestions(phraseList, 10).length === 10)
}

// 词组题：选项必须凑满 4 个。
// 干扰项只能取「同动词的其它词组」，而 176 个动词里 107 个只有一条词组 ——
// 那些题会退化成 1~3 个选项（1 个选项 = 点一下就必对）。旧断言在同动词组为空时
// 恒真（every over 空集 = true），拦不住；这里改成确定性口径：
// 能出题的词组 = 同动词组 >= 4 条，逐条都必须给满 4 个选项。
{
  const byVerb = {}
  for (const p of phraseList) {
    if (p.verb && p.defs?.length) (byVerb[p.verb] ||= []).push(p)
  }
  const expected = Object.values(byVerb).filter(g => g.length >= 4).reduce((a, g) => a + g.length, 0)
  const all = generatePhraseQuestions(phraseList, phraseList.length)
  const notEnough = all.filter(q => q.options.length !== 4)
  t(`词组题可出的 ${all.length} 条全部是 4 选项（数据里足额词组 ${expected} 条）`,
    all.length === expected && notEnough.length === 0,
    `出题 ${all.length}/期望 ${expected}；选项不足: ${notEnough.slice(0, 3).map(q => q.word + '=' + q.options.length).join(', ')}`)
}


// 小词池降级
const tiny = entries.slice(0, 5)
const tinyQs = generateQuestions(tiny, tiny, [], 20)
t('小词池不崩溃且缩减', Array.isArray(tinyQs) && tinyQs.length <= 5)

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
