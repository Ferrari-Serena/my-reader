/**
 * 撤回审计行（phrase_retract_log）构造器。
 *
 * 纯函数、无副作用：只做入参校验 + 列对齐，写库的事交回调用方（sync.js / D1 batch）。
 * 之所以单独抽出来：撤回是「不可回滚」的动作，落库前必须把字段形状钉死，
 * 否则一条脏行会让整批 batch 全废，静默丢掉真正的撤回。
 */

export const RETRACT_LOG_TABLE = 'phrase_retract_log'

// 建表列顺序（见 migrations/0004_phrase_retract_log.sql）；row 的键顺序与之对齐，
// 方便直接 cols.join(',') / placeholders 拼 INSERT，不用再手写一遍列名。
export const RETRACT_LOG_COLUMNS = [
  'id',
  'retracted_at',
  'cache_key_hash',
  'scope_kind',
  'book_id',
  'phrase_hash',
  'answer_rank',
  'schema_ver',
  'model_ver',
  'prompt_ver',
  'lexicon_ver',
  'reason',
  'operator',
]

const HEX64 = /^[0-9a-fA-F]{64}$/
const SCOPE_KINDS = new Set(['public', 'user'])
const BATCH_FIELDS = ['schema_ver', 'model_ver', 'prompt_ver', 'lexicon_ver']

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function fail(error) {
  return { ok: false, error }
}

/**
 * buildRetractAudit(input) -> { ok: true, row } | { ok: false, error }
 *
 * input: { cacheKeyHash, scopeKind, bookId, phraseHash, answerRank,
 *          batch: { schema_ver, model_ver, prompt_ver, lexicon_ver },
 *          reason, operator, retractedAt? }
 */
export function buildRetractAudit(input) {
  if (!input || typeof input !== 'object') return fail('input 必须是对象')
  const {
    cacheKeyHash,
    scopeKind,
    bookId,
    phraseHash,
    answerRank,
    batch,
    reason,
    operator,
    retractedAt,
  } = input

  if (typeof cacheKeyHash !== 'string' || !HEX64.test(cacheKeyHash)) {
    return fail('cacheKeyHash 必须是 64 位 hex')
  }
  if (typeof phraseHash !== 'string' || !HEX64.test(phraseHash)) {
    return fail('phraseHash 必须是 64 位 hex')
  }
  if (!SCOPE_KINDS.has(scopeKind)) {
    return fail('scopeKind 必须是 public | user')
  }
  if (!isNonEmptyString(bookId)) return fail('bookId 不能为空')
  if (!Number.isInteger(answerRank) || answerRank < 0) {
    return fail('answerRank 必须是非负整数')
  }
  if (!batch || typeof batch !== 'object') return fail('batch 必须是对象')
  const batchVals = {}
  for (const field of BATCH_FIELDS) {
    const v = batch[field]
    if (v !== undefined && v !== null && typeof v !== 'string') return fail(`batch.${field} 必须是字符串或 null`)
    batchVals[field] = v == null || String(v).trim() === '' ? null : String(v)
  }
  if (!isNonEmptyString(reason)) return fail('reason 不能为空')
  if (!isNonEmptyString(operator)) return fail('operator 不能为空')

  let when
  if (retractedAt === undefined || retractedAt === null) when = Date.now()
  else if (typeof retractedAt === 'number' && Number.isFinite(retractedAt)) when = retractedAt
  else if (isNonEmptyString(retractedAt) && !Number.isNaN(Date.parse(retractedAt))) when = Date.parse(retractedAt)
  else return fail('retractedAt 必须是毫秒数或可解析时间字符串')

  // 键顺序 = RETRACT_LOG_COLUMNS 去掉 id
  const row = {
    retracted_at: when,
    cache_key_hash: cacheKeyHash,
    scope_kind: scopeKind,
    book_id: bookId,
    phrase_hash: phraseHash,
    answer_rank: answerRank,
    schema_ver: batchVals.schema_ver,
    model_ver: batchVals.model_ver,
    prompt_ver: batchVals.prompt_ver,
    lexicon_ver: batchVals.lexicon_ver,
    reason,
    operator,
  }
  return { ok: true, row }
}
