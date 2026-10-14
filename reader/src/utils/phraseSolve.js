/**
 * 词组消歧纯函数（前端运行时与 Node 离线标注生成器共用）。
 *
 * 设计原则：
 * - 本模块不 import Vue / 浏览器 API，可在 Node 脚本中直接执行；
 * - 前端运行时仍以 L1 cue 为基准；有静态标注时优先用标注结果；
 * - 静态标注 = 离线预计算，未命中标注再回落到现有 L1，最后才由云端兜底。
 *
 * 标注记录形状：
 *   { chapterId, paragraphId, start, end, phrase, rank, source }
 * 其中 start/end 与 `scanParagraphText` 的 token 下标同口径。
 */

export const SENTENCE_END = /[.!?]$/

export function cleanToken(tok) {
  return String(tok || '')
    .replace(/^[^a-zA-Z]+|[^a-zA-Z']+$/g, '')
    .toLowerCase()
}

export function cueTier(cue) {
  if (!cue) return 'none'
  return cue.startsWith('^') ? 'low' : 'high'
}

/**
 * 用命中 token 所在句子跑 L1（`cue` 正则），与 generator/l1_probe.py 同口径。
 * 返回 `unique`（唯一显式 marker）/ `fallback`（唯一兜底，只排序、不打 ★）/
 * `multi`（≥2）/ `zero`（0）；空 cue 不命中。
 */
export function resolvePhraseSense(entry, sentence) {
  const senses = entry?.senses || []
  const hits = []
  for (const s of senses) {
    if (!s.cue) continue
    const tier = cueTier(s.cue)
    if (new RegExp(s.cue, 'i').test(sentence || '')) hits.push({ rank: s.rank, tier })
  }
  if (hits.length === 1) {
    return { state: hits[0].tier === 'high' ? 'unique' : 'fallback', rank: hits[0].rank, hits }
  }
  if (hits.length >= 2) return { state: 'multi', rank: null, hits }
  return { state: 'zero', rank: null, hits }
}

/**
 * 取 tokenIdx 所在的一句（tokenIdx 与模板里 `para.text.split(/(\s+)/)` 对齐）。
 * 句边界沿用 scanParagraph 的 SENTENCE_END。
 */
export function sentenceForToken(text, tokenIdx) {
  const tokens = String(text || '').split(/(\s+)/)
  let start = 0
  for (let i = tokenIdx - 1; i >= 0; i--) {
    if (/\S/.test(tokens[i]) && SENTENCE_END.test(tokens[i])) {
      start = i + 1
      break
    }
  }
  let end = tokens.length - 1
  for (let i = tokenIdx + 1; i < tokens.length; i++) {
    if (/\S/.test(tokens[i]) && SENTENCE_END.test(tokens[i])) {
      end = i
      break
    }
  }
  return tokens.slice(start, end + 1).join('').replace(/\s+/g, ' ').trim()
}

/**
 * 由 phrases 数据构建匹配索引。
 * @param {Record<string, object>} entries basePhrase -> entry
 * @returns {{matchIndex: Map<string, object>, maxPhraseWords: number}}
 */
export function buildMatchIndex(entries = {}) {
  const idx = new Map()
  let maxPhraseWords = 2
  for (const [base, entry] of Object.entries(entries)) {
    const wc = base.split(' ').length
    if (wc > maxPhraseWords) maxPhraseWords = wc
    idx.set(base, { base, entry, wordCount: wc })
    for (const form of entry.forms || []) {
      const fwc = form.split(' ').length
      if (fwc > maxPhraseWords) maxPhraseWords = fwc
      idx.set(form, { base, entry, wordCount: fwc })
    }
  }
  return { matchIndex: idx, maxPhraseWords }
}

/**
 * 扫描段落，返回词组高亮范围。纯函数版（与 usePhrases.scanParagraph 同口径）。
 * @param {string} text 段落原文
 * @param {Map<string, object>} matchIndex buildMatchIndex 产出的匹配表
 * @param {number} maxPhraseWords 最长短语词数
 * @returns {{start:number, end:number, base:string, defs:string[]}[]}
 */
export function scanParagraphText(text, matchIndex, maxPhraseWords = 2) {
  const tokens = String(text || '').split(/(\s+)/)
  const words = []
  for (let i = 0; i < tokens.length; i++) {
    if (/\S/.test(tokens[i])) {
      words.push({ idx: i, clean: cleanToken(tokens[i]), raw: tokens[i] })
    }
  }

  const spans = []
  const claimed = new Set()

  for (let wi = 0; wi < words.length; wi++) {
    if (claimed.has(wi)) continue
    for (let len = Math.min(maxPhraseWords, words.length - wi); len >= 2; len--) {
      const slice = words.slice(wi, wi + len)
      if (slice.slice(0, -1).some(w => SENTENCE_END.test(w.raw))) continue
      if (slice.some((w, k) => k > 0 && claimed.has(wi + k))) continue
      const key = slice.map(w => w.clean).filter(Boolean).join(' ')
      if (slice.some(w => !w.clean)) continue
      const hit = matchIndex.get(key)
      if (!hit) continue
      spans.push({
        start: slice[0].idx,
        end: slice[slice.length - 1].idx,
        base: hit.base,
        defs: hit.entry.defs || []
      })
      for (let k = 0; k < len; k++) claimed.add(wi + k)
      break
    }
  }
  return spans
}

/**
 * 静态标注查表 key。与前端段落 span 的 paragraphId/start/end 同口径。
 */
export function annotationKey(paragraphId, start, end) {
  return `${paragraphId}:${start}:${end}`
}

/**
 * 把离线标注数组建成 O(1) 查找表。
 * @param {Array<{paragraphId:string,start:number,end:number}>} annotations
 * @returns {Map<string, object>}
 */
export function buildAnnotationIndex(annotations = []) {
  const map = new Map()
  for (const a of annotations || []) {
    if (!a || !a.paragraphId || !Number.isInteger(a.start) || !Number.isInteger(a.end)) continue
    map.set(annotationKey(a.paragraphId, a.start, a.end), a)
  }
  return map
}

/**
 * 优先静态标注，未命中回落到 L1 cue。
 * @param {object} entry phrases 条目
 * @param {string} sentence 命中短语所在句
 * @param {object} [annotation] 静态标注记录（含 rank）
 * @returns {object} 与 resolvePhraseSense 同形的 resolution
 */
export function resolvePhraseSenseWithAnnotation(entry, sentence, annotation) {
  const senses = entry?.senses || []
  const rank = annotation?.rank
  if (Number.isInteger(rank) && senses.some(s => s.rank === rank)) {
    return { state: 'annotated', rank, hits: [{ rank, tier: 'annotated' }] }
  }
  return resolvePhraseSense(entry, sentence)
}
