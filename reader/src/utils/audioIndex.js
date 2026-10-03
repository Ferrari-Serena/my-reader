/**
 * audio-index.json（生成端产物，见 generator/pipeline/audio_index.py）的读取口径。
 * 纯函数、无 reactive —— 组件和自检脚本共用同一份判定，避免两处各写一套。
 *
 * 清单结构：
 *   { book, withAudio: [章 id], missing: { 章 id: 'front_matter' | 'unrecorded' } }
 * 原因：
 *   front_matter —— 版权页/目录页等前置页，本来就不朗读
 *   unrecorded   —— 该录没录（如 divergent 的 89 章）
 */

export const NO_AUDIO_LABEL = {
  front_matter: 'Front matter',
  unrecorded: 'Not recorded',
}

export const NO_AUDIO_TOOLTIP = {
  front_matter: 'No audio — front matter (not read aloud)',
  unrecorded: 'No audio — this chapter has not been recorded',
}

/** 该章无音频的原因；有音频、或清单缺失/无此章 → null */
export function noAudioReason(index, chapterId) {
  if (!index || !chapterId) return null
  return index.missing?.[chapterId] || null
}

/** 该章有没有音频；清单缺失时不妄断，按「有」处理（退回「点开再说」的旧行为） */
export function chapterHasAudio(index, chapterId) {
  if (!chapterId || !index) return true
  return noAudioReason(index, chapterId) === null
}

/**
 * 章表要标「无音频」的映射（章 id → 原因）。
 * 整本都没音频的纯文本书（sat-practice / 500）：逐行标没有信息量，返回空对象不标。
 */
export function tocMissingAudio(index) {
  if (!Array.isArray(index?.withAudio) || index.withAudio.length === 0) return {}
  return index.missing || {}
}

/** 无音频原因 → 短标签 */
export function noAudioLabel(reason) {
  return NO_AUDIO_LABEL[reason] || 'No audio'
}

/** 无音频原因 → 完整提示语（章表 title / 播放器副标题） */
export function noAudioTooltip(reason) {
  return NO_AUDIO_TOOLTIP[reason] || 'No chapter audio available'
}
