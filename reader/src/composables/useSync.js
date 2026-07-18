/**
 * 跨设备数据同步单例（module-level reactive，仿 useVocabulary）。
 *
 * 同步码存储在 localStorage key 'reader-sync-code'。
 * 所有网络操作异步、超时 8s、失败静默——离线/弱网不影响本地使用。
 */

import { reactive, computed, ref } from 'vue'
import { useVocabulary } from './useVocabulary'

const SYNC_BASE = 'https://www.ferrari11.com/api/sync'
const SYNC_CODE_KEY = 'reader-sync-code'
const TIMEOUT = 8000

const state = reactive({
  code: '',        // 当前同步码（从 localStorage 恢复）
  paired: false,   // 是否已与远程配对（成功拉取/推送过一次）
  pushing: false,
  pulling: false,
  lastSync: null,  // Date
  error: ''
})

// 恢复持久化的同步码
try { state.code = localStorage.getItem(SYNC_CODE_KEY) || '' } catch { state.code = '' }

async function apiFetch(path, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${SYNC_BASE}${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function createCode() {
  state.error = ''
  try {
    const data = await apiFetch('/create', { method: 'POST' })
    state.code = data.code
    try { localStorage.setItem(SYNC_CODE_KEY, data.code) } catch { /* quota */ }
    return data.code
  } catch (e) {
    state.error = '创建同步码失败，请检查网络'
    return ''
  }
}

async function pairCode(code) {
  state.error = ''
  const clean = (code + '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (clean.length < 8) {
    state.error = '同步码应为 8 位字母数字'
    return false
  }
  // 拉取一次以校验码有效 + 获取已有数据
  try {
    const data = await apiFetch(`/pull?code=${clean}`)
    if (!data || !data.words) {
      state.error = '同步码无效'
      return false
    }
    state.code = clean
    try { localStorage.setItem(SYNC_CODE_KEY, clean) } catch { /* quota */ }
    // 合并远程数据到本地
    if (Object.keys(data.words).length) {
      const vocab = useVocabulary()
      await vocab.init()
      mergeAndApply(vocab, data.words)
    }
    state.paired = true
    state.lastSync = new Date()
    return true
  } catch (e) {
    state.error = '无法连接到服务器，检查网络后重试'
    return false
  }
}

async function push() {
  if (!state.code) return
  state.pushing = true
  try {
    const vocab = useVocabulary()
    await vocab.init()
    const words = { ...vocab.words.value }
    // 只推送有释义的词（空壳是离线收藏未自愈的，推到远程也无用）
    const toPush = {}
    for (const [w, e] of Object.entries(words)) {
      if (e.snapshot?.definitions?.length || e.srs) toPush[w] = e
    }
    if (!Object.keys(toPush).length) return
    await apiFetch('/push', {
      method: 'POST',
      body: JSON.stringify({ code: state.code, words: toPush })
    })
    state.lastSync = new Date()
    state.paired = true
  } catch { /* 离线/弱网静默 */ }
  finally { state.pushing = false }
}

async function pull() {
  if (!state.code) return
  state.pulling = true
  try {
    const data = await apiFetch(`/pull?code=${state.code}`)
    if (!data?.words) return
    const vocab = useVocabulary()
    await vocab.init()
    mergeAndApply(vocab, data.words)
    state.lastSync = new Date()
    state.paired = true
  } catch { /* 离线/弱网静默 */ }
  finally { state.pulling = false }
}

/** 合并策略：最后写入胜出。远程较新的覆盖本地；本地较新的保留。 */
function mergeAndApply(vocab, remoteWords) {
  for (const [word, remoteEntry] of Object.entries(remoteWords)) {
    if (word === '__meta__') continue
    const localEntry = vocab.words.value[word]
    const remoteTime = remoteEntry.addedAt || remoteEntry.updatedAt || ''
    const localTime = localEntry?.addedAt || localEntry?.updatedAt || ''
    if (!localEntry || remoteTime > localTime) {
      vocab.words.value[word] = remoteEntry
    }
  }
}

/** 清除配对（换同步码或放弃同步） */
function unpair() {
  state.code = ''
  state.paired = false
  state.lastSync = null
  state.error = ''
  try { localStorage.removeItem(SYNC_CODE_KEY) } catch { /* ignore */ }
}

export function useSync() {
  return {
    code: computed(() => state.code),
    paired: computed(() => state.paired),
    pushing: computed(() => state.pushing),
    pulling: computed(() => state.pulling),
    lastSync: computed(() => state.lastSync),
    error: computed(() => state.error),
    createCode,
    pairCode,
    push,
    pull,
    unpair
  }
}
