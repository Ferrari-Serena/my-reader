/**
 * 第 14 步 块 C：离线「手感」的验证（`src/utils/offline.js` ＋ 断网时书架的壳供给）。
 *
 * 不起浏览器、不触网：offline.js 拿假的 `navigator` / `window` 驱动；
 * 壳清单那一半**真调** `vite.config.js` 里的 `mrSwPrecache()`，把注入后的 `sw.js` 拿出来看 ——
 * 不读源码里那个数组（那是「在不在」），看的是**产物里到底写了什么**（那才是 `sw.js` 的
 * `decide()` 真去查的 PRECACHE_SET）。
 *
 * 用法: node verify-offline.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as OFF from './src/utils/offline.js'
import { mrSwPrecache } from './vite.config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}

function fakeWin() {
  const map = new Map()
  return {
    map,
    addEventListener: (ty, fn) => map.set(ty, (map.get(ty) || []).concat(fn)),
    removeEventListener: (ty, fn) => map.set(ty, (map.get(ty) || []).filter((x) => x !== fn)),
    fire: (ty) => { for (const fn of (map.get(ty) || []).slice()) fn({}) },
    count: (ty) => (map.get(ty) || []).length,
  }
}

// ═══ ① 文案：空串／单复数 ═══
console.log('\n[offline — 文案]')
t('常驻那句是非空字符串', typeof OFF.OFFLINE_MSG === 'string' && OFF.OFFLINE_MSG.length > 0)
t('0 条**不说**「有 N 条要传」（回空串，整行不出现）', OFF.offlinePendingMsg(0) === '')
t('1 条用单数', OFF.offlinePendingMsg(1).includes('1 change ') && OFF.offlinePendingMsg(1).includes('back online'))
t('3 条用复数', OFF.offlinePendingMsg(3).includes('3 changes '))
t('脏输入（负数／NaN／undefined）回空串，不抛', OFF.offlinePendingMsg(-2) === '' && OFF.offlinePendingMsg(NaN) === '' && OFF.offlinePendingMsg(undefined) === '')

// ═══ ② 判定：明确离线才提示 ═══
console.log('\n[offline — 判定]')
OFF.resetOfflineWatch()
const navOff = { onLine: false }
const win1 = fakeWin()
const read1 = OFF.startOfflineWatch({ navigator: navOff, window: win1 })
t('断网启动就点亮（不等事件）', OFF.isOffline.value === true)
navOff.onLine = true
win1.fire('online')
t('网络回来（online 事件）⇒ 熄灭', OFF.isOffline.value === false)
navOff.onLine = false
win1.fire('offline')
t('再断（offline 事件）⇒ 又点亮', OFF.isOffline.value === true)

const navUnknown = {}
OFF.resetOfflineWatch()
const win2 = fakeWin()
OFF.startOfflineWatch({ navigator: navUnknown, window: win2 })
t('`onLine` 读不到（老浏览器）⇒ 当在线，不提示', OFF.isOffline.value === false)
navUnknown.onLine = false
win2.fire('offline')
t('…但真有 offline 事件时照实点亮（有信号就用）', OFF.isOffline.value === true)

// ═══ ③ 边界：空操作 ＋ 不重复挂 ═══
console.log('\n[offline — 边界]')
OFF.resetOfflineWatch()
t('拿不到 navigator／window（SSR、裸 node）⇒ 空操作返回 null', OFF.startOfflineWatch({ navigator: null, window: null }) === null)
t('…状态维持原样（不假装离线）', OFF.isOffline.value === false)
const win3 = fakeWin()
const nav3 = { onLine: true }
const r3a = OFF.startOfflineWatch({ navigator: nav3, window: win3 })
const r3b = OFF.startOfflineWatch({ navigator: nav3, window: win3 })
t('同一份 window 重复调用：不重复挂监听', win3.count('online') === 1 && win3.count('offline') === 1)
t('…并交回同一个重读函数（幂等）', r3a === r3b && typeof r3a === 'function')
OFF.resetOfflineWatch()
t('reset 会解绑：之后事件不再改状态', win3.count('online') === 0 && win3.count('offline') === 0)
nav3.onLine = false
win3.fire('offline')
t('…解绑后 offline 事件不再点亮', OFF.isOffline.value === false)

// ═══ ④ 壳清单：真跑一遍构建期注入 ═══
console.log('\n[offline — 构建期注入的壳清单（真调 mrSwPrecache）]')
const emitted = []
const ctx = {
  error(m) { throw new Error(m) },
  emitFile(f) { emitted.push(f) }
}
const bundle = {
  'index.html': { type: 'asset' },
  'assets/index-abc.js': { type: 'chunk' },
  'assets/index-abc.css': { type: 'asset' },
  'favicon.svg': { type: 'asset' },
  'manifest.json': { type: 'asset' },
  'assets/pdf.worker-x.mjs': { type: 'asset' }
}
let threw = null
try { mrSwPrecache().generateBundle.call(ctx, {}, bundle) } catch (e) { threw = e }
t('注入不报错（占位符各恰好 1 次）', !threw, threw ? threw.message : '')
t('产出一份 sw.js（asset）', emitted.length === 1 && emitted[0].fileName === 'sw.js' && emitted[0].type === 'asset')
const src = emitted.length ? String(emitted[0].source) : ''
t('占位符已全部替换（产物里不再有 __SW_）', !!src && !src.includes('__SW_'))
t('BUILD 注入的是真版本串，不是占位符字面量', /const BUILD = '[^'"]+'/.test(src) && !src.includes("'__SW_BUILD__'"))
const m = src.match(/const PRECACHE = (\[[\s\S]*?\n\])/)
let list = []
try { list = m ? JSON.parse(m[1]) : [] } catch { list = [] }
t('能从产物里读出 PRECACHE 数组', Array.isArray(list) && list.length > 0)
const has = (x) => list.includes(x)
t('**书架入口索引在壳里**（块 C：断网打开 App→进书架 不该是空的）', has('/books/book-index.json'))
t('/data/phrases.json 仍在壳里（块 B 的去重前提）', has('/data/phrases.json'))
t('产物 chunk／图标／清单照旧进壳（/index.html、js、css、svg、manifest）',
  has('/index.html') && has('/assets/index-abc.js') && has('/assets/index-abc.css') && has('/favicon.svg') && has('/manifest.json'))
t('按需才下的懒加载件**不进壳**（留在 runtime 那条路）', !has('/assets/pdf.worker-x.mjs'))
t('清单是排序过的（注入稳定、diff 可读）',
  JSON.stringify(list) === JSON.stringify([...list].sort()))

// ═══ ⑤ 接线（来源级 —— 组件渲染靠真机） ═══
console.log('\n[offline — 接线]')
{
  const main = readFileSync(join(__dirname, 'src/main.js'), 'utf8')
  const app = readFileSync(join(__dirname, 'src/App.vue'), 'utf8')
  t('main.js 启动就挂上监听', main.includes("from './utils/offline.js'") && /^\s*startOfflineWatch\(\)/m.test(main))
  t('App.vue 用同一个判定（不自己读 navigator.onLine 另写一套）',
    app.includes("from './utils/offline.js'") && app.includes('isOffline') && !app.includes('navigator.onLine'))
  t('离线条画在离线时（v-if）', /v-if="isOffline"/.test(app))
  t('第二行是「待上传条数」，且用同步那份计数（sync.pending）',
    app.includes('offlinePendingLine') && app.includes('offlinePendingMsg(sync.pending.value)'))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)