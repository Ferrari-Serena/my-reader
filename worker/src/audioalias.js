/**
 * 音频访问口径（第 6 步 6.4b，2026-10-05 Ferrari 裁「B」）
 *
 * 背景：6.1 把三本版权书移出了公开库（正文不再进 Pages），但它们的音频对象**仍在 R2 留档**
 * —— 对象不删，只把「谁能取」收口。于是这里有三种处置：
 *   1. retired  已下架的内置 id（the-giver / artemis-fowl / divergent…）→ 一律 404。
 *               对象在桶里，但不再经 Worker 提供（连登录用户也不给：App 里已无入口）。
 *   2. mapped   BYO 别名：下架后自用改走 BYO 重导入，而 BYO 的 id 是**内容指纹**（bk_…），
 *               与归档音频的 slug 不是同一个 key —— 请求会 404、朗读回落浏览器 TTS。
 *               这张表把它接回：BYO id → (归档书, 章号偏移)。**需有效登录会话**才给，
 *               因为它是版权书的派生物。
 *   3. serve    其它书（dr-jekyll 公版、sat-practice 自产…）→ 照旧，匿名可用。
 *               「功能只增不减」：不去全局关掉 /api/audio，免得把公版的匿名朗读一起削掉。
 *
 * 偏移量怎么来的（2026-10-05 实测，不是猜的）：
 *   把 uploads/ 里的源文件真导进 App（BYO），读回 IndexedDB 章清单，与内置 chapters.json 对：
 *     · artemis-fowl : BYO 13 章 vs 内置 11 章，BYO 多出 index / Synopsis 两页 → 偏移 +2，标题 11/11 命中
 *     · the-giver    : BYO 27 章 vs 内置 25 章，BYO 多出 Table of Contents / Unknown 两页 → 偏移 +2
 *                      （音频覆盖内置 ch-03…ch-25 = Chapter 1…23 → BYO ch-05…ch-27）
 *     · divergent…   : 章界不同（+2 只命中 39/86，后半是合集里另一本书）→ **不进表**，
 *                      强行对齐会放错章的音频，比没有更糟
 *
 * 只映射 .mp3，**不映射 .timings.json**：两侧段落切分不同（artemis CHAPTER 1：内置 133 段 /
 * BYO 145 段），timings 按段落 id 记秒数，搬过去必然错位 —— 错位的高亮比没有高亮更糟。
 * 没有 timings 时播放器照常播，只是没有跟读高亮（见 ReaderView 的 playingParaId）。
 */

/** 已下架、对象留档但不再服务的内置 id */
export const RETIRED_BOOKS = [
  'the-giver',
  'artemis-fowl',
  'divergent-series-ultimate-four-book-collection--veronica-rot'
]

/**
 * BYO 内容指纹 → 归档音频。键必须是 App 算出的同一个 bk_ id
 * （= 'bk_' + sha256(源文件原始字节) 的前 16 hex；见 reader/src/utils/bookId.js）。
 * 换一份源文件（哪怕同一本书）→ 指纹变 → 这张表要跟着改。
 */
export const AUDIO_ALIASES = {
  bk_2b9199f77a479bf8: { src: 'artemis-fowl', offset: 2 },
  bk_ff5e9139dfb97b1f: { src: 'the-giver', offset: 2 }
}

/** 只认两位数章号的 mp3：ch-01.mp3 …；timings 与任何其它形状一律不给 */
const CHAPTER_MP3 = /^ch-(\d{2})\.mp3$/

/**
 * 这个音频请求该怎么处理（纯函数，好断言）。
 * @param {string} bookId  URL 里的第一段
 * @param {string} file    URL 里的第二段（如 ch-05.mp3）
 * @param {{aliases?:object, retired?:string[]}} [opts] 只为测试留缝（注入故障用）
 * @returns {{action:'serve'|'mapped'|'retired'|'notfound', key?:string, src?:string}}
 */
export function audioRequestPlan(bookId, file, opts = {}) {
  const aliases = opts.aliases || AUDIO_ALIASES
  const retired = opts.retired || RETIRED_BOOKS

  if (retired.includes(bookId)) return { action: 'retired' }

  const alias = aliases[bookId]
  if (alias) {
    const m = CHAPTER_MP3.exec(file)
    if (!m) return { action: 'notfound' }
    const n = Number(m[1]) - alias.offset
    if (!Number.isInteger(n) || n < 1) return { action: 'notfound' }
    return { action: 'mapped', src: alias.src, key: `${alias.src}/ch-${String(n).padStart(2, '0')}.mp3` }
  }

  return { action: 'serve' }
}
