/**
 * FSRS 调度纯函数模块（无 reactive，会话状态由视图持有）。
 * entry.srs 只存 JSON 序列化后的 ts-fsrs Card：日期字段是 ISO 字符串。
 * ts-fsrs 的 next() 对字符串日期容忍（已在 Node 验证），只有本地比较 due 时才 new Date()。
 */

import { fsrs, createEmptyCard, Rating, State } from 'ts-fsrs'

const f = fsrs()

export { Rating, State }

/** 新卡（可直接 JSON 存储：createEmptyCard 的 due 序列化为 ISO 字符串） */
export function createCard() {
  return JSON.parse(JSON.stringify(createEmptyCard()))
}

/**
 * 评分：rating 为 Rating.Again(1)/Hard(2)/Good(3)/Easy(4)。
 * 输入输出都是可 JSON 存储的普通对象。
 */
export function rate(srsCard, rating) {
  const { card } = f.next(srsCard, new Date(), rating)
  return JSON.parse(JSON.stringify(card))
}

/** 卡片是否到期（srs 为 null/损坏视为不到期，由调用方决定是否建新卡） */
export function isDue(srsCard, now = new Date()) {
  if (!srsCard?.due) return false
  return new Date(srsCard.due) <= now
}

/**
 * 从生词本 words（key → entry）取复习队列：
 * 到期卡（按 due 升序）在前 + 新卡（srs===null，按加入时间升序）在后，新卡每次最多 newLimit 张。
 * 只收录有释义的词（离线收藏未自愈的空快照词进不了队列，视图层负责提示）。
 */
export function buildQueue(words, { newLimit = 20 } = {}) {
  const now = new Date()
  const due = []
  const fresh = []
  for (const entry of Object.values(words)) {
    if (!entry.snapshot?.definitions?.length) continue
    if (entry.srs) {
      if (isDue(entry.srs, now)) due.push(entry)
    } else {
      fresh.push(entry)
    }
  }
  due.sort((a, b) => new Date(a.srs.due) - new Date(b.srs.due))
  fresh.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
  return { due, fresh: fresh.slice(0, newLimit) }
}

/** 下一张到期卡的时间（用于 nothing-due 状态展示）；无卡返回 null */
export function nextDueAt(words) {
  let min = null
  for (const entry of Object.values(words)) {
    if (!entry.srs?.due) continue
    const d = new Date(entry.srs.due)
    if (!min || d < min) min = d
  }
  return min
}
