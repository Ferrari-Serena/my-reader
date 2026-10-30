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
 *   phraseCloze       词组语境填空（4选1；干扰项**只能**取同动词词组）
 *   phraseDefChoice   看释义选词组（4选1；U5，2026-10-09 —— 干扰项不要求同动词，把「同动词兄弟不足」那批救回题池）
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

/**
 * 在 chapters JSON 中搜索包含 word 的句子（返回最短的）。
 * 命中时把**实际命中的那个词形**一起带出来：句子里常常是屈折形（abandoning），
 * 而词表键是原形（abandon）。挖空必须按命中的词形挖，按原形挖一个字符都替换不掉。
 */
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
        // 取句子里**最先**命中的那个词形，与后面 String.replace 只替换第一处的口径一致
        let hit = ''
        for (const w of trimmed.split(/\s+/)) {
          const token = w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase()
          if (token && forms.includes(token)) { hit = token; break }
        }
        if (hit && trimmed.length >= 15 && trimmed.length <= 250) {
          candidates.push({ sentence: trimmed, form: hit, chapterId: ch.id, paragraphId: para.id })
        }
      }
    }
  }
  return candidates.sort((a, b) => a.sentence.length - b.sentence.length)[0] || null
}

/**
 * 用**命中的词形**替换句子里的那一处，返回题干 + 是否真的挖到了空。
 * placed 是给调用方的硬保证：挖不出空就不该出这道题（宁可降级为 wordChoice），
 * 否则学生看到的是一句完整的话，答案还以屈折形印在里面。
 */
function buildClozeStem(sentence, form) {
  const regex = new RegExp(`\\b${form}\\b`, 'i')
  const stem = sentence.replace(regex, '_______')
  return { stem, placed: stem !== sentence }
}

// ─── 题型生成器 ──────────────────────────────────

function genSentenceCloze(entry, allEntries, chapters) {
  const found = findSentence(entry.word, chapters)
  if (!found) return null // 降级为 wordChoice

  // 按命中的词形挖空（句子里可能是 abandoning，而词表键是 abandon）
  const { stem, placed } = buildClozeStem(found.sentence, found.form)
  if (!placed) return null // 挖不出空：宁可不这道题
  // 同一句里可能既出现屈折形又出现原形，挖掉一处后答案仍留在题干里 → 也不能出
  if (new RegExp(`\\b${entry.word}\\b`, 'i').test(stem)) return null
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
    explanation: `${entry.word}: ${(entry.snapshot?.definitions || [])[0] || ''}`,
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
    stem: `哪个单词的意思是「${def}」？`,
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
    stem: `「${entry.word}」是什么意思？`,
    options,
    answerIndex,
    explanation: `${entry.word}: ${correctDef}`,
    word: entry.word,
  }
}

/**
 * 拼写提示的字母头（W-08 §2.3 · `#2026-10-31T1050-cd`）：
 * 默认只给首字母；若同池里有**同首字母且同长度**的词，就把前缀加长到能唯一区分（最多全词）。
 * 2026-10-31 前只给首字母 ⇒ `dissuade` / `diligent` 的提示都是「以 D 开头，共 8 个字母」。
 */
export function plainClozeHead(word, allEntries = []) {
  const w = String(word || '').toLowerCase()
  if (w.length < 2) return w.toUpperCase()
  const peers = (allEntries || [])
    .map(e => String(e?.word || '').toLowerCase())
    .filter(o => o && o !== w && o.length === w.length)
  let n = 1
  while (n < w.length && peers.some(o => o.slice(0, n) === w.slice(0, n))) n++
  const head = w.slice(0, n)
  return head.charAt(0).toUpperCase() + head.slice(1)
}

function genPlainCloze(entry, allEntries = []) {
  const def = (entry.snapshot?.definitions || [])[0]
  if (!def || !entry.word) return null
  return {
    type: 'plainCloze',
    stem: def,
    answer: entry.word,
    hint: `以「${plainClozeHead(entry.word, allEntries)}」开头，共 ${entry.word.length} 个字母`,
    word: entry.word,
  }
}

// ─── 词组题生成器 ──────────────────────────────

/** 释义归一（比较用：去空白 + 小写）。 */
function normDefs(list) {
  return (list || []).map(d => String(d).trim().toLowerCase()).filter(Boolean)
}

/** 两条词组的释义是否「撞车」（相等或互相包含）—— 撞车的不能当干扰项，否则一题两个对。 */
function defClash(a, b) {
  const A = normDefs(a), B = normDefs(b)
  return A.some(x => B.some(y => x === y || x.includes(y) || y.includes(x)))
}

/**
 * 释义 → 选词组（U5，2026-10-09）。题干是释义，四个选项都是词组。
 *
 * 与 `genPhraseCloze` 的差别**只在干扰项**：那一个只能取同动词（考的是搭配），于是
 * 「同动词兄弟不足 3 个」的词组永远出不了题；这一个不要求同动词、只要**释义不撞车**，
 * 于是那批被排除的词组全部回到题池。干扰项顺序：先同动词（读起来最像），不够再跨动词。
 *
 * phraseDict 由调用方给「带 verb 的那一档」—— 库里 3294 条里另有 2894 条是**名词搭配**
 *（westminster abbey / abdominal pain 之类），混进来会把动词短语题变成另一种测验。
 */
function genPhraseDefChoice(phrase, phraseDict, n = 3) {
  const defs = phrase.defs || []
  const def = defs[0]
  if (!def) return null

  const sameVerb = [], others = []
  for (const p of phraseDict) {
    if (p.phrase === phrase.phrase) continue
    if (!p.defs?.length) continue
    if (defClash(p.defs, phrase.defs)) continue
    if (p.verb && p.verb === phrase.verb) sameVerb.push(p)
    else others.push(p)
  }
  // **2026-10-31 裁（）：干扰项不再优先取同动词。**
  // 同动词干扰项在「两字释义」题干下会造成真歧义（ 对「导致」、 对「逃离」）。
  // 改为优先跨动词、义差明显的词组；同动词只在跨动词凑不满时才用来补位。
  const dists = shuffle(others).slice(0, n)
  if (dists.length < n) dists.push(...shuffle(sameVerb).slice(0, n - dists.length))
  if (dists.length < n) return null

  const options = shuffle([phrase, ...dists])
  return {
    type: 'phraseDefChoice',
    stem: `哪个词组的意思是「${def}」？`,
    options: options.map(p => p.phrase),
    answerIndex: options.findIndex(p => p.phrase === phrase.phrase),
    explanation: `${phrase.phrase}: ${defs.join('；')}`,
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
        const q = genPlainCloze(entry, allEntries)
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
  // **2026-10-31 裁（E2 修复窗口 `#2026-10-31T1050-cd`）：词组题只出释义题。**
  // 原 `phraseCloze` 的题干是「动词 + 空格」（无语境时），四个同动词选项都成立 ⇒ 不可答；
  // 已被 QA 判为多解，整型摘除。`phraseDefChoice` 的题干带释义，答案唯一。
  // 干扰项不要求同动词，只要求释义不撞车（见 genPhraseDefChoice）。
  // 同一次测验里**一条词组只出一题**（两道题考同一个词组等于白送分）。
  const eligible = phrases.filter(p => p.verb && p.defs?.length)
  const defs = []
  const used = new Set()
  for (const p of shuffle(eligible)) {
    if (defs.length >= maxCount) break
    if (used.has(p.phrase)) continue
    const q = genPhraseDefChoice(p, eligible, 3)
    if (q) { defs.push(q); used.add(p.phrase) }
  }
  return shuffle(defs)
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
