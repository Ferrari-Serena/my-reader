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

/**
 * 「一章播完该不该自动接着播下一章」的判定（断章续播）。纯函数，组件与自检共用同一份口径。
 *
 * 返回**该续播的章下标**；不该续播 → -1（由调用方停住）。
 * 三条口径，与「手动点无音频章不自动跳」同一方向 —— 宁停不跳：
 *   - 已是最后一章 → -1
 *   - 下一章没有音频 → -1（不静默越过，免得用户以为书已经读完）
 *   - 章表为空 / 下标不是合法整数 → -1
 */
export function autoContinueTarget(index, chapters, currentIndex) {
  if (!Array.isArray(chapters)) return -1
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return -1
  const next = currentIndex + 1
  if (next >= chapters.length) return -1
  const nextChapter = chapters[next]
  if (!nextChapter || !nextChapter.id) return -1
  if (!chapterHasAudio(index, nextChapter.id)) return -1
  return next
}
