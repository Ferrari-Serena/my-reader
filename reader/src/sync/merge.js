/**
 * 同步合并的纯逻辑 —— 不 import Vue / storage / fetch，因此可以在 Node 里直接断言。
 * useSync.js 只负责「把 planMerge 的结论落到 storage 和响应式状态上」。
 *
 * 时间轴约定（与服务端 sync.js 一致）：
 *   每个词一条时间轴，last-write-wins。
 *   例外：词条内部 srs / quiz / snapshot 三个槽位各按自己的轴取新（见 mergeEntries，方案 4.3）。
 *   存活条目取 entry.updatedAt || entry.addedAt；墓碑取它自己的删除时刻。
 *   墓碑和存活条目**必须分开传**——墓碑没有 entry，若混进 remoteWords，
 *   算出来的 remoteTime 会是空串，删除就变成静默空操作。
 */

/** 取条目的时间戳，缺失时回退 addedAt（再缺就空串，空串比不过任何有效时间戳） */
export function entryTime(entry) {
  if (!entry || typeof entry !== 'object') return ''
  if (typeof entry.updatedAt === 'string' && entry.updatedAt) return entry.updatedAt
  if (typeof entry.addedAt === 'string' && entry.addedAt) return entry.addedAt
  return ''
}

/** 槽位「新鲜度」：数字越大越新；-1 ＝ 该槽为空（比不过任何有值的槽） */
function srsRank(srs) {
  if (!srs || typeof srs !== 'object') return -1
  const t = Date.parse(srs.last_review || srs.due || '')
  return Number.isFinite(t) ? t : -1
}
/** quiz 没有自己的时间戳 → 用**累计答题数**当进度轴（只增不减，越多越新） */
function quizRank(quiz) {
  if (!quiz || typeof quiz !== 'object') return -1
  const n = Number(quiz.totalAttempts)
  return Number.isFinite(n) && n > 0 ? n : -1
}
/** snapshot 是「只在为空时补全」的槽 → 释义越多越完整 */
function snapshotRank(snapshot) {
  const n = snapshot && Array.isArray(snapshot.definitions) ? snapshot.definitions.length : -1
  return n > 0 ? n : -1
}

/** 参与字段级合并的槽位表（顺序不影响结果） */
const MERGE_SLOTS = [['srs', srsRank], ['quiz', quizRank], ['snapshot', snapshotRank]]

/** 较晚的时间戳 + 1ms —— 严格新于两边，保证回推能被服务端收下 */
function bumpUpdatedAt(a, b) {
  const ta = Date.parse(a), tb = Date.parse(b)
  const max = Math.max(Number.isFinite(ta) ? ta : -Infinity, Number.isFinite(tb) ? tb : -Infinity)
  return Number.isFinite(max) ? new Date(max + 1).toISOString() : ''
}

/**
 * 词条级「字段合并」（方案 4.3）。
 *
 * 整条按 updatedAt 取新（LWW）为底，再让 srs / quiz / snapshot 三个槽位**各按自己的轴**取新
 * （srs 用 last_review、quiz 用累计答题数、snapshot 用完整度）。并列（同刻）不覆盖，取本地那侧，
 * 与 planMerge 既有姿态一致。
 *
 * 为什么要这么做：两地各改一个槽位时（手机评分 + 电脑答题），纯整条 LWW 会把另一边的改动整段丢掉
 * —— 那就是「不丢数据」的缺口。
 *
 * @returns {{entry: object, tookOther: boolean}} tookOther=true ＝ 从**较旧那侧**并来了某个更新的槽位，
 *   合出来的东西不是任何一侧的原样：调用方既要把 entry 落本地，也要把它回推给服务端，否则两边永久分叉。
 */
export function mergeEntries(localEntry, remoteEntry) {
  const lt = entryTime(localEntry), rt = entryTime(remoteEntry)
  const base = rt > lt ? remoteEntry : localEntry
  const other = base === localEntry ? remoteEntry : localEntry
  const entry = { ...base }
  let tookOther = false
  for (const [slot, rank] of MERGE_SLOTS) {
    if (rank(other[slot]) > rank(base[slot])) { entry[slot] = other[slot]; tookOther = true }
  }
  // 合出了新混合体 → 抬到严格新于两边，否则回推会被服务端按「不占优」静默拒收
  if (tookOther) entry.updatedAt = bumpUpdatedAt(lt, rt) || entry.updatedAt
  return { entry, tookOther }
}

/**
 * 算出「把远程状态合并进本地」要做哪些事。纯函数，不改任何入参。
 *
 * @param localWords  本地词表 {word: entry}
 * @param remoteWords 远程存活词 {word: entry}
 * @param remoteTombs 远程墓碑 {word: 删除时刻}
 * @param localTombs  本地尚未推出去的删除台账 {word: 删除时刻}。必须参与判定：
 *   远程的存活写打不过一条更新的本地删除，否则离线删的词会在下次冷启动被静默复活
 *   （apply → addWord → retireTombstone 顺手把台账抹掉，删除意图从此消失）。
 * @returns {{apply: Array, remove: string[], repush: string[]}}
 *   apply  —— 远程更新，需落盘并更新响应式状态：[{word, entry}]
 *   remove —— 远程墓碑更新，需删本地
 *   repush —— 需回推的本地词：① 本地比远程墓碑新（删后又收藏）；② 字段合并合出了
 *             两侧都没有的新混合体（服务端只有较旧那侧，不回推就永久分叉）
 */
export function planMerge(localWords, remoteWords, remoteTombs, localTombs) {
  const local = localWords || {}
  const tombs = localTombs || {}
  const apply = []
  const remove = []
  const repush = []

  for (const [word, remoteEntry] of Object.entries(remoteWords || {})) {
    const remoteTime = entryTime(remoteEntry)
    const localEntry = local[word]
    if (!localEntry) {
      // 本地没有词条，但可能有一条还没推出去的删除墓碑（离线删词）。
      // 远程存活写不占优就不能 apply —— 台账留着，交给 pushNow 发出去。
      const localTomb = tombs[word]
      if (typeof localTomb === 'string' && localTomb && !(remoteTime > localTomb)) continue
      apply.push({ word, entry: remoteEntry })
      continue
    }
    // 字段级合并（方案 4.3）：整条仍按 updatedAt 取新，srs / quiz / snapshot 另按各自的轴取新。
    // 两地各改一个槽位时，纯整条 LWW 会把另一边的改动整段丢掉。
    const localTime = entryTime(localEntry)
    const merged = mergeEntries(localEntry, remoteEntry)
    if (remoteTime > localTime) {
      // 远程整条更新 → 落盘；若同时并进了本地更新的槽位，还要回推让服务端收敛
      apply.push({ word, entry: merged.entry })
      if (merged.tookOther) repush.push(word)
    } else if (merged.tookOther) {
      // 本地整条更新（或同刻），但远程某个槽位更新 → 本地也落成混合体并回推
      apply.push({ word, entry: merged.entry })
      repush.push(word)
    }
  }

  for (const [word, tombTs] of Object.entries(remoteTombs || {})) {
    if (typeof tombTs !== 'string' || !tombTs) continue
    const localEntry = local[word]
    if (!localEntry) continue // 本地没有，无需删
    if (entryTime(localEntry) > tombTs) {
      // 本地这次收藏晚于远程的删除 → 用户是删了之后又重新收藏的，应该复活
      repush.push(word)
    } else {
      remove.push(word)
    }
  }

  return { apply, remove, repush }
}

/**
 * 时钟校正：客户端时钟不可信，用服务端回传的 serverNow 求偏移。
 * 偏移量超过一天基本可以断定是本地时钟坏了而不是时区问题，宁可不校正。
 */
const MAX_OFFSET_MS = 86400000

export function computeClockOffset(serverNow, localNowMs) {
  if (typeof serverNow !== 'string' || !serverNow) return 0
  const t = Date.parse(serverNow)
  if (!Number.isFinite(t) || !Number.isFinite(localNowMs)) return 0
  const offset = t - localNowMs
  if (Math.abs(offset) > MAX_OFFSET_MS) return 0
  return offset
}

/** 用校正后的时间取当前时刻，统一 toISOString()——精度一致，字符串比较才可靠 */
export function adjustedNowIso(offsetMs, localNowMs) {
  const base = Number.isFinite(localNowMs) ? localNowMs : Date.now()
  const off = Number.isFinite(offsetMs) ? offsetMs : 0
  return new Date(base + off).toISOString()
}
