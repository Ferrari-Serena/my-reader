/**
 * 第 3 步「归档」：五类记录（笔记 / 错题 / 卡片 / 设置 ＋ 第 16 步的 BYO 书元信息）的模型与合并判据。
 *
 * 与服务端 worker/src/sync.js 的「记录通道」对齐：记录用命名空间键 '<kind>:<id>'，
 * 走 /api/sync 的 push `records` / `recordTombstones` 与 pull 的两个数组，
 * 与生词（`words` 通道）在同一张表里互不干扰。
 *
 * 本模块是纯逻辑（不 import Vue / storage / fetch），可直接在 Node 里断言。
 * schema_version 放在 payload 内（服务端只透传、读不懂的字段忽略）。
 */

export const RECORD_KINDS = ['note', 'wrong', 'card', 'setting', 'book']
export const RECORD_SCHEMA_VERSION = 1

/**
 * id 前缀：note -> n_ / wrong -> w_ / card -> card_ / setting -> s_ / book -> bk_
 *
 * ⚠️ book 这一项**不是**给 newRecordId 用的（书的 id 来自内容指纹，见 utils/bookId.js，
 * 永不新铸）；它在这儿只为让 isRecordKind('book') 为真 —— isRecordKind 的实现就是
 * 「ID_PREFIX 里有没有这个键」。漏了它，sanitizeRecord('book', …) 直接返回 null，
 * 书体元信息会被**静默丢光**（不报错、不落盘、也没有任何日志）。
 */
const ID_PREFIX = { note: 'n_', wrong: 'w_', card: 'card_', setting: 's_', book: 'bk_' }

export function isRecordKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(ID_PREFIX, kind)
}

export function recordKey(kind, id) { return kind + ':' + id }

export function splitRecordKey(key) {
  if (typeof key !== 'string') return null
  const i = key.indexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  return { kind: key.slice(0, i), id: key.slice(i + 1) }
}

export function newRecordId(kind) {
  const prefix = ID_PREFIX[kind] || 'r_'
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return prefix + uuid
}

/** 记录的 LWW 时间戳：updatedAt 优先，回退 createdAt（再缺就是空串，比不过任何有效时间戳） */
export function recordTime(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.updatedAt === 'string' && payload.updatedAt) return payload.updatedAt
  if (typeof payload.createdAt === 'string' && payload.createdAt) return payload.createdAt
  return ''
}

const asStr = v => (typeof v === 'string' ? v : '')
const asNum = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** 正数计数（非数 / 负数 / NaN -> 0，小数取整）；与 worker/src/sync.js 的 shapeFields 同口径 */
const asCount = v => {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const plainObj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** 各 kind 的字段白名单（方案 3.4 草案）。未列出的字段一律剪掉。 */
const FIELDS = {
  note: ['bookId', 'bookTitle', 'chapterId', 'anchor', 'quote', 'text', 'color', 'createdAt', 'updatedAt'],
  wrong: ['type', 'refKey', 'yourAnswer', 'rightAnswer', 'createdAt', 'updatedAt'],
  card: ['refKind', 'refKey', 'srs', 'createdAt', 'updatedAt'],
  setting: ['key', 'value', 'createdAt', 'updatedAt'],
  // 第 16 步 D14：BYO 书体元信息（正文走 R2，不在这条通道上）。这份名单与
  // worker/src/sync.js 的 FIELDS.book 是**同一份** —— 服务端照它剪，本机多一个少一个
  // 都会让「本地 ≠ 服务端」。没有 chapters/coverUrl（正文不上记录通道），也没有
  // createdAt（书的时间轴是 addedAt + updatedAt）。
  book: ['bookId', 'title', 'author', 'chapterCount', 'charCount', 'addedAt', 'updatedAt'],
}

function cleanField(field, v) {
  if (field === 'anchor') {
    const o = plainObj(v)
    return o ? { paraId: asStr(o.paraId), charStart: asNum(o.charStart), charEnd: asNum(o.charEnd) } : null
  }
  if (field === 'srs') {
    const o = plainObj(v)
    if (!o) return null
    return {
      due: asStr(o.due), stability: asNum(o.stability), difficulty: asNum(o.difficulty),
      state: asNum(o.state), last_review: asStr(o.last_review),
    }
  }
  if (field === 'value') return v === undefined ? null : v // 设置值可以是任意 JSON 值
  // 计数字段（book 的章节数 / 字数）：与 worker 的 shapeFields 同一条口径 ——
  // 数字或能当数字看的字符串都收，非数 / 负数 / NaN 归 0，小数取整。
  // 不这么干就会落到 asStr：本地出 '12'、服务端归一成 12，两边类型不一致。
  if (field === 'chapterCount' || field === 'charCount') return asCount(v)
  return asStr(v)
}

/**
 * 把一条记录净化到白名单形状；不合法返回 null（未知 kind / 缺 id / id 非字符串）。
 * 一律写入当前 schema_version；时间戳与生词本同口径：缺 updatedAt 时回退 createdAt，
 * 两者都缺才用「现在」（与服务端 stampWithTs 的兜底一致）。
 */
export function sanitizeRecord(kind, id, payload) {
  if (!isRecordKind(kind) || typeof id !== 'string' || !id) return null
  const src = plainObj(payload) || {}
  const out = { schema_version: RECORD_SCHEMA_VERSION }
  const fields = FIELDS[kind]
  for (const f of fields) out[f] = cleanField(f, src[f])
  // 时间戳按白名单**条件注入**：book 的名单里没有 createdAt（它的时间轴是 addedAt +
  // updatedAt），硬写进去等于多产一个服务端必剪的字段 —— 每次 pull 回来又重注入一遍，
  // 本地与远端就永远对不齐。
  if (fields.includes('createdAt')) {
    out.createdAt = asStr(out.createdAt) || asStr(out.updatedAt) || new Date().toISOString()
  }
  if (fields.includes('updatedAt')) {
    out.updatedAt = asStr(out.updatedAt) || asStr(out.createdAt)
  }
  return out
}

/** 批量净化 [{kind,id,payload}] -> 合法子集；坏条目静默丢弃 */
export function sanitizeRecords(list) {
  const out = []
  for (const rec of Array.isArray(list) ? list : []) {
    if (!rec || typeof rec !== 'object') continue
    const kind = asStr(rec.kind)
    const id = asStr(rec.id)
    const payload = sanitizeRecord(kind, id, rec.payload)
    if (!payload) continue
    out.push({ kind, id, payload })
  }
  return out
}

/**
 * 把远程记录状态合并进本地的判据。纯函数，不改入参。
 * 与 sync/merge.js 的 planMerge 同构，只是键换成 '<kind>:<id>'、条目换成数组。
 *
 * @param localRecords 本地记录表 {'kind:id': payload}
 * @param remoteRecords pull 回来的记录数组 [{kind,id,payload}]
 * @param remoteTombstones pull 回来的墓碑数组 [{kind,id,deletedAt}]
 * @param localTombstones 本地还没推出去的删除台账 {'kind:id': 删除时刻}
 * @returns {{apply: Array, remove: string[], repush: string[]}} apply 项含 {kind,id,key,payload}
 */
export function planRecordMerge(localRecords, remoteRecords, remoteTombstones, localTombstones) {
  const local = localRecords || {}
  const tombs = localTombstones || {}
  const apply = []
  const remove = []
  const repush = []

  for (const rec of Array.isArray(remoteRecords) ? remoteRecords : []) {
    if (!rec || typeof rec !== 'object') continue
    const kind = asStr(rec.kind)
    const id = asStr(rec.id)
    if (!isRecordKind(kind) || !id) continue
    const payload = sanitizeRecord(kind, id, rec.payload)
    if (!payload) continue
    const key = recordKey(kind, id)
    const remoteTime = recordTime(payload)
    const localPayload = local[key]
    if (!localPayload) {
      // 本地没有该记录，但可能有一条还没推出去的删除（离线删）——远程存活写不占优就别 apply
      const localTomb = tombs[key]
      if (typeof localTomb === 'string' && localTomb && !(remoteTime > localTomb)) continue
      apply.push({ kind, id, key, payload })
      continue
    }
    if (remoteTime > recordTime(localPayload)) apply.push({ kind, id, key, payload })
  }

  for (const tb of Array.isArray(remoteTombstones) ? remoteTombstones : []) {
    if (!tb || typeof tb !== 'object') continue
    const kind = asStr(tb.kind)
    const id = asStr(tb.id)
    if (!isRecordKind(kind) || !id) continue
    const key = recordKey(kind, id)
    const tombTs = asStr(tb.deletedAt)
    if (!tombTs) continue
    const localPayload = local[key]
    if (!localPayload) continue // 本地没有，无需删
    if (recordTime(localPayload) > tombTs) repush.push(key) // 删后又建 -> 回推复活
    else remove.push(key)
  }

  return { apply, remove, repush }
}
