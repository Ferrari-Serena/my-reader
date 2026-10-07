/**
 * 第 17 步（D17／D20）· 块 D —— 「端上生成一章」的**准入闸 ＋ 轮询条件 ＋ 文案**。
 *
 * 纯逻辑：不碰 DOM、不引 kokoro-js（同目录的 engine.js 才引）。组件、编排、自检三处共用
 * 同一份口径 —— 写成「组件里一个 computed」必然三处各写一套再各自漂（同 audioIndex.js 的理由）。
 *
 * ⚠️ 所在目录是卫生豁免区：**主包不许静态引 `src/generate/`**（见 verify-generate.mjs）。
 * 所以本件的调用方只能是动态加载的那一档：`GenAudioPanel.vue`（动态 import）／`chapterGen.js`
 * ／自检脚本。`ReaderView.vue` 要判「要不要挂面板」时用**粗条件**（BYO ＋ 已登录），
 * 细判（已就绪／无 WebGPU）一律由本件的 `shouldOfferGeneration` 在里面做，避免两处口径。
 *
 * 文案一律**中文**（Ferrari 2026-10-07 裁「B」：照 §13.7 原文）—— 本面板是 reader 里
 * 唯一的非英文 UI 面，其余 reader UI 仍是英文。改文案就在这个文件里改，别散到组件里。
 *
 * 依据：Phase1-实施方案 §13.7（生成器规格 ＋ 使用规则说明六条）＋ §9.2 D20（只做当前章、
 * 约 15–20 分钟／章）＋ §13.1 判据 6（不具 WebGPU 的设备只给看说明，不给按钮）。
 */

import { bookIndexPath } from '../utils/audioCloud.js'

/** 「能不能在本机生成」的原始输入：`navigator.gpu` 在不在（与 engine.hasWebGPU 同一口径） */
export function detectWebGPU(nav = globalThis.navigator) {
  return !!(nav && nav.gpu)
}

/**
 * 该不该给这一章生成入口。四种输入任一为假都拦，**理由各不同**。
 * @param {{hasWebGPU?:boolean, isByo?:boolean, loggedIn?:boolean, alreadyReady?:boolean}} o
 * @returns {{show:boolean, offer:boolean, reason:string}}
 *   show  —— 面板要不要出现（**无 WebGPU 时仍为 true**：只给看说明，见判据 6）
 *   offer —— 生成按钮能不能点
 *   reason —— 不给按钮的原因码（空串 = 给）；文案见 GEN_REASON_HINT
 */
export function shouldOfferGeneration({ hasWebGPU, isByo, loggedIn, alreadyReady } = {}) {
  if (!isByo) return { show: false, offer: false, reason: 'not-byo' }
  if (!loggedIn) return { show: false, offer: false, reason: 'not-logged-in' }
  if (alreadyReady) return { show: false, offer: false, reason: 'already-ready' }
  if (!hasWebGPU) return { show: true, offer: false, reason: 'no-webgpu' }
  return { show: true, offer: true, reason: '' }
}

/** 不给按钮时的那一行说明（面板用；空 reason 不出文案） */
export const GEN_REASON_HINT = {
  'not-byo': '端上生成只对你自己导入的书开放。',
  'not-logged-in': '登录后才能生成 —— 音频存在你自己的账号空间里。',
  'no-webgpu': '这台设备没有 WebGPU，在这里生成要按小时算。请改用电脑。',
  'already-ready': '这一章的云端音频已经就绪。',
}

// ── pending 轮询 ────────────────────────────────────────────────────────────
/** 目标指纹：请求发起时与答复落地时都用它比，防止过期答复写回 UI */
export function chapterToken(bookId, chapterId) {
  return `${bookId || ''}/${chapterId || ''}`
}

/** 这份答复是不是过期了（发起时的目标 ≠ 现在的目标 → 用户已切章／换书，别写回） */
export function staleReply(token, currentToken) {
  return !!token && token !== currentToken
}

/** 轮询目标：这本书的云端就绪索引（服务端给了 `no-store`，否则永远读到旧索引） */
export function pendingCheckUrl(bookId) {
  return bookIndexPath(bookId)
}

/**
 * 这一章在最新索引里**仍未就绪**吗（true → 继续轮询）。
 *
 * 口径与 `audioIndex.chapterHasAudio` **故意不同**，别合并：那边问「现在能不能播」，
 * 清单缺失时按「有音频」兜底（不妄断）；这里问「还在等它出现吗」，清单缺失时
 * 恰恰等于「还没出现」→ true。两者**不需要一致**（一个偏「能播」、一个偏「还在等」），
 * 唯一成立的关系：`chapterHasAudio` 为 false ⇒ 本函数也为 false（`missing` 名单两边都认）。
 *   · index 为 null（还没拿到／404）→ true
 *   · `missing` 里点名了该章 → false（已判定没有，别空转）
 *   · `withAudio` 里点了名 → false（就绪）
 *   · 其余／形状不认识 → true（宁可多轮一次，也不误报就绪）
 */
export function stillPending(index, chapterId) {
  const id = String(chapterId || '')
  if (!id) return false
  if (!index || typeof index !== 'object' || Array.isArray(index)) return true
  const missing = index.missing
  if (missing && typeof missing === 'object' && Object.prototype.hasOwnProperty.call(missing, id)) return false
  if (!Array.isArray(index.withAudio)) return true
  return !index.withAudio.map(String).includes(id)
}

// ── 进度与预计剩余 ──────────────────────────────────────────────────────────
/**
 * 用**已跑出来的实测速度**外推剩余毫秒（不用固定 15–20 min 那张表 —— 那只是预期，
 * 实机 RTF 差一倍都可能）。第一次调用还没跑完（done = 0）→ 0：没有速度可外推，
 * 面板此时显示「估算中」而不是编一个数。
 */
export function estimateRemainingMs(done, total, elapsedMs) {
  if (!(done > 0) || !(total > 0) || !(elapsedMs > 0)) return 0
  if (done >= total) return 0
  return Math.round((elapsedMs / done) * (total - done))
}

/** 毫秒 → 粗粒度人话（面板的「约还剩 4 分钟」）：不足 1 分钟一律抹成「不到 1 分钟」 */
export function formatEta(ms) {
  const sec = Math.round((Number(ms) || 0) / 1000)
  if (sec < 60) return '不到 1 分钟'
  const min = Math.round(sec / 60)
  if (min < 60) return `约 ${min} 分钟`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `约 ${h} 小时 ${rest} 分钟` : `约 ${h} 小时`
}

// ── 使用规则说明（§13.7 六条＋ D20 的粒度／时长）────────────────────────────
export const GEN_NOTES = [
  { id: 'desktop', text: '强烈建议在电脑端操作 —— 性能足、可长时间运行、不会被系统中断。' },
  { id: 'first-download', text: '首次需下载约 90 MB 语音模型（仅一次，之后走浏览器缓存）。' },
  { id: 'foreground', text: '生成期间请让这个标签页留在前台（别切走、别最小化），也不要关闭它 —— 后台标签页会被浏览器降速甚至冻结。' },
  { id: 'mobile', text: '手机／平板可能很慢或中途被系统中断，建议改在电脑上做。' },
  { id: 'scope', text: '生成的是你自己账号空间里的音频，只有你的账号能看到。' },
  { id: 'personal', text: '音频由你自己的正文生成，仅个人使用，不用于分发。' },
]

/** 粒度（D20）：一次只做当前打开的这一章 */
export const GEN_SCOPE_NOTE = '一次只生成当前打开的这一章，不排队整本。'

/** 时长预期（依据项目日志 2026-10-07 块 C3 读数：webgpu ＋ fp16 RTF 0.84 → 平均章 ≈ 17 min） */
export const GEN_ESTIMATE_NOTE = '桌面（WebGPU ＋ fp16）实测约 15–20 分钟／章，全程需让本标签页留在前台。'
export const GEN_ESTIMATE_MINUTES = { min: 15, max: 20 }