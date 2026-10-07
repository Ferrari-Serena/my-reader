/**
 * 浏览器朗读（Web Speech）↔ 云端音频的**接位换算**（第 17 步块 D-3）。
 *
 * 为什么值得单独一个纯函数模块：热切要的是「现在念到哪一段」，而 Web Speech 只给
 * boundary 事件、给不出「当前句在整章音频里的秒数」（判据 2 已明确**不做段内接位**）。
 * 于是位置链条切成两段各自可验：
 *   ① 朗读侧：章文本 ＋ 切句结果 → 每个 chunk 在章文本里的**字符起点**
 *   ② 音频侧：字符偏移 → **段落 id** → 段起始秒（timings，由调用方查）
 * 两段都不碰 DOM、不碰网络，所以能进 node 自检；组件只负责读表与调用。
 *
 * ⚠️ 本模块在主包侧（`src/utils/`）：**不许**引任何 `src/generate/` 的东西
 * （卫生断言见 verify-generate.mjs）。
 */

/**
 * 把「章标题 ＋ 各段」拼成朗读文本，并给出**每一段**在其中的字符起点。
 *
 * 文本与偏移**同源**才算数：分开算必然漂（标题算不算、段间几个空格）。拼接按
 * `join(' ')` 逐字复现 —— 与 `currentChapterText` 原来的写法逐字节相同。
 *
 * @param {Array<{id?: string, text?: string}>} items 顺序：标题在前、各段随后
 * @returns {{text: string, starts: Array<{id: string, start: number}>}}
 *   `starts[i].id` 留空 ＝ 这一项没有段落身份（标题就是这种），含义见 `paragraphIdAt`。
 */
export function buildParagraphStarts(items) {
  const list = Array.isArray(items) ? items : []
  const parts = list.map((it) => (it && it.text != null ? String(it.text) : ''))
  const starts = []
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const id = list[i] && list[i].id != null ? String(list[i].id) : ''
    starts.push({ id, start: pos })
    pos += parts[i].length + 1 // +1 = 连接空格（末项多算 1，无副作用）
  }
  return { text: parts.join(' '), starts }
}

/**
 * 每个 chunk 在原文里的**字符起点**。
 *
 * chunk 是原文按顺序切出来的片段（切句那一步会 trim 掉首尾空白），所以「游标 ＋
 * indexOf」就能**精确**定位，不必另存一份偏移表。找不到（调用方自己造了不在原文里的
 * chunk）就退回当前游标 —— 宁可差一点，也不倒挂、不抛。
 */
export function chunkOffsets(text, chunks) {
  const src = text == null ? '' : String(text)
  const list = Array.isArray(chunks) ? chunks : []
  const out = []
  let cursor = 0
  for (const c of list) {
    const s = c == null ? '' : String(c)
    const at = s ? src.indexOf(s, cursor) : -1
    if (at >= 0) {
      out.push(at)
      cursor = at + s.length
    } else {
      out.push(cursor)
    }
  }
  return out
}

/**
 * 某个字符偏移落在**哪一段**上。
 *
 * `starts` 必须按 start 升序（`buildParagraphStarts` 保证）。返回空串的两种情形调用方
 * 一种对待即可（都接第 0 秒）：① 还没进第一段（标题区，标题项的 id 本来就是空的）；
 * ② 表为空 / 偏移不是数。
 */
export function paragraphIdAt(starts, offset) {
  const list = Array.isArray(starts) ? starts : []
  const off = Number(offset)
  if (!list.length || !Number.isFinite(off)) return ''
  let hit = ''
  for (const it of list) {
    const s = it ? Number(it.start) : NaN
    if (!Number.isFinite(s) || s > off) continue
    hit = it.id == null ? '' : String(it.id)
  }
  return hit
}
