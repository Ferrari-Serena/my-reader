/**
 * 测验设置页的纯逻辑（不碰 DOM）：题量选项、题型过滤、生成量估算。
 * 题型是「生成后筛」：题库本身是混合的；要单一题型时先多要一些，再筛到目标题量。
 */

export const QUIZ_COUNT_OPTIONS = [10, 20, 'All']

export const QUIZ_TYPES = [
  { value: 'mixed', label: '混合' },
  { value: 'choice', label: '选择题' },
  { value: 'spelling', label: '拼写题' },
]

export function isChoiceQuestion(q) {
  return !!(q && Array.isArray(q.options) && q.options.length > 0)
}

/** mixed 原样返回；choice 只留有选项的；spelling 只留输入题。 */
export function filterQuestionsByType(questions, type) {
  const qs = Array.isArray(questions) ? questions : []
  if (!type || type === 'mixed') return qs
  if (type === 'choice') return qs.filter(isChoiceQuestion)
  if (type === 'spelling') return qs.filter((q) => !isChoiceQuestion(q))
  return qs
}

/**
 * 让生成器出多少题：
 *   · 全部 -> available
 *   · 混合 -> 目标题量（生成器按比例给两种题型）
 *   · 单一题型 -> 目标题量 ×3（筛掉另一种），封顶 available
 */
export function generationCount(count, type, available) {
  const cap = Number.isFinite(available) && available > 0 ? Math.floor(available) : 30
  if (count === 'All') return cap
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return 0
  const want = type === 'mixed' ? n : n * 3
  return Math.min(want, cap)
}
