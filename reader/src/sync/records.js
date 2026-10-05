/**
 * 第 3 步「归档」：四类新数据（笔记 / 错题 / 卡片 / 设置）的模型与合并判据。
 *
 * 与服务端 worker/src/sync.js 的「记录通道」对齐：记录用命名空间键 '<kind>:<id>'，
 * 走 /api/sync 的 push `records` / `recordTombstones` 与 pull 的两个数组，
 * 与生词（`words` 通道）在同一张表里互不干扰。
 *
 * 本模块是纯逻辑（不 import Vue / storage / fetch），可直接在 Node 里断言。
 * schema_version 放在 payload 内（服务端只透传、读不懂的字段忽略）。
 */

export const RECORD_KINDS = ['note', 'wrong', 'card', 'setting']
export const RECORD_SCHEMA_VERSION = 1

/** id 前缀：note -> n_ / wrong -> w_ / card -> card_ / setting -> s_ */
const ID_PREFIX = { note: 'n_', wrong: 'w_', card: 'card_', setting: 's_' }

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
const plainObj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** 各 kind 的字段白名单（方案 3.4 草案）。未列出的字段一律剪掉。 */
const FIELDS = {
  note: ['bookId', 'chapterId', 'anchor', 'text', 'color', 'createdAt', 'updatedAt'],
  wrong: ['type', 'refKey', 'yourAnswer', 'rightAnswer', 'createdAt', 'updatedAt'],
  card: ['refKind', 'refKey', 'srs', 'createdAt', 'updatedAt'],
  setting: ['key', 'value', 'createdAt', 'updatedAt'],
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
  for (const f of FIELDS[kind]) out[f] = cleanField(f, src[f])
  out.createdAt = asStr(out.createdAt) || asStr(out.updatedAt) || new Date().toISOString()
  out.updatedAt = asStr(out.updatedAt) || out.createdAt
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
