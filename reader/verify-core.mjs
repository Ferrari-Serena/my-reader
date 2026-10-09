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

// 词组题（两种题型混出：语境 cloze ＋ 看释义选词组；U5 · 2026-10-09）
const phrasesData = JSON.parse(readFileSync(join(__dirname, 'public/data/phrases.json'), 'utf8'))
const phraseList = Object.entries(phrasesData).map(([phrase, e]) => ({ phrase, ...e }))
const pqs = generatePhraseQuestions(phraseList, 10)
t('词组题生成', pqs.length > 0)
t('语境题的干扰项为同动词（这条判据只对 phraseCloze 成立）',
  pqs.filter(q => q.type === 'phraseCloze').every(q => {
    const answerVerb = q.options[q.answerIndex].split(' ')[0]
    return q.options.every(o => o.split(' ')[0] === answerVerb)
  }))
t('一次测验里两种题型各半（语境 5 ＋ 释义 5）',
  pqs.filter(q => q.type === 'phraseCloze').length === 5 &&
  pqs.filter(q => q.type === 'phraseDefChoice').length === 5,
  pqs.map(q => q.type).join(','))

// 词组题：先筛再取样之后，不再出现「0 题」或「凑不满」
{
  let zero = 0
  for (let i = 0; i < 30; i++) {
    if (generatePhraseQuestions(phraseList, 10).length === 0) zero++
  }
  t('词组题 30 次抽样没有一次为空', zero === 0)
  t('词组题能凑满请求数', generatePhraseQuestions(phraseList, 10).length === 10)
}

// 词组题：选项必须凑满 4 个 ＋ U5 的题池扩容。
// 干扰项的约束**分两档**：语境题只能取同动词（176 个动词里 107 个只有一条词组 ⇒ 那批出不了题）；
// 释义题不要求同动词、只要释义不撞车 ⇒ 把被排除的那批救回。旧断言（出题数 = 190）在 U5 之后
// 不再成立，改成逐档确定性口径。
{
  const byVerb = {}
  for (const p of phraseList) {
    if (p.verb && p.defs?.length) (byVerb[p.verb] ||= []).push(p)
  }
  const groups = Object.values(byVerb)
  const expectedCloze = groups.filter(g => g.length >= 4).reduce((a, g) => a + g.length, 0)
  const smallVerbs = groups.filter(g => g.length < 4).flatMap(g => g.map(p => p.phrase))
  const all = generatePhraseQuestions(phraseList, phraseList.length)
  const cloze = all.filter(q => q.type === 'phraseCloze')
  const defs = all.filter(q => q.type === 'phraseDefChoice')
  const notEnough = all.filter(q => q.options.length !== 4)
  t(`词组题池 190 → ${all.length} 条（语境 ${cloze.length} ＋ 释义 ${defs.length}），每条都凑满 4 选项`,
    all.length === 400 && cloze.length === expectedCloze && notEnough.length === 0,
    `选项不足: ${notEnough.slice(0, 3).map(q => q.word + '=' + q.options.length).join(', ')}`)
  t(`语境档出满 ${expectedCloze} 条（同动词兄弟 ≥ 4 的足额池）`, cloze.length === expectedCloze, `实际 ${cloze.length}`)
  const inPool = new Set(defs.map(q => q.word))
  const rescued = smallVerbs.filter(w => inPool.has(w)).length
  t(`U5：「同动词兄弟不足」的 ${smallVerbs.length} 条全部进题池`, rescued === smallVerbs.length, `只进去 ${rescued} 条`)
  t('释义档答案唯一且在选项里',
    defs.every(q => q.answerIndex >= 0 && q.options[q.answerIndex] === q.word &&
      q.options.filter(o => o === q.word).length === 1))
  const norm = s => String(s).trim().toLowerCase()
  const clash = (a, b) => (phrasesData[a]?.defs || []).some(d =>
    (phrasesData[b]?.defs || []).some(r => norm(d) === norm(r) || norm(d).includes(norm(r)) || norm(r).includes(norm(d))))
  t('释义档干扰项释义不与正确释义撞车（否则一题两个对）',
    defs.every(q => q.options.every(o => o === q.word || !clash(o, q.word))),
    defs.filter(q => q.options.some(o => o !== q.word && clash(o, q.word))).slice(0, 3).map(q => q.word).join(', '))
  t('释义档题干是释义、且不含答案词组本身',
    defs.every(q => /^Which phrase means/.test(q.stem) && !q.stem.toLowerCase().includes(q.word.toLowerCase())))
  t('一次测验里一条词组只出一题（不重复考）', new Set(all.map(q => q.word)).size === all.length)
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

// ═══ 6. utils/notes.js（第 9 步 9.2 划线笔记：锚点 / 词级对齐 / 漂移判读）═══
console.log('\n[utils/notes.js]')
{
  const N = await import('./src/utils/notes.js')

  // 颜色域
  t('NOTE_COLORS 恰是四色', N.NOTE_COLORS.join() === 'yellow,green,blue,pink')
  t('默认色是 yellow', N.DEFAULT_NOTE_COLOR === 'yellow')
  t('isNoteColor 只认这四色', N.isNoteColor('green') && !N.isNoteColor('red') && !N.isNoteColor(null))

  // 记录键
  t('noteKey / noteIdFromKey 往返', N.noteKey('n_1') === 'note:n_1' && N.noteIdFromKey('note:n_1') === 'n_1')
  t('noteIdFromKey 非 note 前缀 -> null', N.noteIdFromKey('card:x') === null && N.noteIdFromKey(null) === null)

  // tokenSpans 与渲染分词严格对齐（渲染用 text.split(/(\s+)/)，标色按 token 下标）
  const t3 = '  The quick  brown fox '
  const toks = t3.split(/(\s+)/)
  const spans = N.tokenSpans(t3)
  t('tokenSpans 长度与 split 一致', spans.length === toks.length)
  t('tokenSpans 逐 token 与 split 切出片段一致（含中文/多空格）',
    spans.every((s, i) => (s ? t3.slice(s.start, s.end) === toks[i] : !/\S/.test(toks[i]))))
  t('tokenSpans 只把空白位留 null', spans.filter(s => s === null).length === toks.filter(x => !/\S/.test(x)).length)
  t('tokenSpans 空串 -> [null]', JSON.stringify(N.tokenSpans('')) === '[null]')
  t('tokenSpans 容忍 null 输入', N.tokenSpans(null).length === 1)
  t('tokenSpans 对中文整串无空白 -> 命中数 0', N.tokenSpans('中文段落').filter(x => x === null).length === 0)

  // snapToWords 词级对齐
  const p1 = 'The quick brown fox'
  t('整词范围 -> 原样', JSON.stringify(N.snapToWords(p1, 4, 9)) === JSON.stringify({ start: 4, end: 9 }))
  t('词内部分选中 -> 向外扩到整词', JSON.stringify(N.snapToWords(p1, 5, 7)) === JSON.stringify({ start: 4, end: 9 }))
  t('跨两词 -> 扩到两端词边界',
    JSON.stringify(N.snapToWords(p1, 5, 12)) === JSON.stringify({ start: 4, end: 15 }))
  t('只碰到空白 -> null', N.snapToWords(p1, 3, 4) === null)
  t('起点=终点 -> null', N.snapToWords(p1, 9, 9) === null)
  t('起点>终点 -> null', N.snapToWords(p1, 9, 4) === null)
  t('非整数偏移 -> null', N.snapToWords(p1, 1.5, 5) === null)
  t('非字符串段落 -> null', N.snapToWords(null, 0, 5) === null)

  // overlaps
  t('overlaps 相交/相邻分离', N.overlaps(0, 5, 4, 9) && !N.overlaps(0, 5, 5, 9))

  // resolveAnchor 三分支
  const para = 'The quick brown fox'
  t('精确命中 -> ok',
    JSON.stringify(N.resolveAnchor(para, { charStart: 4, charEnd: 9, quote: 'quick' })) === JSON.stringify({ kind: 'ok', start: 4, end: 9 }))
  t('偏移漂了、引文还在 -> moved（自动重锚）',
    JSON.stringify(N.resolveAnchor(para, { charStart: 99, charEnd: 104, quote: 'quick' })) === JSON.stringify({ kind: 'moved', start: 4, end: 9 }))
  t('moved 取第一次出现位置', N.resolveAnchor('x a x a', { charStart: 90, charEnd: 91, quote: 'a' }).start === 2)
  const lost = N.resolveAnchor(para, { charStart: 4, charEnd: 9, quote: 'never' })
  t('引文没了 -> lost（绝不静默错位）', lost.kind === 'lost' && lost.why === 'quote-gone')
  t('无引文老记录：界内即信 -> ok', N.resolveAnchor(para, { charStart: 4, charEnd: 9 }).kind === 'ok')
  t('无引文老记录：越界 -> lost(out-of-bounds)', N.resolveAnchor(para, { charStart: 100, charEnd: 104 }).why === 'out-of-bounds')
  t('段落缺失 -> lost(no-paragraph)', N.resolveAnchor(null, { charStart: 0, charEnd: 1 }).why === 'no-paragraph')
  t('段内偏移等于段长（到尾部）仍算界内 ok',
    N.resolveAnchor('abc', { charStart: 0, charEnd: 3, quote: 'abc' }).kind === 'ok')

  // normalizeNote 净化读法
  const okNote = N.normalizeNote('n_1', {
    bookId: 'bk_x', bookTitle: 'The Giver', chapterId: 'ch1',
    anchor: { paraId: 'p1', charStart: 0, charEnd: 5 },
    quote: 'hello', text: 'a note', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
  })
  t('合法载荷 -> 归一化对象（字段摊平到顶层）',
    !!okNote && okNote.bookId === 'bk_x' && okNote.paraId === 'p1' && okNote.charStart === 0 && okNote.color === 'blue' && okNote.quote === 'hello')
  t('缺 bookId -> null', N.normalizeNote('n_1', { chapterId: 'c', anchor: { paraId: 'p', charStart: 0, charEnd: 1 } }) === null)
  t('缺 chapterId -> null', N.normalizeNote('n_1', { bookId: 'b', anchor: { paraId: 'p', charStart: 0, charEnd: 1 } }) === null)
  t('缺 paraId -> null', N.normalizeNote('n_1', { bookId: 'b', chapterId: 'c', anchor: { charStart: 0, charEnd: 1 } }) === null)
  t('charStart >= charEnd -> null', N.normalizeNote('n_1', { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 5, charEnd: 5 } }) === null)
  t('非整数偏移 -> null', N.normalizeNote('n_1', { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 1.5, charEnd: 3 } }) === null)
  t('id 非字符串 -> null', N.normalizeNote(null, { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 0, charEnd: 1 } }) === null)
  t('payload 非对象 -> null（不抛）', N.normalizeNote('n_1', 'nope') === null)
  t('脏颜色 -> 兜底 yellow', N.normalizeNote('n_1', { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 0, charEnd: 1 }, color: 'red' }).color === 'yellow')
  t('缺 quote/text -> 空串（不塞 undefined）',
    N.normalizeNote('n_2', { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 0, charEnd: 1 } }).quote === '' &&
    N.normalizeNote('n_2', { bookId: 'b', chapterId: 'c', anchor: { paraId: 'p', charStart: 0, charEnd: 1 } }).text === '')

  // toNotePayload 归一化笔记 -> 记录载荷
  const pl = N.toNotePayload({
    bookId: 'bk_x', bookTitle: 'T', chapterId: 'ch1',
    paraId: 'p1', charStart: 2, charEnd: 8, quote: 'quick b', text: 'hi', color: 'pink'
  })
  t('载荷字段齐（含 quote / bookTitle）',
    pl.bookId === 'bk_x' && pl.bookTitle === 'T' && pl.chapterId === 'ch1' && pl.quote === 'quick b' &&
    pl.text === 'hi' && pl.color === 'pink')
  t('anchor 子对象字段齐', Object.keys(pl.anchor).sort().join() === 'charEnd,charStart,paraId')
  t('anchor 值正确', pl.anchor.paraId === 'p1' && pl.anchor.charStart === 2 && pl.anchor.charEnd === 8)
  t('脏颜色 -> 兜底 yellow', N.toNotePayload({ bookId: 'b', chapterId: 'c', paraId: 'p', charStart: 0, charEnd: 1, color: 'nope' }).color === 'yellow')
  t('全空输入不抛（给空串/0）', (() => { const z = N.toNotePayload({}); return z.bookId === '' && z.quote === '' && z.anchor.paraId === '' && z.anchor.charStart === 0 })())
  t('往返：toNotePayload -> normalizeNote 保持一致', (() => {
    const back = N.normalizeNote('n_rt', N.toNotePayload(okNote))
    return back && back.bookId === okNote.bookId && back.paraId === okNote.paraId && back.charStart === okNote.charStart && back.charEnd === okNote.charEnd && back.quote === okNote.quote && back.color === okNote.color
  })())
  // noteStatus：按章表判读（列表面板用，跨章也能算）
  const chs = [
    { id: 'ch1', title: 'Chapter 1', paragraphs: [{ id: 'p1', text: 'The quick brown fox' }] },
    { id: 'ch2', title: 'Chapter 2', paragraphs: [{ id: 'p9', text: 'Hello world again' }] }
  ]
  t('noteStatus：命中本段 -> ok',
    N.noteStatus(chs, { chapterId: 'ch1', paraId: 'p1', charStart: 4, charEnd: 9, quote: 'quick' }).kind === 'ok')
  t('noteStatus：引文还在、偏移漂了 -> moved',
    N.noteStatus(chs, { chapterId: 'ch1', paraId: 'p1', charStart: 90, charEnd: 95, quote: 'quick' }).kind === 'moved')
  t('noteStatus：引文没了 -> lost',
    N.noteStatus(chs, { chapterId: 'ch1', paraId: 'p1', charStart: 4, charEnd: 9, quote: 'nope' }).kind === 'lost')
  t('noteStatus：章不在章表 -> lost(no-chapter)',
    N.noteStatus(chs, { chapterId: 'chX', paraId: 'p1', charStart: 0, charEnd: 1 }).why === 'no-chapter')
  t('noteStatus：段不在章里 -> lost(no-paragraph)',
    N.noteStatus(chs, { chapterId: 'ch1', paraId: 'pZ', charStart: 0, charEnd: 1 }).why === 'no-paragraph')
  t('noteStatus：null 笔记 -> lost', N.noteStatus(chs, null).kind === 'lost')

  // groupNotesByChapter：按章序分组、组内按位置排
  const gNotes = [
    { id: 'a', chapterId: 'ch2', paraId: 'p9', charStart: 6 },
    { id: 'b', chapterId: 'ch1', paraId: 'p1', charStart: 20 },
    { id: 'c', chapterId: 'ch1', paraId: 'p1', charStart: 4 },
    { id: 'd', chapterId: 'ch1', paraId: 'p0', charStart: 0 }
  ]
  const grouped = N.groupNotesByChapter(gNotes, chs)
  t('groupNotesByChapter：章序按章表（ch1 在前）', grouped.map(g => g.chapterId).join() === 'ch1,ch2')
  t('groupNotesByChapter：组内按 (paraId, charStart) 升序',
    grouped[0].notes.map(n => n.id).join() === 'd,c,b')
  t('groupNotesByChapter：用章表里的 title', grouped[0].title === 'Chapter 1')
  t('groupNotesByChapter：章表里没有的章排最后、title 兜底为 id', (() => {
    const g = N.groupNotesByChapter([{ id: 'x', chapterId: 'ghost', paraId: 'p', charStart: 0 }], chs)
    return g.length === 1 && g[0].chapterId === 'ghost' && g[0].title === 'ghost'
  })())
  t('groupNotesByChapter：空输入 -> []',
    N.groupNotesByChapter([], chs).length === 0 && N.groupNotesByChapter(null, null).length === 0)
  t('groupNotesByChapter：不改入参数组的顺序', gNotes.map(n => n.id).join() === 'a,b,c,d')

  // noteMarksForChapter：正文标注图（9.1 词级着色 + 9.5 段落级降级）
  const mk = N.noteMarksForChapter(
    [{ id: 'p1', text: 'The quick brown fox' }, { id: 'p2', text: 'Hello world' }],
    [
      { id: 'n1', paraId: 'p1', charStart: 4, charEnd: 9, quote: 'quick', color: 'blue' },
      { id: 'n2', paraId: 'p1', charStart: 90, charEnd: 95, quote: 'brown', color: 'green' },
      { id: 'n3', paraId: 'p1', charStart: 4, charEnd: 9, quote: 'gone', color: 'pink' },
      { id: 'n4', paraId: 'pZ', charStart: 0, charEnd: 1, quote: 'x', color: 'yellow' }
    ]
  )
  t('noteMarksForChapter：能定位的进 marks（按词下标）',
    !!mk.marks.p1 && mk.marks.p1.size === 2 && mk.marks.p1.get(2).id === 'n1')
  t('noteMarksForChapter：moved 也进 marks（用重锚后的位置）', mk.marks.p1.get(4).id === 'n2')
  t('noteMarksForChapter：引文没了 -> 落 lost（段落级降级、带 why）',
    !!mk.lost.p1 && mk.lost.p1.length === 1 && mk.lost.p1[0].note.id === 'n3' && mk.lost.p1[0].why === 'quote-gone')
  t('noteMarksForChapter：段落整段没了 -> marks/lost 都不放（正文没地方可标）',
    !mk.marks.pZ && !mk.lost.pZ)
  t('noteMarksForChapter：lost 的词不着色', (() => {
    const only = N.noteMarksForChapter([{ id: 'p1', text: 'The quick brown fox' }],
      [{ id: 'x', paraId: 'p1', charStart: 4, charEnd: 9, quote: 'nope' }])
    return Object.keys(only.marks).length === 0 && only.lost.p1.length === 1
  })())
  t('noteMarksForChapter：空笔记 -> 空图表', (() => {
    const e = N.noteMarksForChapter([{ id: 'p1', text: 'ab' }], [])
    return Object.keys(e.marks).length === 0 && Object.keys(e.lost).length === 0
  })())

  // groupNotesByBook / missingBookGroups：缺书占位（9.4）
  const bNotes = [
    { id: 'x1', bookId: 'bk_b', bookTitle: 'B Book' },
    { id: 'x2', bookId: 'bk_a', bookTitle: '' },
    { id: 'x3', bookId: 'bk_a', bookTitle: 'A Book' },
    { id: 'x4', bookId: 'bk_b', bookTitle: 'B Book' }
  ]
  const byBook = N.groupNotesByBook(bNotes)
  t('groupNotesByBook：按书分组、按 bookId 排', byBook.map(g => g.bookId).join() === 'bk_a,bk_b')
  t('groupNotesByBook：count 与 notes 齐', byBook[0].count === 2 && byBook[0].notes.length === 2)
  t('groupNotesByBook：bookTitle 取组内第一条非空快照',
    byBook[0].bookTitle === 'A Book' && byBook[1].bookTitle === 'B Book')
  t('groupNotesByBook：缺 bookId 的笔记丢掉', N.groupNotesByBook([{ id: 'z' }]).length === 0)
  t('groupNotesByBook：空输入 -> []', N.groupNotesByBook(null).length === 0)
  t('missingBookGroups：本机没有的书才留下',
    N.missingBookGroups(bNotes, ['bk_a']).map(g => g.bookId).join() === 'bk_b')
  t('missingBookGroups：Set 与数组都收', N.missingBookGroups(bNotes, new Set(['bk_a', 'bk_b'])).length === 0)
  t('missingBookGroups：全不在本机 -> 全留', N.missingBookGroups(bNotes, []).length === 2)
  t('missingBookGroups：不改入参', bNotes.map(n => n.id).join() === 'x1,x2,x3,x4')

}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
