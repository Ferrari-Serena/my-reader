/**
 * 同步纯逻辑 + 存储层验证（不依赖浏览器 / 网络）。
 *   sync/merge.js     — planMerge / 时钟校正
 *   sync/progress.js  — 进度键格式 / 收集 / LWW 回写
 *   storage/schema.js — updatedAt 落盘往返
 *   storage/localAdapter.js — 墓碑台账
 * 用法: node verify-sync.mjs
 *
 * 与 verify-core.mjs 同一套 t(name, cond) 写法；localStorage 打桩同 smoke-test.mjs。
 */

// ── localStorage 打桩（必须在 import 业务模块之前） ──
const store = new Map()
let setCount = 0 // 统计落盘次数：批量写应当只写一次，逐条写会写成 N 次
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { setCount++; store.set(k, String(v)) },
  removeItem: k => store.delete(k),
  // collectLocalProgress 要遍历整个 localStorage，所以打桩也得有 key/length
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

const { planMerge, entryTime, computeClockOffset, adjustedNowIso } = await import('./src/sync/merge.js')
const { readingStorageKey, audioStorageKey, collectLocalProgress, applyRemoteProgress } =
  await import('./src/sync/progress.js')
const { sanitizeEntry } = await import('./src/storage/schema.js')
const storage = await import('./src/storage/localAdapter.js')
const { mergeAndApply } = await import('./src/composables/useSync.js')
const { useVocabulary } = await import('./src/composables/useVocabulary.js')

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const T0 = '2025-12-31T00:00:00.000Z'
const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-01-02T00:00:00.000Z'
const T3 = '2026-01-03T00:00:00.000Z'
const entry = (v, ts) => ({ word: 'w', updatedAt: ts, snapshot: { definitions: [v] } })
const val = e => e.snapshot.definitions[0]

console.log('\n[merge.js — 存活条目的新旧判定]')
{
  const local = { apple: entry('local', T1) }
  t('远程更旧 → 不采纳，本地保留',
    planMerge(local, { apple: entry('remote', T0) }, {}).apply.length === 0)
  const r = planMerge(local, { apple: entry('remote', T2) }, {})
  t('远程更新 → 采纳', r.apply.length === 1 && val(r.apply[0].entry) === 'remote')
  t('并列 → 不动作', planMerge(local, { apple: entry('remote', T1) }, {}).apply.length === 0)
  t('本地没有 → 直接采纳', planMerge({}, { apple: entry('remote', T1) }, {}).apply.length === 1)
  t('缺 updatedAt → 回退 addedAt',
    entryTime({ word: 'w', addedAt: T1 }) === T1)
  t('两个时间戳都缺 → 空串', entryTime({ word: 'w' }) === '')
}

console.log('\n[merge.js — 墓碑]')
{
  const local = { apple: entry('local', T1) }
  const r1 = planMerge(local, {}, { apple: T2 })
  t('墓碑更新 → 进 remove', r1.remove.length === 1 && r1.remove[0] === 'apple')
  // 本地这次收藏（T3）晚于远程的删除（T2）→ 用户是删了之后又重新收藏的
  const r2 = planMerge({ apple: entry('local', T3) }, {}, { apple: T2 })
  t('本地比墓碑新（删后又收藏）→ 进 repush 而不是 remove',
    r2.repush.includes('apple') && r2.remove.length === 0)
  t('本地没有该词 → 墓碑无事可做',
    planMerge({}, {}, { apple: T2 }).remove.length === 0)
  t('并列（同刻）→ 判为删除生效',
    planMerge({ apple: entry('local', T2) }, {}, { apple: T2 }).remove.includes('apple'))
  t('畸形墓碑时间戳被忽略',
    planMerge(local, {}, { apple: '' }).remove.length === 0)
}

console.log('\n[merge.js — 墓碑不能混进 words（否则删除退化成空操作）]')
{
  // 这正是审查指出的坑：把墓碑当 entry 传进来，remoteTime 会是空串
  const local = { apple: entry('local', T1) }
  const wrong = planMerge(local, { apple: { word: 'apple' } }, {})
  t('墓碑若误作存活条目传入 → 时间戳为空串，确实什么都不会发生（所以必须分开传）',
    wrong.apply.length === 0 && wrong.remove.length === 0)
  t('正确分开传 → 删除生效',
    planMerge(local, {}, { apple: T2 }).remove.includes('apple'))
}

console.log('\n[merge.js — 本地未推出去的删除不能被远程存活写复活]')
{
  // 场景：本机离线删掉了 apple（本地词条已无，台账留着删除时刻 T2），
  // 而服务端上 apple 仍是更早的存活版本（T1）。拉取绝不能把它加回来，
  // 否则「离线删词」会被下一次冷启动静默撤销。
  const tombs = { apple: T2 }
  const r1 = planMerge({}, { apple: entry('remote', T1) }, {}, tombs)
  t('本地墓碑更新 → 不 apply（删除赢）', r1.apply.length === 0)
  // 反过来：远程存活写确实更新（T3 > T2）→ 交给 retireTombstone，应当复活
  const r2 = planMerge({}, { apple: entry('remote', T3) }, {}, tombs)
  t('远程存活写更新 → apply（这次复活是对的）',
    r2.apply.length === 1 && val(r2.apply[0].entry) === 'remote')
  // 并列：删除与存活同刻 → 删除赢，与既有的「并列判删除生效」同口径
  t('并列 → 删除赢', planMerge({}, { apple: entry('remote', T2) }, {}, tombs).apply.length === 0)
  // 没有本地墓碑时行为必须完全不变
  t('无本地墓碑 → 照常 apply',
    planMerge({}, { apple: entry('remote', T1) }, {}, {}).apply.length === 1)
  // 本地词条还在时，仍以词条时间戳为准，不被台账干扰
  t('本地词条存在时仍按词条比时间',
    planMerge({ apple: entry('local', T1) }, { apple: entry('remote', T2) }, {}, { apple: T3 }).apply.length === 1)
  // 畸形空值不得把正常 apply 挡掉
  t('台账值为空串 → 不挡',
    planMerge({}, { apple: entry('remote', T1) }, {}, { apple: '' }).apply.length === 1)
}

console.log('\n[端到端 — mergeAndApply 走真 storage，离线删除不得被复活]')
{
  store.clear()
  await storage.clearVocabulary()                       // 清内存文档 + localStorage
  store.set('reader-vocab-tombstones', JSON.stringify({ abandon: T2 })) // 只留这一条台账
  const remote = ts => ({ abandon: { word: 'abandon', addedAt: ts, updatedAt: ts, snapshot: { definitions: ['放弃'] } } })
  const vocab1 = { words: { value: {} }, markDirty() {} }
  const p1 = await mergeAndApply(vocab1, remote(T1), {})
  t('拉取没有把词加回本地', p1.apply.length === 0 && Object.keys(vocab1.words.value).length === 0)
  t('删除台账仍在（等着被推出去）', storage.loadTombstones().abandon === T2)
  const vocab2 = { words: { value: {} }, markDirty() {} }
  const p2 = await mergeAndApply(vocab2, remote(T3), {})
  t('远程存活写更新 → 正常复活', p2.apply.length === 1 && !!vocab2.words.value.abandon)
  t('复活后台账被清掉', !storage.loadTombstones().abandon)
  // 复位共享状态，别把后面「新增不产生墓碑」那类用例带脏
  await storage.clearVocabulary()
  storage.clearTombstones(Object.keys(storage.loadTombstones()))
}

console.log('\n[merge.js — 时钟校正]')
{
  t('慢 1 小时的设备被校正回来',
    computeClockOffset('2026-01-01T01:00:00.000Z', Date.parse('2026-01-01T00:00:00.000Z')) === 3600000)
  t('准时钟 → 偏移 0',
    computeClockOffset('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:00:00.000Z')) === 0)
  t('偏移超一天视为坏钟 → 不校正',
    computeClockOffset('2027-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:00:00.000Z')) === 0)
  t('serverNow 非法 → 不校正', computeClockOffset('garbage', Date.now()) === 0)
  t('校正后的时间戳是统一精度的 ISO 串',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      adjustedNowIso(3600000, Date.parse('2026-01-01T00:00:00.000Z'))))
  t('校正确实把时间往前推了',
    adjustedNowIso(3600000, Date.parse('2026-01-01T00:00:00.000Z')) === '2026-01-01T01:00:00.000Z')
}

console.log('\n[schema.js — updatedAt 必须能落盘往返]')
{
  const clean = sanitizeEntry({ word: 'Apple', addedAt: T1, updatedAt: T2, snapshot: { definitions: ['x'] } })
  t('updatedAt 不再被白名单剥掉', clean.updatedAt === T2)
  t('word 归一为小写', clean.word === 'apple')
  const legacy = sanitizeEntry({ word: 'pear', addedAt: T1, snapshot: { definitions: ['y'] } })
  t('存量条目缺 updatedAt → 回退 addedAt', legacy.updatedAt === T1)
  const dirty = sanitizeEntry({ word: 'fig', addedAt: T1, updatedAt: 12345, snapshot: {} })
  t('updatedAt 不是字符串 → 回退 addedAt（绝不留 null）', dirty.updatedAt === T1)
  const injected = sanitizeEntry({ word: 'kiwi', addedAt: T1, __evil: 'x', snapshot: { definitions: ['z'], evil: 1 } })
  t('未知字段被剪裁', !('__evil' in injected) && !('evil' in injected.snapshot))
}

console.log('\n[localAdapter — 墓碑台账]')
{
  await storage.clearVocabulary()
  await storage.addWord({ word: 'alpha', addedAt: T1, updatedAt: T1, snapshot: { definitions: ['a'] } })
  t('新增不产生墓碑', Object.keys(storage.loadTombstones()).length === 0)

  await storage.removeWord('alpha')
  const tombs = storage.loadTombstones()
  t('removeWord 自动记台账', typeof tombs.alpha === 'string' && tombs.alpha.length > 0)
  t('词已从词表移除', !(await storage.loadVocabulary()).words.alpha)

  // 删了又加 = 复活，时间戳必须严格晚于墓碑
  await storage.addWord({ word: 'alpha', addedAt: T1, updatedAt: T1, snapshot: { definitions: ['a2'] } })
  const after = await storage.loadVocabulary()
  t('复活后台账被清掉', !('alpha' in storage.loadTombstones()))
  t('复活的时间戳严格晚于墓碑', after.words.alpha.updatedAt > tombs.alpha)

  // clearVocabulary 要给每个词留墓碑
  await storage.addWord({ word: 'beta', addedAt: T1, updatedAt: T1, snapshot: { definitions: ['b'] } })
  await storage.clearVocabulary()
  t('clearAll 给每个词留下墓碑',
    Object.keys(storage.loadTombstones()).includes('beta'))
  t('clearAll 后词表为空', Object.keys((await storage.loadVocabulary()).words).length === 0)
}

console.log('\n[localAdapter — updateWord 也要过 sanitize]')
{
  await storage.clearVocabulary()
  await storage.addWord({ word: 'gamma', addedAt: T1, updatedAt: T1, snapshot: { definitions: ['g'] } })
  await storage.updateWord('gamma', { __evil: 'x', snapshot: { definitions: ['g2'], evil: 1 } })
  const w = (await storage.loadVocabulary()).words.gamma
  t('补丁里的未知字段被挡下', !('__evil' in w) && !('evil' in w.snapshot))
  t('合法字段正常更新', w.snapshot.definitions[0] === 'g2')
}

console.log('\n[progress.js — 键格式（换域名不能让进度变孤儿）]')
{
  t('阅读键不带域名', readingStorageKey('artemis-fowl') === 'reader-reading-pos:artemis-fowl')
  t('音频键定位到章', audioStorageKey('artemis-fowl', 'ch-001') === 'reader-audio-pos:artemis-fowl/ch-001')
  t('音频键不含音频 URL', !audioStorageKey('b', 'c').includes('http'))
}

console.log('\n[progress.js — 收集与回写]')
{
  store.clear()
  localStorage.setItem(readingStorageKey('b1'), JSON.stringify({ chapterId: 'ch-002', paragraphIndex: 5, updatedAt: T2 }))
  localStorage.setItem(audioStorageKey('b1', 'ch-002'), JSON.stringify({ seconds: 42.5, updatedAt: T3 }))
  // 旧格式（裸秒数）：没有时间戳，参与不了 LWW，必须被跳过
  localStorage.setItem('reader-audio-pos:https://old.example/x.mp3', '99')
  // 无关的键不能混进来
  localStorage.setItem('reader-vocab-v1', '{"words":{}}')

  const p = collectLocalProgress()
  t('收集到阅读进度', p['reading:b1']?.payload?.chapterId === 'ch-002')
  t('收集到音频进度', p['audio:b1/ch-002']?.payload?.seconds === 42.5)
  t('裸秒数的旧条目被跳过（无 updatedAt 无法比新旧）', !('audio:https://old.example/x.mp3' in p))
  t('非进度键不进载荷', !Object.keys(p).some(k => k.includes('vocab')))
  t('同步键带类型前缀', Object.keys(p).every(k => k.startsWith('reading:') || k.startsWith('audio:')))

  // 回写：远程更新才写，本地更新时本地赢——否则正在读的设备会被别的设备拽回去
  const wrote = applyRemoteProgress({
    'reading:b1': { chapterId: 'ch-009', paragraphIndex: 1, updatedAt: T1 }, // 更旧 → 不写
    'audio:b1/ch-002': { seconds: 7, updatedAt: T3 },                          // 并列 → 不写
    'reading:b2': { chapterId: 'ch-001', paragraphIndex: 0, updatedAt: T3 },  // 本地没有 → 写
  })
  t('远程更旧不写回', !wrote.includes(readingStorageKey('b1')))
  t('并列不写回', !wrote.includes(audioStorageKey('b1', 'ch-002')))
  t('本地没有的键写回', wrote.includes(readingStorageKey('b2')))
  t('写回的是同名 localStorage 键（阅读页无需改动）',
    JSON.parse(localStorage.getItem(readingStorageKey('b2'))).chapterId === 'ch-001')
  t('本地较新的进度没被覆盖',
    JSON.parse(localStorage.getItem(readingStorageKey('b1'))).chapterId === 'ch-002')

  // 推送窗口上限：按时间倒序取最近的，避免一个读了很多书的设备每次推几千条
  store.clear()
  for (let i = 0; i < 320; i++) {
    const ts = new Date(Date.parse(T0) + i * 60000).toISOString()
    localStorage.setItem(readingStorageKey('bk' + i), JSON.stringify({ chapterId: 'ch-001', paragraphIndex: 0, updatedAt: ts }))
  }
  const capped = collectLocalProgress()
  t('推送窗口有上限', Object.keys(capped).length === 300)
  t('截断保留的是最新的那批', 'reading:bk319' in capped && !('reading:bk0' in capped))
}

console.log('\n[mergeAndApply — 批量落盘（一次写，不是每条一次）]')
{
  store.clear()
  await storage.clearVocabulary()
  storage.clearTombstones(Object.keys(storage.loadTombstones()))

  const remote = {}
  for (let i = 0; i < 8; i++) {
    remote['w' + i] = { word: 'w' + i, addedAt: T1, updatedAt: T1, snapshot: { definitions: ['d' + i] } }
  }
  remote.ws = { word: 'ws', addedAt: T1, updatedAt: T1, snapshot: { definitions: ['d'], surfaces: ['wss'] } }

  setCount = 0
  const vocab = { words: { value: {} }, markDirty() {} }
  await mergeAndApply(vocab, remote, {})
  t('远程写全部落盘', Object.keys((await storage.loadVocabulary()).words).length === 9)
  t('响应式状态同步拿到全部', Object.keys(vocab.words.value).length === 9)
  t('9 条只写了一次 localStorage（逐条 persist 就是 O(N²)）', setCount === 1, 'got ' + setCount)
  t('surfaces 没在净化时被剪掉（否则收藏态高亮只剩词头）',
    vocab.words.value.ws?.snapshot?.surfaces?.join() === 'wss')
  t('surfaces 非数组 → 空数组', sanitizeEntry({ word: 'go', snapshot: { surfaces: 'went' } }).snapshot.surfaces.length === 0)

  const tombsBefore = JSON.stringify(storage.loadTombstones())
  setCount = 0
  const plan = await mergeAndApply(vocab, {}, { w0: T2, w1: T2 })
  t('远程墓碑批量删除生效', plan.remove.length === 2 && !(await storage.loadVocabulary()).words.w0)
  t('应用远程墓碑不记本地台账', JSON.stringify(storage.loadTombstones()) === tombsBefore)
  t('批量删除也只写一次', setCount === 1, 'got ' + setCount)
}

console.log('\n[budget.js — keepalive 64 KiB 预算]')
{
  const { KEEPALIVE_BODY_LIMIT, utf8Bytes, budgetKeepaliveParts } = await import('./src/sync/budget.js')
  const code = 'ABCD2345'
  const bytesOf = (b) => utf8Bytes(JSON.stringify({ code, words: b.words, tombstones: b.tombstones }))
    + utf8Bytes(JSON.stringify({ code, entries: b.progress }))

  const small = budgetKeepaliveParts({
    code,
    words: { go: { word: 'go', updatedAt: T1, snapshot: { definitions: ['x'] } } },
    tombstones: { gone: T2 },
    progress: { 'reading:b1': { payload: { chapterId: 'ch-001', updatedAt: T2 }, updatedAt: T2 } }
  })
  t('小载荷原样通过',
    Object.keys(small.words).length === 1 && small.tombstones.gone === T2
    && !!small.progress['reading:b1'] && small.droppedWords.length === 0)

  const words = {}
  for (let i = 0; i < 400; i++) {
    words['w' + i] = { word: 'w' + i, updatedAt: new Date(Date.parse(T0) + i * 1000).toISOString(), snapshot: { definitions: ['x'.repeat(400)] } }
  }
  const big = budgetKeepaliveParts({ code, words, tombstones: { t1: T1, t2: T2 }, progress: {} })
  const bigTotal = bytesOf(big)
  t('超预算时总字节数不超上限', bigTotal <= KEEPALIVE_BODY_LIMIT, bigTotal + ' bytes')
  t('确实裁掉了词', big.droppedWords.length > 0, 'dropped ' + big.droppedWords.length)
  t('裁掉 + 保留 = 全部', big.droppedWords.length + Object.keys(big.words).length === 400)
  t('保留的是最新那批（倒序截断）', 'w399' in big.words && !('w0' in big.words))

  const progress = {}
  for (let i = 0; i < 800; i++) {
    const ts = new Date(Date.parse(T0) + i * 1000).toISOString()
    progress['reading:b' + i] = { payload: { chapterId: 'ch-001', paragraphIndex: 0, pad: 'y'.repeat(100), updatedAt: ts }, updatedAt: ts }
  }
  const mixed = budgetKeepaliveParts({ code, words: { go: words.w0 }, tombstones: { t1: T1 }, progress })
  const mixedTotal = bytesOf(mixed)
  t('进度重的场景也不超上限', mixedTotal <= KEEPALIVE_BODY_LIMIT, mixedTotal + ' bytes')
  t('自愈的进度被裁（下次重推）', Object.keys(mixed.progress).length < 800)
  t('被裁后仍保留最新的进度', 'reading:b799' in mixed.progress && !('reading:b0' in mixed.progress))
  t('词与墓碑在预算内完整保留', 'go' in mixed.words && mixed.tombstones.t1 === T1)

  const tiny = budgetKeepaliveParts({ code, words: { a: words.w0, b: words.w1 }, tombstones: {}, progress: {} }, 120)
  t('预算连信封都装不下时全部裁掉，不抛错',
    tiny.droppedWords.length === 2 && Object.keys(tiny.words).length === 0 && bytesOf(tiny) <= 120)
}

console.log('\n[progressMigrate — 旧音频续播位置（URL 键 + 裸秒数）]')
{
  const { migrateAudioPositions, MIGRATED_AT } = await import('./src/sync/progressMigrate.js')
  store.clear()
  localStorage.setItem('reader-audio-pos:/books/the-giver/audio/ch-04.mp3', '590.049')
  localStorage.setItem('reader-audio-pos:/my-reader/books/the-giver/audio/ch-05.mp3', '12')
  localStorage.setItem('reader-audio-pos:/books/b/audio/bad.mp3', 'NaN')
  localStorage.setItem('reader-audio-pos:https://old.example/x.mp3', '99')
  localStorage.setItem(audioStorageKey('artemis-fowl', 'ch-01'), JSON.stringify({ seconds: 7, updatedAt: T3 }))
  localStorage.setItem(readingStorageKey('the-giver'), JSON.stringify({ chapterId: 'ch-04', paragraphIndex: 3, updatedAt: T3 }))

  const r = migrateAudioPositions()
  t('两条旧键都迁移了', r.migrated === 2, JSON.stringify(r))
  t('三条旧键被清掉', r.removed === 3, JSON.stringify(r))
  t('新键与值形状正确',
    JSON.parse(localStorage.getItem(audioStorageKey('the-giver', 'ch-04'))).seconds === 590.049)
  t('子路径前缀的旧键也认得出',
    JSON.parse(localStorage.getItem(audioStorageKey('the-giver', 'ch-05'))).seconds === 12)
  t('迁移值带最旧时间戳（不许压过别的设备的更新）',
    JSON.parse(localStorage.getItem(audioStorageKey('the-giver', 'ch-04'))).updatedAt === MIGRATED_AT)
  t('坏值只删不迁',
    localStorage.getItem('reader-audio-pos:/books/b/audio/bad.mp3') === null
    && !localStorage.getItem(audioStorageKey('b', 'bad')))
  t('认不出形状的旧键不动',
    localStorage.getItem('reader-audio-pos:https://old.example/x.mp3') === '99')
  t('已是新键的不被动',
    JSON.parse(localStorage.getItem(audioStorageKey('artemis-fowl', 'ch-01'))).seconds === 7)
  t('阅读进度键不被动', localStorage.getItem(readingStorageKey('the-giver')) !== null)
  t('迁移后的值能被推送采集到（有 updatedAt 才参与 LWW）',
    collectLocalProgress()['audio:the-giver/ch-04']?.payload?.seconds === 590.049)
  t('幂等：再跑一次什么都迁移不了', migrateAudioPositions().migrated === 0)

  store.clear()
  localStorage.setItem('reader-audio-pos:/books/b/audio/c.mp3', '5')
  localStorage.setItem(audioStorageKey('b', 'c'), JSON.stringify({ seconds: 99, updatedAt: T3 }))
  const r2 = migrateAudioPositions()
  t('已有新键 → 不覆盖，旧键照样清掉',
    r2.migrated === 0 && r2.skipped === 1
    && JSON.parse(localStorage.getItem(audioStorageKey('b', 'c'))).seconds === 99
    && localStorage.getItem('reader-audio-pos:/books/b/audio/c.mp3') === null)
}

console.log('\n[0.1 — 脏词集合持久化（关页重开不丢欠推）]')
{
  const DIRTY_KEY = 'reader-vocab-dirty'
  const readDirty = () => {
    const r = store.get(DIRTY_KEY)
    return r === undefined ? null : JSON.parse(r)
  }

  store.delete(DIRTY_KEY)
  const v = useVocabulary()
  const leftover = v.pendingDirty()
  if (leftover.length) v.clearDirty(leftover) // 清干净起步（内存 + 盘）

  v.markDirty('Go', 'went')
  t('markDirty 立即落盘（小写化）', JSON.stringify(readDirty()) === JSON.stringify(['go', 'went']))

  const before = setCount
  v.markDirty('GO')
  t('重复标脏不再写盘', setCount === before && readDirty().length === 2)

  // 模拟「关页重开」：新模块实例的内存脏集合是空的，只能靠 localStorage 恢复
  const fresh = (await import('./src/composables/useVocabulary.js?reloaded=1')).useVocabulary()
  t('重开后脏词仍在（从 localStorage 恢复）', fresh.pendingDirty().sort().join() === 'go,went')

  // 回归（0.1 真机验收抓到）：清账必须发生在**推送成功之后**。取待推集合这一动作本身
  // 绝不能清盘 —— 否则关页打断推送时（keepalive 请求刚发出、catch 永不执行）欠推记录
  // 连盘一起消失，下次冷启动无词可补推。旧实现 takeDirty() 就是「先清盘」的写法。
  t('pendingDirty 只读：读不改盘',
    fresh.pendingDirty().sort().join() === 'go,went' && readDirty().length === 2)
  const freshX = (await import('./src/composables/useVocabulary.js?reloaded=1b')).useVocabulary()
  freshX.pendingDirty() // 旧实现在这一步就把盘清了；新实现读多少次都不改盘
  const afterPeek = (await import('./src/composables/useVocabulary.js?reloaded=1c')).useVocabulary()
  t('（回归）取待推集合后重开，欠推记录仍在盘上', afterPeek.pendingDirty().sort().join() === 'go,went')

  t('clearDirty 只划掉指定词并落盘',
    fresh.clearDirty(['go']) && JSON.stringify(readDirty()) === JSON.stringify(['went']))
  t('clearDirty 清空后删键（不留 [] 垃圾）', fresh.clearDirty(['went']) && readDirty() === null)
  t('清空后再读为空（不会重复推）', fresh.pendingDirty().length === 0)

  // 恢复时不能按「词表里有没有」过滤：空壳词、已删词的墓碑都交给 pushNow 自己判
  fresh.markDirty('ghost')
  const fresh2 = (await import('./src/composables/useVocabulary.js?reloaded=2')).useVocabulary()
  t('恢复不按词表过滤（交给 pushNow 判）', fresh2.pendingDirty().includes('ghost'))
  fresh2.markAllDirty()
  t('markAllDirty 也落盘且与内存一致',
    JSON.stringify(readDirty()) === JSON.stringify(fresh2.pendingDirty()))
  fresh2.clearDirty(fresh2.pendingDirty())
  t('收尾：持久化副本已清空', readDirty() === null)
  const v2 = useVocabulary()
  v2.clearDirty(v2.pendingDirty()) // 最早那个模块实例的内存也清掉，别干扰后面的冷启动用例
}

console.log('\n[0.1 — 冷启动补推（拉成功后，有欠推脏词才发 /push）]')
{
  const calls = []
  const realFetch = globalThis.fetch
  const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj })
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null })
    if (u.includes('/pull')) {
      return jsonRes({
        words: { apple: { word: 'apple', updatedAt: T1, snapshot: { definitions: ['apple-fruit'] } } },
        tombstones: {}, progress: {}
      })
    }
    if (u.includes('/push')) return jsonRes({ rejected: 0 })
    return jsonRes({})
  }
  const tick = (ms) => new Promise(r => setTimeout(r, ms))
  const waitPush = async () => {
    for (let i = 0; i < 30 && !calls.some(c => c.url.includes('/push')); i++) await tick(10)
  }

  // 对照：没有欠推脏词 → 只拉不推
  store.set('reader-sync-code', 'SIMCODE1')
  ;(await import('./src/composables/useSync.js?sim=B')).useSync()
  await tick(30)
  t('对照：无欠推脏词 → 拉了一次但不补推',
    calls.filter(c => c.url.includes('/pull')).length >= 1 && calls.every(c => !c.url.includes('/push')))

  // 正例：有欠推脏词 → 冷启动补推一次
  calls.length = 0
  useVocabulary().markDirty('apple')
  ;(await import('./src/composables/useSync.js?sim=A')).useSync()
  await waitPush()
  const pushA = calls.find(c => c.url.includes('/push'))
  t('有欠推脏词 → 冷启动补推 /push', !!pushA)
  t('推的正是那个欠推词', !!pushA && !!pushA.body && 'apple' in pushA.body.words)

  // 回归（0.1 真机验收抓到）：推送失败/被关页打断时，欠推记录必须留在盘上。
  // 旧实现「先 takeDirty 清盘、失败再 markDirty 还回来」在关页那条路径上不成立。
  globalThis.fetch = async () => { throw new Error('simulated offline / page death') }
  const vs = useVocabulary()
  store.delete('reader-vocab-dirty')
  vs.markDirty('apple')
  await (await import('./src/composables/useSync.js?sim=C')).useSync().push()
  const kept = store.get('reader-vocab-dirty')
  t('（回归）推送失败后欠推记录仍留在盘上',
    kept !== undefined && JSON.parse(kept).includes('apple'))

  globalThis.fetch = realFetch
  store.delete('reader-sync-code')
  const vc = useVocabulary()
  vc.clearDirty(vc.pendingDirty())
}

console.log('\n[第 3 步 — 登录 ↔ 数据：租户键对账判据（纯函数）]')
{
  const { tenantAction } = await import('./src/sync/tenant.js')
  t('账号还没主码 -> claim（拿本机码去认领）', tenantAction({ accountCode: null, localCode: 'AAAAAAAA' }) === 'claim')
  t('账号没主码 ＋ 本机也没码 -> 还是 claim（让服务端铸一个）', tenantAction({ accountCode: '', localCode: '' }) === 'claim')
  t('账号有主码、本机不同 -> adopt（接管）', tenantAction({ accountCode: 'AAAAAAAA', localCode: 'BBBBBBBB' }) === 'adopt')
  t('两边一样 -> none（幂等，不白跑网络）', tenantAction({ accountCode: 'AAAAAAAA', localCode: 'AAAAAAAA' }) === 'none')
  t('账号有主码、本机没码 -> adopt（这就是「换新设备登录」）', tenantAction({ accountCode: 'AAAAAAAA', localCode: '' }) === 'adopt')
}

console.log('\n[第 3 步 — adoptCode：换租户键的三件事]')
{
  const realFetch = globalThis.fetch
  const calls = []
  const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj })
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null })
    if (u.includes('/pull')) {
      return jsonRes({ words: { beta: { word: 'beta', updatedAt: T1, snapshot: { definitions: ['b'] } } }, tombstones: {}, progress: {} })
    }
    if (u.includes('/push')) return jsonRes({ rejected: 0 })
    return jsonRes({})
  }
  const tick = (ms) => new Promise(r => setTimeout(r, ms))

  // 本机先有一个词（走正常存储通道写进去），再起一个带旧码的实例
  await mergeAndApply(useVocabulary(), { gamma: { word: 'gamma', updatedAt: T1, snapshot: { definitions: ['g'] } } }, {})
  const vc2 = useVocabulary()
  vc2.clearDirty(vc2.pendingDirty())
  store.delete('reader-vocab-dirty')
  store.delete('reader-sync-code-previous')
  store.set('reader-sync-code', 'OLDCODE1')

  const mod = await import('./src/composables/useSync.js?sim=TENANT')
  const sync = mod.useSync()
  t('实例起来时用的是盘上的旧码', sync.code.value === 'OLDCODE1')
  await tick(40)
  calls.length = 0

  const ok = await sync.adoptCode('NEWCODE2')
  t('adoptCode 成功', ok === true)
  t('① 键换成新码', sync.code.value === 'NEWCODE2')
  t('① 新码落盘（刷新后还认得）', store.get('reader-sync-code') === 'NEWCODE2')
  t('② 旧码挪到备份位、没被删', store.get('reader-sync-code-previous') === 'OLDCODE1')
  t('③ 先拉一次新键', calls.some(c => c.url.includes('/pull?code=NEWCODE2')))
  await tick(60)
  const push = calls.find(c => c.url.includes('/push'))
  t('③ 随后把本机词整体推给新键', !!push && push.body && push.body.code === 'NEWCODE2')
  t('推的里面真有本机原有的那个词', !!push && !!push.body && 'gamma' in push.body.words)

  // 形状不对的码：不动任何东西
  calls.length = 0
  t('码长度不对 -> 拒绝且不改键', (await sync.adoptCode('AB')) === false && sync.code.value === 'NEWCODE2')
  t('拒绝时不发任何请求', calls.length === 0)
  // 同一个码：幂等
  calls.length = 0
  t('同一个码 -> true 且不重新拉推', (await sync.adoptCode('NEWCODE2')) === true && calls.length === 0)

  globalThis.fetch = realFetch
  store.delete('reader-sync-code')
  store.delete('reader-sync-code-previous')
}

console.log('\n[第 3 步 — reconcileTenant：把「认领」与「换键」串起来]')
{
  const realFetch = globalThis.fetch
  const calls = []
  const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj })
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null })
    if (u.includes('/pull')) return jsonRes({ words: {}, tombstones: {}, progress: {} })
    if (u.includes('/push')) return jsonRes({ rejected: 0 })
    return jsonRes({})
  }
  const { reconcileTenant } = await import('./src/sync/tenant.js')
  const tick = (ms) => new Promise(r => setTimeout(r, ms))

  const claimCalls = [], notices = []
  // 仿真 useAuth：认领成功后它会把 user.syncCode 回写成账号主码（
  // 正是因为这个回写，后面再对账才会得到 'none' —— 不回写就会反复认领）
  const fakeAuth = (syncCode) => {
    const user = { value: { id: 'u1', email: 'a@b.co', syncCode } }
    return {
      user,
      csrf: { value: 'tok' },
      claim: async (code) => {
        claimCalls.push(code)
        user.value = { ...user.value, syncCode: 'MAINCODE' }
        return { ok: true, status: 200, data: { ok: true, code: 'MAINCODE', claimed: true } }
      },
      note: (m) => notices.push(m),
    }
  }

  t('没登录 -> null（什么都不做）', (await reconcileTenant({ user: { value: null } })) === null)

  // 账号已有主码：只接管，不认领
  claimCalls.length = 0
  const r1 = await reconcileTenant(fakeAuth('ACCTCODE'))
  t('账号有主码 -> 动作是 adopt，不去认领', r1 && r1.action === 'adopt' && claimCalls.length === 0)

  // 账号未认领：先认领、再换键，并提一句给用户
  const fake = fakeAuth(null)
  const r2 = await reconcileTenant(fake)
  t('账号没主码 -> 动作是 claim', r2 && r2.action === 'claim' && r2.claimed === true)
  t('认领时把本机码交了上去', claimCalls.length === 1)
  t('认领成功后本身也换了键', r2.code === 'MAINCODE' && store.get('reader-sync-code') === 'MAINCODE')
  t('真认领才提一句「已并入账号」', notices.length === 1 && /part of this account/.test(notices[0]))

  // 对账完了再来一次：两边一样，不白跑
  claimCalls.length = 0
  notices.length = 0
  const r3 = await reconcileTenant(fake)
  t('已对齐后再调 -> none（不重复认领/重复提醒）', r3 && r3.action === 'none' && claimCalls.length === 0 && notices.length === 0)

  globalThis.fetch = realFetch
  await tick(5)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
