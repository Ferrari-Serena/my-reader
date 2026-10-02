/**
 * 跨设备数据同步单例（module-level reactive，仿 useVocabulary）。
 *
 * 同步码存储在 localStorage key 'reader-sync-code'。
 * 所有网络操作异步、超时 8s、失败静默——离线/弱网不影响本地使用。
 *
 * 冲突策略与服务端 worker/src/sync.js 对齐：每个词一条时间轴，last-write-wins。
 * 删除不推「删除」，推的是墓碑（见 storage/localAdapter.js 的删除台账）。
 *
 * 推送为什么是「先拉后推 + 只推脏词」：
 *   服务端会拒收时间戳不占优的写入。若客户端只推不拉，它永远看不到别的设备的更新，
 *   也永远不知道自己的写入被拒了——两边就此永久分叉。所以每次推送前先合并一次远程状态，
 *   拿到拒收回执后再拉一次收敛。
 *   只推脏词是因为原来每答一道题就推一次**全量**词表，词表上千时那是上千条 upsert。
 */

import { reactive, computed } from 'vue'
import { useVocabulary } from './useVocabulary.js'
import { planMerge } from '../sync/merge.js'
import { syncClock } from '../sync/clock.js'
import { collectLocalProgress, applyRemoteProgress } from '../sync/progress.js'

const SYNC_BASE = 'https://www.ferrari11.com/api/sync'
const SYNC_CODE_KEY = 'reader-sync-code'
const TIMEOUT = 8000
const PUSH_DEBOUNCE_MS = 1500 // 尾随防抖：答题连点不再是一次一推

const state = reactive({
  code: '',        // 当前同步码（从 localStorage 恢复）
  paired: false,   // 是否已与远程配对（成功拉取/推送过一次）
  pushing: false,
  pulling: false,
  lastSync: null,  // Date
  error: '',
  rejected: 0,     // 上次推送被服务端拒收的条数（0 表示本地都是最新的）
  progressRev: 0   // 远程进度写回本地的次数（阅读页据此判断要不要跟随过去）
})

// 恢复持久化的同步码
try { state.code = localStorage.getItem(SYNC_CODE_KEY) || '' } catch { state.code = '' }

let _autoPulled = false
let _pushTimer = null
let _inFlight = false      // 推送防重入
let _flushAgain = false    // 推送进行中又来了新变更
let _flushKeepalive = false // 那次补推是页面卸载触发的（不能靠定时器续跑）

async function storage() {
  return import('../storage/index.js')
}

async function apiFetch(path, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${SYNC_BASE}${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    const data = await res.json()
    // 顺手校准本地时钟：服务端按时间戳判新旧，本地钟慢了会把自己的新编辑推成「旧的」
    if (data && data.serverNow) syncClock(data.serverNow)
    return data
  } finally {
    clearTimeout(timer)
  }
}

/** 远程状态合并进本地。remoteWords 与 remoteTombstones 必须分开传——见 merge.js 的说明 */
export async function mergeAndApply(vocab, remoteWords, remoteTombstones) {
  const st = await storage()
  // 第四个参数是本地未推出去的删除台账：远程存活写不得覆盖一条更新的本地删除
  const plan = planMerge(vocab.words.value, remoteWords, remoteTombstones, st.loadTombstones())

  for (const { word, entry } of plan.apply) {
    await st.addWord(entry) // 内部 sanitizeEntry 并落盘
    // 响应式状态里也要放**净化后**的那份，否则内存与磁盘口径分叉
    const doc = await st.loadVocabulary()
    if (doc.words[word]) vocab.words.value[word] = doc.words[word]
  }

  for (const word of plan.remove) {
    // record:false —— 这个删除服务端已经有了，本地不必再记台账（记了反而会被拒收）
    await st.removeWord(word, { record: false })
    delete vocab.words.value[word]
  }
  if (plan.remove.length) st.clearTombstones(plan.remove)

  // 本地这次收藏晚于远程的删除 → 用户删过又加回来了，回推复活
  if (plan.repush.length) {
    st.clearTombstones(plan.repush)
    vocab.markDirty(...plan.repush)
  }

  return plan
}

/** 拉取 + 合并。返回是否成功（供 autoPullOnce 决定要不要重试） */
async function pullOnce() {
  if (!state.code) return false
  state.pulling = true
  try {
    const data = await apiFetch(`/pull?code=${state.code}`)
    if (!data) return false
    const vocab = useVocabulary()
    await vocab.init()
    const plan = await mergeAndApply(vocab, data.words || {}, data.tombstones || {})
    if (applyRemoteProgress(data.progress || {}).length) state.progressRev++
    state.lastSync = new Date()
    state.paired = true
    state.error = ''
    if (plan.repush.length) pushSoon()
    return true
  } catch (e) {
    if (e.status === 404) {
      state.error = '同步码已失效，请重新配对'
      state.paired = false
    }
    return false // 其余静默——离线/弱网时本地数据不受影响
  } finally {
    state.pulling = false
  }
}

async function pushNow(options = {}) {
  if (!state.code) return
  if (_inFlight) {
    _flushAgain = true
    // 记下这次是不是「页面正在消失」触发的：那种情况下没人再等定时器了
    if (options.keepalive) _flushKeepalive = true
    return
  }
  _inFlight = true
  state.pushing = true

  const vocab = useVocabulary()
  await vocab.init()
  const dirtyKeys = vocab.takeDirty()
  const st = await storage()
  let wordsPushed = false

  try {
    const words = {}
    for (const k of dirtyKeys) {
      const e = vocab.words.value[k]
      if (!e) continue
      // 只推有释义的词：空壳是离线收藏未自愈的，推上去也没用
      if (e.snapshot?.definitions?.length || e.srs) words[k] = e
    }
    // 与词表冲突的墓碑不发（同一次推送里一个词只能有一个状态）
    const tombstones = {}
    for (const [w, ts] of Object.entries(st.loadTombstones())) {
      if (!(w in words) && !vocab.words.value[w]) tombstones[w] = ts
    }

    const hasWords = Object.keys(words).length || Object.keys(tombstones).length

    if (hasWords) {
      const res = await apiFetch('/push', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify({ code: state.code, words, tombstones })
      })
      wordsPushed = true
      state.lastSync = new Date()
      state.paired = true
      state.rejected = res?.rejected || 0
      // 推送成功才清台账——失败时要留着，下次继续推
      if (Object.keys(tombstones).length) st.clearTombstones(Object.keys(tombstones))
      // 时间戳仍是旧的，说明服务端有更新的版本：本地这些词已被拒收，
      // 必须立刻拉一次把远程版本合并进来，否则本地会一直以为自己写成功了
      if (state.rejected > 0) await pullOnce()
    } else {
      state.rejected = 0
    }

    // 进度单独一个端点。它的拒收不触发重新拉取——进度是次要数据，
    // 为它多跑一轮拉取不划算，下次推送自然会带上更新的位置。
    const progress = collectLocalProgress()
    if (Object.keys(progress).length) {
      await apiFetch('/progress', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify({ code: state.code, entries: progress })
      })
      state.lastSync = new Date()
    }
  } catch (e) {
    // 推送失败：脏标记还回去，下次重推。
    // 词表已经推成功、只是进度那一步失败时不还——那会把时间戳平等的词再推一遍，
    // 服务端一律拒收，把 rejected 计数污染成假信号（它本该只表示「本地版本旧了」）。
    if (!wordsPushed && dirtyKeys.length) vocab.markDirty(...dirtyKeys)
    if (e.status === 404) {
      state.error = '同步码已失效，请重新配对'
      state.paired = false
    }
  } finally {
    _inFlight = false
    state.pushing = false
    if (_flushAgain) {
      _flushAgain = false
      const keepalive = _flushKeepalive
      _flushKeepalive = false
      // 卸载触发的补推不能再走定时器——页面已经在消失，0ms 的定时器根本不会执行，
      // 于是最后一次保存的阅读位置永远发不出去。直接续跑一次。
      if (keepalive) pushNow({ keepalive: true })
      else pushSoon(0)
    }
  }
}

/**
 * 手动「立即同步」：先拉（拿到远程状态并合并）再推。
 * 只拉不推的话，本机这次会话里的改动要等到下一次变异或防抖触发才会上去。
 */
async function syncNow() {
  await pullOnce()
  await pushNow()
}

/** 防抖安排一次推送 */
function pushSoon(delay = PUSH_DEBOUNCE_MS) {
  if (!state.code) return
  if (_pushTimer) clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => { _pushTimer = null; pushNow() }, delay)
}

/**
 * 立刻推送，不等防抖。页面要隐藏/卸载时用，配 keepalive 让请求在页面消失后仍能发出去——
 * 普通 fetch 在这里会被浏览器直接取消，退出时的进度就永远推不出去。
 */
function flushNow() {
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null }
  pushNow({ keepalive: true })
}

async function createCode() {
  state.error = ''
  try {
    const data = await apiFetch('/create', { method: 'POST' })
    state.code = data.code
    try { localStorage.setItem(SYNC_CODE_KEY, data.code) } catch { /* quota */ }
    // 新码下本机数据全是「远程没有的」，整体标脏推一次，别的设备配对时才有东西可拉
    const vocab = useVocabulary()
    await vocab.init()
    vocab.markAllDirty()
    pushSoon(0)
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
  // 拉取一次以校验码有效 + 获取已有数据。
  // 校验必须靠 HTTP 状态：未知码现在服务端回 404，
  // 以前回的是 200 + 空词表，于是打错一个字母会「配对成功」到一个幽灵码。
  try {
    const data = await apiFetch(`/pull?code=${clean}`)
    if (!data) { state.error = '同步码无效'; return false }
    state.code = clean
    try { localStorage.setItem(SYNC_CODE_KEY, clean) } catch { /* quota */ }
    const vocab = useVocabulary()
    await vocab.init()
    await mergeAndApply(vocab, data.words || {}, data.tombstones || {})
    if (applyRemoteProgress(data.progress || {}).length) state.progressRev++
    state.paired = true
    state.lastSync = new Date()
    // 本机已有的生词也要推到这个码上。它们从没被标脏过（标脏只发生在变异时），
    // 不推的话「配对」只是一次单向下载：A 的生词到了 B，B 的生词永远上不去。
    // 时间戳输的那批会被服务端拒收 → 触发一次重新拉取 → 收敛。
    vocab.markAllDirty()
    pushSoon(0)
    return true
  } catch (e) {
    if (e.status === 404) {
      state.error = '同步码不存在，请核对后重试'
      return false
    }
    state.error = '无法连接到服务器，检查网络后重试'
    return false
  }
}

/** 清除配对（换同步码或放弃同步） */
function unpair() {
  state.code = ''
  state.paired = false
  state.lastSync = null
  state.error = ''
  state.rejected = 0
  try { localStorage.removeItem(SYNC_CODE_KEY) } catch { /* ignore */ }
}

/**
 * 页面启动时自动拉取一次（已有配对码的情况下）。
 * 失败必须重置标志——原来在 fetch 之前就把标志置了真且失败不重置，
 * 一次离线冷启动会让整场会话都不同步。
 */
function autoPullOnce() {
  if (_autoPulled || !state.code) return
  _autoPulled = true
  pullOnce().then(ok => { if (!ok) _autoPulled = false })
}

// 页面隐藏/卸载时立刻把待推送的内容发出去（带 keepalive）
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}

export function useSync() {
  // 首次调用时触发自动拉取（页面启动 + 已有配对码）
  autoPullOnce()
  return {
    code: computed(() => state.code),
    paired: computed(() => state.paired),
    pushing: computed(() => state.pushing),
    pulling: computed(() => state.pulling),
    lastSync: computed(() => state.lastSync),
    error: computed(() => state.error),
    rejected: computed(() => state.rejected),
    progressRevision: computed(() => state.progressRev),
    createCode,
    pairCode,
    syncNow,
    push: pushNow,
    pushSoon,
    flushNow,
    pull: pullOnce,
    unpair
  }
}
