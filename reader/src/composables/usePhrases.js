/**
 * 短语词典单例（module-level reactive，跨视图共享，仿 useVocabulary 模式）。
 * 数据源 public/data/phrases.json（构建时已展开屈折变形，运行时零变形计算）。
 * 加载失败静默降级：loaded 保持 false，阅读页只显示绿点线，测验的 Phrases 来源禁用。
 */

import { reactive, computed } from 'vue'

const state = reactive({
  loaded: false,
  loading: false,
  entries: {},     // 原始条目: basePhrase → { defs, pos, verb, particle, forms }
})

// 匹配索引：每个变形（含基本形） → { base, entry, wordCount }
// 非 reactive（只读大 Map，避免 proxy 开销）
let matchIndex = new Map()
let maxPhraseWords = 2

let initPromise = null

async function init() {
  if (state.loaded || initPromise) return initPromise
  state.loading = true
  initPromise = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/phrases.json`)
      if (!res.ok) throw new Error(`phrases.json ${res.status}`)
      const data = await res.json()
      const idx = new Map()
      for (const [base, entry] of Object.entries(data)) {
        const wc = base.split(' ').length
        if (wc > maxPhraseWords) maxPhraseWords = wc
        idx.set(base, { base, entry, wordCount: wc })
        for (const form of entry.forms || []) {
          const fwc = form.split(' ').length
          if (fwc > maxPhraseWords) maxPhraseWords = fwc
          idx.set(form, { base, entry, wordCount: fwc })
        }
      }
      matchIndex = idx
      state.entries = data
      state.loaded = true
    } catch {
      // 静默降级
    } finally {
      state.loading = false
    }
  })()
  return initPromise
}

const SENTENCE_END = /[.!?]$/

function cleanToken(tok) {
  return tok.replace(/^[^a-zA-Z]+|[^a-zA-Z']+$/g, '').toLowerCase()
}

function cueTier(cue) {
  if (!cue) return 'none'
  return cue.startsWith('^') ? 'low' : 'high'
}

/**
 * 用命中 token 所在的句子跑 L1（`cue` 正则），与 generator/l1_probe.py 同口径。
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
  const tokens = text.split(/(\s+)/)
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
 * 扫描段落，返回词组高亮范围。
 * @param {string} text 段落原文
 * 命中即标：不再要求成分词已收藏（2026-10-10 Ferrari 裁「A」）
 * @returns {{start:number, end:number, base:string, defs:string[]}[]}
 *   start/end 为 split(/(\s+)/) 产生的 token 数组下标（含空白 token，与 ReaderView 渲染对齐）
 */
function scanParagraph(text) {
  if (!state.loaded) return []

  const tokens = text.split(/(\s+)/)
  // 词 token 的下标与清洗后文本
  const words = []
  for (let i = 0; i < tokens.length; i++) {
    if (/\S/.test(tokens[i])) {
      words.push({ idx: i, clean: cleanToken(tokens[i]), raw: tokens[i] })
    }
  }

  const spans = []
  const claimed = new Set() // 已被更长匹配占用的词位置

  // 对每个词位置，尝试从它开始的 2..maxPhraseWords 词片段（先长后短 → 最长匹配优先）
  for (let wi = 0; wi < words.length; wi++) {
    if (claimed.has(wi)) continue
    for (let len = Math.min(maxPhraseWords, words.length - wi); len >= 2; len--) {
      const slice = words.slice(wi, wi + len)
      // 句内约束：片段中间不得有句末标点（最后一词允许）
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
      break // 该起点已取最长匹配
    }
  }
  return spans
}

/** 词组测验数据：转为数组形态 [{ phrase, defs, pos, verb, particle, forms }] */
const allPhrases = computed(() =>
  Object.entries(state.entries).map(([phrase, e]) => ({ phrase, ...e }))
)

export function usePhrases() {
  return {
    loaded: computed(() => state.loaded),
    loading: computed(() => state.loading),
    count: computed(() => Object.keys(state.entries).length),
    all: allPhrases,
    init,
    scanParagraph,
    /** 直接按短语文本查条目（WordPopup 词组信息行用） */
    get: (phrase) => state.entries[phrase] || null
  }
}
