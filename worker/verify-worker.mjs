/**
 * Worker 纯逻辑验证（不依赖 Cloudflare 运行时）：
 *   range.js — HTTP Range 头解析
 * 用法: node verify-worker.mjs
 *
 * 与 reader/verify-core.mjs 同一套 t(name, cond) 写法。
 */

import { parseRange } from './src/range.js'
import * as syncMod from './src/sync.js'

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

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
