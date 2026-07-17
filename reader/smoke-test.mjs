// 模拟 localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
}

const { useVocabulary } = await import('./src/composables/useVocabulary.js')
const v = useVocabulary()
await v.init()

// 1. 添加（带 lemma 归一）
await v.add({ word: 'went', dictEntry: { lemma: 'go', definitions: ['to move'], phonetic: 'g', partOfSpeech: 'verb', level: 'SAT', chapters: ['ch-03'] }, bookId: 'the-giver', chapterId: 'ch-03' })
console.assert(v.has('go'), 'FAIL: lemma key')
console.assert(v.savedSet.value.has('go'), 'FAIL: savedSet reactivity')
console.assert(v.count.value === 1, 'FAIL: count')

// 2. 离线收藏空快照 + 自愈（表面词 key 双查）
await v.add({ word: 'ran', dictEntry: null, bookId: 'the-giver', chapterId: 'ch-04' })
console.assert(v.has('ran'), 'FAIL: offline add')
await v.refreshSnapshot('ran', { lemma: 'run', definitions: ['to move fast'] })
console.assert(v.words.value['ran'].snapshot.definitions.length === 1, 'FAIL: self-heal surface key')

// 3. 持久化 & 重载（新实例视角：直接读 localStorage 再 migrate）
const { migrate } = await import('./src/storage/schema.js')
const raw = JSON.parse(store.get('reader-vocab-v1'))
const migrated = migrate(raw)
console.assert(Object.keys(migrated.words).length === 2, 'FAIL: persisted')

// 4. 导出 → 清空 → 导入还原
const envelope = await v.exportJSON()
await v.clearAll()
console.assert(v.count.value === 0, 'FAIL: clear')
const file = { size: 100, text: async () => JSON.stringify(envelope) }
const r = await v.importJSON(file)
console.assert(r.added === 2 && v.count.value === 2, 'FAIL: import restore, got ' + JSON.stringify(r))

// 5. 二次导入全跳过
const r2 = await v.importJSON(file)
console.assert(r2.added === 0 && r2.skipped === 2, 'FAIL: merge skip')

// 6. 恶意/脏数据导入
const dirty = { size: 100, text: async () => JSON.stringify({ app: 'x', type: 'vocabulary', schemaVersion: 1, data: { version: 1, words: { '__proto__': { word: 'evil' }, 'ok': { word: 'ok', snapshot: { level: 5, definitions: ['a', {bad:1}] } } } } }) }
const r3 = await v.importJSON(dirty)
console.assert(v.words.value['ok'].snapshot.level === null, 'FAIL: level sanitize')
console.assert(v.words.value['ok'].snapshot.definitions.length === 1, 'FAIL: defs sanitize')
console.assert(!Object.prototype.evil, 'FAIL: proto pollution')

// 7. 移除
await v.remove('go')
console.assert(!v.has('go') && !v.savedSet.value.has('go'), 'FAIL: remove reactivity')

console.log('ALL PASSED')
