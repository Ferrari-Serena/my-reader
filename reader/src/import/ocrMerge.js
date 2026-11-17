/**
 * OCR 合并规则（BYO-OCR S8 §11.1–§11.3；b2 生产同意层）。
 *
 * 纯函数：无 I/O、无 locale 依赖、同输入同输出。
 *   · visOf —— 可见码点计数（文字层 vis 与 OCR 的 ocrVis 用同一个函数，§11.1.1）；
 *   · verdictOf —— 三态判定 empty／sparse／image_body（text 只作防御，§11.1.4）；
 *   · mergePage —— 三分支：replace（仅 empty 且 vis===0）／merge（只追加）／keep（保留原文），
 *     所有丢弃都进 discarded，不静默（§11.2）。
 *
 * 旧式单门槛 `ocrVis ≥ max(100, 2×vis)` 已于 2026-11-14 废除：它拿 OCR 字数与整页文字层比，
 * 页眉越密正文越不可能达标（200 字页眉＋150 字图片正文会被判「不替换」，正文永久缺失）。
 * 本模块不保留该分支的任何别名或 fallback；旧行为只在 verify-import.mjs 的 legacyMergePage 里复现，
 * 用于证明反例夹具真能让修复缺失时变红（§11.6.3）。
 *
 * 段落化复用 pdf.js 的 linesToParagraphs（与文字层同一套启发式）；两文件互相引用，
 * 但只在调用期取用，函数声明在模块实例化阶段已就绪，ESM 循环依赖是安全的。
 * 版面限制（§11.2.1）：merge 只追加、不重排原文 —— 没有可靠的页眉／正文映射，
 * 补进的正文可能排在页眉／页脚之后，这里不假装按阅读序插回。
 */
import { linesToParagraphs } from './pdf.js'

/** 规格级参数（§11.2.2）；改动须重跑 §11.6 夹具并出新规格版本，不在代码里静默调参 */
export const DEFAULT_RULES = {
  MIN_NOVEL_BLOCK_VIS: 4,      // 不含 CJK 的块：少于 4 个可见字符不算新正文（页码、噪声）
  MIN_NOVEL_BLOCK_VIS_CJK: 2,  // 含 CJK 的块：少于 2 个不算（2–3 字的中文短块是正文）
  COVER_SIM: 0.80,             // 3-gram Jaccard 下限：容忍 OCR 小错，不把同一句当新句
  T_SPARSE: 50,                // vis < 50 ⇒ sparse（FE-OCR-1 待定值，现按试算值）
  C_BODY: 0.12,                // vis ≥ 50 且 cov < 0.12 ⇒ image_body
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * 可见码点数（§11.1.1）：NFKC → 去空白／控制／格式／软连字符／U+FFFD → 按码点计数。
 * 标点计入；U+FFFD 不计（坏 OCR 不能靠乱码抬高 ocrVis）；组合符 NFKC 后能合的算一个。
 */
export function visOf(s) {
  const s2 = (s == null ? '' : String(s)).normalize('NFKC').replace(/[\s\p{C}�]/gu, '')
  return Array.from(s2).length
}

/** 一页的三态 verdict（§11.1.4）。顺序不可换：empty 先于一切，sparse 先于 cov。 */
export function verdictOf({ vis, cov } = {}, rules = DEFAULT_RULES) {
  const v = Math.max(0, Number(vis) || 0)
  const c = Math.max(0, Number(cov) || 0)
  const state = v === 0
    ? 'empty'
    : v < rules.T_SPARSE
      ? 'sparse'
      : c < rules.C_BODY ? 'image_body' : 'text'
  return { state, needsOcr: state !== 'text' }
}

function sumVis(list) {
  let n = 0
  for (const s of list) n += visOf(s)
  return n
}

/** 覆盖比较用的归一化（§11.2.3）：NFKC + 去空白 + 小写；与 visOf 无关，别混用 */
function cmpText(s) {
  return (s == null ? '' : String(s)).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 按码点切 3-gram；不足 3 码点整串一个 shingle */
function shingles(s) {
  const a = Array.from(cmpText(s))
  if (!a.length) return new Set()
  if (a.length < 3) return new Set([a.join('')])
  const out = new Set()
  for (let i = 0; i + 3 <= a.length; i++) out.add(a.slice(i, i + 3).join(''))
  return out
}

/** 3-gram Jaccard 相似度 */
export function simOf(a, b) {
  const A = shingles(a)
  const B = shingles(b)
  const inter = [...A].filter(x => B.has(x)).length
  const union = new Set([...A, ...B]).size
  return union ? inter / union : 0
}

/**
 * OCR 块 a 是否已被 list 里某个原文段落覆盖（§11.2.3）。
 * 只用 sim + 长度上限，不用子串包含：块比段落长就说明它可能含段落之外的新字，
 * 不能判成已覆盖 —— 「页眉＋正文」合成块一定走 merge（宁可重复页眉，不丢正文）。
 */
export function coveredBy(a, list, rules = DEFAULT_RULES) {
  const va = visOf(a)
  return (Array.isArray(list) ? list : []).some(p => va <= visOf(p) && simOf(a, p) >= rules.COVER_SIM)
}

function minNovelVis(text, rules) {
  return CJK_RE.test(text == null ? '' : String(text)) ? rules.MIN_NOVEL_BLOCK_VIS_CJK : rules.MIN_NOVEL_BLOCK_VIS
}

function validBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return false
  return [0, 1, 2, 3].every(i => Number.isFinite(Number(bbox[i])))
}

/** 有没有 bbox 决定能否按版面切段；缺一块就整页退化（一块一段） */
function degradedOf(blocks) {
  return blocks.length > 0 && !blocks.every(b => validBbox(b && b.bbox))
}

/**
 * OCR 块 -> 段落。
 * 有 bbox：映射成 {text, y, h, right}，按 y 降序（pdfjs 同向：左下原点）后走 linesToParagraphs；
 * 服务端若给左上原点，传 pageHeight 即按 `y' = pageHeight - y1` 换算（§11.2.1）。
 * 没有 bbox：退化「一块一段」，调用方必须在 stats 标 degraded（这里只管产出）。
 */
export function ocrParagraphsOf(blocks, pageHeight) {
  const list = Array.isArray(blocks) ? blocks : []
  const allBoxed = list.length > 0 && list.every(b => validBbox(b && b.bbox))
  const textOf = b => (b && b.text != null ? String(b.text) : '').replace(/\s+/g, ' ').trim()
  if (!allBoxed) return list.map(textOf).filter(Boolean)
  const ph = Number(pageHeight)
  const topLeft = Number.isFinite(ph) && ph > 0
  const lines = list.map(b => {
    const [x0, y0, x1, y1] = b.bbox.map(Number)
    return {
      text: textOf(b),
      y: topLeft ? ph - y1 : y0,
      h: Math.abs(y1 - y0) || 1,
      right: x1,
    }
  }).filter(l => l.text)
  lines.sort((a, b) => b.y - a.y)
  return linesToParagraphs(lines)
}

/** 按阅读序接受块；后块被已接受块覆盖即判重复（§11.2.3 dedupeBlocks／dedupeNovel） */
function dedupeByCover(blocks, rules) {
  const accepted = []
  const duplicates = []
  for (const b of blocks) {
    if (coveredBy(b.text, accepted.map(x => x.text), rules)) duplicates.push(b)
    else accepted.push(b)
  }
  return { accepted, duplicates }
}

const OCR_DROP_REASONS = ['covered_by_text_layer', 'below_min_block', 'duplicate_block']

/** 统一返回形状：stats 的每个键都填上，早退分支也不留洞（§11.2.3 R14） */
function resultOf(action, paragraphs, reason, stats, discarded) {
  return {
    action,
    paragraphs,
    reason,
    stats: {
      vis: 0, ocrVis: 0, novelRawVis: 0, novelVis: 0,
      blocks: 0, coveredBlocks: 0, novelBlocks: 0, acceptedBlocks: 0,
      droppedBlocks: 0, degraded: false, verdictMismatch: false,
      ...stats,
    },
    discarded: Array.isArray(discarded) ? discarded : [],
  }
}

/**
 * 一页的 OCR 合并决策（§11.2.3 伪码，顺序不可换）。
 *
 * input：{ verdict, paragraphs: string[], ocrBlocks: [{text, bbox?}], pageNo?, pageHeight? }
 * 注意：text 页不进本函数（生产按 needsOcr 过滤），verdict==='text' 只作防御分支。
 * droppedBlocks 只计 covered_by_text_layer／below_min_block／duplicate_block；
 * ocr_empty（零可见字符、无内容可丢）与 text_layer_replaced（原文段落，不是 OCR 块）都不计。
 */
export function mergePage(input, rules = DEFAULT_RULES) {
  const { verdict, paragraphs, ocrBlocks, pageHeight } = input || {}
  const paras = Array.isArray(paragraphs) ? paragraphs.map(p => (p == null ? '' : String(p))) : []
  const blocks = (Array.isArray(ocrBlocks) ? ocrBlocks : []).map(b => ({
    text: b && b.text != null ? String(b.text) : '',
    bbox: b && b.bbox,
  }))
  const degraded = degradedOf(blocks)

  if (verdict === 'text') {
    return resultOf('keep', paras, 'page_has_text_layer', {
      vis: sumVis(paras),
      blocks: blocks.length,
    }, [])
  }

  const vis = sumVis(paras)
  const ocrVis = sumVis(blocks.map(b => b.text))
  // 早退前先算：verdict 判 empty 但仍有可见原文 ⇒ 上游判定与切段不一致（M9c）
  const verdictMismatch = verdict === 'empty' && vis > 0

  if (ocrVis === 0) {
    // 零可见字符块不产生正文；有块时只记一条汇总（不计入 droppedBlocks）。
    // 这一支不做段落化，degraded 固定 false（§11.2.3 早退分支口径）。
    const discarded = blocks.length ? [{ reason: 'ocr_empty', blocks: blocks.length, vis: 0 }] : []
    return resultOf('keep', paras, 'ocr_empty', { vis, blocks: blocks.length, verdictMismatch }, discarded)
  }

  if (verdict === 'empty' && vis === 0) {
    // 整页替换的唯一门：没有原文可丢（§11.2.3 R2）
    const { accepted, duplicates } = dedupeByCover(blocks, rules)
    const discarded = []
    if (duplicates.length) {
      discarded.push({ reason: 'duplicate_block', blocks: duplicates.length, vis: sumVis(duplicates.map(b => b.text)) })
    }
    if (paras.length) {
      // text_layer_replaced 记的是被替换的原文：段数 / 原文可见字数（不是 OCR 块）
      discarded.push({ reason: 'text_layer_replaced', blocks: paras.length, vis: 0 })
    }
    return resultOf('replace', ocrParagraphsOf(accepted, pageHeight), 'empty_page', {
      vis: 0,
      ocrVis,
      blocks: blocks.length,
      coveredBlocks: 0,
      novelBlocks: accepted.length,
      acceptedBlocks: accepted.length,
      droppedBlocks: duplicates.length,
      degraded,
      verdictMismatch: false,
    }, discarded)
  }

  // 到这里仍要为 empty 且 vis>0 的页落回 coverage 路径：不得丢原文，只留 verdictMismatch 痕迹
  const coveredFlags = blocks.map(b => coveredBy(b.text, paras, rules))
  const covered = blocks.filter((b, i) => coveredFlags[i])
  const rawNovel = blocks.filter((b, i) => !coveredFlags[i])
  const novel = rawNovel.filter(b => visOf(b.text) >= minNovelVis(b.text, rules))
  const novelRawVis = sumVis(rawNovel.map(b => b.text))
  const novelVis = sumVis(novel.map(b => b.text))

  const discarded = []
  if (covered.length) {
    discarded.push({ reason: 'covered_by_text_layer', blocks: covered.length, vis: sumVis(covered.map(b => b.text)) })
  }
  const belowMin = rawNovel.filter(b => visOf(b.text) < minNovelVis(b.text, rules))
  if (belowMin.length) {
    discarded.push({ reason: 'below_min_block', blocks: belowMin.length, vis: sumVis(belowMin.map(b => b.text)) })
  }
  const base = {
    vis,
    ocrVis,
    novelRawVis,
    novelVis,
    blocks: blocks.length,
    coveredBlocks: covered.length,
    novelBlocks: novel.length,
    degraded,
    verdictMismatch,
  }

  if (novelRawVis === 0) {
    return resultOf('keep', paras, 'ocr_no_novel_text', {
      ...base,
      acceptedBlocks: 0,
      droppedBlocks: covered.length,
    }, discarded)
  }
  if (novelVis === 0) {
    return resultOf('keep', paras, 'novel_below_block_min', {
      ...base,
      acceptedBlocks: 0,
      droppedBlocks: covered.length + belowMin.length,
    }, discarded)
  }

  const { accepted, duplicates } = dedupeByCover(novel, rules)
  if (duplicates.length) {
    discarded.push({ reason: 'duplicate_block', blocks: duplicates.length, vis: sumVis(duplicates.map(b => b.text)) })
  }
  return resultOf('merge', [...paras, ...ocrParagraphsOf(accepted, pageHeight)], 'ocr_adds_novel_text', {
    ...base,
    acceptedBlocks: accepted.length,
    droppedBlocks: covered.length + belowMin.length + duplicates.length,
  }, discarded)
}

/** 审计不变量：droppedBlocks === Σ 三类 OCR 丢弃的块数（§11.2.3） */
export function auditDropped(result) {
  const discarded = result && Array.isArray(result.discarded) ? result.discarded : []
  const sum = discarded
    .filter(d => d && OCR_DROP_REASONS.includes(d.reason))
    .reduce((n, d) => n + (Number(d.blocks) || 0), 0)
  return !!(result && result.stats) && result.stats.droppedBlocks === sum
}
