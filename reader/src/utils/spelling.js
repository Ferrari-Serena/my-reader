/**
 * 拼写比对工具（闪卡 + 测验填空题共用）。
 */

/** Levenshtein 距离 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * 逐字符差异标注
 * @returns {{ correct: boolean, distance: number, diff: { pos: number, got: string, expected: string }[] }}
 */
export function checkSpelling(userInput, correctWord) {
  const input = (userInput || '').trim()
  const correct = (correctWord || '').trim()
  if (!correct) return { correct: input === correct, distance: 0, diff: [] }

  const inputLower = input.toLowerCase()
  const correctLower = correct.toLowerCase()
  if (inputLower === correctLower) return { correct: true, distance: 0, diff: [] }

  const dist = levenshtein(inputLower, correctLower)
  const diff = []
  const maxLen = Math.max(inputLower.length, correctLower.length)

  for (let i = 0; i < maxLen; i++) {
    const got = inputLower[i] || ''
    const exp = correctLower[i] || ''
    if (got !== exp) {
      // 检查是否为交换相邻字母导致的差异（dist==1 且相邻位相反）
      const swapped = i + 1 < maxLen
        && inputLower[i] === correctLower[i + 1]
        && inputLower[i + 1] === correctLower[i]
      diff.push({ pos: i, got: input[i] || '', expected: correct[i] || '', swapped })
      if (swapped) i++ // 跳过下一个已处理的字符
    }
  }

  return { correct: false, distance: dist, diff }
}

/** 生成差异高亮的 HTML 片段（用于 v-html 展示） */
export function diffHtml(userInput, correctWord) {
  const { correct, diff } = checkSpelling(userInput, correctWord)
  if (correct) return `<span style="color:var(--success-color)">${correctWord}</span>`

  const chars = [...correctWord]
  const wrongPositions = new Set(diff.map(d => d.pos))
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    if (wrongPositions.has(i)) {
      out += `<mark style="background:#ff3b3033;color:var(--danger-color);border-radius:2px;padding:0 1px">${chars[i]}</mark>`
    } else {
      out += chars[i]
    }
  }
  return out
}
