/**
 * 记录通道的本地存储（localStorage）—— 无模块级缓存，每次直接读盘，便于单测与多实例。
 *
 * 三样都持久化，缺一不可（理由与生词本 storage/localAdapter.js 一致）：
 *   ① 记录本体   reader-records-v1            {'kind:id': payload}
 *   ② 删除台账   reader-records-tombstones    {'kind:id': 删除时刻}
 *   ③ 待推脏集合 reader-records-dirty         ['kind:id']
 * 否则「改了没推出去 / 离线删了」会随关页一起消失。
 *
 * 姿态与 localAdapter 一致：本模块是**存储层**，写本身不标脏；
 * 标脏由用户侧的 putRecord/removeRecord 或同步层的 markRecordDirty 决定。
 */

import { recordKey, splitRecordKey, sanitizeRecord, newRecordId, recordTime } from './records.js'

const KEY = 'reader-records-v1'
const TOMB_KEY = 'reader-records-tombstones'
const DIRTY_KEY = 'reader-records-dirty'

function readMap(key) {
  try {
    const raw = localStorage.getItem(key)
    const obj = raw ? JSON.parse(raw) : null
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}

function writeMap(key, map) {
  try {
    if (Object.keys(map).length) localStorage.setItem(key, JSON.stringify(map))
    else localStorage.removeItem(key) // 空表不留 `{}` 垃圾
    return true
  } catch {
    return false // 配额满 / 私有模式：退回「只活在内存里」的旧行为
  }
}

/** 本地记录表 {'kind:id': payload}（只读快照） */
export function loadRecordsMap() { return readMap(KEY) }

/** 本地还没推出去的删除台账 */
export function loadRecordTombstones() { return readMap(TOMB_KEY) }

/** 清除指定键的墓碑（远程墓碑已应用、或该记录被重新写入时调用） */
export function clearRecordTombstones(keys) {
  const map = readMap(TOMB_KEY)
  let changed = false
  for (const k of keys || []) {
    if (k in map) { delete map[k]; changed = true }
  }
  if (changed) writeMap(TOMB_KEY, map)
}

// ── 待推送脏集合（与生词本的 reader-vocab-dirty 同口径：推送成功才清账）──
export function loadRecordDirty() {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr.filter(k => typeof k === 'string' && k) : []
  } catch {
    return []
  }
}

export function saveRecordDirty(keys) {
  return writeMapArray(keys)
}

function writeMapArray(keys) {
  try {
    const arr = [...new Set((keys || []).filter(k => typeof k === 'string' && k))]
    if (arr.length) localStorage.setItem(DIRTY_KEY, JSON.stringify(arr))
    else localStorage.removeItem(DIRTY_KEY)
    return true
  } catch {
    return false
  }
}

export function markRecordDirty(keys) {
  const cur = loadRecordDirty()
  return saveRecordDirty([...cur, ...(keys || [])])
}

/** 把已推送成功的键从脏集合里划掉 */
export function clearRecordDirty(keys) {
  const done = new Set(keys || [])
  if (!done.size) return true
  return saveRecordDirty(loadRecordDirty().filter(k => !done.has(k)))
}

/**
 * 把一个键从墓碑台账里划掉，并返回它应当使用的时间戳（与 localAdapter.retireTombstone 同规则）。
 * 此前被删过、这次又写回来 = 一次「复活」：服务端拿墓碑时刻比时间戳，并列会判为不占优而拒收，
 * 所以复活必须严格晚于墓碑时刻。
 */
function retireTombstone(tombs, key, updatedAt) {
  const tombTs = tombs[key]
  if (!tombTs) return { updatedAt, changed: false }
  delete tombs[key]
  const t = Date.parse(tombTs)
  if (Number.isFinite(t) && !(updatedAt > tombTs)) {
    return { updatedAt: new Date(t + 1).toISOString(), changed: true }
  }
  return { updatedAt, changed: true }
}

/**
 * 批量写入（存储层，不标脏）。语义与生词本 addWords 一致：净化 + 复活台账，只在最后落盘一次。
 * @returns {object} 实际写入的 {key: 净化后 payload}
 */
export function addRecords(items) {
  const records = readMap(KEY)
  const tombs = readMap(TOMB_KEY)
  const applied = {}
  let tombChanged = false
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue
    const clean = sanitizeRecord(it.kind, it.id, it.payload)
    if (!clean) continue
    const key = recordKey(it.kind, it.id)
    const r = retireTombstone(tombs, key, clean.updatedAt)
    clean.updatedAt = r.updatedAt
    tombChanged = tombChanged || r.changed
    records[key] = clean
    applied[key] = clean
  }
  if (Object.keys(applied).length) writeMap(KEY, records)
  if (tombChanged) writeMap(TOMB_KEY, tombs)
  return applied
}

/**
 * 用户侧写入一条记录（变异路径）：净化 + 复活台账 +（默认）标脏。
 * id 缺省时按 kind 前缀新铸一个；payload.id 也认。
 * @returns {{kind,id,payload}|null}
 */
export function putRecord(kind, payload, { id, dirty = true } = {}) {
  const rid = id || (payload && typeof payload.id === 'string' ? payload.id : '') || newRecordId(kind)
  const applied = addRecords([{ kind, id: rid, payload }])
  const key = recordKey(kind, rid)
  if (!applied[key]) return null
  if (dirty) markRecordDirty([key])
  return { kind, id: rid, payload: applied[key] }
}

/**
 * 用户侧删除一条记录：清本体 + 记台账 + 标脏。
 * @param {object} [opts]
 * @param {boolean} [opts.record] 是否记台账。默认 true；应用**远程**墓碑时传 false
 * @param {boolean} [opts.dirty]  是否标脏。默认 true
 */
export function removeRecord(kind, id, { record = true, dirty = true } = {}) {
  const key = recordKey(kind, id)
  const records = readMap(KEY)
  delete records[key]
  writeMap(KEY, records)
  if (record) {
    const tombs = readMap(TOMB_KEY)
    tombs[key] = new Date().toISOString()
    writeMap(TOMB_KEY, tombs)
  }
  if (dirty) markRecordDirty([key])
}

/** 批量删除（同上，逐键语义一致） */
export function removeRecords(keys, opts = {}) {
  for (const k of keys || []) {
    const sp = splitRecordKey(k)
    if (!sp) continue
    removeRecord(sp.kind, sp.id, opts)
  }
}
