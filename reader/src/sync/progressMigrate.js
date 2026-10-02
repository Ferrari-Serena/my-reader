/**
 * 一次性迁移：音频续播位置（旧格式 → progress.js 的新格式）。
 *
 * 旧格式（976c79d / 90c4a22）的键是**完整音频 URL**、值是**裸秒数**：
 *   reader-audio-pos:/books/the-giver/audio/ch-04.mp3  →  "590.049"
 * 新格式的键是 <bookId>/<chapterId>、值是 { seconds, updatedAt }。
 * 新代码把认不出的值当 0，于是升级后「从哪儿接着听」全部清零，而旧键还占着地方。
 *
 * 为什么不给 now：旧值没带时间戳，我们并不知道它有多旧。给 now 会让一个几个月前的位置
 * 在 LWW 里赢过别的设备上真正更新的位置。迁移只是为了让**本机**能接着听，所以给它一个
 * 明确的「最旧」时间戳：远程有任何记录都会盖掉它，本机没有远程记录时照样能恢复。
 *
 * 幂等：只认得出 `…/books/<bookId>/audio/<chapterId>.mp3` 的键才动。新格式的键不含 `/books/`，
 * 所以重复执行不会伤到已迁移的数据。
 */

import { AUDIO_POS_PREFIX, audioStorageKey } from './progress.js'

/** 旧键里那段 …/books/<bookId>/audio/<chapterId>.mp3（BASE_URL 前缀可有可无，域名也可能在） */
const LEGACY_AUDIO_RE = /\/books\/([^/?#]+)\/audio\/([^/?#]+)\.mp3$/

/** 迁移值的时间戳：明确的「最旧」，绝不让无语义的旧值赢过任何有据可查的更新 */
export const MIGRATED_AT = '1970-01-01T00:00:00.000Z'

/** 旧值：裸秒数（字节串化后是一个 JSON number） */
function readLegacySeconds(store, key) {
  try {
    const raw = store.getItem(key)
    if (raw == null) return NaN
    const v = JSON.parse(raw)
    return typeof v === 'number' ? v : NaN
  } catch { return NaN }
}

/**
 * 把本机的旧格式音频续播位置迁到新格式。
 * @param {Storage} [store] 默认全局 localStorage（传参是为了可单测）
 * @returns {{migrated: number, removed: number, skipped: number}}
 */
export function migrateAudioPositions(store = (typeof localStorage === 'undefined' ? null : localStorage)) {
  const result = { migrated: 0, removed: 0, skipped: 0 }
  if (!store) return result

  // 先把键全部收集好：边遍历边 removeItem 会让位置漂移
  let keys = []
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && k.startsWith(AUDIO_POS_PREFIX)) keys.push(k)
    }
  } catch { return result } // 存储不可用（私有模式）：当作没有旧键

  for (const oldKey of keys) {
    const m = LEGACY_AUDIO_RE.exec(oldKey.slice(AUDIO_POS_PREFIX.length))
    if (!m) continue // 已是新格式的键，或认不出的形状：一律不动
    const seconds = readLegacySeconds(store, oldKey)
    try {
      if (Number.isFinite(seconds) && seconds > 0) {
        const newKey = audioStorageKey(m[1], m[2])
        // 已有新键就不覆盖：新键一定比旧键新（旧键是上一版的写法）
        if (!store.getItem(newKey)) {
          store.setItem(newKey, JSON.stringify({ seconds, updatedAt: MIGRATED_AT }))
          result.migrated++
        } else {
          result.skipped++
        }
      } else {
        result.skipped++ // 形状对、值坏：只删不迁
      }
      store.removeItem(oldKey)
      result.removed++
    } catch { /* 单条失败不影响其余 */ }
  }
  return result
}
