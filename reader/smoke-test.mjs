// 模拟 localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
}

// 计数式断言：console.assert 不改退出码、末尾又无条件打印 ALL PASSED，
// 于是这个脚本结构上不可能失败（审查抓到的一半问题就是这么藏住的）。
let pass = 0, fail = 0
function t(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

const { useVocabulary } = await import('./src/composables/useVocabulary.js')
const v = useVocabulary()
await v.init()

// 1. 添加（带 lemma 归一）
await v.add({ word: 'went', dictEntry: { lemma: 'go', definitions: ['to move'], phonetic: 'g', partOfSpeech: 'verb', level: 'SAT', chapters: ['ch-03'] }, bookId: 'the-giver', chapterId: 'ch-03' })
t('lemma key', v.has('go'))
t('savedSet reactivity', v.savedSet.value.has('go'))
t('count', v.count.value === 1)

// 2. 离线收藏空快照 + 自愈（表面词 key 双查）
await v.add({ word: 'ran', dictEntry: null, bookId: 'the-giver', chapterId: 'ch-04' })
t('offline add', v.has('ran'))
await v.refreshSnapshot('ran', { lemma: 'run', definitions: ['to move fast'] })
t('self-heal surface key', v.words.value['ran'].snapshot.definitions.length === 1)

// 3. 持久化 & 重载（新实例视角：直接读 localStorage 再 migrate）
const { migrate } = await import('./src/storage/schema.js')
const raw = JSON.parse(store.get('reader-vocab-v1'))
const migrated = migrate(raw)
t('persisted', Object.keys(migrated.words).length === 2)

// 4. 导出 → 清空 → 导入还原
const envelope = await v.exportJSON()
await v.clearAll()
t('clear', v.count.value === 0)
const file = { size: 100, text: async () => JSON.stringify(envelope) }
const r = await v.importJSON(file)
t('import restore', r.added === 2 && v.count.value === 2, 'got ' + JSON.stringify(r))

// 5. 二次导入全跳过
const r2 = await v.importJSON(file)
t('merge skip', r2.added === 0 && r2.skipped === 2)

// 6. 恶意/脏数据导入
const dirty = { size: 100, text: async () => JSON.stringify({ app: 'x', type: 'vocabulary', schemaVersion: 1, data: { version: 1, words: { '__proto__': { word: 'evil' }, 'ok': { word: 'ok', snapshot: { level: 5, definitions: ['a', {bad:1}] } } } } }) }
const r3 = await v.importJSON(dirty)
t('level sanitize', v.words.value['ok'].snapshot.level === null)
t('defs sanitize', v.words.value['ok'].snapshot.definitions.length === 1)
t('proto pollution', !Object.prototype.evil)

// 7. 移除
await v.remove('go')
t('remove reactivity', !v.has('go') && !v.savedSet.value.has('go'))

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
