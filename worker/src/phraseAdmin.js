// 短语撤回后台：请求校验 / 缓存键 / 短语哈希

export const RETRACT_PATH = '/api/phrase/admin/retract'

const SCOPE_USER_RE = /^user:[A-Za-z0-9_-]{1,64}$/
const HASH_RE = /^[0-9a-f]{64}$/

function isStr(v, min, max) {
  if (typeof v !== 'string') return false
  const t = v.trim()
  return t.length >= min && t.length <= max
}

function checkBatch(batch) {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return 'batch 必填'
  const { schema, model, prompt, lexicon } = batch
  if (!isStr(schema, 1, 80)) return 'batch.schema 非法'
  if (typeof model !== 'string' || model.length > 120) return 'batch.model 非法'
  if (!isStr(prompt, 1, 80)) return 'batch.prompt 非法'
  if (!isStr(lexicon, 1, 80)) return 'batch.lexicon 非法'
  return null
}

/**
 * 解析撤回请求体。
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function parseRetractRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body 非法' }
  }
  const dryRun = body.dryRun === undefined ? false : body.dryRun
  if (typeof dryRun !== 'boolean') return { ok: false, error: 'dryRun 必须是布尔值' }

  let scope = null
  let answerHash = null

  if (!dryRun) {
    if (typeof body.scope !== 'string') return { ok: false, error: 'scope 必填' }
    const s = body.scope
    if (s !== 'public' && !SCOPE_USER_RE.test(s)) return { ok: false, error: 'scope 非法' }
    if (typeof body.answerHash !== 'string' || !HASH_RE.test(body.answerHash)) {
      return { ok: false, error: 'answerHash 非法' }
    }
    scope = s
    answerHash = body.answerHash
  } else {
    if (body.scope !== undefined) {
      if (typeof body.scope !== 'string') return { ok: false, error: 'scope 非法' }
      if (body.scope !== 'public' && !SCOPE_USER_RE.test(body.scope)) {
        return { ok: false, error: 'scope 非法' }
      }
      scope = body.scope
    }
    if (body.answerHash !== undefined) {
      if (typeof body.answerHash !== 'string' || !HASH_RE.test(body.answerHash)) {
        return { ok: false, error: 'answerHash 非法' }
      }
      answerHash = body.answerHash
    }
  }

  const { bookId, phrase } = body
  if (typeof bookId !== 'string') return { ok: false, error: 'bookId 必填' }
  const bid = bookId.trim()
  if (bid.length < 1 || bid.length > 128) return { ok: false, error: 'bookId 长度非法' }

  if (typeof phrase !== 'string') return { ok: false, error: 'phrase 必填' }
  const ph = phrase.trim()
  if (ph.length < 1 || ph.length > 80) return { ok: false, error: 'phrase 长度非法' }

  const batchErr = checkBatch(body.batch)
  if (batchErr) return { ok: false, error: batchErr }

  if (typeof body.reason !== 'string') return { ok: false, error: 'reason 必填' }
  const reason = body.reason.trim()
  if (reason.length < 1 || reason.length > 500) return { ok: false, error: 'reason 长度非法' }

  return {
    ok: true,
    value: {
      scope,
      answerHash,
      bookId: bid,
      phrase: ph,
      batch: {
        schema: body.batch.schema.trim(),
        model: body.batch.model,
        prompt: body.batch.prompt.trim(),
        lexicon: body.batch.lexicon.trim(),
      },
      reason,
      dryRun,
    },
  }
}

/**
 * 缓存键：public:<hash> / user:<id>:<hash>；非法输入返回 null。
 */
export function retractCacheKey(scope, answerHash) {
  if (typeof scope !== 'string') return null
  if (typeof answerHash !== 'string' || !HASH_RE.test(answerHash)) return null
  if (scope === 'public') return 'public:' + answerHash
  const m = /^user:([A-Za-z0-9_-]{1,64})$/.exec(scope)
  if (!m) return null
  return 'user:' + m[1] + ':' + answerHash
}

/**
 * phraseHash(bookId, phrase) -> Promise<64hex>
 */
export async function phraseHash(bookId, phrase) {
  const data = new TextEncoder().encode(String(bookId) + '\u0000' + String(phrase))
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}
