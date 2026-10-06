/**
 * 同步码的格式与生成 —— **唯一归属地**（第 16.5 步 D16 从 sync.js 抽出）。
 *
 * 为什么单独一个叶子模块：`authapi.js` 要用 `CODE_LEN`／`randCode`，而它又要被
 * `sync.js` 反过来用（会话 → 租户的闸）—— 两端互相 import 就是环。把这两样放进
 * **谁都不依赖**的叶子文件，环就断了（`sync.js` 仍 re-export，外部调用点一行不用改）。
 *
 * 码的**双重身份**（D16）：①用户看得见的配对凭据 → 正在退场；②服务端的分区键
 * （`sync_data.code`／`sync_progress.code`／R2 `books/<code>/`）→ 保留，只是改成
 * 由会话反推、客户端永不传。
 */

/** 去掉容易混淆的 0/O/1/I */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LEN = 8

/** 8 位强随机码（撞码由调用方按 `changes` 判定并重试，不在这里查库） */
export function randCode() {
  const buf = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join('')
}

/**
 * 洗同步码：只留大写字母数字，**长度不对就当「没码」**（返回空串）。
 * 与旧的 authapi 私有副本语义一字不差（只收字符串；数字/对象一律空串）。
 */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return ''
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.length === CODE_LEN ? clean : ''
}