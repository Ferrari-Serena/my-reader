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

/**
 * 扫描段落，返回词组高亮范围。
 * @param {string} text 段落原文
 * @param {Set<string>} savedSet 已收藏词集合（小写 lemma）
 * @returns {{start:number, end:number, base:string, defs:string[]}[]}
 *   start/end 为 split(/(\s+)/) 产生的 token 数组下标（含空白 token，与 ReaderView 渲染对齐）
 */
function scanParagraph(text, savedSet) {
  if (!state.loaded || !savedSet?.size) return []

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
      // 至少一个成分词已被收藏（含短语动词的 base verb 命中）
      const containsSaved = slice.some(w => savedSet.has(w.clean))
        || (hit.entry.verb && savedSet.has(hit.entry.verb))
      if (!containsSaved) continue
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
