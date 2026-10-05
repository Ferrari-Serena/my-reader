/**
 * 核心逻辑端到端验证（不依赖浏览器）：
 *   1. fsrs.js — 卡片创建/评分/到期队列/日期序列化
 *   2. spelling.js — 拼写比对/差异标注
 *   3. quizGen.js — 四种题型生成/干扰项/词组题
 *   4. utils/bookId.js — BYO 书的内容指纹（第 3 步 3.5）
 * 用法: node verify-core.mjs
 */

import { createCard, rate, isDue, buildQueue, nextDueAt } from './src/fsrs.js'
import { checkSpelling, levenshtein } from './src/utils/spelling.js'
import { generateQuestions, generatePhraseQuestions } from './src/quizGen.js'
import { buildDictAlias, resolveDictKey, addEntryForms } from './src/utils/dictIndex.js'
import { bookIdFromHex, bookIdFromBytes, bookIdFromText, isBookId, BOOK_ID_PREFIX, BOOK_ID_HEX_LEN } from './src/utils/bookId.js'
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


// ═══ 4. 词典表面形索引 ═══
console.log('\n[dictIndex.js]')
const jekyll = JSON.parse(readFileSync(join(__dirname, 'public/books/dr-jekyll-and-mr-hyde/dictionary.json'), 'utf8'))
const jw = jekyll.words || {}
const alias = buildDictAlias(jw)

t('别名表非空', alias.size > 0)

// 词典里每个词条的每个 surface，都必须解析回它自己（没有悬空指针）
{
  const dangling = []
  for (const [key, e] of Object.entries(jw)) {
    for (const s of (e.surfaces || [])) {
      if (resolveDictKey(s, jw, alias) !== key) dangling.push(`${s}→${key}`)
    }
  }
  t(`surfaces 无悬空（${Object.keys(jw).length} 个词条自洽）`, dangling.length === 0, dangling.slice(0, 5).join(' | '))
}

// 屈折形必须离线命中（这批词在改口径前全部落空、只能联网查）
{
  const probes = ['affections', 'agonies', 'appalled', 'appalling', 'appetites', 'apprehensions', 'arteries', 'aspirations']
  const miss = probes.filter(w => !resolveDictKey(w, jw, alias))
  t(`屈折形离线命中（${probes.length} 个探针）`, miss.length === 0, '落空: ' + miss.join(', '))
}

// 收藏高亮：词头 + surfaces 都要进查找集合
{
  const set = new Set()
  addEntryForms(set, { snapshot: { lemma: 'abandon', surfaces: ['abandon', 'abandoned', 'abandoning'] } })
  t('addEntryForms 收词头与全部表面形', set.has('abandon') && set.has('abandoned') && set.has('abandoning'))
}

// 小词池降级
const tiny = entries.slice(0, 5)
const tinyQs = generateQuestions(tiny, tiny, [], 20)
t('小词池不崩溃且缩减', Array.isArray(tinyQs) && tinyQs.length <= 5)

// ═══ 5. 0.3 分词口径（连字符复合词 + NGSL 例外） ═══
console.log('\n[dict 分词口径]')

// 连字符复合词：改口径前 tokenize 只吃 [a-zA-Z]{3,}，well-known 被拆成 well + known
// 两个碎片、两个都在 NGSL 里 → 整条词被滤掉，点它只能联网（0.3 修的系统性缺口）
{
  const compoundProbes = ['well-known', 'after-dinner', 'passer-by', 'self-indulgence', 'pocket-handkerchief']
  const compoundMiss = compoundProbes.filter(w => {
    const k = resolveDictKey(w, jw, alias)
    return !k || !(jw[k].definitions || []).length
  })
  t(`连字符复合词离线命中（${compoundProbes.length} 个探针）`, compoundMiss.length === 0, '落空: ' + compoundMiss.join(', '))

  const wk = resolveDictKey('well-known', jw, alias)
  t('复合词以整体为词头（不是拆成 well + known）',
    !!wk && jw[wk].lemma === 'well-known' && (jw[wk].surfaces || []).includes('well-known'))
}

// NGSL 例外：clothes / ground 的 ECDICT 词头是 clothe / grind（语义不同），
// 按词头过滤会把正文里真正会点的「衣服 / 地面」整条滤掉
// → 这两条以自身为词头、不过 NGSL 滤网
{
  const ck = resolveDictKey('clothes', jw, alias)
  t('NGSL 例外 clothes 离线命中', !!ck && (jw[ck].definitions || []).length > 0)
  t('clothes 是自己的词头（不是 clothe 的别名）', !!ck && ck === 'clothes' && jw[ck].lemma === 'clothes')

  const gk = resolveDictKey('ground', jw, alias)
  t('NGSL 例外 ground 离线命中', !!gk && (jw[gk].definitions || []).length > 0)
  t('ground 是自己的词头（不是 grind 的别名）', !!gk && gk === 'ground' && jw[gk].lemma === 'ground')
}

// ═══ 4. BYO 书的内容指纹（第 3 步 3.5）═══
console.log('\n[utils/bookId.js — BYO 内容指纹]')
{
  t('前缀 / 长度常量', BOOK_ID_PREFIX === 'bk_' && BOOK_ID_HEX_LEN === 16)
  t('bookIdFromHex 取前 16 位并加前缀',
    bookIdFromHex('ba7816bf8f01cfea414140de5dae2223') === 'bk_ba7816bf8f01cfea')
  t('bookIdFromHex 容忍大写与非 hex 噪声',
    bookIdFromHex('BA7816BF-8F01-CFEA-4141') === 'bk_ba7816bf8f01cfea')
  t('hex 不足 16 位 -> 空串', bookIdFromHex('abc') === '' && bookIdFromHex('') === '')
  t('isBookId：BYO 形状为真、存量 slug 为假',
    isBookId('bk_ba7816bf8f01cfea') === true && isBookId('the-giver') === false && isBookId('') === false)

  // known-answer：真 SHA-256 的公布值，JS 与 Python 孪生用同一组，防两侧静默漂移
  t('sha256("") 前 16 位', (await bookIdFromBytes(new Uint8Array(0))) === 'bk_e3b0c44298fc1c14')
  t('sha256("abc") 前 16 位（WebCrypto 路径）',
    (await bookIdFromText('abc')) === 'bk_ba7816bf8f01cfea')
  t('同一内容算出同一个 id（确定性）',
    (await bookIdFromText('hello world')) === (await bookIdFromText('hello world')))
  t('不同内容算出不同 id',
    (await bookIdFromText('hello world')) !== (await bookIdFromText('hello world!')))
  t('bookIdFromBytes 与 bookIdFromText 一致',
    (await bookIdFromBytes(new TextEncoder().encode('abc'))) === (await bookIdFromText('abc')))
}

// ═══ 5. readerSettings.js（第 8 步 8.1 阅读设置）═══
console.log('\n[readerSettings.js]')
{
  const RS = await import('./src/utils/readerSettings.js')

  t('字号值域由档位表派生',
    RS.FONT_SIZES.join(',') === RS.FONT_SIZE_OPTIONS.map(o => o.value).join(','))
  t('行距 / 页宽 / 字体 同理',
    RS.LINE_HEIGHTS.length === RS.LINE_HEIGHT_OPTIONS.length &&
    RS.PAGE_WIDTHS.length === RS.PAGE_WIDTH_OPTIONS.length &&
    RS.FONT_FAMILIES.length === RS.FONT_FAMILY_OPTIONS.length)
  t('每个档位都有非空标签',
    [...RS.FONT_SIZE_OPTIONS, ...RS.LINE_HEIGHT_OPTIONS, ...RS.PAGE_WIDTH_OPTIONS, ...RS.FONT_FAMILY_OPTIONS]
      .every(o => typeof o.label === 'string' && o.label.length > 0))

  t('默认设置四项皆 null（＝不下发任何变量，零视觉回归）', RS.isDefaultSettings(RS.DEFAULT_SETTINGS))
  t('DEFAULT_SETTINGS 是冻结的', Object.isFrozen(RS.DEFAULT_SETTINGS))

  t('归一化保留合法值',
    JSON.stringify(RS.normalizeSettings({ fontSize: 19, lineHeight: 1.75, pageWidth: 720, fontFamily: 'serif' }))
    === JSON.stringify({ fontSize: 19, lineHeight: 1.75, pageWidth: 720, fontFamily: 'serif' }))
  t('枚举外的字号归 null（18 不在档位表里）', RS.normalizeSettings({ fontSize: 18 }).fontSize === null)
  t('行距 1.8（非档位）归 null', RS.normalizeSettings({ lineHeight: 1.8 }).lineHeight === null)
  t('字体只认 sans/serif', RS.normalizeSettings({ fontFamily: 'comic' }).fontFamily === null)
  t('数字型字符串不当数字用',
    RS.normalizeSettings({ fontSize: '19', pageWidth: '720' }).fontSize === null &&
    RS.normalizeSettings({ fontSize: '19', pageWidth: '720' }).pageWidth === null)
  t('数组 / null / 字符串输入都退化成默认',
    RS.isDefaultSettings(RS.normalizeSettings([1, 2])) &&
    RS.isDefaultSettings(RS.normalizeSettings(null)) &&
    RS.isDefaultSettings(RS.normalizeSettings('19')))

  const base = RS.normalizeSettings({ fontSize: 19 })
  t('withSetting 改一项、其余保持', (() => { const n = RS.withSetting(base, 'pageWidth', 900); return n.pageWidth === 900 && n.fontSize === 19 })())
  t('withSetting 不改入参', base.pageWidth === null)
  t('withSetting 传 null 表示该项回默认', RS.withSetting(base, 'fontSize', null).fontSize === null)
  t('withSetting 传脏值 -> 该项回默认（不是塞进去）', RS.withSetting(base, 'fontSize', 99).fontSize === null)
  t('withSetting 未知键原样返回', RS.withSetting(base, 'zoom', 3).pageWidth === null)

  t('未设置 -> 一个变量都不下发', Object.keys(RS.toCssVars(RS.DEFAULT_SETTINGS)).length === 0)
  const vars = RS.toCssVars({ fontSize: 23, lineHeight: 1.95, pageWidth: 900, fontFamily: 'serif' })
  t('字号 -> px 变量', vars['--reader-font-size'] === '23px')
  t('行距 -> 无单位字符串', vars['--reader-line-height'] === '1.95')
  t('页宽 -> px 变量', vars['--reader-width'] === '900px')
  t('衬线 -> Georgia 栈', vars['--reader-font'].indexOf('Georgia') === 0)
  t('无衬线 -> 指回全局 --font-sans', RS.toCssVars({ fontFamily: 'sans' })['--reader-font'] === 'var(--font-sans)')
  t('只改一项时只出一个变量', Object.keys(RS.toCssVars({ pageWidth: 640 })).join() === '--reader-width')
  t('toCssVars 容忍脏值（等于没设置）', Object.keys(RS.toCssVars({ fontSize: 18 })).length === 0)

  const rv = RS.toRecordValue({ fontSize: 21, lineHeight: 1.5, pageWidth: 640, fontFamily: 'serif' })
  t('记录 value 就是四项', Object.keys(rv).sort().join() === 'fontFamily,fontSize,lineHeight,pageWidth')
  t('记录 value 往返一致',
    JSON.stringify(RS.fromRecordValue(rv)) === JSON.stringify({ fontSize: 21, lineHeight: 1.5, pageWidth: 640, fontFamily: 'serif' }))
  t('从脏记录读回退化默认', RS.isDefaultSettings(RS.fromRecordValue({ fontSize: 'big' })))
  t('固定记录 id 与 kind 前缀一致（s_）', RS.READER_SETTING_RECORD_ID === 's_reader' && RS.READER_SETTING_KEY === 'reader')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
