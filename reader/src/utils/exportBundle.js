/**
 * 「备份包」的数据形状与校验 —— 最小导出（第 0 步 0.6）。
 *
 * 一键导出把用户在这台设备上的**全部**本地数据打成一个 JSON：
 *   生词本（含错题 quiz / SRS 槽位）＋ 删除台账 ＋ 待推脏词 ＋ 阅读 / 音频进度。
 * 目前没有独立的「笔记」「设置」存储键 —— 错题就是词条里的 quiz 槽位，
 * 字号等设置尚未实现，所以这里是空集而不是遗漏（见 data/backup.schema.md）。
 *
 * 口径：
 *   - 导出必须能**原样回导**（本文件只负责形状，落盘在 useVocabulary.importBackup）。
 *   - 校验从严：type / exportVersion / 词表 migrate 三道闸；版本比本机新一律拒收，不降级。
 *   - 纯数据函数，不 import Vue / useSync，便于在 Node 里直接断言。
 */

import { migrate } from '../storage/schema.js'
import { READING_POS_PREFIX, AUDIO_POS_PREFIX } from '../sync/progress.js'

export const EXPORT_KIND = 'my-reader-backup'
export const EXPORT_VERSION = 1
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

/** 原型污染 key：导入外部 JSON 时一律跳过 */
function isUnsafeKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

/** 本地进度键 → 同步键（reading:<bookId> / audio:<bookId>/<chapterId>）；不是进度键返回 null */
export function progressSyncKey(storageKey) {
  if (typeof storageKey !== 'string') return null
  if (storageKey.startsWith(READING_POS_PREFIX)) {
    return 'reading:' + storageKey.slice(READING_POS_PREFIX.length)
  }
  if (storageKey.startsWith(AUDIO_POS_PREFIX)) {
    return 'audio:' + storageKey.slice(AUDIO_POS_PREFIX.length)
  }
  return null
}

/**
 * 收集全部本地进度（**不截断** —— 推送有 300 条窗口，备份要完整）。
 * 只收带字符串 updatedAt 的对象条目：没有时间戳的位置没法参与 LWW，收了只会捣乱。
 */
export function collectProgress(store) {
  const out = {}
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!s) return out
  try {
    const n = Number(s.length) || 0
    for (let i = 0; i < n; i++) {
      const key = s.key(i)
      if (!key) continue
      const syncKey = progressSyncKey(key)
      if (!syncKey) continue
      const raw = s.getItem(key)
      if (!raw) continue
      let value
      try { value = JSON.parse(raw) } catch { continue }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      if (typeof value.updatedAt !== 'string' || !value.updatedAt) continue
      out[syncKey] = value
    }
  } catch { /* 存储不可用（私有模式）→ 当没有进度 */ }
  return out
}

/** 校验一组进度（来自外部文件）：键前缀合法 ＋ 值是带 updatedAt 的对象 */
function sanitizeProgress(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || isUnsafeKey(key)) continue
    if (!(key.startsWith('reading:') || key.startsWith('audio:'))) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (typeof value.updatedAt !== 'string' || !value.updatedAt) continue
    out[key] = value
  }
  return out
}

/** 校验墓碑台账：小写化 key、非空字符串时间戳、跳原型污染 */
function sanitizeTombstones(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [word, ts] of Object.entries(raw)) {
    if (isUnsafeKey(word)) continue
    const key = (word + '').toLowerCase()
    if (!key || typeof ts !== 'string' || !ts) continue
    out[key] = ts
  }
  return out
}

/**
 * 校验并规整一个已 JSON.parse 的备份文件。纯函数，不改入参。
 * @returns {{ok:true, data:{vocabulary,tombstones,dirty,progress}, counts:object}
 *          |{ok:false, error:string}}
 */
export function analyzeBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Not a JSON object' }
  }
  if (raw.type !== EXPORT_KIND) {
    return { ok: false, error: 'Not a my-reader backup file' }
  }
  const v = raw.exportVersion
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    return { ok: false, error: 'Backup is missing its export version' }
  }
  if (v > EXPORT_VERSION) {
    return { ok: false, error: 'Backup version ' + v + ' is newer than this app supports' }
  }
  const d = raw.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { ok: false, error: 'Backup has no data' }
  }
  const vocabulary = migrate(d.vocabulary)
  if (!vocabulary) return { ok: false, error: 'Unrecognized vocabulary data' }

  const tombstones = sanitizeTombstones(d.tombstones)
  const dirty = Array.isArray(d.dirty)
    ? [...new Set(d.dirty.filter(w => typeof w === 'string' && w).map(w => w.toLowerCase()))]
    : []
  const progress = sanitizeProgress(d.progress)

  return {
    ok: true,
    data: { vocabulary, tombstones, dirty, progress },
    counts: {
      words: Object.keys(vocabulary.words).length,
      tombstones: Object.keys(tombstones).length,
      dirty: dirty.length,
      progress: Object.keys(progress).length
    }
  }
}
