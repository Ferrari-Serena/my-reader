/**
 * 用户数据存储统一出口。所有组件 / composable 只从这里 import，不直接触碰底层存储：
 *   · 生词本 / 删词台账 / 脏集合 —— localStorage（量小、要同步），出口在 localAdapter.js
 *   · BYO 书库（书体 + 书架索引）—— IndexedDB（量大、纯本机、不上云），出口在 bookAdapter.js
 * 产品化切后端时：新建 apiAdapter.js 实现同一组接口，在这里换出口，其余代码零改动。
 */

export {
  loadVocabulary,
  addWord,
  addWords,
  removeWord,
  removeWords,
  updateWord,
  clearVocabulary,
  importVocabulary,
  loadTombstones,
  clearTombstones,
  mergeTombstones,
  loadDirtyWords,
  saveDirtyWords,
  sync
} from './localAdapter.js'

export {
  createBookStore,
  bookStore,
  normalizeRecord,
  saveBook,
  loadBook,
  listByoBooks,
  deleteBook,
  countByoBooks,
  clearByoBooks,
  BookStoreError
} from './bookAdapter.js'
