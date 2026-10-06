/**
 * BYO 书库 + 书架聚合验证（第 5 步 5B；不依赖浏览器 / 网络 / 线上环境）。
 *   utils/bookShelf.js          — 书架聚合口径（纯函数）
 *   storage/bookAdapter.js      — 入库净化 / 书体与索引同事务 / 列书架 / 删除
 *   storage/bookDb.js           — IndexedDB 驱动（真驱动，跑在 fake-indexeddb 上）
 *   composables/useBookShelf.js — 两个来源各自降级
 * 用法: node verify-books.mjs
 *
 * 书库那一组断言（crudSuite）**跑两遍**：一次内存驱动、一次真 IndexedDB 驱动
 * （fake-indexeddb 提供 indexedDB 全局）。两边跑同一套断言，是为了逼出「只有真驱动
 * 才有的行为」—— 比如升级建店、键路径、事务回滚；内存驱动满足不了契约就会红。
 *
 * ⚠️ 覆盖边界：fake-indexeddb 是**纯 JS 重新实现**，不是浏览器引擎。它足以压住我们的
 * 用法（同一事务写两店、回滚、键路径），但引擎特有的坑它照不出来 ——
 * 真引擎那侧由浏览器实测兜（项目日志 5B 条目：本地 22 条 ＋ 线上 7 条）。
 */

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
function tEq(name, got, want) {
  t(name + `  [got ${JSON.stringify(got)}]`, JSON.stringify(got) === JSON.stringify(want))
}
async function codeOf(fn) {
  try { await fn(); return null } catch (e) { return (e && e.code) ? e.code : ('threw:' + (e && e.message)) }
}

const { BOOK_KIND, kindOfBook, builtinEntry, metaOf, sortByAddedAtDesc, columnsOf, isPublicBook, groupByCategory, categoryKeyOf, categoryLabelOf, notOnDeviceRows } = await import('./src/utils/bookShelf.js')
const { createBookStore, normalizeRecord, BookStoreError } = await import('./src/storage/bookAdapter.js')
const idbDriverDefault = await import('./src/storage/bookDb.js')
const { openBookDb, closeBookDb, BOOK_DB_NAME, BOOK_DB_VERSION, STORE_BOOKS, STORE_SHELF } = idbDriverDefault
const { useBookShelf } = await import('./src/composables/useBookShelf.js')
const { COVER_MAX_DATA_URL } = await import('./src/utils/bookCover.js')

/** 一份合法的封面 data URL（第 7 步 7.4 白名单的正样本） */
const GOOD_COVER = 'data:image/png;base64,aGVsbG8='

// ── 内存驱动（契约见 src/storage/bookDb.js 文件头）──────────────────────
// put 的做法是「先全部备好、再一次性落盘」：失败时一个字节都不落。
// 真驱动的事务原子性由下面 IDB 那组断言压（见「第二个写入不可克隆 -> 回滚」）。
const KEY_PATH = { [STORE_BOOKS]: 'bookId', [STORE_SHELF]: 'id' }
function memoryDriver(opts = {}) {
  const stores = new Map()
  const bag = (n) => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n) }
  const keyOf = (store, value) => value[KEY_PATH[store]]
  return {
    stores,
    async get(store, key) { return bag(store).get(key) },
    async all(store) { return [...bag(store).values()] },
    async count(store) { return bag(store).size },
    async put(pairs, storeNames) {
      if (opts.onPut) opts.onPut(pairs, storeNames)
      const staged = pairs.map(([store, value]) => [store, keyOf(store, value), value])
      for (const [store, key, value] of staged) bag(store).set(key, value)
    },
    async del(storeNames, keys) {
      if (opts.onDel) opts.onDel(storeNames, keys)
      for (const [store, key] of keys) bag(store).delete(key)
    },
    async clear(storeNames) {
      for (const store of storeNames) bag(store).clear()
    }
  }
}

function sampleBook(over = {}) {
  return {
    bookId: 'bk_0123456789abcdef',
    title: 'Sample',
    author: 'Anon',
    chapters: [
      { id: 'ch-01', title: 'One', paragraphs: [{ id: 'p-01-001', text: 'alpha' }, { id: 'p-01-002', text: 'beta' }] },
      { id: 'ch-02', title: 'Two', paragraphs: [{ id: 'p-02-001', text: 'gamma' }] }
    ],
    ...over
  }
}

/**
 * 书库一致性套件 —— 内存驱动与真 IDB 驱动跑的是同一套断言。
 * 只用 bookAdapter 的公开 API 与驱动的 get/count（两侧都有），不窥探实现。
 */
async function crudSuite(tag, driver) {
  const store = createBookStore(driver)
  const n = (name) => `${tag} · ${name}`

  const meta = await store.saveBook(sampleBook())
  t(n('saveBook 返回书架条目、不带正文'), meta.id === 'bk_0123456789abcdef' && !('chapters' in meta))
  t(n('书架索引里没有正文'), !('chapters' in (await driver.get(STORE_SHELF, 'bk_0123456789abcdef'))))
  t(n('书体店里有正文'), (await driver.get(STORE_BOOKS, 'bk_0123456789abcdef')).chapters.length === 2)

  tEq(n('loadBook 往返一致'), (await store.loadBook('bk_0123456789abcdef')).chapters, sampleBook().chapters)
  tEq(n('loadBook：slug id -> null'), await store.loadBook('the-giver'), null)
  tEq(n('loadBook：没有这本 -> null'), await store.loadBook('bk_ffffffffffffffff'), null)
  tEq(n('countByoBooks'), await store.countByoBooks(), 1)

  // 净化产出的是新对象：改调用方手里那份，库里那份不该跟着变
  const raw = sampleBook({ bookId: 'bk_3333333333333333', addedAt: '2025-12-01T00:00:00.000Z' })
  await store.saveBook(raw)
  raw.chapters[0].paragraphs[0].text = 'MUTATED'
  t(n('入库即快照（改原对象不影响库里）'),
    (await store.loadBook('bk_3333333333333333')).chapters[0].paragraphs[0].text === 'alpha')

  await store.saveBook(sampleBook({ author: 'Changed', addedAt: '2026-01-01T00:00:00.000Z' }))
  await store.saveBook(sampleBook({ bookId: 'bk_bbbbbbbbbbbbbbbb', addedAt: '2026-03-01T00:00:00.000Z' }))
  const list = await store.listByoBooks()
  tEq(n('同 id 覆盖不新增'), list.length, 3)
  tEq(n('列表按加入时间倒序'), list.map(b => b.id),
    ['bk_bbbbbbbbbbbbbbbb', 'bk_0123456789abcdef', 'bk_3333333333333333'])
  tEq(n('覆盖真的换了内容'), (await store.loadBook('bk_0123456789abcdef')).author, 'Changed')
  tEq(n('列表条目不带正文'), list.some(b => 'chapters' in b), false)

  // 封面（第 7 步 7.4）：书架索引要带得出来，书体记录里也留一份
  await store.saveBook(sampleBook({ bookId: 'bk_4444444444444444', coverUrl: GOOD_COVER, addedAt: '2026-02-01T00:00:00.000Z' }))
  tEq(n('封面随书架条目带出来'), (await driver.get(STORE_SHELF, 'bk_4444444444444444')).coverUrl, GOOD_COVER)
  tEq(n('书体记录里也留着封面'), (await store.loadBook('bk_4444444444444444')).coverUrl, GOOD_COVER)
  tEq(n('脏封面进不了书架索引'),
    (await store.saveBook(sampleBook({ bookId: 'bk_5555555555555555', coverUrl: 'http://x/y.png' }))).coverUrl, '')

  tEq(n('deleteBook -> true'), await store.deleteBook('bk_0123456789abcdef'), true)
  tEq(n('删除后取不到'), await store.loadBook('bk_0123456789abcdef'), null)
  tEq(n('删除后索引也没了'), await driver.get(STORE_SHELF, 'bk_0123456789abcdef'), undefined)
  tEq(n('deleteBook 坏 id -> false（不抛）'), await store.deleteBook('the-giver'), false)
  tEq(n('deleteBook 不存在的书 -> 不抛'), await store.deleteBook('bk_eeeeeeeeeeeeeeee'), true)

  await store.clearByoBooks()
  tEq(n('clear 后书体店空'), await driver.count(STORE_BOOKS), 0)
  tEq(n('clear 后索引店空'), await store.countByoBooks(), 0)
}

console.log('\n[utils/bookShelf.js — 书架聚合口径]')
{
  tEq('slug -> builtin', kindOfBook('the-giver'), BOOK_KIND.BUILTIN)
  tEq('bk_ -> byo', kindOfBook('bk_0123456789abcdef'), BOOK_KIND.BYO)
  tEq('空 id -> builtin（宁可点开报找不到，也别去查 IDB）', kindOfBook(''), BOOK_KIND.BUILTIN)
  tEq('大写 hex 不合形状 -> builtin', kindOfBook('bk_0123456789ABCDEF'), BOOK_KIND.BUILTIN)

  const be = builtinEntry({ id: ' the-giver ', title: ' The Giver ', author: 'Lois', coverUrl: 'c.png' })
  tEq('builtinEntry 去空白', [be.id, be.title, be.author], ['the-giver', 'The Giver', 'Lois'])
  tEq('builtinEntry：kind / 计数未知 / 无加入时间', [be.kind, be.chapterCount, be.charCount, be.addedAt], ['builtin', 0, 0, ''])
  tEq('builtinEntry 无 id -> null', builtinEntry({ title: 'x' }), null)
  tEq('builtinEntry 无标题 -> Untitled', builtinEntry({ id: 'x' }).title, 'Untitled')

  // 四字段（第 7 步 7.1）：原样带上；缺省回落，category 野值归 other
  const meta = builtinEntry({ id: 'jk', visibility: 'public', rights: 'public-domain', category: 'classic-fiction', license: 'Public Domain' })
  tEq('builtinEntry 带四字段', [meta.rights, meta.visibility, meta.category, meta.license],
    ['public-domain', 'public', 'classic-fiction', 'Public Domain'])
  const bare = builtinEntry({ id: 'x' })
  tEq('builtinEntry 缺四字段 -> 空 / category 归 other', [bare.rights, bare.visibility, bare.license, bare.category], ['', '', '', 'other'])
  tEq('builtinEntry 野 category 归 other', builtinEntry({ id: 'x', category: 'Classic Fiction' }).category, 'other')

  // fail-closed：公开目录只列显式 public
  tEq('visibility 缺 -> 不公开', isPublicBook(bare), false)
  tEq('visibility=private -> 不公开', isPublicBook({ visibility: 'private' }), false)
  tEq('visibility=public -> 公开', isPublicBook({ visibility: 'public' }), true)
  tEq('visibility 大小写不认（非枚举值） -> 不公开', isPublicBook({ visibility: 'Public' }), false)
  tEq('null 不公开', isPublicBook(null), false)

  const rec = sampleBook()
  const m = metaOf(normalizeRecord(rec))
  tEq('metaOf：kind / id / 计数（由净化重算）', [m.kind, m.id, m.chapterCount, m.charCount], ['byo', rec.bookId, 2, 14])
  tEq('metaOf 不夹带正文', 'chapters' in m, false)
  tEq('metaOf：用户书默认私有（决策 #9）', [m.rights, m.visibility, m.category], ['private', 'private', ''])
  tEq('metaOf：slug 记录 -> null', metaOf({ id: 'the-giver' }), null)
  tEq('metaOf：无标题 -> Untitled', metaOf({ bookId: 'bk_ffffffffffffffff' }).title, 'Untitled')
  tEq('metaOf：合法封面带出来', metaOf({ id: 'bk_ffffffffffffffff', coverUrl: GOOD_COVER }).coverUrl, GOOD_COVER)
  tEq('metaOf：脏封面丢掉', metaOf({ id: 'bk_ffffffffffffffff', coverUrl: 'http://x/y.png' }).coverUrl, '')

  const sorted = sortByAddedAtDesc([
    { id: 'a', addedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', addedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'c', addedAt: '' }
  ]).map(x => x.id)
  tEq('按加入时间倒序，缺时间戳沉底', sorted, ['b', 'a', 'c'])
  const keep = [{ id: 'x', addedAt: '1' }, { id: 'y', addedAt: '1' }]
  sortByAddedAtDesc(keep)
  tEq('排序不改原数组（返回副本）', keep.map(x => x.id), ['x', 'y'])

  // 两栏（第 7 步 7.2）
  const cols = columnsOf(
    [
      { id: 'the-giver', title: 'G', visibility: 'private' },   // 下架书：不进公开书库
      { id: 'sat-practice', title: 'S', visibility: 'public' },
      { id: 'no-vis', title: 'N' }                              // 缺字段：fail-closed 不公开
    ],
    [
      { bookId: 'bk_aaaaaaaaaaaaaaaa', title: 'B1', addedAt: '2026-01-01T00:00:00.000Z' },
      { bookId: 'bk_bbbbbbbbbbbbbbbb', title: 'B2', addedAt: '2026-02-01T00:00:00.000Z' }
    ]
  )
  tEq('公开书库：只留 public、保持原序', cols.publicBooks.map(b => b.id), ['sat-practice'])
  tEq('我的书架：按加入时间倒序', cols.mine.map(b => b.id), ['bk_bbbbbbbbbbbbbbbb', 'bk_aaaaaaaaaaaaaaaa'])
  tEq('我的书架条目一律标私有', [cols.mine[0].rights, cols.mine[0].visibility], ['private', 'private'])
  tEq('非数组输入 -> 两栏都空', columnsOf(null, undefined), { publicBooks: [], mine: [] })
  tEq('两侧坏条目都被丢掉', columnsOf([{ title: 'no id' }], [{ id: 'the-giver' }]), { publicBooks: [], mine: [] })

  // 分类分组（第 7 步 7.3）
  const groups = groupByCategory([
    { id: 'a', category: 'poetry' },
    { id: 'b', category: 'exam-prep' },
    { id: 'c', category: 'classic-fiction' },
    { id: 'd', category: 'poetry' },
    { id: 'e', category: 'weird-unknown' },
    { id: 'f' }
  ])
  tEq('分组按枚举顺序、other 沉底', groups.map(g => g.key), ['classic-fiction', 'exam-prep', 'poetry', 'other'])
  tEq('同类合并、组内保持传入顺序', groups.find(g => g.key === 'poetry').books.map(b => b.id), ['a', 'd'])
  tEq('other 收「野值」与「缺字段」', groups.find(g => g.key === 'other').books.map(b => b.id), ['e', 'f'])
  tEq('组标签可读', groups.map(g => g.label), ['Classic Fiction', 'Exam Prep', 'Poetry', 'Other'])
  tEq('空输入 -> 空分组', groupByCategory(null), [])
  tEq('categoryKeyOf / categoryLabelOf', [categoryKeyOf('exam-prep'), categoryKeyOf('nope'), categoryLabelOf('short-stories')],
    ['exam-prep', 'other', 'Short Stories'])
}

console.log('\n[storage/bookAdapter.js — 入库净化]')
{
  tEq('非 bk_ id -> BAD_ID', await codeOf(() => normalizeRecord(sampleBook({ bookId: 'the-giver' }))), 'BAD_ID')
  tEq('没有可用章 -> NO_CHAPTERS', await codeOf(() => normalizeRecord(sampleBook({ chapters: [] }))), 'NO_CHAPTERS')
  tEq('整本空 -> NO_CHAPTERS', await codeOf(() => normalizeRecord(sampleBook({
    chapters: [{ id: 'ch-01', paragraphs: [{ id: 'a', text: '   ' }] }]
  }))), 'NO_CHAPTERS')

  const dirty = normalizeRecord(sampleBook({
    title: '   ',
    chapters: [
      { id: 'ch-01', title: '', paragraphs: [{ id: 'p-01-001', text: 'keep' }, { id: 'p-01-002', text: '   ' }] },
      { id: '', paragraphs: [{ id: 'p-02-001', text: 'dropped with its chapter' }] },
      { id: 'ch-03', title: 'T', paragraphs: [] }
    ]
  }))
  tEq('空段 / 无 id 的章 / 空章全被丢掉', dirty.chapters.map(c => c.id), ['ch-01'])
  tEq('段也只剩有字的', dirty.chapters[0].paragraphs.map(p => p.id), ['p-01-001'])
  tEq('计数重算', [dirty.chapterCount, dirty.charCount], [1, 4])
  tEq('空标题 -> Untitled', dirty.title, 'Untitled')

  const withJunk = normalizeRecord(sampleBook({
    junk: 'x',
    chapters: [{ id: 'ch-01', paragraphs: [{ id: 'p-01-001', text: 'x', junk: 1 }] }]
  }))
  tEq('顶层未知字段被剪裁', 'junk' in withJunk, false)
  tEq('段上未知字段被剪裁', 'junk' in withJunk.chapters[0].paragraphs[0], false)
  tEq('产出键就是白名单', Object.keys(withJunk).sort(),
    ['addedAt', 'author', 'bookId', 'chapterCount', 'charCount', 'chapters', 'coverUrl', 'title', 'updatedAt'].sort())

  // 封面白名单（第 7 步 7.4）：只认自己产的 image data URL
  tEq('合法封面原样保留', normalizeRecord(sampleBook({ coverUrl: GOOD_COVER })).coverUrl, GOOD_COVER)
  tEq('外链封面被丢', normalizeRecord(sampleBook({ coverUrl: 'https://evil.example/x.jpg' })).coverUrl, '')
  tEq('非图片 data URL 被丢', normalizeRecord(sampleBook({ coverUrl: 'data:text/html;base64,YQ==' })).coverUrl, '')
  tEq('缺 base64 标记被丢', normalizeRecord(sampleBook({ coverUrl: 'data:image/png,YQ==' })).coverUrl, '')
  tEq('前后带空白被丢', normalizeRecord(sampleBook({ coverUrl: ' ' + GOOD_COVER })).coverUrl, '')
  tEq('没有封面 -> 空串', normalizeRecord(sampleBook()).coverUrl, '')
  tEq('封面非字符串被丢', normalizeRecord(sampleBook({ coverUrl: 42 })).coverUrl, '')
  tEq('超长封面被丢', normalizeRecord(sampleBook({ coverUrl: 'data:image/png;base64,' + 'A'.repeat(COVER_MAX_DATA_URL + 1) })).coverUrl, '')
  tEq('净化幂等（合法封面过两遍不变）', normalizeRecord(normalizeRecord(sampleBook({ coverUrl: GOOD_COVER }))).coverUrl, GOOD_COVER)
  t('addedAt / updatedAt 都是 ISO 串',
    /^\d{4}-\d{2}-\d{2}T/.test(dirty.addedAt) && /^\d{4}-\d{2}-\d{2}T/.test(dirty.updatedAt))
  tEq('显式 addedAt 被原样保留', normalizeRecord(sampleBook({ addedAt: '2026-01-01T00:00:00.000Z' })).addedAt, '2026-01-01T00:00:00.000Z')
  tEq('BookStoreError 是 Error 子类', new BookStoreError('BAD_ID') instanceof Error, true)
}

console.log('\n[storage/bookAdapter.js — 书体与书架索引（内存驱动）]')
{
  await crudSuite('内存', memoryDriver())

  const putCalls = []
  const delCalls = []
  const spy = createBookStore(memoryDriver({
    onPut: (pairs, names) => putCalls.push([names, pairs.map(p => p[0])]),
    onDel: (names, keys) => delCalls.push([names, keys.map(k => k[0])])
  }))
  await spy.saveBook(sampleBook())
  tEq('入库：put 只调一次（一个事务）', putCalls.length, 1)
  tEq('入库：两个店在同一个事务里', [...putCalls[0][0]].sort(), [STORE_BOOKS, STORE_SHELF].sort())
  tEq('入库：一次写两条（书体 + 索引）', putCalls[0][1].length, 2)
  await spy.deleteBook('bk_0123456789abcdef')
  tEq('删除：del 也只调一次（一个事务）', delCalls.length, 1)
  tEq('删除：两个店同一个事务', [...delCalls[0][0]].sort(), [STORE_BOOKS, STORE_SHELF].sort())

  const boom = memoryDriver({ onPut: () => { throw new BookStoreError('TX_FAILED', 'boom') } })
  tEq('驱动抛错时如实上抛', await codeOf(() => createBookStore(boom).saveBook(sampleBook())), 'TX_FAILED')
  tEq('抛错后书体店没留痕', boom.stores.get(STORE_BOOKS)?.size || 0, 0)
}

console.log('\n[storage/bookDb.js — 真 IndexedDB 驱动（fake-indexeddb）]')
await import('fake-indexeddb/auto')
{
  // 每个用例前把库删干净：驱动在模块级缓存连接，不先关掉 deleteDatabase 会被 blocked
  async function wipeIdb() {
    await closeBookDb()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(BOOK_DB_NAME)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  }

  await wipeIdb()
  await crudSuite('IDB', idbDriverDefault.default)

  const db = await openBookDb()
  tEq('DB 名字对', db.name, BOOK_DB_NAME)
  tEq('DB 版本对', db.version, BOOK_DB_VERSION)
  tEq('两个 store 都建出来', [...db.objectStoreNames].sort(), [STORE_BOOKS, STORE_SHELF].sort())
  const roTx = db.transaction([STORE_BOOKS, STORE_SHELF], 'readonly')
  tEq('books 的 keyPath = bookId', roTx.objectStore(STORE_BOOKS).keyPath, 'bookId')
  tEq('shelf 的 keyPath = id', roTx.objectStore(STORE_SHELF).keyPath, 'id')

  t('openBookDb 有连接缓存（两次同一连接）', (await openBookDb()) === db)
  await closeBookDb()
  const db2 = await openBookDb()
  t('close 之后能重开（且是新连接）', db2 !== db && db2.name === BOOK_DB_NAME)

  // 事务回滚：第二个写入不可结构化克隆 -> 整个事务回滚，两店都不许留痕
  const poison = normalizeRecord(sampleBook({ bookId: 'bk_9999999999999999' }))
  const poisonMeta = metaOf(poison)
  tEq('第二个写入不可克隆 -> TX_FAILED',
    await codeOf(() => idbDriverDefault.default.put(
      [[STORE_BOOKS, poison], [STORE_SHELF, { ...poisonMeta, boom: () => {} }]],
      [STORE_BOOKS, STORE_SHELF])), 'TX_FAILED')
  tEq('事务回滚：书体店没留痕', await idbDriverDefault.default.get(STORE_BOOKS, 'bk_9999999999999999'), undefined)
  tEq('事务回滚：索引店也没留痕', await idbDriverDefault.default.get(STORE_SHELF, 'bk_9999999999999999'), undefined)

  tEq('没有 IndexedDB 时 -> UNAVAILABLE', await codeOf(() => openBookDb({ factory: null })), 'UNAVAILABLE')
  tEq('空店 count = 0', await idbDriverDefault.default.count(STORE_BOOKS), 0)
  tEq('删不存在的键不抛', await codeOf(() => idbDriverDefault.default.del([STORE_SHELF], [[STORE_SHELF, 'bk_ffffffffffffffff']])), null)
  tEq('清空空的店不抛', await codeOf(() => idbDriverDefault.default.clear([STORE_SHELF])), null)
  await wipeIdb()
}

console.log('\n[composables/useBookShelf.js — 两栏 + 各自降级]')
{
  const store = createBookStore(memoryDriver())
  await store.saveBook(sampleBook({ title: 'Mine', addedAt: '2026-01-01T00:00:00.000Z' }))

  const realFetch = globalThis.fetch
  // 一本 public（该进公开书库）、一本 private（下架书，不该露面）
  const INDEX = { books: [
    { id: 'sat-practice', title: 'SAT', visibility: 'public' },
    { id: 'the-giver', title: 'The Giver', visibility: 'private' }
  ] }
  globalThis.fetch = async () => ({ ok: true, json: async () => INDEX })

  const shelf = useBookShelf({ indexUrl: 'https://example.test/book-index.json', store })
  await shelf.refresh()
  tEq('公开书库只列 public', shelf.publicBooks.value.map(b => b.id), ['sat-practice'])
  tEq('我的书架放 BYO', shelf.myBooks.value.map(b => b.id), ['bk_0123456789abcdef'])
  tEq('byoCount', shelf.byoCount.value, 1)
  tEq('两个来源都没报错', [shelf.error.value, shelf.byoError.value], [null, null])
  tEq('refresh 收尾 loading = false', shelf.loading.value, false)

  globalThis.fetch = async () => ({ ok: false, status: 503 })
  await shelf.refresh()
  tEq('静态书目表 503 -> 我的书架照常显示', shelf.myBooks.value.map(b => b.id), ['bk_0123456789abcdef'])
  tEq('静态书目表 503 -> 公开书库空', shelf.publicBooks.value, [])
  t('error 记下原因', /503/.test(String(shelf.error.value)))

  globalThis.fetch = async () => ({ ok: true, json: async () => INDEX })
  const broken = useBookShelf({
    indexUrl: 'https://example.test/book-index.json',
    store: { listByoBooks: async () => { throw new BookStoreError('UNAVAILABLE') } }
  })
  await broken.refresh()
  tEq('书库打不开 -> 公开书库照常显示', broken.publicBooks.value.map(b => b.id), ['sat-practice'])
  tEq('书库打不开 -> 我的书架空', broken.myBooks.value, [])
  tEq('byoError 记下 code', broken.byoError.value, 'UNAVAILABLE')
  tEq('坏书库的 byoCount 归零（不虚报）', broken.byoCount.value, 0)

  await shelf.removeByoBook('bk_0123456789abcdef')
  tEq('移出后我的书架空了', shelf.myBooks.value, [])
  tEq('移出后公开书库不受影响', shelf.publicBooks.value.map(b => b.id), ['sat-practice'])
  tEq('移出后 byoCount 归零', shelf.byoCount.value, 0)

  globalThis.fetch = realFetch
}

console.log('\n[composables/useBookShelf.js — 对账收尾要自己反映到书架上（第 16.6 步）]')
{
  const B = await import('./src/sync/bookSync.js')
  const { nextTick } = await import('vue')
  const store = createBookStore(memoryDriver())
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ books: [] }) })
  const shelf = useBookShelf({ indexUrl: 'https://example.test/book-index.json', store })
  await shelf.refresh()

  tEq('没有失败时给空数组（书架不用再防 undefined）', shelf.failedIds.value, [])
  B.bookSyncState.failedIds = ['bk_cccccccccccccccc']
  tEq('对账拉失败的 id 原样透出（缺书行据此画「重试 →」）',
    shelf.failedIds.value, ['bk_cccccccccccccccc'])
  B.bookSyncState.failedIds = []

  // 🔴 预取落盘后书架得**自己**重列。原来这里是 `watch(bookSyncState.revision, …)`：
  // 传进去的是个数字，Vue 只 warn（Invalid watch source）不报错，监听是死的 —— 书拉下来了，
  // 书架却要等下一次进页面才认（第 16.6 步实测）。
  await store.saveBook(sampleBook({ title: 'From cloud' }))
  B.bookSyncState.revision++
  await nextTick()
  await new Promise((r) => setTimeout(r, 20)) // 监听回调里的 refresh() 是异步的
  tEq('🔴 revision++ 后书架自己重列（不必等下一次进页面）',
    shelf.myBooks.value.map((b) => b.title), ['From cloud'])

  globalThis.fetch = realFetch
}
console.log('\n[utils/bookShelf.js — 「正文不在本机」的行（第 9 步 9.4 ＋ 第 16 步块 3）]')
{
  const NOTE_ONLY = 'bk_aaaaaaaaaaaaaaaa'
  const FROM_CLOUD = 'bk_bbbbbbbbbbbbbbbb'
  const FAILED = 'bk_cccccccccccccccc'

  const rows = notOnDeviceRows(
    [{ bookId: NOTE_ONLY, bookTitle: 'Notes only', count: 3 }],
    [{ bookId: NOTE_ONLY, title: 'Notes only' }, { bookId: FROM_CLOUD, title: 'From account' }],
    [FROM_CLOUD],
    [FAILED]
  )
  tEq('两个来源取并集：一个 id 一行（同一本两边都有也只出一行）',
    rows.map(r => r.bookId), [NOTE_ONLY, FROM_CLOUD])
  tEq('两边都有的那本：笔记数保留、且标成可下载（账号里有正文）',
    [rows[0].noteCount, rows[0].cloud], [3, true])
  tEq('只有账号的那本：0 条笔记、可下载、书名取账号那条',
    [rows[1].noteCount, rows[1].cloud, rows[1].title], [0, true, 'From account'])
  tEq('正在下载的那本被标出来', [rows[1].downloading, rows[0].downloading], [true, false])

  const only = notOnDeviceRows([{ bookId: NOTE_ONLY, bookTitle: 'N', count: 2 }], [], [], [])
  tEq('只有笔记 -> 不能下载（还得自己导入那一本）', [only.length, only[0].cloud, only[0].noteCount], [1, false, 2])

  tEq('空输入 -> 空（不抛）', notOnDeviceRows(null, null), [])
  tEq('没有 id 的坏条目丢掉', notOnDeviceRows([{ bookTitle: 'x' }], [{ title: 'y' }]), [])
  tEq('下载失败的标记按 id 对上',
    notOnDeviceRows([], [{ bookId: FAILED }], [], [FAILED])[0].failed, true)
  tEq('被标下载中的那本，失败标记互不干扰',
    notOnDeviceRows([], [{ bookId: FROM_CLOUD }], [FROM_CLOUD], [FAILED])[0].failed, false)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
