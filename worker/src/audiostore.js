/**
 * my-reader 第 17 步（D17）· 块 E —— BYO 音频的**键布局 ＋ 按前缀清**（全库只有一份）。
 *
 * 为什么单独一个文件：`user/<code>/…` 这套键有三处要用 ——
 *   ① 上传／读取路由（`bookaudio.js`）按它拼键；
 *   ② 删书（`booksync.js` 的 DELETE）要清 `user/<code>/<bookId>/`；
 *   ③ 注销真删（`authapi.js` 的 `purgeDeletedAccounts`）要清 `user/<code>/`。
 * ②③ 不能直接 import `bookaudio.js` 的常量：`bookaudio.js` **反向** import 了
 * `authapi.js` 的 `attemptCount`／`noteAttempt`，`authapi → bookaudio` 会成环。
 * 所以把「键怎么拼」＋「按前缀清」放这里，本文件**不 import 任何本地模块**，谁都引得到。
 *
 * `user/` 前缀即权限边界（结构性隔离，不靠路由里的 if 兜）—— 见 `bookaudio.js` 头注。
 * 本文件只认这一个前缀，**不碰** `books/`（BYO 正文）与内置书音频（`<bookId>/…`）。
 */

export const USER_PREFIX = 'user/'

/** 一个账号的音频前缀（租户边界） */
export function audioPrefixFor(code) { return `${USER_PREFIX}${code}/` }
/** 一个账号里一本书的音频前缀 */
export function bookAudioPrefixFor(code, bookId) { return `${audioPrefixFor(code)}${bookId}/` }
/** 对象在 R2 里的键：账号主码是**目录**，也就是租户边界 */
export function audioObjectKey(code, bookId, file) { return `${bookAudioPrefixFor(code, bookId)}${file}` }

/**
 * 清掉某前缀下的全部对象。**恒不抛** —— 它是删书／注销的收尾动作，一次 R2 打嗝不该把
 * 主操作（对象已删、墓碑已写）弄成失败。
 *
 * 翻页手法：R2 list 每页上限 1000，而**一边删一边按 cursor 翻**不可靠（游标可能指向已被删掉的
 * 键）—— 所以每轮都从**头**重新列一页、删掉、再列。防死循环：某一轮列表非空却一条也没删掉
 * （说明 delete 没生效）就退出，不做无限重试。
 *
 * @returns {Promise<number>} 删掉的条数；list／delete 出错回 -1（调用方只用来回报与记日志）
 */
export async function purgePrefix(env, prefix, { maxPasses = 50, pageLimit = 1000 } = {}) {
  if (!prefix || typeof prefix !== 'string') return 0
  let removed = 0
  for (let pass = 0; pass < maxPasses; pass++) {
    let page
    try {
      page = await env.AUDIO.list({ prefix, limit: pageLimit })
    } catch (e) {
      console.error('audio purge list failed:', e && e.message)
      return -1
    }
    const keys = ((page && page.objects) || []).map((o) => o.key).filter(Boolean)
    if (keys.length === 0) return removed
    try {
      await env.AUDIO.delete(keys)
    } catch (e) {
      console.error('audio purge delete failed:', e && e.message)
      return -1
    }
    removed += keys.length
  }
  console.error('audio purge hit maxPasses (未清完):', prefix)
  return removed
}
