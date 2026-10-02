/**
 * 生词本数据 schema：版本、空结构、迁移链、条目校验。
 * 版本升级规则：只在 migrate() 里加 case，绝不改旧版本的写入逻辑。
 */

export const SCHEMA_VERSION = 1

export function emptyVocab() {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    words: {}
  }
}

/**
 * 条目字段白名单：导入外部 JSON 时剪裁掉未知字段，防污染。
 * updatedAt 必须在列——它是跨设备 LWW 的唯一依据。此前漏了它，
 * 于是 addWord 落盘时会把它剥掉、updateWord 却保留，两条写入路径口径不一致，
 * 重载后 mergeAndApply 只能退化成比 addedAt（创建时间，跨设备相同）。
 */
const ENTRY_FIELDS = ['word', 'bookId', 'chapterId', 'addedAt', 'updatedAt', 'snapshot', 'srs', 'quiz']
// surfaces（词条在正文里出现过的写法）必须在列：不在就会在 addWord / mergeAndApply 写盘时被剔掉，
// 而收藏态高亮正好靠 entry.snapshot.surfaces 把屈折形也算进查找集合，
// 于是重载/同步一次后就只剩词头能亮。
const SNAPSHOT_FIELDS = ['lemma', 'phonetic', 'partOfSpeech', 'definitions', 'audioUrl', 'level', 'chapters', 'surfaces']

export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.word !== 'string') return null
  const entry = {}
  for (const f of ENTRY_FIELDS) entry[f] = raw[f] ?? null
  entry.word = raw.word.toLowerCase()
  entry.addedAt = typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString()
  // 存量条目没有 updatedAt → 回退到 addedAt（语义正确：创建后没改过）。
  // 保证它永远是个可比较的 ISO 串，绝不留 null，否则 LWW 会静默走偏。
  entry.updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : entry.addedAt
  const snap = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {}
  entry.snapshot = {}
  for (const f of SNAPSHOT_FIELDS) {
    entry.snapshot[f] = snap[f] ?? (f === 'definitions' || f === 'chapters' || f === 'surfaces' ? [] : '')
  }
  // 类型收紧：导入的脏数据不能崩渲染。
  // level 只有两种合法取值：非空字符串 或 null（全项目都用 null 表示「无 level」）。
  // 必须显式吃掉 null —— 上面那个 `snap[f] ?? ''` 会把 null 变成 ''，
  // 于是净化不幂等（null → '' → 保持 ''），而 updateWord / importVocabulary
  // 都会对已净化的条目再净化一次，等级标签就会从「无」变成「空字符串」。
  const lvl = snap.level
  entry.snapshot.level = (typeof lvl === 'string' && lvl) ? lvl : null
  entry.snapshot.definitions = Array.isArray(entry.snapshot.definitions)
    ? entry.snapshot.definitions.filter(d => typeof d === 'string')
    : []
  entry.snapshot.chapters = Array.isArray(entry.snapshot.chapters)
    ? entry.snapshot.chapters.filter(c => typeof c === 'string')
    : []
  entry.snapshot.surfaces = Array.isArray(entry.snapshot.surfaces)
    ? entry.snapshot.surfaces.filter(s => typeof s === 'string')
    : []
  for (const f of ['lemma', 'phonetic', 'partOfSpeech', 'audioUrl']) {
    if (typeof entry.snapshot[f] !== 'string') entry.snapshot[f] = ''
  }
  // quiz/srs 槽位形状校验：非法结构一律归 null（下次写入时由调用方 lazy-init）
  if (entry.quiz && typeof entry.quiz === 'object' && !Array.isArray(entry.quiz)) {
    entry.quiz = {
      wrongHistory: Array.isArray(entry.quiz.wrongHistory)
        ? entry.quiz.wrongHistory.filter(h => h && typeof h === 'object')
        : [],
      correctStreak: Number(entry.quiz.correctStreak) || 0,
      totalAttempts: Number(entry.quiz.totalAttempts) || 0,
      totalCorrect: Number(entry.quiz.totalCorrect) || 0
    }
  } else {
    entry.quiz = null
  }
  if (!(entry.srs && typeof entry.srs === 'object' && !Array.isArray(entry.srs)
        && typeof entry.srs.due === 'string')) {
    entry.srs = null
  }
  return entry
}

/**
 * 把任意历史版本的数据升级到当前版本。
 * 输入非法时返回 null（调用方决定回退到 emptyVocab）。
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.words !== 'object' || raw.words === null) {
    return null
  }
  let data = raw
  switch (data.version) {
    case SCHEMA_VERSION:
      break
    // case 1: → 2 时在此处补 FSRS 卡片（7.2 实现）
    default:
      return null // 未知版本（比当前还新的数据不降级处理）
  }

  // 逐条目校验剪裁（跳过原型污染 key）
  const words = {}
  for (const [key, val] of Object.entries(data.words)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const entry = sanitizeEntry(val)
    if (entry) words[key.toLowerCase()] = entry
  }
  return { version: SCHEMA_VERSION, updatedAt: data.updatedAt || new Date().toISOString(), words }
}
