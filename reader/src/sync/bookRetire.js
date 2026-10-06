/**
 * 永久退役名单（第 16.5 步块 4 / D16-b「防删了又活」）。
 *
 * 一件事：**这本 BYO 书被删过**，本机就记着 —— 对账补发（本机 -> 账号）不许再把它推上去，
 * 自动预取（账号 -> 本机）也不许再把它拉回来。
 *
 * 为什么非得单独一张名单（拿「本机有正文 && 账号没有 meta」当判据不够用）：
 *   · 删除只留墓碑、不留 meta —— 这两个条件区分不了「还没上云」和「已经删掉」；
 *   · 本机删书（removeByoBookEverywhere）：removeRecord 留墓碑，而墓碑**推成功后会被清掉**
 *     （同步协议要求，见 useSync 的 push），清完「无 meta、无墓碑」就成立 -> 会被当「没上云」补发；
 *   · 别的设备删书：本机拉到远程墓碑、应用后同样把本地 meta 删掉、本地墓碑清掉，而本机的
 *     正文按设计**保留**（别的设备是「本机那份」的主人）-> 一样会被重新补发。
 *   所以必须有一张**不被同步协议清掉**的名单。
 *
 * 写它的地方只有两处，都在 recordStore 里（那边记着「一条不变式」）：
 *   记录表里 book:<id> 消失（本机删 / 应用远程墓碑）-> 记上；
 *   记录表里 book:<id> 出现（重新导入 / 别处重新建）-> 划掉。
 * 形状与 PENDING_PUBLISH_KEY 一致：坏表退回空、空表不留空数组垃圾、非指纹 id 不记。
 */

import { isBookId } from '../utils/bookId.js'

const RETIRED_KEY = 'reader-books-retired'

export function loadRetiredBooks() {
  try {
    const raw = localStorage.getItem(RETIRED_KEY)
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? [...new Set(arr.filter((v) => isBookId(v)))] : []
  } catch {
    return [] // 私有模式 / 表坏了：退回「不记得」
  }
}

function writeRetiredBooks(list) {
  try {
    const arr = [...new Set((list || []).filter((v) => isBookId(v)))]
    if (arr.length) localStorage.setItem(RETIRED_KEY, JSON.stringify(arr))
    else localStorage.removeItem(RETIRED_KEY) // 空表不留垃圾
  } catch { /* 配额满：不记也不影响本机阅读 */ }
}

export function markBookRetired(bookId) {
  if (!isBookId(bookId)) return
  const cur = loadRetiredBooks()
  if (cur.includes(bookId)) return
  writeRetiredBooks([...cur, bookId])
}

export function clearBookRetired(bookId) {
  if (!isBookId(bookId)) return
  const cur = loadRetiredBooks()
  if (!cur.includes(bookId)) return
  writeRetiredBooks(cur.filter((id) => id !== bookId))
}

export function isBookRetired(bookId) {
  return isBookId(bookId) && loadRetiredBooks().includes(bookId)
}