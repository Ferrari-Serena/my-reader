/**
 * 用户数据存储统一出口。
 * 所有组件/composable 只从这里 import，不直接触碰 localStorage。
 * 产品化切后端时：import * as apiAdapter from './apiAdapter' 并换出口，其余代码零改动。
 */

export {
  loadVocabulary,
  addWord,
  removeWord,
  updateWord,
  clearVocabulary,
  importVocabulary,
  sync
} from './localAdapter.js'
