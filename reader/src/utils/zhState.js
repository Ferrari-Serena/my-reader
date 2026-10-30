/**
 * dict-zh 六态（D2）的落态判据 —— 纯函数，不碰 Vue／DOM／网络。
 *
 * 为什么单独一件：六条验收判据要能在裸 node 里直接跑（本仓没有组件挂载器），
 * 若把分支写在 ReaderView 的 async 回调里，测试只能读源码字符串、读不到组合结果。
 * 这里把「lookup 四值 ＋ 英文缓存 ＋ 离线 ＋ 在线兜底」摊成返回
 * `{ lookupState, zhReason, dictEntry, next }` 的决定，ReaderView 只负责赋值与发事件。
 *
 * B9 顺序在 resolveZhOutcome 里定死：**中文 → 英文缓存 → 在线**，英文缓存不短路中文。
 * 六态枚举与规格一致：'idle'|'loading'|'hit'|'english'|'miss'|'error'|'offline'|'phrase'。
 */

export const LOOKUP_STATES = [
  'idle', 'loading', 'hit', 'english', 'miss', 'error', 'offline', 'phrase',
]

/** 这两种 reason 同侧：中文词典层「确实没有可用释义」，可以断言未收。 */
export function isDefinitiveMiss(reason) {
  return reason === 'miss_dict' || reason === 'miss_empty'
}

/**
 * 单词分支进入：与 `selectedWord=word` 同批。
 * `dictEntry` 预置英文缓存只为回落保留；UI 先看 lookupState==='loading'，不会先露旧词条。
 */
export function beginWordLookup(word, entry) {
  return {
    lookupState: 'loading',
    zhReason: '',
    dictEntry: entry || null,
    word: word ?? null,
    next: 'lookup',
  }
}

/** 词组早退：专用值 'phrase'（六态之外），dictEntry 必须清空。 */
export function beginPhraseLookup(phrase) {
  return {
    lookupState: 'phrase',
    zhReason: '',
    dictEntry: null,
    word: phrase ?? null,
    next: 'done',
  }
}

/** 端到端 deadline 到点：网络/超时态，reason 固定 miss_net。 */
export function deadlineOutcome() {
  return { lookupState: 'error', zhReason: 'miss_net', next: 'done' }
}

/**
 * `await lookupZh` 返回后：按 B9 决定落哪一态。
 * @param {{status:'hit'|'miss'|'error', result?:string, reason?:string, entry?:object}} zh
 * @param {object|undefined} entry 英文缓存条目（只作回落）
 * @param {boolean} offline
 * @returns {{lookupState:string, zhReason:string, dictEntry:object|null, next:'done'|'online'}}
 */
export function resolveZhOutcome({ zh, entry, offline = false } = {}) {
  const reason = zh && zh.status === 'hit' ? zh.result : zh && zh.reason

  if (zh && zh.status === 'hit') {
    // 中文命中：英文缓存即使有内容也不得抢先（B9）。
    const merged = { ...(entry || {}), ...(zh.entry || {}) }
    return { lookupState: 'hit', zhReason: reason, dictEntry: merged, next: 'done' }
  }

  if (entry && Array.isArray(entry.definitions) && entry.definitions.length > 0) {
    return { lookupState: 'english', zhReason: reason, dictEntry: entry, next: 'done' }
  }

  if (entry && entry.notFound) {
    // 中文分片/网络没取到 ≠ 词典未收：只有 miss_dict／miss_empty 才能断言未收。
    return {
      lookupState: isDefinitiveMiss(reason) ? 'miss' : 'error',
      zhReason: reason,
      dictEntry: entry,
      next: 'done',
    }
  }

  if (offline) {
    // miss_dict／miss_empty 即使离线也落「未收」，绝不把「词不在词典」报成「没缓存」。
    return {
      lookupState: isDefinitiveMiss(reason) ? 'miss' : 'offline',
      zhReason: reason,
      dictEntry: null,
      next: 'done',
    }
  }

  // 在线且无英文缓存：继续走 /api/dict，弹窗维持加载态。
  return { lookupState: 'loading', zhReason: reason, dictEntry: entry || null, next: 'online' }
}

/**
 * `/api/dict` 返回后（或网络/JSON 失败）：决定最终态。
 * `failed=true` 覆盖非 2xx／JSON 失败／catch；只有 miss_dict／miss_empty 能落 'miss'。
 */
export function resolveOnlineOutcome({ reason, online, failed = false } = {}) {
  const zhReason = reason || 'miss_net'
  if (failed) return { lookupState: 'error', zhReason, next: 'done' }

  const definitions = online && Array.isArray(online.definitions) ? online.definitions : []
  if (definitions.length > 0) return { lookupState: 'english', zhReason, next: 'done' }

  return {
    lookupState: isDefinitiveMiss(reason) ? 'miss' : 'error',
    zhReason,
    next: 'done',
  }
}
