/**
 * 第 16 步块 2 验证 —— BYO 书体上云的**前端一半**（纯逻辑 ＋ 打桩，不触网、不碰浏览器）。
 *   sync/records.js   — kind='book' 认不认（交接坑：ID_PREFIX 就是判据）、元信息白名单、计数归一
 *   sync/bookSync.js  — 租户一致性闸 / 书体原文 / 元信息载荷 / PUT / 发布编排
 *   sync/bookRetire.js ＋ recordStore.js — 第 16.5 步块 4：永久退役名单（防「删了又活」）
 * 用法: node verify-booksync.mjs
 *
 * ⚠️ 这一段里带 🔴 的几条是**故意的注入故障自检点**（项目日志记了实测读数）：
 *   · 把 records.js 的 `ID_PREFIX.book` 或 `FIELDS.book` 拆掉，上面那两条必红。只跑正常输入
 *     的闸是装饰 —— 这里真的会咬自己。（拆 FIELDS.book 时 sanitizeRecord 是**抛**不是回 null，
 *     所以下面走 trySanitize 兜住两种失败形态，红法不同、红是必然。）
 *   · 块 4 的 🔴 是两处：① recordStore 里 book 记录一消失就记入退役名单；② planLocalPublish /
 *     planPrefetch 把退役名单里的 id 滤掉（拆掉 `!gone.has(...)`，补发／预取那几条必红）。
 */

// ── localStorage 打桩（必须在 import 业务模块之前，与 verify-sync.mjs 同一套） ──
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

const R = await import('./src/sync/records.js')
const B = await import('./src/sync/bookSync.js')
const RS = await import('./src/sync/recordStore.js')
const BR = await import('./src/sync/bookRetire.js')

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
function tEq(name, got, want) {
  t(name + `  [got ${JSON.stringify(got)}]`, JSON.stringify(got) === JSON.stringify(want))
}
const keysOf = o => Object.keys(o || {}).sort()
const ID = 'bk_0123456789abcdef'

/** 不抛版 sanitize：拆掉白名单时 FIELDS[kind] 是 undefined（抛 TypeError），不是回 null */
function trySanitize(kind, id, payload) {
  try { return R.sanitizeRecord(kind, id, payload) } catch { return null }
}

/** 一本像样的 BYO 记录（形状与 storage/bookAdapter.js 的 normalizeRecord 产物一致） */
function sampleRecord(over = {}) {
  return {
    bookId: ID,
    title: 'Sample',
    author: 'Anon',
    coverUrl: 'data:image/png;base64,aGVsbG8=',
    chapters: [
      { id: 'ch-01', title: 'One', paragraphs: [{ id: 'p-01-001', text: 'alpha' }] },
      { id: 'ch-02', title: 'Two', paragraphs: [{ id: 'p-02-001', text: 'beta' }] }
    ],
    chapterCount: 2,
    charCount: 10,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over
  }
}

const BOOK_META_FIELDS = ['bookId', 'title', 'author', 'chapterCount', 'charCount', 'addedAt', 'updatedAt']

console.log('\n[records.js — kind=book 认不认（交接坑就在 ID_PREFIX）]')
{
  t('RECORD_KINDS 含 book（五类）', R.RECORD_KINDS.includes('book') && R.RECORD_KINDS.length === 5)
  t('🔴 isRecordKind(book) 为真（ID_PREFIX 里有这一项）', R.isRecordKind('book'))
  t('公开书 slug 仍不是记录 kind', !R.isRecordKind('the-giver') && !R.isRecordKind(''))
  t('🔴 sanitizeRecord(book) 不返回 null', trySanitize('book', ID, sampleRecord()) !== null)

  // 下面几条也走 trySanitize：拆掉白名单时它可能是 null、也可能是抛 —— 两种都让闸红，
  // 而不是让脚本自己崩掉（崩了只会打印半张表，看不出红在哪）
  const p = trySanitize('book', ID, sampleRecord()) || {}
  tEq('book 载荷 = schema_version ＋ 白名单七字段',
    keysOf(p), ['schema_version', ...BOOK_META_FIELDS].sort())
  t('不硬注入 createdAt（book 的时间轴是 addedAt/updatedAt）', !('createdAt' in p))
  t('chapters 被剪掉（正文不上记录通道）', !('chapters' in p))
  t('coverUrl 被剪掉', !('coverUrl' in p))
  t('多余字段一律剪', !('junk' in p))
  tEq('bookId 原样保留', p.bookId, ID)
  tEq('recordTime 取 updatedAt（记录通道比新旧的轴）', R.recordTime(p), '2026-01-02T00:00:00.000Z')

  const q = trySanitize('book', ID, { chapterCount: '12', charCount: 3456.7 }) || {}
  tEq("计数归一：'12' -> 12（与 worker 的 shapeFields 同口径）", q.chapterCount, 12)
  tEq('计数归一：3456.7 -> 3456', q.charCount, 3456)
  const bad = trySanitize('book', ID, { chapterCount: -5, charCount: 'abc' }) || {}
  tEq('负数 / 非数 -> 0（宁可少记，不写脏值）', [bad.chapterCount, bad.charCount], [0, 0])
  const empty = trySanitize('book', ID, {}) || {}
  tEq('缺字段 -> 空串 / 0', [empty.title, empty.author, empty.addedAt], ['', '', ''])
  const missingTs = trySanitize('book', ID, { addedAt: '', updatedAt: '' }) || {}
  tEq('时间戳全缺 -> updatedAt 为空串（比不过任何有效时间戳）', missingTs.updatedAt, '')

  // 回归：改造「条件注入」不能让别的 kind 掉字段
  const note = R.sanitizeRecord('note', 'n_1', { text: 'x' })
  t('note 照旧拿到 createdAt + updatedAt', !!note.createdAt && !!note.updatedAt)
  const stg = R.sanitizeRecord('setting', 's_theme', { key: 'theme', value: { dark: true } })
  t('setting 照旧拿到时间戳、value 原样', !!stg.updatedAt && JSON.stringify(stg.value) === '{"dark":true}')
}

console.log('\n[bookSync.js — BYO id 形状]')
{
  t('bk_ ＋ 16 hex 过', B.isByoBookId(ID))
  t('公开书 slug 不过', !B.isByoBookId('the-giver') && !B.isByoBookId('sat-practice'))
  t('位数不够不过', !B.isByoBookId('bk_0123456789abcde'))
  t('大写 hex 不过（指纹一律小写）', !B.isByoBookId('bk_0123456789ABCDEF'))
  t('没有前缀不过', !B.isByoBookId('0123456789abcdef'))
}

console.log('\n[bookSync.js — 元信息载荷（与 worker 的 FIELDS.book 同一份名单）]')
{
  const m = B.bookMetaPayload(sampleRecord())
  tEq('恰好七个字段', keysOf(m), [...BOOK_META_FIELDS].sort())
  t('不含 chapters / coverUrl', !('chapters' in m) && !('coverUrl' in m))
  tEq('bookId 取内容指纹', m.bookId, ID)
  tEq('计数是数字', [typeof m.chapterCount, typeof m.charCount], ['number', 'number'])
  tEq('updatedAt 原样', m.updatedAt, '2026-01-02T00:00:00.000Z')
  tEq('缺 updatedAt -> 回退 addedAt', B.bookMetaPayload(sampleRecord({ updatedAt: '' })).updatedAt, '2026-01-01T00:00:00.000Z')
  t('两个都没有 -> 不是空串（否则旧值永远赢）', B.bookMetaPayload(sampleRecord({ updatedAt: '', addedAt: '' })).updatedAt !== '')
  tEq('slug id 不产元信息', B.bookMetaPayload(sampleRecord({ bookId: 'the-giver' })), null)
}

console.log('\n[bookSync.js — 书体原文]')
{
  const text = B.bookBodyText(sampleRecord())
  const back = JSON.parse(text)
  t('是整本的 JSON（章节都带上）', back.bookId === ID && back.chapters.length === 2)
  t('封面一并带上（B 设备看到同一张封面）', back.coverUrl.startsWith('data:image/png'))
  tEq('没有章节 -> 空串（不传半本）', B.bookBodyText(sampleRecord({ chapters: [] })), '')
  tEq('slug id -> 空串', B.bookBodyText(sampleRecord({ bookId: 'the-giver' })), '')
  tEq('非对象 -> 空串', B.bookBodyText(null), '')
}

console.log('\n[bookSync.js — 租户一致性闸]')
{
  t('同码 -> 放行', B.tenantReady({ accountCode: 'ABCD1234', localCode: 'ABCD1234' }))
  t('没登录 -> 不放行', !B.tenantReady({ accountCode: '', localCode: 'ABCD1234' }))
  t('认领还没跑完（本机还是游客码）-> 不放行', !B.tenantReady({ accountCode: 'ABCD1234', localCode: 'ZZZZ9999' }))
  t('都没码 -> 不放行', !B.tenantReady({}))
}

console.log('\n[bookSync.js — PUT 书体（URL 与请求形状）]')
{
  const calls = []
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await B.uploadBookBody(ID, '{"a":1}', { fetchImpl: ok })
  tEq('成功 -> ok / 200', [r.ok, r.status], [true, 200])
  tEq('打在书体路由上', calls[0].url, '/api/sync/book/' + ID)
  t('🔴 URL 里没有 code、也没有查询串（带了服务端 400）',
    !calls[0].url.includes('code') && !calls[0].url.includes('?'))
  tEq('动词是 PUT', calls[0].init.method, 'PUT')
  tEq('body 就是书体原文', calls[0].init.body, '{"a":1}')
  t('不带 keepalive（书体可达 8 MB，64 KiB 预算一裁就整条丢）', !calls[0].init.keepalive)
  tEq('Content-Type 是 JSON', calls[0].init.headers['Content-Type'], 'application/json')

  const code = (s) => async () => ({ ok: false, status: s })
  tEq('401 -> ok:false / 401（没会话）', await B.uploadBookBody(ID, 'x', { fetchImpl: code(401) }),
    { ok: false, status: 401 })
  tEq('403 -> ok:false / 403（账号还没认领主码）', (await B.uploadBookBody(ID, 'x', { fetchImpl: code(403) })).status, 403)
  tEq('413 -> ok:false / 413（超 8 MB）', (await B.uploadBookBody(ID, 'x', { fetchImpl: code(413) })).status, 413)
  tEq('网络抛错 -> ok:false / network',
    await B.uploadBookBody(ID, 'x', { fetchImpl: async () => { throw new Error('boom') } }),
    { ok: false, status: 0, reason: 'network' })

  let touched = 0
  const spy = async () => { touched++; return { ok: true, status: 200 } }
  tEq('id 形状不对 -> 拒发', (await B.uploadBookBody('the-giver', 'x', { fetchImpl: spy })).reason, 'bad-input')
  tEq('空正文 -> 拒发', (await B.uploadBookBody(ID, '', { fetchImpl: spy })).reason, 'bad-input')
  tEq('这两种情况一个请求都没发出去', touched, 0)
}

console.log('\n[bookSync.js — publishByoBook：正文先上、元信息跟着走]')
{
  const clean = () => { store.clear() }
  const rec = sampleRecord()
  const calls2 = []
  const twoHundred = async (url) => { calls2.push(url); return { ok: true, status: 200 } }

  clean()
  let r = await B.publishByoBook(rec, { accountCode: '', localCode: '', fetchImpl: twoHundred })
  tEq('没登录 -> tenant-not-ready', r, { ok: false, reason: 'tenant-not-ready' })
  tEq('没登录 -> 一个请求都没发', calls2.length, 0)
  tEq('没登录 -> 盘上没有 book 记录', Object.keys(RS.loadRecordsMap()), [])

  r = await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ZZZZ9999', fetchImpl: twoHundred })
  tEq('租户还没对齐 -> tenant-not-ready', r.reason, 'tenant-not-ready')
  tEq('租户还没对齐 -> 同样不发、不写', [calls2.length, Object.keys(RS.loadRecordsMap()).length], [0, 0])

  r = await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: twoHundred })
  tEq('对齐后 -> ok:true', [r.ok, r.bookId], [true, ID])
  tEq('正文落在书体路由上', calls2[0], '/api/sync/book/' + ID)
  const written = RS.loadRecordsMap()['book:' + ID]
  t('元信息写进了记录通道（键 book:<bookId>）', !!written)
  tEq('元信息仍是七个字段（正文没混进来）', keysOf(written).filter(k => k !== 'schema_version').sort(), [...BOOK_META_FIELDS].sort())
  tEq('元信息标了脏（等下一次推送）', RS.loadRecordDirty(), ['book:' + ID])

  // 正文没上去，元信息就不许写：否则别的设备书架挂着一条点不开的书
  clean()
  const deny = async () => ({ ok: false, status: 403 })
  r = await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: deny })
  tEq('上传失败 -> upload-failed / 403', [r.ok, r.reason, r.status], [false, 'upload-failed', 403])
  tEq('上传失败 -> 盘上一条元信息都不许留', [Object.keys(RS.loadRecordsMap()).length, RS.loadRecordDirty().length], [0, 0])

  // 正文本身不合格（没有章节）-> 拒发（空正文服务端也 400），更不留元信息
  clean()
  const sentBefore = calls2.length
  r = await B.publishByoBook(sampleRecord({ chapters: [] }), { accountCode: 'A1', localCode: 'A1', fetchImpl: twoHundred })
  tEq('没有章节 -> 拒发（正文为空）且不留元信息',
    [r.reason, calls2.length - sentBefore, Object.keys(RS.loadRecordsMap()).length], ['upload-failed', 0, 0])

  // 幂等：同一本重复发布 = 同一个键，覆盖同一份
  clean()
  await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: twoHundred })
  await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: twoHundred })
  tEq('同一本重复发布 -> 盘上仍只有一条（幂等）', Object.keys(RS.loadRecordsMap()), ['book:' + ID])

  // 元信息进得了合并判据（别的设备拉回来不会因为 kind=book 被吞）—— 这条直接关系「B 设备
  // 根本看不到这本书」：kind 认不出时 planRecordMerge 会把记录静默跳过。拆掉白名单时它会抛，
  // 所以这里也兜一层，让闸红得清楚。
  let plan = null
  try {
    plan = R.planRecordMerge({}, [{ kind: 'book', id: ID, payload: RS.loadRecordsMap()['book:' + ID] }], [], {})
  } catch { plan = null }
  tEq('远端拉回的 book 元信息能被 planRecordMerge 收下', (plan ? plan.apply.map(a => a.key) : []), ['book:' + ID])
  clean()
}

console.log('\n[第 16 步块 3 — 账号里的书：从记录通道挑出来]')
{
  const recs = {
    'note:n_1': { schema_version: 1, text: 'x' },
    ['book:' + ID]: { schema_version: 1, ...B.bookMetaPayload(sampleRecord()) },
    'book:bk_ffffffffffffffff': { schema_version: 1, bookId: 'bk_ffffffffffffffff', title: 'Tombed' },
    'book:not-a-fingerprint': { schema_version: 1, bookId: 'not-a-fingerprint' },
    'book:bk_0123456789abcdee': { schema_version: 1, bookId: 'bk_0123456789abcdee', title: 'Kept' }
  }
  const tombs = { 'book:bk_ffffffffffffffff': '2026-01-01T00:00:00.000Z' }
  const metas = B.cloudBookMetas(recs, tombs)
  tEq('只挑 kind=book 且形状对的（笔记不算、坏指纹不算）',
    metas.map(m => m.bookId).sort(), [ID, 'bk_0123456789abcdee'].sort())
  t('带墓碑的不挑（云端已删，别又拉回来）', !metas.some(m => m.bookId === 'bk_ffffffffffffffff'))
  tEq('记录表为空 -> 空（不抛）', B.cloudBookMetas(null, null), [])

  tEq('本机已有的不再拉', B.planPrefetch(metas, [ID]).map(m => m.bookId), ['bk_0123456789abcdee'])
  tEq('本机一本都没有 -> 全拉', B.planPrefetch(metas, []).length, 2)
  tEq('空清单 -> 无可拉', B.planPrefetch(null, []), [])
  tEq('本机 id 里有非指纹（内置书）不影响', B.planPrefetch(metas, ['the-giver']).length, 2)
}

console.log('\n[第 16 步块 3 — GET 书体]')
{
  const calls = []
  const spyGet = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => sampleRecord() } }
  const r = await B.fetchBookBody(ID, { fetchImpl: spyGet })
  tEq('成功 -> ok ＋ 整本', [r.ok, r.record.bookId, r.record.chapters.length], [true, ID, 2])
  tEq('打在书体路由上（GET）', calls[0], '/api/sync/book/' + ID)
  t('🔴 URL 里没有 code、也没有查询串', !calls[0].includes('code') && !calls[0].includes('?'))

  const bad = (status) => async () => ({ ok: false, status })
  tEq('401 -> ok:false / 401（没登录 / 会话过期）', await B.fetchBookBody(ID, { fetchImpl: bad(401) }), { ok: false, status: 401 })
  tEq('404 -> ok:false / 404（这本不在账号里）', (await B.fetchBookBody(ID, { fetchImpl: bad(404) })).status, 404)
  tEq('body 的 bookId 与路径不符 -> bad-book',
    (await B.fetchBookBody(ID, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ bookId: 'bk_ffffffffffffffff', chapters: [{}] }) }) })).reason, 'bad-book')
  tEq('没有章节 -> bad-book（不落半本）',
    (await B.fetchBookBody(ID, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ bookId: ID, chapters: [] }) }) })).reason, 'bad-book')
  tEq('不是 JSON -> bad-json',
    (await B.fetchBookBody(ID, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope') } }) })).reason, 'bad-json')
  tEq('网络抛错 -> network',
    (await B.fetchBookBody(ID, { fetchImpl: async () => { throw new Error('boom') } })).reason, 'network')
  tEq('id 形状不对 -> bad-id（连请求都不发）', (await B.fetchBookBody('the-giver', { fetchImpl: spyGet })).reason, 'bad-id')
}

console.log('\n[第 16 步块 3 — 预取：一本拉不动不影响别的]')
{
  const OTHER = 'bk_ffffffffffffffff'
  const bodies = { [ID]: sampleRecord(), [OTHER]: sampleRecord({ bookId: OTHER, title: 'Other' }) }
  const getBody = async (id) => (bodies[id] ? { ok: true, status: 200, record: bodies[id] } : { ok: false, status: 404 })
  const metas = [B.bookMetaPayload(bodies[ID]), B.bookMetaPayload(bodies[OTHER]), { bookId: 'bk_0123456789abcdee', title: 'Missing' }]

  const saved = []
  const r = await B.prefetchCloudBooks({ metas, localIds: [], getBody, save: async (rec) => { saved.push(rec.bookId) } })
  tEq('拉到的落盘、拉不到的记账', [r.saved.slice().sort(), r.failed], [[ID, OTHER].sort(), ['bk_0123456789abcdee']])
  tEq('落的是整本记录（交给 saveBook 自己净化）', saved.length, 2)

  saved.length = 0
  const r2 = await B.prefetchCloudBooks({ metas, localIds: [ID, OTHER], getBody, save: async (rec) => { saved.push(rec.bookId) } })
  tEq('本机已有 -> 一个都不拉、一个都不存', [r2.saved.length, saved.length], [0, 0])

  let ticked = 0
  await B.prefetchCloudBooks({ metas: [metas[0]], localIds: [], getBody, save: async () => {}, onSaved: () => { ticked++ } })
  tEq('每落盘一本报一次（书架据此重列）', ticked, 1)

  const r3 = await B.prefetchCloudBooks({ metas: [metas[0]], localIds: [], getBody, save: async () => { throw new Error('quota') } })
  tEq('落盘失败 -> 记失败、不抛', [r3.saved, r3.failed], [[], [ID]])
}

console.log('\n[第 16 步块 3 — 点「下载」只拉一本]')
{
  const calls = []
  const getBody = async (id) => { calls.push(id); return { ok: true, status: 200, record: sampleRecord({ bookId: id }) } }
  const saved = []
  const r = await B.downloadCloudBook(ID, { getBody, save: async (rec) => { saved.push(rec.bookId) } })
  tEq('成功 -> 落一本', [r.ok, saved], [true, [ID]])
  tEq('只发一个请求', calls, [ID])
  tEq('拉不到 -> fetch-failed',
    (await B.downloadCloudBook(ID, { getBody: async () => ({ ok: false, status: 404 }) })).reason, 'fetch-failed')
  tEq('存不下 -> save-failed（配额这种事不该假装成功）',
    (await B.downloadCloudBook(ID, { getBody, save: async () => { throw new Error('quota') } })).reason, 'save-failed')
  tEq('id 形状不对 -> bad-id', (await B.downloadCloudBook('the-giver', { getBody })).reason, 'bad-id')
}

console.log('\n[第 16 步块 4 — 「还没上云」台账：导入时没登录 / 上传失败要记着]')
{
  store.clear()
  tEq('初始为空', B.loadPendingPublish(), [])
  B.markPendingPublish(ID)
  tEq('记上一本', B.loadPendingPublish(), [ID])
  B.markPendingPublish(ID)
  tEq('同一本重复记 -> 去重（不会越攒越多）', B.loadPendingPublish(), [ID])
  B.markPendingPublish('bk_ffffffffffffffff')
  tEq('记第二本', B.loadPendingPublish().slice().sort(), [ID, 'bk_ffffffffffffffff'].sort())
  B.clearPendingPublish(ID)
  tEq('划掉一本 -> 只剩另一本', B.loadPendingPublish(), ['bk_ffffffffffffffff'])
  B.clearPendingPublish('bk_ffffffffffffffff')
  tEq('全划掉 -> 空表（键都不留，不留 `[]` 垃圾）',
    [B.loadPendingPublish(), store.has('reader-books-to-publish')], [[], false])
  B.markPendingPublish('the-giver')
  tEq('非指纹 id 不记（公开书 slug 混不进来）', B.loadPendingPublish(), [])
  store.set('reader-books-to-publish', '{ not json')
  tEq('表坏了 -> 退回空（不抛）', B.loadPendingPublish(), [])
  store.clear()
}

console.log('\n[第 16 步块 4 — 台账与 publishByoBook 咬合：成功才划掉]')
{
  const rec = sampleRecord()
  const ok200 = async () => ({ ok: true, status: 200 })

  store.clear()
  await B.publishByoBook(rec, { accountCode: '', localCode: '', fetchImpl: ok200 })
  tEq('没登录 -> 记「欠着」（登录后自愈）', B.loadPendingPublish(), [ID])

  await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ZZZZ9999', fetchImpl: ok200 })
  tEq('租户没对齐 -> 也记着', B.loadPendingPublish(), [ID])

  await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: async () => ({ ok: false, status: 500 }) })
  tEq('上传失败（500）-> 还记着', B.loadPendingPublish(), [ID])

  await B.publishByoBook(rec, { accountCode: 'ABCD1234', localCode: 'ABCD1234', fetchImpl: ok200 })
  tEq('上传成功 -> 台账划掉', B.loadPendingPublish(), [])
  store.clear()
}

console.log('\n[第 16 步块 4 — DELETE 书体（URL 与请求形状）]')
{
  const calls = []
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await B.deleteCloudBookBody(ID, { fetchImpl: ok })
  tEq('成功 -> ok / 200', [r.ok, r.status], [true, 200])
  tEq('打在书体路由上', calls[0].url, '/api/sync/book/' + ID)
  t('🔴 URL 里没有 code、也没有查询串（带了服务端一律 400）',
    !calls[0].url.includes('code') && !calls[0].url.includes('?'))
  tEq('动词是 DELETE', calls[0].init.method, 'DELETE')
  t('不带 body（删除不需要载荷）', calls[0].init.body === undefined)

  const code = (s) => async () => ({ ok: false, status: s })
  tEq('401 -> ok:false / 401（没会话 / 会话过期）',
    await B.deleteCloudBookBody(ID, { fetchImpl: code(401) }), { ok: false, status: 401 })
  tEq('404 -> ok:false / 404（调用方按「尽力」处理，不当成功）',
    (await B.deleteCloudBookBody(ID, { fetchImpl: code(404) })).status, 404)
  tEq('网络抛错 -> ok:false / network',
    await B.deleteCloudBookBody(ID, { fetchImpl: async () => { throw new Error('boom') } }),
    { ok: false, status: 0, reason: 'network' })

  let touched = 0
  const spy = async () => { touched++; return { ok: true, status: 200 } }
  tEq('id 形状不对 -> 拒发', (await B.deleteCloudBookBody('the-giver', { fetchImpl: spy })).reason, 'bad-id')
  tEq('拒发时一个请求都没出去', touched, 0)
}

console.log('\n[第 16 步块 4 — 删一本自带书：本机先删、云端尽力删]')
{
  const rec = sampleRecord()
  // 摆成「本机 ＋ 账号都有这本书」：记录通道有 meta，且台账还欠着一笔发布
  const seed = () => {
    store.clear()
    RS.putRecord('book', B.bookMetaPayload(rec), { id: ID })
    B.markPendingPublish(ID)
  }

  seed()
  const calls = []
  const del = async (url, init) => { calls.push({ url, method: init && init.method }); return { ok: true, status: 200 } }
  const deletedLocal = []
  let r = await B.removeByoBookEverywhere(ID, {
    fetchImpl: del, deleteLocal: async (id) => { deletedLocal.push(id); return true }
  })
  tEq('一次删除：本机删了、云端也删了', [r.ok, r.localDeleted, r.cloud, r.cloudStatus], [true, true, true, 200])
  tEq('本机正文删除收的是这本书 id', deletedLocal, [ID])
  tEq('云端打的是 DELETE 同一本', [calls[0].url, calls[0].method], ['/api/sync/book/' + ID, 'DELETE'])
  tEq('本机记录通道：meta 没了、留墓碑（别的设备据此跟着丢）',
    [Object.keys(RS.loadRecordsMap()), Object.keys(RS.loadRecordTombstones())], [[], ['book:' + ID]])
  t('本机这条标了脏（下一次推送带上墓碑）', RS.loadRecordDirty().includes('book:' + ID))
  tEq('「待发布」台账也划掉了（别把删掉的书又发回账号）', B.loadPendingPublish(), [])
  t('🔴 删书顺带记入永久退役名单（对账补发时跳过它）', BR.isBookRetired(ID))
  tEq('删完本机正文真的没了（IndexedDB 那半被调到）', deletedLocal.length, 1)

  // 云端删不掉（弱网 / 5xx）：本机照样删干净，如实回报 cloud:false —— 不假装成功
  seed()
  r = await B.removeByoBookEverywhere(ID, {
    fetchImpl: async () => ({ ok: false, status: 500 }), deleteLocal: async () => true
  })
  tEq('云端 500 -> 本机照删、如实回报 cloud:false',
    [r.ok, r.localDeleted, r.cloud, r.cloudStatus], [true, true, false, 500])
  tEq('云端失败也留墓碑（下次对账 / 推送再收敛）', Object.keys(RS.loadRecordTombstones()), ['book:' + ID])

  // 本机那半失手（本来就没落盘 / 库打不开）：不抛、照实回报
  seed()
  r = await B.removeByoBookEverywhere(ID, {
    fetchImpl: async () => ({ ok: true, status: 200 }), deleteLocal: async () => false
  })
  tEq('本机正文没删掉 -> 照实回报 localDeleted:false，不吹', [r.ok, r.localDeleted, r.cloud], [true, false, true])

  // 形状不对（公开书 slug）：连本机都不碰，更不发请求
  seed()
  let touchedLocal = 0
  const before = Object.keys(RS.loadRecordsMap()).length
  r = await B.removeByoBookEverywhere('the-giver', {
    fetchImpl: async () => { throw new Error('不该发请求') },
    deleteLocal: async () => { touchedLocal++; return true }
  })
  tEq('公开书 slug -> 拒删（bad-id）', [r.ok, r.reason], [false, 'bad-id'])
  tEq('拒删时本机没动、下游也没被调', [Object.keys(RS.loadRecordsMap()).length, touchedLocal], [before, 0])
  store.clear()
}
console.log('\n[第 16.5 步块 4 — 永久退役名单：读写与形状]')
{
  store.clear()
  tEq('初始为空', BR.loadRetiredBooks(), [])
  BR.markBookRetired(ID)
  tEq('记上一本', BR.loadRetiredBooks(), [ID])
  BR.markBookRetired(ID)
  tEq('同一本重复记 -> 去重（不会越攒越多）', BR.loadRetiredBooks(), [ID])
  t('isBookRetired 认得出', BR.isBookRetired(ID))
  t('没记过的认不出来', !BR.isBookRetired('bk_ffffffffffffffff'))
  BR.clearBookRetired(ID)
  tEq('划掉 -> 空表，键都不留（不留空数组垃圾）',
    [BR.loadRetiredBooks(), store.has('reader-books-retired')], [[], false])
  BR.clearBookRetired('bk_ffffffffffffffff')
  t('划掉一个没记过的 -> 不报错、仍为空', BR.loadRetiredBooks().length === 0)
  BR.markBookRetired('the-giver')
  tEq('公开书 slug 不进名单', BR.loadRetiredBooks(), [])
  BR.markBookRetired('bk_0123456789ABCDEF')
  tEq('大写 hex 不进名单（指纹一律小写）', BR.loadRetiredBooks(), [])
  store.set('reader-books-retired', '{ not json')
  tEq('表坏了 -> 退回空（不抛）', BR.loadRetiredBooks(), [])
  store.set('reader-books-retired', JSON.stringify([ID, ID, 'the-giver', 42, null, 'bk_ffffffffffffffff']))
  tEq('坏表：去重 ＋ 滤掉非指纹', BR.loadRetiredBooks().slice().sort(), [ID, 'bk_ffffffffffffffff'].sort())
  store.clear()
}

console.log('\n[第 16.5 步块 4 — 记录表 ↔ 退役名单：一条不变式]')
{
  const rec = sampleRecord()
  store.clear()
  RS.putRecord('book', B.bookMetaPayload(rec), { id: ID })
  t('写入 book 记录 -> 不在退役名单里', !BR.isBookRetired(ID))
  RS.removeRecord('book', ID)
  t('🔴 本机删书（记录消失）-> 自动记入退役名单', BR.isBookRetired(ID))
  RS.putRecord('book', B.bookMetaPayload(rec), { id: ID })
  t('重新写入（重新导入）-> 划掉', !BR.isBookRetired(ID))
  RS.removeRecords(['book:' + ID], { record: false, dirty: false })
  t('🔴 应用远程墓碑（record:false）-> 同样记入', BR.isBookRetired(ID))
  const n = RS.putRecord('note', { text: 'x' })
  RS.removeRecord('note', n.id)
  tEq('别的 kind 删了不进名单', BR.loadRetiredBooks(), [ID])
  RS.removeRecord('book', 'the-giver')
  tEq('公开书 slug 删了不进名单', BR.loadRetiredBooks(), [ID])
  store.clear()
}

console.log('\n[第 16.5 步块 4 — 补发判据 planLocalPublish：防「删了又活」]')
{
  const OLD = 'bk_aaaaaaaaaaaaaaaa'          // 「功能上线前导入」的那本
  const META = { ['book:' + ID]: { schema_version: 1 } }
  const TOMB = { ['book:' + ID]: '2026-01-01T00:00:00.000Z' }

  tEq('本机有、账号没有（上线前导入）-> 补发', B.planLocalPublish({ localIds: [OLD] }), [OLD])
  tEq('账号已有 meta -> 不补发', B.planLocalPublish({ localIds: [ID], recordsMap: META }), [])
  tEq('本机删了还没推出去（有墓碑）-> 不补发', B.planLocalPublish({ localIds: [ID], tombstones: TOMB }), [])
  tEq('🔴 退役名单上的 -> 不补发（删了不许活）', B.planLocalPublish({ localIds: [OLD], retired: [OLD] }), [])
  tEq('台账欠着的 -> 补发（本机书架上有没有都不影响）', B.planLocalPublish({ pending: [ID] }), [ID])
  tEq('台账与扫本机是同一本 -> 只发一次（并集去重）', B.planLocalPublish({ localIds: [OLD], pending: [OLD] }), [OLD])
  tEq('🔴 台账与退役冲突 -> 退役赢（不许复活）', B.planLocalPublish({ pending: [OLD], retired: [OLD] }), [])
  tEq('内置书 slug 混进来 -> 不发', B.planLocalPublish({ localIds: ['the-giver', OLD] }), [OLD])
  tEq('空输入 -> 空（不抛）', B.planLocalPublish(), [])
}

console.log('\n[第 16.5 步块 4 — 预取 / 列「待接入」跳过退役]')
{
  const OTHER = 'bk_ffffffffffffffff'
  const metas = [B.bookMetaPayload(sampleRecord()), B.bookMetaPayload(sampleRecord({ bookId: OTHER }))]
  tEq('本机没有、也没退役 -> 都拉', B.planPrefetch(metas, [], []).map(m => m.bookId).sort(), [ID, OTHER].sort())
  tEq('🔴 退役名单上的不拉', B.planPrefetch(metas, [], [ID]).map(m => m.bookId), [OTHER])
  tEq('没传退役参数（老调用）-> 行为不变', B.planPrefetch(metas, []).length, 2)

  const getBody = async (id) => ({ ok: true, status: 200, record: sampleRecord({ bookId: id }) })
  const saved = []
  const r = await B.prefetchCloudBooks({
    metas, localIds: [], retired: [ID],
    getBody, save: async (rec) => { saved.push(rec.bookId) }
  })
  tEq('prefetchCloudBooks 也跳过退役的那本', [r.saved, saved], [[OTHER], [OTHER]])
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)