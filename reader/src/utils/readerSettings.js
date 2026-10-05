/**
 * 第 8 步 8.1「阅读设置」：字号 / 行距 / 页宽 / 字体的取值域、归一化与 CSS 变量换算。
 *
 * 纯逻辑（不 import Vue / storage），可直接在 Node 里断言。
 * 真正落盘与跨设备同步在 composables/useReaderSettings.js —— 走记录通道的 setting 记录
 * （固定 id `s_reader`，LWW）；这里只管「什么值合法 / 怎么变成样式」。
 *
 * 四项默认全是 null ＝「未设置」：此时**一个 CSS 变量都不下发**，排版沿用 CSS 里各屏的
 * 现值（桌面 17px / 手机 16px 的响应式默认）—— 老用户升级后视觉零变化；用户选过档位后，
 * 也只覆盖他真改过的那几项。
 */

export const READER_SETTING_KEY = 'reader'
/** 设置是单例：一台设备一份，每次写同一条记录（LWW 合并靠 updatedAt） */
export const READER_SETTING_RECORD_ID = 's_reader'

/** 档位表是唯一权威：值域由它派生，UI 标签也读它，避免两处各写一份 */
export const FONT_SIZE_OPTIONS = [15, 17, 19, 21, 23].map(v => ({ value: v, label: String(v) }))
export const LINE_HEIGHT_OPTIONS = [
  { value: 1.5, label: '紧凑' },
  { value: 1.75, label: '标准' },
  { value: 1.95, label: '宽松' },
]
export const PAGE_WIDTH_OPTIONS = [
  { value: 640, label: '窄' },
  { value: 720, label: '中' },
  { value: 900, label: '宽' },
]
export const FONT_FAMILY_OPTIONS = [
  { value: 'sans', label: '无衬线' },
  { value: 'serif', label: '衬线' },
]

export const FONT_SIZES = FONT_SIZE_OPTIONS.map(o => o.value)
export const LINE_HEIGHTS = LINE_HEIGHT_OPTIONS.map(o => o.value)
export const PAGE_WIDTHS = PAGE_WIDTH_OPTIONS.map(o => o.value)
export const FONT_FAMILIES = FONT_FAMILY_OPTIONS.map(o => o.value)

/** 字体档 -> font-family 值；sans 显式指回全局无衬线栈（与「未设置」同款） */
export const FONT_FAMILY_CSS = {
  sans: 'var(--font-sans)',
  serif: "Georgia, 'Times New Roman', serif",
}

export const DEFAULT_SETTINGS = Object.freeze({
  fontSize: null,
  lineHeight: null,
  pageWidth: null,
  fontFamily: null,
})

/** 键 -> 值域（withSetting 用） */
const DOMAIN = {
  fontSize: FONT_SIZES,
  lineHeight: LINE_HEIGHTS,
  pageWidth: PAGE_WIDTHS,
  fontFamily: FONT_FAMILIES,
}

const oneOf = (list, v) => (list.indexOf(v) >= 0 ? v : null)

/** 把任意来源（记录 / 组件事件 / 脏数据）的值收进合法域；不认识的一律 null */
export function normalizeSettings(raw) {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
  return {
    fontSize: oneOf(FONT_SIZES, o.fontSize),
    lineHeight: oneOf(LINE_HEIGHTS, o.lineHeight),
    pageWidth: oneOf(PAGE_WIDTHS, o.pageWidth),
    fontFamily: oneOf(FONT_FAMILIES, o.fontFamily),
  }
}

export function isDefaultSettings(s) {
  const n = normalizeSettings(s)
  return n.fontSize === null && n.lineHeight === null && n.pageWidth === null && n.fontFamily === null
}

/** 改一项 -> 新对象（不改入参）；未知键原样返回，值不合法则该项归位 null（＝回到默认） */
export function withSetting(settings, key, value) {
  const next = normalizeSettings(settings)
  if (!Object.prototype.hasOwnProperty.call(DOMAIN, key)) return next
  next[key] = oneOf(DOMAIN[key], value)
  return next
}

/** 归一化设置 -> 记录载荷的 value（写进 setting 记录的就这四个字段） */
export function toRecordValue(settings) {
  return normalizeSettings(settings)
}

/** 记录载荷的 value -> 归一化设置（容忍缺字段 / 脏值） */
export function fromRecordValue(value) {
  return normalizeSettings(value)
}

/**
 * 归一化设置 -> 挂在 .reader-view 上的内联 CSS 变量。
 * 只下发「用户真的选过」的项 —— 没选的项连变量都不出现，
 * CSS 里的 var(--reader-*, 现值) 兜底自动生效（见 ReaderView.vue 的 <style scoped>）。
 */
export function toCssVars(settings) {
  const s = normalizeSettings(settings)
  const out = {}
  if (s.fontSize !== null) out['--reader-font-size'] = s.fontSize + 'px'
  if (s.lineHeight !== null) out['--reader-line-height'] = String(s.lineHeight)
  if (s.pageWidth !== null) out['--reader-width'] = s.pageWidth + 'px'
  if (s.fontFamily !== null) out['--reader-font'] = FONT_FAMILY_CSS[s.fontFamily]
  return out
}
