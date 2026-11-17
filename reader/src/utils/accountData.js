/**
 * 「我的」页的纯逻辑（不碰 DOM / 网络），AccountView 与 verify-accountui 共用。
 *
 * 数据口径：
 *   · 额度／存储来自服务端 `GET /api/gen/book/<bookId>` 的 `quota` / `storage`
 *     （账号级，与生成页同一份镜像；没有本地书时读不到，界面如实说「暂时读不到」）。
 *   · 最近任务从同样几份 status 的章节行合并而来，按 `finishedAt || updatedAt` 倒序。
 *   · 失败重试走 `submitGenChapters`：服务端对 `failed` 行是同一行重新排队（SQL_TASK_REQUEUE），
 *     **不额外占用当日额度** —— 线框 v0.2 里「第 1 次免费／第 2 次占额度」的文案与实现不符，
 *     这里按实现写（见 2026-11-17 项目日志）。
 */
import { formatBytes } from './genApi.js'

export const RECENT_TASK_LIMIT = 5
export const RECENT_BOOK_LIMIT = 3
export const GIB = 1024 ** 3

export const RETRY_NOTE = '失败章节可重试：同一行重新排队，不额外占用当日额度。'
export const REGEN_NOTE = '清空后重新生成按一次新生成计算，占用当日额度。'

/** 额度：`used + left` 就是服务端当日的上限（env 可改），不写死 5。 */
export function quotaSummary(quota) {
  const q = (quota && typeof quota === 'object' && !Array.isArray(quota)) ? quota : {}
  const used = Number.isFinite(q.chaptersUsed) ? Math.max(0, q.chaptersUsed) : 0
  const left = Number.isFinite(q.chaptersLeft) ? Math.max(0, q.chaptersLeft) : null
  if (q.unknown || left === null) return { known: false, used, left: null, max: null, pct: null }
  const max = used + left
  return { known: true, used, left, max, pct: max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0 }
}

/** GiB 优先、太小退回通用单位。 */
export function gibText(n) {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n >= GIB / 10) return (n / GIB).toFixed(1) + ' GiB'
  return formatBytes(n)
}

/** 存储：usedBytes 为 -1 表示服务端读不到用量（fail-open），照实说不知道。 */
export function storageSummary(storage) {
  const s = (storage && typeof storage === 'object' && !Array.isArray(storage)) ? storage : {}
  const used = Number.isFinite(s.usedBytes) ? s.usedBytes : -1
  const limit = Number.isFinite(s.limitBytes) ? s.limitBytes : -1
  const known = used >= 0 && limit > 0
  return {
    known,
    full: !!s.full,
    usedBytes: used,
    limitBytes: limit,
    usedText: known ? gibText(used) : '',
    limitText: known ? gibText(limit) : '',
    pct: known ? Math.min(100, Math.round((used / limit) * 100)) : null,
  }
}

const HM = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')

/** ISO 时间 → 「今天 12:40」／「昨天 12:40」／「11月15日 12:40」；认不出回空串。 */
export function formatWhen(iso, now = Date.now()) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const n = new Date(now)
  if (d.toDateString() === n.toDateString()) return '今天 ' + HM(d)
  const y = new Date(n)
  y.setDate(y.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return '昨天 ' + HM(d)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + HM(d)
}

export function statusLabel(status, { queuePosition = null } = {}) {
  const st = String(status || '')
  if (st === 'pending') return queuePosition ? '排队中 · 第 ' + queuePosition + ' 位' : '排队中'
  if (st === 'running') return '生成中'
  if (st === 'done') return '已完成'
  if (st === 'failed') return '失败'
  return '未完成'
}

/**
 * 合并最近任务。
 * @param {Array<{bookId,bookTitle,chapterIds?,data}>} statuses 每本书的归一 status
 * @returns 行：{bookId,bookTitle,chapterId,chapterNo,status,label,at,atText,ts,canRetry,error}
 */
export function recentTasks(statuses, { now = Date.now(), limit = RECENT_TASK_LIMIT } = {}) {
  const rows = []
  for (const s of Array.isArray(statuses) ? statuses : []) {
    const data = s && s.data
    if (!data || !data.chapters) continue
    const pos = data.queue && Number.isFinite(data.queue.position) ? data.queue.position : null
    const order = Array.isArray(s.chapterIds) ? s.chapterIds.map(String) : []
    for (const [id, ch] of Object.entries(data.chapters)) {
      const st = String((ch && ch.status) || '')
      if (st !== 'pending' && st !== 'running' && st !== 'done' && st !== 'failed') continue
      const at = (ch && (ch.finishedAt || ch.updatedAt)) || ''
      const ts = Date.parse(String(at || ''))
      if (!Number.isFinite(ts)) continue
      const idx = order.indexOf(String(id))
      rows.push({
        bookId: s.bookId,
        bookTitle: s.bookTitle || '',
        chapterId: String(id),
        chapterNo: idx >= 0 ? idx + 1 : null,
        status: st,
        label: statusLabel(st, { queuePosition: st === 'pending' ? pos : null }),
        at,
        atText: formatWhen(at, now),
        ts,
        canRetry: st === 'failed',
        error: (ch && ch.error) ? String(ch.error) : ''
      })
    }
  }
  rows.sort((a, b) => b.ts - a.ts)
  return rows.slice(0, Math.max(0, limit))
}

/** 任务行标题：《书名》第 N 章；没有章号就只写书名。 */
export function taskTitle(row) {
  const r = row || {}
  const book = r.bookTitle ? '《' + r.bookTitle + '》' : ''
  const ch = Number.isInteger(r.chapterNo) ? '第 ' + r.chapterNo + ' 章' : ''
  return book + ch
}
