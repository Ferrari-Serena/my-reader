/**
 * 同步合并的纯逻辑 —— 不 import Vue / storage / fetch，因此可以在 Node 里直接断言。
 * useSync.js 只负责「把 planMerge 的结论落到 storage 和响应式状态上」。
 *
 * 时间轴约定（与服务端 sync.js 一致）：
 *   每个词一条时间轴，last-write-wins。
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
 *   repush —— 本地比远程墓碑新（删后又收藏），需回推复活
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
    // 并列时不覆盖：两边同刻说明内容一致（先拉后推的前提下），动作越少越安全
    if (remoteTime > entryTime(localEntry)) apply.push({ word, entry: remoteEntry })
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
