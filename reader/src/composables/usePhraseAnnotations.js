/**
 * 静态词组消歧标注加载器。
 *
 * 数据源 `public/data/phrase-annotations/<bookId>.json`：
 * - 内置书（slug）与 BYO 书（bk_ 指纹）同路径；
 * - 文件不存在时静默降级，阅读页继续走 L1 cue；
 * - 标注只覆盖离线预计算过的书/章节，不强制每本书都要有。
 */

import { reactive, computed } from 'vue'
import { annotationKey, buildAnnotationIndex } from '../utils/phraseSolve.js'

const state = reactive({
  bookId: '',
  loaded: false,
  loading: false,
  missing: false,
})

let annotationMap = new Map()
let loadedBookId = ''
let loadPromise = null

async function load(bookId) {
  const id = String(bookId || '')
  if (!id) return null
  if (loadedBookId === id && state.loaded) return annotationMap
  if (loadPromise && state.bookId === id) return loadPromise

  state.bookId = id
  state.loading = true
  state.loaded = false
  state.missing = false

  loadPromise = (async () => {
    try {
      const url = `${import.meta.env.BASE_URL}data/phrase-annotations/${encodeURIComponent(id)}.json`
      const res = await fetch(url)
      if (!res.ok) {
        state.missing = true
        annotationMap = new Map()
        loadedBookId = id
        return annotationMap
      }
      const data = await res.json()
      annotationMap = buildAnnotationIndex(data.annotations || data || [])
      loadedBookId = id
      state.missing = false
      return annotationMap
    } catch {
      state.missing = true
      annotationMap = new Map()
      loadedBookId = id
      return annotationMap
    } finally {
      state.loaded = true
      state.loading = false
    }
  })()

  return loadPromise
}

function get(paragraphId, start, end) {
  return annotationMap.get(annotationKey(paragraphId, start, end)) || null
}

export function usePhraseAnnotations() {
  return {
    loaded: computed(() => state.loaded),
    loading: computed(() => state.loading),
    missing: computed(() => state.missing),
    load,
    get,
  }
}
