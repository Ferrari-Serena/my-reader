/**
 * 阅读 / 音频进度的本地存储格式 —— 键格式与取值形状的唯一归属地。
 *
 * 进度同步的做法是：把远程较新的位置**写回同名 localStorage key**，
 * 于是 useReadingPosition.loadPosition 和 AudioPlayer 的恢复逻辑一行都不用改。
 * 代价是同步层必须知道这些键长什么样，所以就都收在这里，
 * 由 useReadingPosition / AudioPlayer 反过来 import，避免格式在两处各写一遍。
 *
 * 音频键为什么不用完整 audioUrl：那个串里嵌着域名（https://www.ferrari11.com/...），
 * 而这个 app 已经换过一次域名（github.io 子路径 → 自定义域），
 * 一旦再换，旧键全成孤儿，同步逻辑里还硬编码着域名。
 * 值为什么是对象而不是光秃的秒数：LWW 需要时间戳，纯数字没法比新旧。
 */

export const READING_POS_PREFIX = 'reader-reading-pos:'
export const AUDIO_POS_PREFIX = 'reader-audio-pos:'

export function readingStorageKey(bookId) {
  return READING_POS_PREFIX + bookId
}

export function audioStorageKey(bookId, chapterId) {
  return `${AUDIO_POS_PREFIX}${bookId}/${chapterId}`
}

/** 本地键 → 同步键（reading:<bookId> / audio:<bookId>/<chapterId>） */
function toSyncKey(storageKey) {
  if (storageKey.startsWith(READING_POS_PREFIX)) {
    return 'reading:' + storageKey.slice(READING_POS_PREFIX.length)
  }
  if (storageKey.startsWith(AUDIO_POS_PREFIX)) {
    return 'audio:' + storageKey.slice(AUDIO_POS_PREFIX.length)
  }
  return null
}

/** 同步键 → 本地键 */
function toStorageKey(syncKey) {
  if (syncKey.startsWith('reading:')) return READING_POS_PREFIX + syncKey.slice(8)
  if (syncKey.startsWith('audio:')) return AUDIO_POS_PREFIX + syncKey.slice(6)
  return null
}

/**
 * 收集本机进度，整理成推送载荷。
 * 只收带 updatedAt 的条目——没有时间戳就没法参与 LWW，推上去只会捣乱。
 *
 * 只取最近 MAX_PUSH_ENTRIES 条：进度是每次保存都全量带上推的，一个读了很多书的设备
 * 能有几千条（每本 × 每章一条音频位置），全塞进请求体既慢又没必要。
 * 按时间倒序截断后，久未触碰的位置不再上推；等用户再打开那本书，位置会被重新打上时间戳，
 * 自然回到窗口内。真正要「接着上次读」的位置永远是最新的那批。
 */
const MAX_PUSH_ENTRIES = 300

export function collectLocalProgress() {
  const all = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const syncKey = toSyncKey(key)
      if (!syncKey) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object') continue
      if (typeof value.updatedAt !== 'string' || !value.updatedAt) continue
      all.push([syncKey, value])
    }
  } catch { /* 存储不可用（私有模式）时当作没有进度 */ }

  all.sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : a[1].updatedAt > b[1].updatedAt ? -1 : 0))

  const out = {}
  for (const [syncKey, value] of all.slice(0, MAX_PUSH_ENTRIES)) {
    out[syncKey] = { payload: value, updatedAt: value.updatedAt }
  }
  return out
}

/**
 * 把远程进度写回本地键。远程更新才写——本地更新的话本地赢，
 * 否则正在阅读的设备会被别的设备的旧位置拽回去。
 * @returns {string[]} 实际写入的本地键（调用方据此判断要不要刷新界面）
 */
export function applyRemoteProgress(progress) {
  const written = []
  for (const [syncKey, payload] of Object.entries(progress || {})) {
    const key = toStorageKey(syncKey)
    if (!key || !payload || typeof payload !== 'object') continue
    const remoteTs = payload.updatedAt
    if (typeof remoteTs !== 'string' || !remoteTs) continue
    try {
      const cur = JSON.parse(localStorage.getItem(key) || 'null')
      const curTs = (cur && typeof cur.updatedAt === 'string') ? cur.updatedAt : ''
      // 并列不写：同刻说明内容一致，少动一次少一分竞态
      if (remoteTs > curTs) {
        localStorage.setItem(key, JSON.stringify(payload))
        written.push(key)
      }
    } catch { /* 单条失败不影响其余 */ }
  }
  return written
}
