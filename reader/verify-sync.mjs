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
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
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

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
process.exit(fail ? 1 : 0)
