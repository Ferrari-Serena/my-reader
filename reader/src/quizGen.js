/**
 * quizGen.js — 出题引擎纯函数。
 * 所有函数无副作用、无 reactive；输入词列表 + 配置 → 输出 Question[]。
 */

/**
 * 统一题目形态：
 *  选择题: { type, stem, options:[4], answerIndex, explanation, word }
 *  输入题: { type, stem, answer, hint, word }
 *
 * 题型：
 *   sentenceCloze     句子语境填空（4选1）
 *   wordChoice        看释义选词（4选1）
 *   definitionChoice  看词选释义（4选1）
 *   plainCloze        释义+首字母输入
 */

// ─── 工具 ──────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 从词列表中取最多 n 个同词性同级别的干扰项，不够则降级 */
function pickDistractors(targetEntry, allEntries, n = 3) {
  const targetPos = (targetEntry.snapshot?.partOfSpeech || '').split('.')[0]
  const targetLevel = targetEntry.snapshot?.level
  const exclude = targetEntry.word.toLowerCase()

  // 同词性 + 同级别
  let pool = allEntries.filter(e =>
    e.word.toLowerCase() !== exclude
    && e.snapshot?.partOfSpeech?.startsWith(targetPos)
    && e.snapshot?.level === targetLevel
  )
  // 同词性
  if (pool.length < n) {
    const extra = allEntries.filter(e =>
      e.word.toLowerCase() !== exclude
      && e.snapshot?.partOfSpeech?.startsWith(targetPos)
      && e.snapshot?.level !== targetLevel
    )
    pool = pool.concat(extra)
  }
  // 任意
  if (pool.length < n) {
    const extra = allEntries.filter(e =>
      e.word.toLowerCase() !== exclude
      && !e.snapshot?.partOfSpeech?.startsWith(targetPos)
    )
    pool = pool.concat(extra)
  }
  return shuffle(pool).slice(0, n)
}

/** 在 chapters JSON 中搜索包含 word 的句子（返回最短的） */
function findSentence(word, chapters) {
  const candidates = []
  const lower = word.toLowerCase()
  const forms = [lower]
  // 简单变形
  if (lower.endsWith('e')) forms.push(lower + 's', lower.slice(0, -1) + 'ing')
  else forms.push(lower + 's', lower + 'es', lower + 'ing')
  if (lower.endsWith('y') && lower.length > 2) forms.push(lower.slice(0, -1) + 'ies')

  for (const ch of chapters) {
    for (const para of ch.paragraphs || []) {
      const raw = para.text
      if (!raw) continue
      const sentences = raw.match(/[^.!?\n]+[.!?\n]+/g) || [raw]
      for (const s of sentences) {
        const trimmed = s.trim()
        if (!trimmed) continue
        const words = trimmed.split(/\s+/)
        const hasWord = words.some(w =>
          forms.some(f => w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase() === f)
        )
        if (hasWord && trimmed.length >= 15 && trimmed.length <= 250) {
          candidates.push({ sentence: trimmed, chapterId: ch.id, paragraphId: para.id })
        }
      }
    }
  }
  return candidates.sort((a, b) => a.sentence.length - b.sentence.length)[0] || null
}

/** 用 word 替换含 target 的句子，返回题干 + 正确答案 */
function buildClozeStem(sentence, target) {
  const regex = new RegExp(`\\b${target}\\b`, 'i')
  return {
    stem: sentence.replace(regex, '_______'),
    // 保留原词首字母大写信息以便渲染
    correctWord: target,
  }
}

// ─── 题型生成器 ──────────────────────────────────

function genSentenceCloze(entry, allEntries, chapters) {
  const found = findSentence(entry.word, chapters)
  if (!found) return null // 降级为 wordChoice

  const { stem, correctWord } = buildClozeStem(found.sentence, entry.word)
  const dists = pickDistractors(entry, allEntries, 3)
  if (dists.length < 3) return null

  const options = shuffle([entry, ...dists])
  const answerIndex = options.findIndex(o => o.word === entry.word)
  const distractorWords = dists.map(d => d.word).join(', ')

  return {
    type: 'sentenceCloze',
    stem,
    options: options.map(o => o.word),
    answerIndex,
    explanation: `${correctWord}: ${(entry.snapshot?.definitions || [])[0] || ''}`,
    word: entry.word,
    context: `from "${found.sentence.slice(0, 60)}..." (${distractorWords})`,
  }
}

function genWordChoice(entry, allEntries) {
  const def = (entry.snapshot?.definitions || [])[0] || entry.snapshot?.lemma || entry.word
  const dists = pickDistractors(entry, allEntries, 3)
  if (dists.length < 3) return null

  const options = shuffle([entry, ...dists])
  const answerIndex = options.findIndex(o => o.word === entry.word)

  return {
    type: 'wordChoice',
    stem: `Which word means: "${def}"?`,
    options: options.map(o => o.word),
    answerIndex,
    explanation: `${entry.word}: ${def}`,
    word: entry.word,
  }
}

function genDefinitionChoice(entry, allEntries) {
  const correctDef = (entry.snapshot?.definitions || [])[0]
  if (!correctDef) return null

  // 干扰项 = 其他词的定义
  const others = allEntries
    .filter(e => e.word.toLowerCase() !== entry.word.toLowerCase())
    .map(e => (e.snapshot?.definitions || [])[0])
    .filter(Boolean)
  const distDefs = shuffle([...new Set(others)]).slice(0, 3)
  if (distDefs.length < 3) return null

  const options = shuffle([correctDef, ...distDefs])
  const answerIndex = options.indexOf(correctDef)

  return {
    type: 'definitionChoice',
    stem: `What does "${entry.word}" mean?`,
    options,
    answerIndex,
    explanation: `${entry.word}: ${correctDef}`,
    word: entry.word,
  }
}

function genPlainCloze(entry) {
  const def = (entry.snapshot?.definitions || [])[0]
  if (!def || !entry.word) return null
  return {
    type: 'plainCloze',
    stem: def,
    answer: entry.word,
    hint: `starts with "${entry.word[0].toUpperCase()}", ${entry.word.length} letters`,
    word: entry.word,
  }
}

// ─── 词组题生成器 ──────────────────────────────

/**
 * 从短语词典中生成选择题。干扰项 = 同动词不同小品词。
 * phraseDict: { phrase, defs:[], verb, particle, forms[] }[]
 */
function genPhraseCloze(phrase, phraseDict, n = 3) {
  const def = (phrase.defs || [])[0]
  if (!def) return null

  // 干扰项：同动词不同小品词
  const sameVerb = phraseDict.filter(p =>
    p.phrase !== phrase.phrase && p.verb === phrase.verb
  )
  const dists = shuffle(sameVerb).slice(0, n)

  const options = shuffle([phrase, ...dists])
  const answerIndex = options.findIndex(p => p.phrase === phrase.phrase)

  // 题干：用第一个例句（有替换条件）或用模板
  const ex = (phrase.examples || [])[0]
  const stem = ex
    ? ex.replace(new RegExp(`\\b${phrase.phrase}\\b`, 'i'), '_______')
    : `${phrase.verb} _______`

  return {
    type: 'phraseCloze',
    stem,
    options: options.map(p => p.phrase),
    answerIndex,
    explanation: `${phrase.phrase}: ${def}`,
    word: phrase.phrase,
  }
}

// ─── 公开 API ──────────────────────────────────────

/** 硬编码题型比例（常量，不开放用户配置） */
const TYPE_MIX = { sentenceCloze: 50, wordChoice: 25, definitionChoice: 15, plainCloze: 10 }

/**
 * 从候选词列表生成测验题目。
 * 候选词不足时自动缩减；sentenceCloze 类词找不到句子则降级为 wordChoice。
 */
export function generateQuestions(candidates, allEntries, chapters = [], maxCount = 20) {
  const shuffled = shuffle(candidates)
  const questions = []

  // 分配到各题型
  const plans = []
  let remaining = Math.min(maxCount, shuffled.length)
  for (const [type, pct] of Object.entries(TYPE_MIX)) {
    const n = Math.round(remaining * pct / 100)
    if (n > 0) plans.push({ type, count: n })
  }
  // 余数补到 sentenceCloze
  const totalPlanned = plans.reduce((s, p) => s + p.count, 0)
  if (totalPlanned < remaining && plans.length > 0) plans[0].count += remaining - totalPlanned

  // 跳过 sentenceCloze 的书（如 merged_dict 无句子 → 纯定义题）
  const hasValidChapters = chapters.length > 0 && chapters.some(c =>
    (c.paragraphs || []).some(p => p.text && p.text.length >= 15)
  )

  let idx = 0
  for (const plan of plans) {
    for (let i = 0; i < plan.count && idx < shuffled.length; ) {
      const entry = shuffled[idx++]
      if (!entry?.snapshot) continue

      if (plan.type === 'sentenceCloze' && hasValidChapters) {
        const q = genSentenceCloze(entry, allEntries, chapters)
        if (q) { questions.push(q); i++; } else continue // 找不到句子则跳过此词
      } else if (plan.type === 'wordChoice' || (plan.type === 'sentenceCloze' && !hasValidChapters)) {
        const q = genWordChoice(entry, allEntries)
        if (q) { questions.push(q); i++; }
      } else if (plan.type === 'definitionChoice') {
        const q = genDefinitionChoice(entry, allEntries)
        if (q) { questions.push(q); i++; }
      } else if (plan.type === 'plainCloze') {
        const q = genPlainCloze(entry)
        if (q) { questions.push(q); i++; }
      }
    }
  }

  return shuffle(questions)
}

/**
 * 从短语词典生成词组测验。
 */
export function generatePhraseQuestions(phrases, maxCount = 20) {
  const pool = shuffle(phrases).slice(0, maxCount * 3) // 多取些以留降级空间
  const questions = []
  for (const p of pool) {
    if (questions.length >= maxCount) break
    if (!p.verb || !p.defs?.length) continue
    const q = genPhraseCloze(p, phrases, 3)
    if (q) questions.push(q)
  }
  return shuffle(questions)
}

/** 硬编码兜底词（当生词本过小时作为干扰项备选）。仅含常见 SAT 词，不会产生"明显易排除"的选项。 */
export const FALLBACK_WORDS = [
  'abandon', 'ambiguous', 'benevolent', 'candid', 'concise', 'diligent', 'eloquent',
  'frugal', 'gregarious', 'haughty', 'impartial', 'judicious', 'keen', 'loquacious',
  'mundane', 'negligent', 'obstinate', 'pragmatic', 'quaint', 'resilient', 'skeptical',
  'taciturn', 'ubiquitous', 'verbose', 'whimsical', 'zealous',
  'advocate', 'brevity', 'concede', 'deference', 'empirical', 'fallacy', 'gratuitous',
  'hardship', 'inevitable', 'jargon', 'listless', 'meticulous', 'novel', 'ominous',
]
