/**
 * 复习页的展示纯逻辑（不碰 DOM / 反应式）。
 * 「今日已复习」按 FSRS 的 last_review 落在本地今天来数——不另建计数器，
 * 也不编「每日目标 30」这类产品方案里没有的数字。
 */
export const REVIEW_SECONDS_PER_CARD = 12

const pad = (n) => String(n).padStart(2, '0')

export function localDayKey(iso, now = Date.now()) {
  const t = Date.parse(String(iso || ''))
  const d = new Date(Number.isFinite(t) ? t : now)
  if (!Number.isFinite(d.getTime())) return ''
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function isReviewedToday(iso, now = Date.now()) {
  if (!iso) return false
  return localDayKey(iso, now) === localDayKey(new Date(now).toISOString(), now)
}

/** items：review.js 产出的 review item（含 srs）；没有 last_review 的不计。 */
export function dailyReviewedCount(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.srs && isReviewedToday(it.srs.last_review, now)).length
}

/** 队列估算：每张 12 秒，向上取整到分钟；0 张回 0。 */
export function estimateMinutes(count, secondsPerCard = REVIEW_SECONDS_PER_CARD) {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(1, Math.ceil((n * secondsPerCard) / 60))
}

export function estimateText(count, secondsPerCard = REVIEW_SECONDS_PER_CARD) {
  const m = estimateMinutes(count, secondsPerCard)
  return m ? '约 ' + m + ' 分钟' : '—'
}

/** 来源：队列里有词组卡（测验错题／词组收藏）就并列写出，不冒充全是手动收藏。 */
export function queueSourceText(items) {
  const hasPhrase = (Array.isArray(items) ? items : []).some((it) => it && it.refKind === 'phrase')
  return hasPhrase ? '生词本 ＋ 测验错题' : '生词本手动收藏'
}
