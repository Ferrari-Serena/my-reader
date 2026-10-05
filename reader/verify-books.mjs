/**
 * BYO 书库 + 书架聚合验证（第 5 步 5B；不依赖浏览器 / 网络 / 线上环境）。
 *   utils/bookShelf.js          — 书架聚合口径（纯函数）
 *   storage/bookAdapter.js      — 入库净化 / 书体与索引同事务 / 列书架 / 删除
 *   composables/useBookShelf.js — 两个来源各自降级
 * 用法: node verify-books.mjs
 *
 * ⚠️ 覆盖边界（别把它读成「书库全测过了」）：真正发 IO 的 IndexedDB 驱动
 * （storage/bookDb.js）在 Node 里跑不起来 —— 没有 indexedDB 这个全局。本文件用
 * **内存驱动**跑的是 bookAdapter 的编排语义（净化 / 一次事务 / 排序 / 删除），
 * 内存驱动必须满足 storage/bookDb.js 文件头那份契约。app 实际用的 IndexedDB 驱动
 * 由浏览器实测覆盖（项目日志 5B 条目有记录）。
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

const { BOOK_KIND, kindOfBook, builtinEntry, metaOf, sortByAddedAtDesc, shelfOf } = await import('./src/utils/bookShelf.js')
const { createBookStore, normalizeRecord, BookStoreError } = await import('./src/storage/bookAdapter.js')
const { STORE_BOOKS, STORE_SHELF } = await import('./src/storage/bookDb.js')
const { useBookShelf } = await import('./src/composables/useBookShelf.js')

// ── 内存驱动（契约见 src/storage/bookDb.js 文件头）──────────────────────
// put 的做法是「先全部备好、再一次性落盘」：失败时一个字节都不落。
// 真驱动的事务原子性是浏览器那边的事；这里要保的是**同一次调用**里两店一起写。
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

  const rec = sampleBook()
  const m = metaOf(normalizeRecord(rec))
  tEq('metaOf：kind / id / 计数（由净化重算）', [m.kind, m.id, m.chapterCount, m.charCount], ['byo', rec.bookId, 2, 14])
  tEq('metaOf 不夹带正文', 'chapters' in m, false)
  tEq('metaOf：slug 记录 -> null', metaOf({ id: 'the-giver' }), null)
  tEq('metaOf：无标题 -> Untitled', metaOf({ bookId: 'bk_ffffffffffffffff' }).title, 'Untitled')

  const sorted = sortByAddedAtDesc([
    { id: 'a', addedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', addedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'c', addedAt: '' }
  ]).map(x => x.id)
  tEq('按加入时间倒序，缺时间戳沉底', sorted, ['b', 'a', 'c'])
  const keep = [{ id: 'x', addedAt: '1' }, { id: 'y', addedAt: '1' }]
  sortByAddedAtDesc(keep)
  tEq('排序不改原数组（返回副本）', keep.map(x => x.id), ['x', 'y'])

  const merged = shelfOf(
    [{ id: 'the-giver', title: 'G' }, { id: 'sat-practice', title: 'S' }],
    [{ bookId: 'bk_aaaaaaaaaaaaaaaa', title: 'B1', addedAt: '2026-01-01T00:00:00.000Z' },
     { bookId: 'bk_bbbbbbbbbbbbbbbb', title: 'B2', addedAt: '2026-02-01T00:00:00.000Z' }]
  )
  tEq('BYO 在前（新的更前）、内置保持原序', merged.map(b => b.id),
    ['bk_bbbbbbbbbbbbbbbb', 'bk_aaaaaaaaaaaaaaaa', 'the-giver', 'sat-practice'])
  t('合并后各自 kind 正确', merged[0].kind === 'byo' && merged[2].kind === 'builtin')
  tEq('非数组输入 -> 空书架', shelfOf(null, undefined), [])
  tEq('两侧坏条目都被丢掉', shelfOf([{ title: 'no id' }], [{ id: 'the-giver' }]), [])
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
    ['addedAt', 'author', 'bookId', 'chapterCount', 'charCount', 'chapters', 'title', 'updatedAt'].sort())
  t('addedAt / updatedAt 都是 ISO 串',
    /^\d{4}-\d{2}-\d{2}T/.test(dirty.addedAt) && /^\d{4}-\d{2}-\d{2}T/.test(dirty.updatedAt))
  tEq('显式 addedAt 被原样保留', normalizeRecord(sampleBook({ addedAt: '2026-01-01T00:00:00.000Z' })).addedAt, '2026-01-01T00:00:00.000Z')
  tEq('BookStoreError 是 Error 子类', new BookStoreError('BAD_ID') instanceof Error, true)
}

console.log('\n[storage/bookAdapter.js — 书体与书架索引]')
{
  const drv = memoryDriver()
  const store = createBookStore(drv)

  const meta = await store.saveBook(sampleBook())
  t('saveBook 返回书架条目、且不带正文', meta.id === 'bk_0123456789abcdef' && !('chapters' in meta))
  tEq('书架索引里没有正文', 'chapters' in drv.stores.get(STORE_SHELF).get('bk_0123456789abcdef'), false)
  tEq('书体店里有正文', drv.stores.get(STORE_BOOKS).get('bk_0123456789abcdef').chapters.length, 2)

  const back = await store.loadBook('bk_0123456789abcdef')
  tEq('loadBook 往返一致', back.chapters, sampleBook().chapters)
  tEq('loadBook：slug id -> null', await store.loadBook('the-giver'), null)
  tEq('loadBook：没有这本 -> null', await store.loadBook('bk_ffffffffffffffff'), null)
  tEq('countByoBooks', await store.countByoBooks(), 1)

  await store.saveBook(sampleBook({ author: 'Changed', addedAt: '2026-01-01T00:00:00.000Z' }))
  await store.saveBook(sampleBook({ bookId: 'bk_bbbbbbbbbbbbbbbb', addedAt: '2026-03-01T00:00:00.000Z' }))
  const list = await store.listByoBooks()
  tEq('同 id 覆盖不新增', list.length, 2)
  tEq('列表按加入时间倒序', list.map(b => b.id), ['bk_bbbbbbbbbbbbbbbb', 'bk_0123456789abcdef'])
  tEq('覆盖真的换了内容', (await store.loadBook('bk_0123456789abcdef')).author, 'Changed')
  tEq('列表条目不带正文', list.some(b => 'chapters' in b), false)

  tEq('deleteBook -> true', await store.deleteBook('bk_0123456789abcdef'), true)
  tEq('删除后取不到', await store.loadBook('bk_0123456789abcdef'), null)
  tEq('删除后索引也没了', drv.stores.get(STORE_SHELF).has('bk_0123456789abcdef'), false)
  tEq('deleteBook 坏 id -> false（不抛）', await store.deleteBook('the-giver'), false)

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

  await store.clearByoBooks()
  tEq('clear 后书体空', drv.stores.get(STORE_BOOKS).size, 0)
  tEq('clear 后索引空', await store.countByoBooks(), 0)
}

console.log('\n[composables/useBookShelf.js — 两个来源各自降级]')
{
  const store = createBookStore(memoryDriver())
  await store.saveBook(sampleBook({ title: 'Mine', addedAt: '2026-01-01T00:00:00.000Z' }))

  const realFetch = globalThis.fetch
  const INDEX = { books: [{ id: 'the-giver', title: 'The Giver' }] }
  globalThis.fetch = async () => ({ ok: true, json: async () => INDEX })

  const shelf = useBookShelf({ indexUrl: 'https://example.test/book-index.json', store })
  await shelf.refresh()
  tEq('合成：BYO 在前、内置在后', shelf.books.value.map(b => b.id), ['bk_0123456789abcdef', 'the-giver'])
  tEq('byoCount', shelf.byoCount.value, 1)
  tEq('两个来源都没报错', [shelf.error.value, shelf.byoError.value], [null, null])
  tEq('refresh 收尾 loading = false', shelf.loading.value, false)

  globalThis.fetch = async () => ({ ok: false, status: 503 })
  await shelf.refresh()
  tEq('静态书目表 503 -> 自带书照常显示', shelf.books.value.map(b => b.id), ['bk_0123456789abcdef'])
  t('error 记下原因', /503/.test(String(shelf.error.value)))

  globalThis.fetch = async () => ({ ok: true, json: async () => INDEX })
  const broken = useBookShelf({
    indexUrl: 'https://example.test/book-index.json',
    store: { listByoBooks: async () => { throw new BookStoreError('UNAVAILABLE') } }
  })
  await broken.refresh()
  tEq('书库打不开 -> 内置书照常显示', broken.books.value.map(b => b.id), ['the-giver'])
  tEq('byoError 记下 code', broken.byoError.value, 'UNAVAILABLE')
  tEq('坏书库的 byoCount 归零（不虚报）', broken.byoCount.value, 0)

  await shelf.removeByoBook('bk_0123456789abcdef')
  tEq('移出后书架只剩内置', shelf.books.value.map(b => b.id), ['the-giver'])
  tEq('移出后 byoCount 归零', shelf.byoCount.value, 0)

  globalThis.fetch = realFetch
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
