// 模拟 localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  // collectProgress 要遍历整个 localStorage，所以打桩也得有 key/length
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size }
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

// 8. 缺音频降级口径（audio-index.json → 章表徽标 / 播放器提示）
const { chapterHasAudio, noAudioReason, tocMissingAudio, noAudioLabel, noAudioTooltip, autoContinueTarget } =
  await import('./src/utils/audioIndex.js')
const mixed = { withAudio: ['ch-03'], missing: { 'ch-01': 'front_matter', 'ch-04': 'unrecorded' } }
t('清单里没有的章 → 有音频', chapterHasAudio(mixed, 'ch-03'))
t('前置页 → 无音频', !chapterHasAudio(mixed, 'ch-01') && noAudioReason(mixed, 'ch-01') === 'front_matter')
t('未录制 → 无音频', noAudioReason(mixed, 'ch-04') === 'unrecorded')
t('清单缺失 → 不妄断（按有音频）', chapterHasAudio(null, 'ch-01') && noAudioReason(null, 'ch-01') === null)
t('无章节 id → 有音频', chapterHasAudio(mixed, ''))
t('章表：混合书标缺章', Object.keys(tocMissingAudio(mixed)).length === 2)
t('章表：纯文本书不逐行标', Object.keys(tocMissingAudio({ withAudio: [], missing: { 'ch-01': 'unrecorded' } })).length === 0)
t('章表：无清单不标', Object.keys(tocMissingAudio(null)).length === 0)
t('标签与提示语有兜底', noAudioLabel('front_matter') === 'Front matter' && noAudioTooltip('unknown').length > 0)

// 8b. 断章续播：一章放完该不该自动接下一章（纯判据，不碰 vue / audio）
const chs = [{ id: 'ch-01' }, { id: 'ch-02' }, { id: 'ch-03' }, { id: 'ch-04' }]
t('中间章、下一章有音频 -> 接着播下一章', autoContinueTarget(mixed, chs, 0) === 1)
t('中间章再接一步 -> 还是接着播', autoContinueTarget(mixed, chs, 1) === 2)
t('最后一章 -> -1（停住，不绕回开头）', autoContinueTarget(mixed, chs, 3) === -1)
t('下一章没音频 -> -1（宁停不跳，不静默越过）', autoContinueTarget(mixed, chs, 2) === -1)
t('清单缺失不妄断：照样接下一章', autoContinueTarget(null, chs, 0) === 1)
t('章表为空 / 不是数组 -> -1', autoContinueTarget(mixed, [], 0) === -1 && autoContinueTarget(mixed, null, 0) === -1)
t('下标不合法（负 / 非整数 / 越界）-> -1', autoContinueTarget(mixed, chs, -1) === -1 && autoContinueTarget(mixed, chs, 1.5) === -1 && autoContinueTarget(mixed, chs, 99) === -1)
t('下一章没有 id -> -1（不把空章当章）', autoContinueTarget(mixed, [{ id: 'ch-01' }, { id: '' }], 0) === -1)

// 9. 0.6 最小导出：备份包（生词 + 墓碑 + 脏词 + 进度）导出 → 清空 → 回导还原，以及拒收与污染防护
console.log('\n[0.6 备份包 — 导出 / 回导]')
{
  const { EXPORT_KIND, EXPORT_VERSION } = await import('./src/utils/exportBundle.js')
  const storageMod = await import('./src/storage/localAdapter.js')

  // 铺垫：写一条阅读进度 + 一条音频进度
  localStorage.setItem('reader-reading-pos:the-giver',
    JSON.stringify({ chapterId: 'ch-03', paragraphIndex: 7, updatedAt: '2026-10-04T00:00:00.000Z' }))
  localStorage.setItem('reader-audio-pos:the-giver/ch-03',
    JSON.stringify({ seconds: 12.5, updatedAt: '2026-10-04T00:01:00.000Z' }))

  const backup = await v.exportBackup()
  t('备份信封形态', backup.app === 'my-reader' && backup.type === EXPORT_KIND
    && backup.exportVersion === EXPORT_VERSION && typeof backup.exportedAt === 'string')
  t('备份含生词', Object.keys(backup.data.vocabulary.words).length === 2)
  t('备份含删除台账', typeof backup.data.tombstones.go === 'string')
  t('备份含进度（阅读 + 音频）',
    !!backup.data.progress['reading:the-giver'] && !!backup.data.progress['audio:the-giver/ch-03'])
  t('备份不收非进度键', !('reader-vocab-v1' in backup.data.progress))

  // 清空：模拟换域名后 localStorage 清空（连台账一起没了）
  await v.clearAll()
  storageMod.clearTombstones(Object.keys(storageMod.loadTombstones()))
  localStorage.removeItem('reader-reading-pos:the-giver')
  localStorage.removeItem('reader-audio-pos:the-giver/ch-03')
  t('清空干净', v.count.value === 0
    && localStorage.getItem('reader-reading-pos:the-giver') === null
    && Object.keys(storageMod.loadTombstones()).length === 0)

  const bfile = { size: 4096, text: async () => JSON.stringify(backup) }
  const rb = await v.importBackup(bfile)
  t('回导：生词还原', rb.words.applied === 2 && v.count.value === 2 && v.has('ran') && v.has('ok'))
  t('回导：删除台账并入', rb.tombstones === 1 && typeof storageMod.loadTombstones().go === 'string')
  t('回导：进度 LWW 写回', rb.progress === 2
    && JSON.parse(localStorage.getItem('reader-reading-pos:the-giver')).paragraphIndex === 7
    && JSON.parse(localStorage.getItem('reader-audio-pos:the-giver/ch-03')).seconds === 12.5)

  // 本地更新的删除挡住回导复活（墓碑受保护）
  await v.remove('ok')
  await v.importBackup(bfile)
  t('本地更新的删除挡住回导复活', !v.has('ok') && v.has('ran')
    && typeof storageMod.loadTombstones().ok === 'string')

  // 拒收：非 JSON / 错类型 / 版本过新 / 词表不认识 / 超大
  async function rejected(name, fileObj) {
    try { await v.importBackup(fileObj); t(name, false, 'should have thrown') }
    catch { t(name, true) }
  }
  const mk = (obj, size) => ({ size: size || 4096, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) })
  await rejected('拒收：非法 JSON', mk('{ not json'))
  await rejected('拒收：非 my-reader 备份', mk({ app: 'x', type: 'vocabulary', schemaVersion: 1, data: { version: 1, words: {} } }))
  await rejected('拒收：导出版本比本机新', mk({ app: 'my-reader', type: EXPORT_KIND, exportVersion: 99, data: { vocabulary: { version: 1, words: {} } } }))
  await rejected('拒收：词表版本不认识', mk({ app: 'my-reader', type: EXPORT_KIND, exportVersion: 1, data: { vocabulary: { version: 99, words: {} } } }))
  await rejected('拒收：超大文件', { size: 20 * 1024 * 1024, text: async () => '{}' })

  // 原型污染：文件里的 __proto__ 键不能落进对象/台账/进度
  const evil = JSON.parse('{"app":"my-reader","type":"my-reader-backup","exportVersion":1,"data":{'
    + '"vocabulary":{"version":1,"words":{"__proto__":{"word":"evil"},"zed":{"word":"zed"}}},'
    + '"tombstones":{"__proto__":"2026-01-01T00:00:00.000Z"},'
    + '"progress":{"reading:the-giver":{"chapterId":"ch-09","paragraphIndex":1,"updatedAt":"2027-01-01T00:00:00.000Z"},'
    + '"reading:no-ts":{"chapterId":"ch-01"},"garbage":"x"},'
    + '"dirty":[]}}')
  await v.importBackup(mk(evil))
  t('原型污染不泄漏（__proto__ 键丢弃）',
    !({}).evil && !Object.prototype.hasOwnProperty.call(storageMod.loadTombstones(), '__proto__'))
  t('合法词仍照收', v.has('zed'))
  t('进度：缺 updatedAt / 键不合规 不写；合法的照写',
    localStorage.getItem('reader-reading-pos:no-ts') === null
    && JSON.parse(localStorage.getItem('reader-reading-pos:the-giver')).chapterId === 'ch-09')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
