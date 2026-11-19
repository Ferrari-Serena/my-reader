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
import viteConfig, {
  mrSwPrecache, resolveBuildId, BUILD_ID_RE, SOURCE_ALLOW, buildSourceAllow,
  allowedValues, findVersionShapedStrings, scanVersionStrings, assertNoUnregisteredVersions,
  judgeWorkerPayload, assertVersionConsistency, assertSwTemplateAnchors,
} from './vite.config.js'
import { WORKER_VERSION, WORKER_SERVICE, versionPayload } from '../worker/src/version.js'

// 3.1b：构建身份没有 dev 回退，测试也必须显式给一个（模拟 CI 的 GITHUB_SHA）。
const TEST_BUILD_ID = 'abc123def456'
process.env.MR_BUILD_ID = TEST_BUILD_ID

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
t('BUILD 注入的是真版本串，不是占位符字面量', src.includes(`const BUILD = '${TEST_BUILD_ID}'`) && !src.includes("'__SW_BUILD__'"))
t('Worker 版本也注入了（3.1b 安装期握手的期望值）',
  src.includes(`const WORKER_VERSION = '${WORKER_VERSION}'`) && !src.includes('__SW_WORKER_VERSION__'))
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

// ═══ ⑥ 3.1b：版本源（无 dev 回退）＋ SOURCE_ALLOW 登记表 ═══
console.log('\n[offline — 3.1b 版本源与登记表]')
function mustThrow(fn) {
  try { const r = fn(); return r === undefined ? null : null } catch (e) { return e }
}
t('BUILD_ID：缺 env ⇒ 抛（无 dev 回退）', !!mustThrow(() => resolveBuildId({})))
t("BUILD_ID：'dev' ⇒ 抛", !!mustThrow(() => resolveBuildId({ MR_BUILD_ID: 'dev' })))
t('BUILD_ID：非十六进制 ⇒ 抛', !!mustThrow(() => resolveBuildId({ MR_BUILD_ID: 'not-a-sha' })))
t('BUILD_ID：GITHUB_SHA 取前 12 位并小写', resolveBuildId({ GITHUB_SHA: 'A1B2C3D4E5F6A7B8' }) === 'a1b2c3d4e5f6')
t('BUILD_ID：显式 MR_BUILD_ID 生效', resolveBuildId({ MR_BUILD_ID: TEST_BUILD_ID }) === TEST_BUILD_ID)
t('BUILD_ID 形状是 12 位十六进制（收窄以免误杀校验常量）', BUILD_ID_RE.test(TEST_BUILD_ID) && BUILD_ID_RE.test('a'.repeat(12)) && !BUILD_ID_RE.test('a'.repeat(11)) && !BUILD_ID_RE.test('dev'))
const devCfg = viteConfig({ command: 'serve', mode: 'development' })
t('dev 身份也是真 12 位 SHA（不是 dev 兜底）', BUILD_ID_RE.test(JSON.parse(devCfg.define.__APP_VERSION__)))
t('注入的 __APP_VERSION__ 是本测试显式给的 BUILD_ID', JSON.parse(devCfg.define.__APP_VERSION__) === TEST_BUILD_ID)
const buildCfg = viteConfig({ command: 'build' })
t('build 配置走严格解析（同为本测试的 BUILD_ID）', JSON.parse(buildCfg.define.__APP_VERSION__) === TEST_BUILD_ID)
t('前端也注入 Worker 期望版本（CI/运行时握手）', JSON.parse(devCfg.define.__WORKER_VERSION__) === WORKER_VERSION)

const REQUIRED_FIELDS = ['id', 'slot', 'consumer', 'registrant', 'reason']
t('登记表每条字段写全（身份/注册槽/消费者/登记人/原因）',
  SOURCE_ALLOW.length >= 2 && SOURCE_ALLOW.every((e) => REQUIRED_FIELDS.every((k) => typeof e[k] === 'string' && e[k].trim().length > 0)))
const resolvedAllow = buildSourceAllow(TEST_BUILD_ID)
t('登记表能解析出本次构建的允许值（BUILD_ID + WORKER_VERSION）',
  resolvedAllow.some((e) => e.kind === 'build-id' && e.value === TEST_BUILD_ID)
  && resolvedAllow.some((e) => e.kind === 'worker-version' && e.value === WORKER_VERSION))
t('允许值清单恰好是登记的那两条',
  JSON.stringify([...allowedValues(TEST_BUILD_ID)].sort()) === JSON.stringify([TEST_BUILD_ID, WORKER_VERSION].sort()))

// ═══ ⑦ 3.1b：扫描器（构建期 / 成品期共用） ═══
console.log('\n[offline — 3.1b 版本形串扫描]')
t('登记过的 SHA 形串不报', scanVersionStrings([{ path: 'x.js', text: `const B = '${TEST_BUILD_ID}'` }], [TEST_BUILD_ID, WORKER_VERSION]).length === 0)
t('登记过的 YYYY.MM.DD.N 不报', scanVersionStrings([{ path: 'x.js', text: `const W = '${WORKER_VERSION}'` }], [TEST_BUILD_ID, WORKER_VERSION]).length === 0)
const badSha = scanVersionStrings([{ path: 'x.js', text: "const LEAK = 'deadbeefcafe'" }], [TEST_BUILD_ID, WORKER_VERSION])
t('未登记 SHA 形串 ⇒ 红（并报出值与位置）', badSha.length === 1 && badSha[0].value === 'deadbeefcafe' && badSha[0].path === 'x.js')
t('未登记 YYYY.MM.DD.N ⇒ 红', scanVersionStrings([{ path: 'x.js', text: "const LEAK = '2025.01.01.9'" }], [TEST_BUILD_ID, WORKER_VERSION]).length === 1)
t('普通串不误报（缓存名 / 占位符 / 文件名）',
  findVersionShapedStrings("'mr-runtime-v1' '__SW_BUILD__' '/assets/index-abc.js' 'mr-shell-abc123'").length === 0)
t('assertNoUnregisteredVersions：违规即 throw', !!mustThrow(() => assertNoUnregisteredVersions([{ path: 'x.js', text: "'2025.01.01.9'" }], [])))

// ═══ ⑧ 3.1b：Worker /version 握手 ═══
console.log('\n[offline — 3.1b Worker 版本握手]')
t('握手正例：payload 与期望一致', assertVersionConsistency({ buildId: TEST_BUILD_ID, workerVersion: WORKER_VERSION, workerPayload: versionPayload() }) === true)
t('握手负例：Worker 版本 mismatch ⇒ throw', /mismatch/.test(String(mustThrow(() => assertVersionConsistency({ buildId: TEST_BUILD_ID, workerVersion: WORKER_VERSION, workerPayload: { service: WORKER_SERVICE, version: '2026.11.18.9' } })))))
t('握手负例：缺 version 字段 ⇒ throw', /missing/.test(String(mustThrow(() => assertVersionConsistency({ buildId: TEST_BUILD_ID, workerPayload: {} })))))
t('握手负例：格式错 ⇒ throw', /format/.test(String(mustThrow(() => assertVersionConsistency({ buildId: TEST_BUILD_ID, workerPayload: { version: 'v1.2' } })))))
t('握手负例：BUILD_ID 格式错 ⇒ throw', !!mustThrow(() => assertVersionConsistency({ buildId: 'dev', workerPayload: versionPayload() })))
t('judgeWorkerPayload 三类原因可区分',
  judgeWorkerPayload(null).reason === 'missing'
  && judgeWorkerPayload({ version: 'v1' }).reason === 'format'
  && judgeWorkerPayload({ version: '2025.01.01.9' }, WORKER_VERSION).reason === 'mismatch')
t('WORKER_VERSION 是机器可读的 YYYY.MM.DD.N', /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(WORKER_VERSION))

// ═══ ⑨ 3.1b：占位符负测（重复 / 漏注 / 错注 / 成品期未登记） ═══
console.log('\n[offline — 3.1b 占位符与成品期负测]')
const swSrc = readFileSync(join(__dirname, 'sw.js'), 'utf8')
function runPlugin({ template = swSrc, buildId = TEST_BUILD_ID, workerVersion = WORKER_VERSION, bundle = {} } = {}) {
  const emitted = []
  const ctx = { error(m) { throw new Error(m) }, emitFile(f) { emitted.push(f) } }
  mrSwPrecache({ template, buildId, workerVersion }).generateBundle.call(ctx, {}, bundle)
  return emitted
}
const pos = runPlugin()
t('正例：三处占位符全部替换、不留 __SW_',
  pos.length === 1 && !String(pos[0].source).includes('__SW_') && String(pos[0].source).includes(WORKER_VERSION))

const dupErr = mustThrow(() => runPlugin({ template: swSrc.replace('const BUILD =', "// 错注示范：占位符又写进注释 __SW_BUILD__\nconst BUILD =") }))
t('重复占位符（写进注释也算）⇒ 构建红', !!dupErr && /__SW_BUILD__.*恰好出现 1 次/.test(dupErr.message))
const missErr = mustThrow(() => runPlugin({ template: swSrc.replace('const PRECACHE = __SW_PRECACHE__', 'const PRECACHE = []') }))
t('漏注（清单占位符缺失）⇒ 构建红', !!missErr && /__SW_PRECACHE__.*恰好出现 1 次/.test(missErr.message))
const missWorkerErr = mustThrow(() => runPlugin({ template: swSrc.replace("const WORKER_VERSION = '__SW_WORKER_VERSION__'", `const WORKER_VERSION = '${WORKER_VERSION}'`) }))
t('漏注（Worker 版本占位符缺失）⇒ 构建红', !!missWorkerErr && /__SW_WORKER_VERSION__.*恰好出现 1 次/.test(missWorkerErr.message))

const injectErr = mustThrow(() => runPlugin({ template: swSrc + "\nconst LEAK = '2025.01.01.9'\n" }))
t('错注：模板里混入未登记版本形串 ⇒ 成品期扫描红', !!injectErr && /未登记版本形串/.test(injectErr.message))
const bundleErr = mustThrow(() => runPlugin({ bundle: { 'assets/app.js': { type: 'chunk', code: "const V='2025.01.01.9'" } } }))
t('成品期扫描：chunk 里未登记版本串 ⇒ 红', !!bundleErr && /未登记版本形串/.test(bundleErr.message))
const devErr = mustThrow(() => runPlugin({ buildId: 'dev' }))
t("BUILD_ID='dev' 注入 ⇒ 构建红", !!devErr && /BUILD_ID 格式错/.test(devErr.message))

const startCtx = { error(m) { throw new Error(m) } }
t('构建期扫描：干净模板通过', mrSwPrecache({ template: swSrc, buildId: TEST_BUILD_ID }).buildStart.call(startCtx) === undefined)
const startErr = mustThrow(() => mrSwPrecache({ template: swSrc + "\nconst LEAK='2025.01.01.9'", buildId: TEST_BUILD_ID }).buildStart.call({ error(m) { throw new Error(m) } }))
t('构建期扫描：未登记版本串 ⇒ 红', !!startErr && /未登记版本形串/.test(startErr.message))

// ═══ ⑩ 3.1b 第三项补钉：可执行锚定 + 真正的「错注」负测 ═══
// 旧实现只数出现次数（移进注释仍是 1）＋ rendered.includes（仍能找到注入值）⇒ 放行。
// 新实现要求占位符落在可执行赋值上；注释/其它字符串里的不算。
console.log('\n[offline — 3.1b 可执行锚定与错注负测]')
t('锚定正例：真模板的 BUILD/WORKER_VERSION/PRECACHE 都在可执行赋值上',
  assertSwTemplateAnchors(swSrc) === true)

const misBuildErr = mustThrow(() => runPlugin({
  template: swSrc.replace(
    "const BUILD = '__SW_BUILD__'",
    "// 错注：唯一占位符被移进注释\n// '__SW_BUILD__'\nconst BUILD = ''"
  )
}))
t('错注负测：唯一 BUILD 占位符被移进注释 ⇒ 构建红',
  !!misBuildErr && /__SW_BUILD__.*(注释|可执行赋值)/.test(misBuildErr.message))

const misWorkerErr = mustThrow(() => runPlugin({
  template: swSrc.replace(
    "const WORKER_VERSION = '__SW_WORKER_VERSION__'",
    "// '__SW_WORKER_VERSION__'\nconst WORKER_VERSION = ''"
  )
}))
t('错注负测：唯一 WORKER_VERSION 占位符被移进注释 ⇒ 构建红',
  !!misWorkerErr && /__SW_WORKER_VERSION__.*(注释|可执行赋值)/.test(misWorkerErr.message))

const misPrecacheErr = mustThrow(() => runPlugin({
  template: swSrc.replace(
    'const PRECACHE = __SW_PRECACHE__',
    '// __SW_PRECACHE__\nconst PRECACHE = []'
  )
}))
t('错注负测：唯一 PRECACHE 占位符被移进注释 ⇒ 构建红',
  !!misPrecacheErr && /__SW_PRECACHE__.*(注释|可执行赋值)/.test(misPrecacheErr.message))

const stringOnlyErr = mustThrow(() => runPlugin({
  template: swSrc.replace(
    "const BUILD = '__SW_BUILD__'",
    "const BUILD = ''\nconst NOTE = '__SW_BUILD__'"
  )
}))
t('错注负测：占位符只在普通字符串里、不在赋值上 ⇒ 构建红',
  !!stringOnlyErr && /__SW_BUILD__.*(不在可执行赋值|不在字符串|注释)/.test(stringOnlyErr.message))

t('直接负测：assertSwTemplateAnchors 对「注释里的唯一占位符」抛',
  !!mustThrow(() => assertSwTemplateAnchors(swSrc.replace(
    "const BUILD = '__SW_BUILD__'",
    "// '__SW_BUILD__'\nconst BUILD = ''"
  ))))

const buildStartMisErr = mustThrow(() => mrSwPrecache({
  template: swSrc.replace(
    "const BUILD = '__SW_BUILD__'",
    "// '__SW_BUILD__'\nconst BUILD = ''"
  ),
  buildId: TEST_BUILD_ID,
}).buildStart.call({ error(m) { throw new Error(m) } }))
t('错注负测（buildStart 早失败）：唯一 BUILD 占位符移进注释 ⇒ 构建红',
  !!buildStartMisErr && /__SW_BUILD__.*(注释|可执行赋值)/.test(buildStartMisErr.message))

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)