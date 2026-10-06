/**
 * 跨设备数据同步单例（module-level reactive，仿 useVocabulary）。
 *
 * 租户码缓存在 localStorage key 'reader-sync-code'（D16 起**只是离线缓存** —— 客户端不再传码：
 * push／pull／progress 的租户一律由服务端按会话反推 `users.sync_code`；未登录 401、账号没主码 403）。
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

import { reactive, computed, watch } from 'vue'
import { useVocabulary } from './useVocabulary.js'
import { planMerge } from '../sync/merge.js'
import { syncClock } from '../sync/clock.js'
import { collectLocalProgress, applyRemoteProgress } from '../sync/progress.js'
import { budgetKeepaliveParts } from '../sync/budget.js'
import { nextRetryDelay, RETRY_BASE_MS } from '../sync/retry.js'
import { planRecordMerge, splitRecordKey } from '../sync/records.js'
import * as recordStore from '../sync/recordStore.js'
import { loadPendingPublish, reconcileBooksNow } from '../sync/bookSync.js'

const SYNC_BASE = '/api/sync'
const SYNC_CODE_KEY = 'reader-sync-code'
const CODE_LEN = 8
const TIMEOUT = 8000
const PUSH_DEBOUNCE_MS = 1500 // 尾随防抖：答题连点不再是一次一推
const KEEPALIVE_RETRY_MS = 1500 // keepalive 载荷被裁后的补发间隔

const state = reactive({
  code: '',        // 当前同步码（从 localStorage 恢复）
  paired: false,   // 是否已与账号同步过（成功拉取/推送过一次）
  pushing: false,
  pulling: false,
  lastSync: null,  // Date
  error: '',
  rejected: 0,     // 上次推送被服务端拒收的条数（0 表示本地都是最新的）
  progressRev: 0,  // 远程进度写回本地的次数（阅读页据此判断要不要跟随过去）
  recordRev: 0,    // 远程记录（笔记/错题/卡片/设置）写回本地的次数（阅读设置据此重读）
  pending: 0,      // 待上传条数（脏词 + 脏记录 + 未确认的删除台账；M2 · 4.4）
  conflicts: []    // 最近的同步事件（被远端覆盖 / 被远端删除 / 回推合并），面板可查
})

// 恢复持久化的同步码
try { state.code = localStorage.getItem(SYNC_CODE_KEY) || '' } catch { state.code = '' }

// ── 同步事件小账本（M2 · 4.4「冲突记录可查」）──
// 只留最近 MAX_CONFLICTS 条；持久化，关页也不丢（否则「昨天被谁覆盖了」永远查不到）。
const CONFLICTS_KEY = 'reader-sync-conflicts'
const MAX_CONFLICTS = 20
try {
  const raw = localStorage.getItem(CONFLICTS_KEY)
  const arr = raw ? JSON.parse(raw) : null
  if (Array.isArray(arr)) state.conflicts = arr.filter(e => e && typeof e === 'object').slice(0, MAX_CONFLICTS)
} catch { state.conflicts = [] }

function pushConflict(entry) {
  state.conflicts = [{ at: new Date().toISOString(), ...entry }, ...state.conflicts].slice(0, MAX_CONFLICTS)
  try { localStorage.setItem(CONFLICTS_KEY, JSON.stringify(state.conflicts)) } catch { /* quota */ }
}

/** 清空事件账本（面板上的「Clear」） */
function clearConflicts() {
  state.conflicts = []
  try { localStorage.removeItem(CONFLICTS_KEY) } catch { /* ignore */ }
}

let _autoPulled = false
let _pushTimer = null
let _inFlight = false      // 推送防重入
let _flushAgain = false    // 推送进行中又来了新变更
let _flushKeepalive = false // 那次补推是页面卸载触发的（不能靠定时器续跑）
let _retryDelay = RETRY_BASE_MS // 离线补推的下次等待（M3 · 4.5）；推送成功即复位

async function storage() {
  return import('../storage/index.js')
}

/**
 * 重算「待上传」条数（M2 · 4.4 同步可见）。
 * 四个来源：脏词（生词/评分/答题改了还没推）、脏记录（五类记录通道 —— **含 BYO 书的元信息**）、
 * 删除台账（本机删了、还没被服务端确认）、**书体上传台账**（第 16.5 步块 4：正文 8 MB 走的是
 * 另一条路，PUT 失败/当时没登录的那几本记在 `reader-books-to-publish`，原来不计，
 * 于是「All changes uploaded ✓」会在书没上去时撒谎）。全是**读盘**、不是响应式状态，所以由
 * vocab.dirtyRevision 的 watcher ＋ 每次推送/拉取结束显式触发重算。
 */
async function refreshPending() {
  const vocab = useVocabulary()
  vocab.dirtyRevision.value // 建立响应式依赖：脏集合一变，watcher 就会重算
  let tombs = 0
  try {
    const st = await storage()
    tombs = Object.keys(st.loadTombstones()).length
  } catch { /* 存储不可用（私有模式）时按 0 算 */ }
  const words = vocab.pendingDirty().filter(k => vocab.words.value[k]).length
  const recDirty = recordStore.loadRecordDirty().filter(k => recordStore.loadRecordsMap()[k]).length
  const recTombs = Object.keys(recordStore.loadRecordTombstones()).length
  const books = loadPendingPublish().length
  state.pending = words + recDirty + tombs + recTombs + books
}

/** fire-and-forget 版：UI 计数不值得让调用方等它 */
function scheduleRefreshPending() {
  refreshPending().catch(() => { /* 计数失败不影响同步本身 */ })
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

  // 批量落盘：一次 persist 而不是每条一次（逐条会把整张词表反复 JSON.stringify，合起来是 O(N²)）。
  // 响应式状态放的是**净化后**的那份，否则内存与磁盘口径分叉。
  const applied = await st.addWords(plan.apply.map(p => p.entry))
  for (const [word, entry] of Object.entries(applied)) vocab.words.value[word] = entry

  if (plan.remove.length) {
    // record:false —— 这个删除服务端已经有了，本地不必再记台账（记了反而会被拒收）
    await st.removeWords(plan.remove, { record: false })
    for (const word of plan.remove) delete vocab.words.value[word]
    st.clearTombstones(plan.remove)
  }

  // 本地这次收藏晚于远程的删除 → 用户删过又加回来了，回推复活
  if (plan.repush.length) {
    st.clearTombstones(plan.repush)
    vocab.markDirty(...plan.repush)
  }

  return plan
}

/**
 * 记录通道的「远程 -> 本地」合并（与 mergeAndApply 同姿态，键换成 '<kind>:<id>'）。
 * 存储层是无状态的，故同步即可。返回 plan 供调用方决定要不要回推。
 */
function mergeRecords(remoteRecords, remoteTombstones) {
  const plan = planRecordMerge(
    recordStore.loadRecordsMap(),
    remoteRecords || [],
    remoteTombstones || [],
    recordStore.loadRecordTombstones()
  )
  if (plan.apply.length) {
    recordStore.addRecords(plan.apply.map(a => ({ kind: a.kind, id: a.id, payload: a.payload })))
  }
  if (plan.remove.length) {
    // record:false —— 这个删除服务端已经有了，本地不必再记台账（记了反而会被拒收）
    recordStore.removeRecords(plan.remove, { record: false, dirty: false })
    recordStore.clearRecordTombstones(plan.remove)
  }
  if (plan.repush.length) {
    recordStore.clearRecordTombstones(plan.repush)
    recordStore.markRecordDirty(plan.repush)
  }
  // 远程真动了本地记录表才自增（合并空转时不惊动订阅方）
  if (plan.apply.length || plan.remove.length) state.recordRev++
  return plan
}

/** 把所有本地记录整体标脏（登录认领 / 换租户缓存时用，与 vocab.markAllDirty 对称） */
function markAllRecordsDirty() {
  const keys = Object.keys(recordStore.loadRecordsMap())
  if (keys.length) recordStore.markRecordDirty(keys)
}

/** 拉取 + 合并。返回是否成功（供 autoPullOnce 决定要不要重试） */
async function pullOnce() {
  if (!state.code) return false
  state.pulling = true
  try {
    const data = await apiFetch('/pull')
    if (!data) return false
    const vocab = useVocabulary()
    await vocab.init()
    const plan = await mergeAndApply(vocab, data.words || {}, data.tombstones || {})
    const rplan = mergeRecords(data.records, data.recordTombstones)
    if (applyRemoteProgress(data.progress || {}).length) state.progressRev++
    state.lastSync = new Date()
    state.paired = true
    state.error = ''
    // 4.4：把「这次拉取发生的冲突」记一笔，面板上可查
    const removed = plan.remove.length + rplan.remove.length
    const repushed = plan.repush.length + rplan.repush.length
    if (removed) pushConflict({ kind: 'remote-delete', n: removed })
    if (repushed) pushConflict({ kind: 'repush', n: repushed })
    scheduleRefreshPending()
    if (plan.repush.length || rplan.repush.length) pushSoon()
    return true
  } catch (e) {
    // D16（第 16.5 步）：租户改由会话反推 —— 401（没会话）/403（账号还没认领主码）都只是
    // 「登录还没就位」的一瞬，按**安静重试**处理：不写 state.error、不弹红字；脏集合留在盘上，
    // 登录认领（sync/tenant.js）或下一次冷启动自愈。
    // 服务端不再按「未知码」回 404（会话路径上哨兵行自带创建），原 404 分支随 D16 撤掉。
    return false
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
  // 只读不取走：清账要等推送成功（clearDirty），否则关页打断推送时欠推记录会连盘一起丢
  const dirtyKeys = vocab.pendingDirty()
  const st = await storage()
  // 本次成功推出去的脏词；失败/未完成时保持 null，脏集合原样留在盘上，下次继续推
  let doneKeys = null
  let droppedSet = null

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

    // 记录通道（笔记/错题/卡片/设置）：脏记录 + 待推墓碑。
    // keepalive 那条路径不带记录 —— budget.js 只建模了词/墓碑/进度，且记录的生产者
    // （笔记/错题/卡片 UI）尚未落地；脏集合已持久化，下次普通推送自会补上。
    const pushRecords = []
    const pushRecordTombs = []
    if (!options.keepalive) {
      const recMap = recordStore.loadRecordsMap()
      for (const key of recordStore.loadRecordDirty()) {
        const payload = recMap[key]
        const sp = splitRecordKey(key)
        if (payload && sp) pushRecords.push({ kind: sp.kind, id: sp.id, payload })
      }
      for (const [key, ts] of Object.entries(recordStore.loadRecordTombstones())) {
        if (recMap[key]) continue // 同一次推送里一个键只能有一个状态
        const sp = splitRecordKey(key)
        if (sp) pushRecordTombs.push({ kind: sp.kind, id: sp.id, deletedAt: ts })
      }
    }

    // keepalive 的请求体总量上限 64 KiB（超了浏览器**整条丢弃**，一条都推不出去）。
    // 页面卸载时的那次推送正好走 keepalive，所以先按优先级裁到预算内再发（见 sync/budget.js）。
    const progress = collectLocalProgress()
    let pushWords = words
    let pushTombs = tombstones
    let pushProgress = progress
    if (options.keepalive) {
      const b = budgetKeepaliveParts({ words, tombstones, progress })
      pushWords = b.words
      pushTombs = b.tombstones
      pushProgress = b.progress
      // 被裁掉的词仍在脏集合里（pendingDirty 不删盘），落账时要排除，否则一次裁剪就把
      // 「没发出去」的词当成已推清掉，编辑照样丢。另外安排一次普通推送补发，
      // 页面只是切到后台（visibilitychange）时它会真的执行。
      if (b.droppedWords.length) {
        droppedSet = new Set(b.droppedWords)
        pushSoon(KEEPALIVE_RETRY_MS)
      }
    }

    const hasWords = Object.keys(pushWords).length || Object.keys(pushTombs).length
    const hasRecords = pushRecords.length || pushRecordTombs.length

    if (hasWords || hasRecords) {
      const body = { words: pushWords, tombstones: pushTombs }
      if (pushRecords.length) body.records = pushRecords
      if (pushRecordTombs.length) body.recordTombstones = pushRecordTombs
      const res = await apiFetch('/push', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify(body)
      })
      state.lastSync = new Date()
      state.paired = true
      _retryDelay = RETRY_BASE_MS // 推到服务端了 → 退避复位
      state.rejected = res?.rejected || 0
      if (state.rejected > 0) pushConflict({ kind: 'rejected', n: state.rejected })
      // 推送成功才清账——失败时脏集合原样留在盘上，下次继续推；被 keepalive 裁掉的排除在外
      doneKeys = dirtyKeys.filter(k => !(droppedSet && droppedSet.has(k)))
      // 推送成功才清台账——失败时要留着，下次继续推
      if (Object.keys(pushTombs).length) st.clearTombstones(Object.keys(pushTombs))
      // 记录通道同理：成功才清脏、才清墓碑
      if (pushRecords.length) recordStore.clearRecordDirty(pushRecords.map(r => r.kind + ':' + r.id))
      if (pushRecordTombs.length) {
        const doneTombKeys = pushRecordTombs.map(t => t.kind + ':' + t.id)
        recordStore.clearRecordTombstones(doneTombKeys)
        recordStore.clearRecordDirty(doneTombKeys)
      }
      // 时间戳仍是旧的，说明服务端有更新的版本：本地这些词/记录已被拒收，
      // 必须立刻拉一次把远程版本合并进来，否则本地会一直以为自己写成功了
      if (state.rejected > 0) await pullOnce()
    } else {
      // 没有任何可推内容（空壳词/已删词）：这些脏词不再挂账，否则每次冷启动都空推一轮
      doneKeys = dirtyKeys
      state.rejected = 0
      // 只清「既无本体、也无墓碑」的真·空键；keepalive 路径本就跳过记录，
      // 若照单全清会把「有改动但本次没发」的记录脏键抹掉 —— 那次编辑就永远上不去了。
      const recMap = recordStore.loadRecordsMap()
      const recTombs = recordStore.loadRecordTombstones()
      const staleRecords = recordStore.loadRecordDirty().filter(k => !recMap[k] && !recTombs[k])
      if (staleRecords.length) recordStore.clearRecordDirty(staleRecords)
    }

    // 进度单独一个端点。它的拒收不触发重新拉取——进度是次要数据，
    // 为它多跑一轮拉取不划算，下次推送自然会带上更新的位置。
    if (Object.keys(pushProgress).length) {
      await apiFetch('/progress', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify({ entries: pushProgress })
      })
      state.lastSync = new Date()
    }
  } catch (e) {
    // 推送失败：脏集合原样留在内存与盘上（pendingDirty 从不删盘），下次重推，无需「还」。
    // 词表已推成功、只是进度那一步失败时 doneKeys 已设好，finally 正常落账即可——
    // 把时间戳平等的词再推一遍会被服务端一律拒收，把 rejected 计数污染成假信号
    // （它本该只表示「本地版本旧了」）。
    // D16：401（没会话）/403（账号还没认领主码）＝「登录还没就位」，落进下面的有界退避
    // **安静重试**，不当错误（不写 state.error）。服务端不再按未知码回 404，404 分支已撤。
    if (state.code) {
      // 4.5 离线队列：网络/5xx 失败不是终点 —— 排一次**有界退避**重试。
      // 已知离线（navigator.onLine === false）时只等 'online' 事件，不空转定时器。
      if (!(typeof navigator !== 'undefined' && navigator.onLine === false)) {
        pushSoon(_retryDelay)
        _retryDelay = nextRetryDelay(_retryDelay)
      }
    }
  } finally {
    _inFlight = false
    state.pushing = false
    // 只有拿到「推送成功」这一事实才落账；页面在推送途中被销毁时这里根本不会执行，
    // 脏词因此留在盘上，留给下次冷启动补推（这正是 0.1 要修的场景）
    if (doneKeys) vocab.clearDirty(doneKeys)
    scheduleRefreshPending()
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
 * 手动「立即同步」：先拉（拿到远程状态并合并）再推，最后**对一次书**。
 * 只拉不推的话，本机这次会话里的改动要等到下一次变异或防抖触发才会上去。
 * 书体走的是另一条路（R2，见 sync/bookSync.js）—— pull 只搬「账号里有这本书」的元信息，
 * 正文得靠对账里的预取去拉。第 16.6 步之前这一步不在，「点 Sync 后新书自动上架」就看运气：
 * 那一趟对账要是正好在飞（书架刚打开 / 上一趟还在收尾），新书就永远轮不到。
 */
async function syncNow() {
  await pullOnce()
  await pushNow()
  await reconcileBooksNow().catch(() => { /* 书体那半趟失败不该弹给用户：脏集合留在盘上，下次自愈 */ })
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

/**
 * 第 16.5 步 D16：`createCode`（铸码）／`pairCode`（输码配对）／`unpair`（解绑）**整体退场** ——
 * 同步码不再由设备铸、也不再是用户手里的配对凭据（配对凭据退场，分区键改由服务端读
 * `users.sync_code`）。铸码现在只发生在**首次登录认领**（`/api/auth/claim`，见 worker 的
 * `handleClaim`），本机对应动作是下面的 `adoptCode`。停止同步 ＝ 登出账号，不再需要解绑。
 */

/**
 * 页面启动时自动拉取一次（本机已有缓存租户码的情况下）。
 * 失败必须重置标志——原来在 fetch 之前就把标志置了真且失败不重置，
 * 一次离线冷启动会让整场会话都不同步。
 */
function autoPullOnce() {
  if (_autoPulled || !state.code) return
  _autoPulled = true
  pullOnce().then(ok => {
    if (!ok) { _autoPulled = false; return }
    // 0.1：拉完再补推一次「上次没推出去的脏词」（集合已持久化在 localStorage）。
    // 不补推的话，页面重开后没有任何变异 → 不会触发 pushSoon → 那次编辑永远上不去。
    // 离线冷启动时这里不会执行（pullOnce 失败），脏词留在盘上等下一次推送自愈。
    const vocab = useVocabulary()
    if (vocab.pendingDirty().length || recordStore.loadRecordDirty().length) pushSoon(0)
  })
}

// 页面隐藏/卸载时立刻把待推送的内容发出去（带 keepalive）
// 脏集合一变（生词本增删改 / 答题 / 评分）就重算待上传数
if (typeof window !== 'undefined') {
  watch(() => useVocabulary().dirtyRevision.value, () => scheduleRefreshPending())
  scheduleRefreshPending()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  // 4.5 离线队列：网络一恢复就把断网期间攒下的改动补推一次（不等下次变异）
  window.addEventListener('online', () => {
    scheduleRefreshPending()
    pushSoon(0)
  })
}

/**
 * 把本机缓存的租户码对齐到账号主码（登录认领 / 接管后由 sync/tenant.js 调）。
 *
 * D16 起本机这份码**只是缓存**（权威在服务端的 `users.sync_code`，客户端永不传码）。
 * 两件事，顺序有讲究：
 *   1) 换缓存 ＋ 本机词表整体标脏：本机生词是**一份全局词表**（不按码分家），
 *      换键后它在服务端属于「新码下还没有的」。不标脏就不会被推上去，
 *      账号那边也就永远看不到这台机器上攒的内容。
 *   2) 先拉后推（与 pullOnce/pushNow 既有姿态一致）：先把新键已有的内容合并进来，
 *      再让本机内容按时间戳去竞争，避免本机旧值把账号里的新值盖掉。
 *
 * 不再留「旧码备份位」（`reader-sync-code-previous`）：那是给「人工输码回退」准备的，
 * 而配对凭据已随 D16 整体退场 —— 留着只是一串再也用不上的码。
 */
async function adoptCode(rawCode) {
  const clean = (rawCode + '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== CODE_LEN) return false
  if (clean === state.code) return true

  state.code = clean
  state.paired = false
  state.rejected = 0
  state.error = ''
  try { localStorage.setItem(SYNC_CODE_KEY, clean) } catch { /* quota */ }

  const vocab = useVocabulary()
  await vocab.init()
  vocab.markAllDirty()
  markAllRecordsDirty()
  scheduleRefreshPending()
  const ok = await pullOnce()
  // 这次已经拉过了；拉失败就别把标志置真，留给 autoPullOnce 下次重试
  _autoPulled = ok
  pushSoon(0)
  return true
}

export function useSync() {
  // 首次调用时触发自动拉取（页面启动 + 已有缓存租户码）
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
    recordRevision: computed(() => state.recordRev),
    pending: computed(() => state.pending),
    conflicts: computed(() => state.conflicts),
    refreshPending,
    clearConflicts,
    adoptCode,
    syncNow,
    push: pushNow,
    pushSoon,
    flushNow,
    pull: pullOnce
  }
}
