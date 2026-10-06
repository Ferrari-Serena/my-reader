/**
 * Worker 纯逻辑验证（不依赖 Cloudflare 运行时）：
 *   range.js — HTTP Range 头解析
 * 用法: node verify-worker.mjs
 *
 * 与 reader/verify-core.mjs 同一套 t(name, cond) 写法。
 */

import { parseRange } from './src/range.js'
import * as syncMod from './src/sync.js'
import * as corsMod from './src/cors.js'
import * as rlMod from './src/ratelimit.js'
import * as monMod from './src/monitor.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const SIZE = 10000

console.log('\n[range.js — 可满足的区间]')
t('bytes=0-999 → {0,1000}', eq(parseRange('bytes=0-999', SIZE), { offset: 0, length: 1000 }))
t('bytes=5000- → 到文件尾', eq(parseRange('bytes=5000-', SIZE), { offset: 5000, length: 5000 }))
t('bytes=-500 → 末 500 字节', eq(parseRange('bytes=-500', SIZE), { offset: 9500, length: 500 }))
t('bytes=-0 → 越界（不是空区间）', parseRange('bytes=-0', SIZE) === 'unsatisfiable')
t('bytes=0- → 整份', eq(parseRange('bytes=0-', SIZE), { offset: 0, length: SIZE }))
t('末尾超出 → 截到文件尾', eq(parseRange('bytes=9999-100000', SIZE), { offset: 9999, length: 1 }))
t('整段覆盖 → 全长', eq(parseRange('bytes=0-99999', SIZE), { offset: 0, length: SIZE }))
t('后缀大于文件 → 整份', eq(parseRange('bytes=-99999', SIZE), { offset: 0, length: SIZE }))
t('前导空格容忍', eq(parseRange('  bytes=0-9  ', SIZE), { offset: 0, length: 10 }))

console.log('\n[range.js — 越界 → 416]')
t('起点 = size', parseRange('bytes=10000-', SIZE) === 'unsatisfiable')
t('起点 > size', parseRange('bytes=10001-', SIZE) === 'unsatisfiable')
t('起点 > 终点', parseRange('bytes=500-100', SIZE) === 'unsatisfiable')
t('空对象上的任何 Range', parseRange('bytes=0-', 0) === 'unsatisfiable')

console.log('\n[range.js — 不可识别 → 忽略该头，回整份 200]')
t('无 Range 头', parseRange(null, SIZE) === null)
t('空串', parseRange('', SIZE) === null)
t('多段 Range 明确不接', parseRange('bytes=0-9,20-29', SIZE) === null)
t('非 bytes 单位', parseRange('items=0-9', SIZE) === null)
t('"bytes=-" 无意义', parseRange('bytes=-', SIZE) === null)
t('畸形串', parseRange('bytes=abc-def', SIZE) === null)
t('纯文本', parseRange('hello', SIZE) === null)

console.log('\n[sync.js — 时间戳钳制必须同时落到载荷里]')
{
  const t0 = typeof syncMod.stampWithTs === 'function'
  t('stampWithTs 已导出', t0)
  if (t0) {
    const now = Date.parse('2026-10-02T12:00:00.000Z')
    const future = '2027-01-01T00:00:00.000Z'
    const a = syncMod.stampWithTs({ word: 'x', updatedAt: future, snapshot: {} }, future, now)
    t('超前时间戳被钳到 serverNow', a.ts === '2026-10-02T12:00:00.000Z')
    t('载荷里的 updatedAt 同步被钳（否则会回流到别的设备）',
      JSON.parse(a.payload).updatedAt === a.ts)
    const b = syncMod.stampWithTs({ word: 'y', updatedAt: '2026-10-02T11:00:00Z' },
      '2026-10-02T11:00:00Z', now)
    t('精度归一：载荷与 LWW 列同值', b.ts === '2026-10-02T11:00:00.000Z'
      && JSON.parse(b.payload).updatedAt === b.ts)
    const c = syncMod.stampWithTs({ word: 'z' }, undefined, now)
    t('缺时间戳 → 回退到 serverNow，且载荷一致',
      c.ts === '2026-10-02T12:00:00.000Z' && JSON.parse(c.payload).updatedAt === c.ts)
    const d = syncMod.stampWithTs({ word: 'w', addedAt: '2026-10-02T09:00:00.000Z' },
      '2026-10-02T09:00:00.000Z', now)
    t('不丢原有字段', JSON.parse(d.payload).word === 'w')
  }
}

console.log('\n[cors.js — 只回显自家 Origin（0.0 止血）]')
{
  const req = o => ({ headers: new Headers(o === undefined ? {} : { Origin: o }) })
  const acao = (o, env) => corsMod.corsFor(req(o), env || {})['Access-Control-Allow-Origin']

  t('apex 放行', acao('https://ferrari11.com') === 'https://ferrari11.com')
  t('www 放行', acao('https://www.ferrari11.com') === 'https://www.ferrari11.com')
  t('迁移后的子域放行', acao('https://my-reader.ferrari11.com') === 'https://my-reader.ferrari11.com')
  t('兄弟站放行（自家）', acao('https://crf.ferrari11.com') === 'https://crf.ferrari11.com')
  t('本地 dev 放行', acao('http://localhost:5173') === 'http://localhost:5173')
  t('外部站不放行', acao('https://evil.example') === undefined)
  t('无 Origin 不放行', acao(undefined) === undefined)
  t('Origin: null 不放行', acao('null') === undefined)
  t('ferrari11.com.evil.com 不放行', acao('https://ferrari11.com.evil.com') === undefined)
  t('env.ALLOWED_ORIGINS 精确放行', acao('https://foo.pages.dev', { ALLOWED_ORIGINS: 'https://foo.pages.dev, https://bar.dev' }) === 'https://foo.pages.dev')
  t('带 Vary: Origin（防 CDN 串味）', corsMod.corsFor(req('https://ferrari11.com'), {}).Vary === 'Origin')
  t('未命中时无 ACAO 键', !('Access-Control-Allow-Origin' in corsMod.corsFor(req('https://evil.example'), {})))
}

console.log('\n[ratelimit.js — 纯函数（0.0 止血 · 第二半）]')
{
  const req = ip => ({ headers: new Headers(ip === undefined ? {} : { 'CF-Connecting-IP': ip }) })
  t('clientIp 读 CF-Connecting-IP', rlMod.clientIp(req('1.2.3.4')) === '1.2.3.4')
  t('clientIp 缺头回 unknown', rlMod.clientIp(req()) === 'unknown')
  t('clientIp 空白回 unknown', rlMod.clientIp(req('   ')) === 'unknown')
  t('clientIp 无 headers 不炸', rlMod.clientIp(undefined) === 'unknown')

  t('utcDayStart 落当日 0 点', rlMod.utcDayStart(Date.UTC(2026, 9, 3, 15, 30, 1)) === Date.UTC(2026, 9, 3))
  t('utcDayStart 对 0 点不变', rlMod.utcDayStart(Date.UTC(2026, 9, 3)) === Date.UTC(2026, 9, 3))
  t('utcDayStart 跨月正确', rlMod.utcDayStart(Date.UTC(2026, 10, 1, 0, 0, 1)) === Date.UTC(2026, 10, 1))

  const now = 10_000_000
  t('countInWindow 只数窗内', rlMod.countInWindow([now - 1, now - 30_000, now - 60_001, now - 90_000], now) === 2)
  t('countInWindow 边界：恰好 60s 前不算', rlMod.countInWindow([now - 60_000], now) === 0)
  t('countInWindow 空数组为 0', rlMod.countInWindow([], now) === 0)
  t('countInWindow 全在窗内', rlMod.countInWindow([now, now - 59_999], now) === 2)
  t('countInWindow 自定义窗口', rlMod.countInWindow([now - 5_000, now - 15_000], now, 10_000) === 1)

  t('WINDOW_MS = 60s', rlMod.WINDOW_MS === 60_000)
  t('默认阈值导出（60 / 900）', rlMod.DEFAULT_PER_MIN === 60 && rlMod.DEFAULT_MW_DAILY === 900)
}

console.log('\n[sync.js — 第 3 步：记录通道（kind 白名单 + 命名空间键）]')
{
  t('recordKey 用 <kind>:<id> 命名空间（永不与裸词撞车）', syncMod.recordKey('note', 'n_1') === 'note:n_1')
  t('RECORD_KINDS 恰是五类（第 16 步加 book）',
    syncMod.RECORD_KINDS.size === 5 && ['note', 'wrong', 'card', 'setting', 'book'].every(k => syncMod.RECORD_KINDS.has(k)))

  const now = Date.parse('2026-10-05T12:00:00.000Z')
  const T = '2026-10-05T11:00:00.000Z'
  const ops = syncMod.buildSyncOps({
    words: { apple: { word: 'apple', updatedAt: T } },
    records: [
      { kind: 'note', id: 'n_1', payload: { text: 'hi' }, updatedAt: T },
      { kind: 'word', id: 'x', payload: { v: 1 }, updatedAt: T }, // 'word' 不是记录 kind
      { kind: 'note', id: '', payload: { v: 1 }, updatedAt: T },  // 空 id
      { kind: 'note', id: 'n_2', payload: 'not-an-object', updatedAt: T }, // 载荷非对象
      { kind: 'note', id: 'n_3', updatedAt: T },                  // 缺载荷
    ],
  }, now)
  t('词走裸键、记录走命名空间键', ops.has('apple') && ops.has('note:n_1'))
  t('词条 kind = word', ops.get('apple').kind === 'word')
  t('记录 kind 原样保留', ops.get('note:n_1').kind === 'note')
  t('记录载荷原样透传 + 注入 updatedAt',
    JSON.parse(ops.get('note:n_1').payload).text === 'hi'
    && JSON.parse(ops.get('note:n_1').payload).updatedAt === T)
  t('非法记录被静默丢弃（未知/空 id/非对象载荷/缺载荷）',
    !ops.has('word:x') && !ops.has('note:') && !ops.has('note:n_2') && !ops.has('note:n_3'))
  t('op 数 = 2（只有 apple 与 note:n_1）', ops.size === 2)

  const o2 = syncMod.buildSyncOps({
    records: [{ kind: 'note', id: 'n_1', payload: { text: 'v1' }, updatedAt: T }],
    recordTombstones: [{ kind: 'note', id: 'n_1', deletedAt: T }],
  }, now)
  t('墓碑与存活写同刻 -> 存活写胜（不误删）', o2.get('note:n_1').deleted === false)

  const o3 = syncMod.buildSyncOps({
    records: [{ kind: 'note', id: 'n_1', payload: { text: 'v1' }, updatedAt: T }],
    recordTombstones: [{ kind: 'note', id: 'n_1', deletedAt: '2026-10-05T11:30:00.000Z' }],
  }, now)
  t('更新的墓碑 -> 删除生效', o3.get('note:n_1').deleted === true && o3.get('note:n_1').payload === 'null')

  const o4 = syncMod.buildSyncOps({
    records: [
      { kind: 'card', id: 'c_1', payload: { v: 1 }, updatedAt: T },
      { kind: 'card', id: 'c_1', payload: { v: 2 }, updatedAt: '2026-10-05T11:45:00.000Z' },
    ],
  }, now)
  t('同一 key 一次 push 内取新者', JSON.parse(o4.get('card:c_1').payload).v === 2)

  const reserved = syncMod.buildSyncOps({ words: JSON.parse('{"__proto__":{"a":1},"constructor":{"a":1}}') }, now)
  t('保留名不放进词表通道（无原型链污染）', reserved.size === 0)
}

console.log('\n[monitor.js — 最小监控（第 4 步 4.8）]')
{
  t('routeOf: /api/sync/pull → sync', monMod.routeOf('/api/sync/pull') === 'sync')
  t('routeOf: /api/sync（无尾斜杠）→ sync', monMod.routeOf('/api/sync') === 'sync')
  t('routeOf: 前缀不越界（/api/syncX 不算 sync）', monMod.routeOf('/api/syncX') === 'other')
  t('routeOf: dict / audio / auth / metrics / health',
    monMod.routeOf('/api/dict/go') === 'dict' && monMod.routeOf('/api/audio/b/a.mp3') === 'audio'
    && monMod.routeOf('/api/auth/login') === 'auth' && monMod.routeOf('/api/metrics') === 'metrics'
    && monMod.routeOf('/health') === 'health')
  t('routeOf: 未知/空/非字符串 → other',
    monMod.routeOf('/') === 'other' && monMod.routeOf('/api/nope') === 'other'
    && monMod.routeOf(null) === 'other' && monMod.routeOf(undefined) === 'other')

  const line = monMod.buildLogLine({ method: 'get', path: '/api/sync/pull?code=SECRET9', route: 'sync', status: 200, ms: 7, ip: '1.2.3.4' })
  const parsed = JSON.parse(line)
  t('buildLogLine: 结构化字段齐全',
    parsed.t === 'req' && parsed.m === 'GET' && parsed.r === 'sync'
    && parsed.s === 200 && parsed.ms === 7 && parsed.ip === '1.2.3.4')
  t('buildLogLine: 查询串被切掉（绝不记同步码/令牌）',
    parsed.p === '/api/sync/pull' && !line.includes('SECRET9'))
  t('buildLogLine: 路由缺省时按 path 现算',
    JSON.parse(monMod.buildLogLine({ path: '/api/dict/go', status: 404 })).r === 'dict')
  t('buildLogLine: 缺字段不炸',
    (() => { const o = JSON.parse(monMod.buildLogLine({})); return o.t === 'req' && o.m === 'GET' && o.s === 0 && o.p === '' })())

  const now = Date.UTC(2026, 9, 5, 15, 30)
  const qs = monMod.metricsQueries(now)
  t('metricsQueries: 六项计数',
    JSON.stringify(qs.map(q => q.name)) === JSON.stringify(
      ['dictLookupsToday', 'dictCached', 'syncCodes', 'syncLiveRows', 'syncTombstones', 'users']))
  t('metricsQueries: 全是 COUNT（永不 SELECT 业务行）', qs.every(q => /COUNT\(/i.test(q.sql)))
  const lookup = qs.find(q => q.name === 'dictLookupsToday')
  t('metricsQueries: 词典调用按 UTC 日切片',
    JSON.stringify(lookup.binds) === JSON.stringify([rlMod.utcDayStart(now)]))

  const shaped = monMod.shapeMetrics([{ n: 42 }, { n: 1200 }, { n: 3 }, { n: 500 }, { n: 7 }, { n: 9 }], now)
  t('shapeMetrics: 逐项落值',
    shaped.dictLookupsToday === 42 && shaped.dictCached === 1200 && shaped.syncCodes === 3
    && shaped.syncLiveRows === 500 && shaped.syncTombstones === 7 && shaped.users === 9)
  t('shapeMetrics: ok + serverNow + dayStart',
    shaped.ok === true && shaped.serverNow === new Date(now).toISOString() && shaped.dayStart === rlMod.utcDayStart(now))
  const zeros = monMod.shapeMetrics([null, undefined, {}, { n: 'x' }, { n: 0 }, { n: NaN }], now)
  t('shapeMetrics: 缺行/烂值一律回 0（不抛错、不隐藏）',
    Object.entries(zeros).filter(([k]) => !['ok', 'serverNow', 'dayStart'].includes(k)).every(([, v]) => v === 0))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
