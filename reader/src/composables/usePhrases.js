/**
 * 短语词典单例（module-level reactive，跨视图共享，仿 useVocabulary 模式）。
 * 数据源 public/data/phrases.json（构建时已展开屈折变形，运行时零变形计算）。
 * 加载失败静默降级：loaded 保持 false，阅读页只显示绿点线，测验的 Phrases 来源禁用。
 */

import { reactive, computed } from 'vue'
import {
  resolvePhraseSense,
  sentenceForToken,
  buildMatchIndex,
  scanParagraphText
} from '../utils/phraseSolve.js'

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
      const built = buildMatchIndex(data)
      matchIndex = built.matchIndex
      maxPhraseWords = built.maxPhraseWords
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

/**
 * 扫描段落，返回词组高亮范围。
 * @param {string} text 段落原文
 * 命中即标：不再要求成分词已收藏（2026-10-10 Ferrari 裁「A」）
 * @returns {{start:number, end:number, base:string, defs:string[]}[]}
 *   start/end 为 split(/(\s+)/) 产生的 token 数组下标（含空白 token，与 ReaderView 渲染对齐）
 */
function scanParagraph(text) {
  if (!state.loaded) return []
  return scanParagraphText(text, matchIndex, maxPhraseWords)
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
    resolvePhraseSense,
    sentenceForToken,
    /** 直接按短语文本查条目（WordPopup 词组信息行用） */
    get: (phrase) => state.entries[phrase] || null
  }
}

export { resolvePhraseSense, sentenceForToken }
