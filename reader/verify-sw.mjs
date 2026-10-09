/**
 * 第 14 步 块 A：Service Worker（`sw.js` ＋ `utils/swUpdate.js`）的验证。
 *
 * 不起浏览器、不触网：`sw.js` 在**假的 SW 全局**里跑（`self` / `caches` / `fetch` 全是我们给的），
 * 然后按事件（install / activate / message / fetch）真派发，断言它到底干了什么。
 * 为什么值得这样绕：SW 真要命的错都长在「拦了不该拦的」「缓存了半截的」「装到旧壳」
 *   这类**只在真实运行时才现形**的判断上，光读源码读不出来。
 *
 * 用法: node verify-sw.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as SW from './src/utils/swUpdate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const ORIGIN = 'https://my-reader.ferrari11.com'
const SW_SRC = readFileSync(join(__dirname, 'sw.js'), 'utf8')

// ═══ 假 SW 运行时 ═══
const norm = (req) => {
  const url = typeof req === 'string' ? req : req.url
  return url.startsWith('/') ? ORIGIN + url : url
}
// 真 SW 里 `new Request('/index.html')` 合法（按 SW 自身位置解析）；Node 的 Request 要求绝对 URL。
// 这一层把相对路径补成绝对，别让「假环境比真环境更严」把好代码判成坏代码。
function mkRequest(input, init) {
  const resolved = typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input) ? ORIGIN + input : input
  return new Request(resolved, init)
}

function makeEnv({ fetchImpl } = {}) {
  const stores = new Map()   // cacheName -> Map（Map 保插入序，正好当 LRU 用）
  const events = new Map()
  const calls = { skipWaiting: 0, claim: 0, reload: 0, fetches: [], added: [], addCache: [] }

  const openStore = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name) }

  const makeCache = (name) => {
    const store = openStore(name)
    return {
      async add(req) {
        const res = await impl(norm(req))
        if (!res.ok) throw new Error('add ' + res.status + ' ' + norm(req))
        calls.added.push(norm(req))
        calls.addCache.push(req.cache)
        store.set(norm(req), res)
      },
      async put(req, res) { store.set(norm(req), res) },
      async match(req) { return store.get(norm(req)) || undefined },
      async keys() { return [...store.keys()].map((u) => mkRequest(u)) },
      async delete(req) { return store.delete(norm(req)) },
    }
  }

  const cachesMock = {
    async open(name) { openStore(name); return makeCache(name) },
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
    async match(req) {
      const url = norm(req)
      for (const store of stores.values()) if (store.has(url)) return store.get(url)
      return undefined
    },
    async has() { return false },
  }

  const selfMock = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { events.set(type, (events.get(type) || []).concat(fn)) },
    skipWaiting: () => { calls.skipWaiting++ },
    clients: { claim: async () => { calls.claim++ } },
  }

  const baseImpl = fetchImpl || (async (url) => new Response('{"net":true}', { status: 200 }))
  const impl = async (url) => { calls.fetches.push(url); return baseImpl(url) }

  return {
    stores, events, calls, self: selfMock, caches: cachesMock,
    fetch: (input) => impl(norm(input)),
  }
}

function loadSw(opts = {}) {
  const env = makeEnv(opts)
  const src = SW_SRC
    .replace('__SW_BUILD__', opts.build || 'testbuild')
    .replace('__SW_PRECACHE__', JSON.stringify(opts.precache || ['/index.html', '/assets/index-abc.js']))
  const fn = new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'console', src)
  fn(env.self, env.caches, env.fetch, mkRequest, Response, URL, console)
  return env
}

function mkEvent(extra = {}) {
  const waits = []
  const ev = { waits, waitUntil: (p) => waits.push(p), ...extra }
  return ev
}
const settle = (ev) => Promise.all(ev.waits.map((p) => Promise.resolve(p).catch(() => null)))
function fire(env, type, ev) {
  const fns = env.events.get(type) || []
  for (const fn of fns.slice()) fn(ev)
  return ev
}
function fetchEv(request) {
  const ev = mkEvent({ request, response: undefined })
  ev.respondWith = (p) => { ev.response = p }
  return ev
}
const mkReq = (url, init = {}) => mkRequest(url, init)
const navReq = (url) => {
  try { return mkRequest(url, { mode: 'navigate' }) }
  catch { return { url: ORIGIN + url, method: 'GET', mode: 'navigate', headers: new Headers() } }
}

// ═══ ① 模板卫生（构建期必须注入的两个占位符）═══
console.log('\n[sw — 模板卫生]')
const countOf = (s, tok) => s.split(tok).length - 1
t('占位符「版本号」恰好出现 1 次（多一处就是把真值注进注释、代码留空）', countOf(SW_SRC, '__SW_BUILD__') === 1)
t('占位符「清单」恰好出现 1 次', countOf(SW_SRC, '__SW_PRECACHE__') === 1)
function sliceHandler(src, marker) {
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('marker not found: ' + marker)
  const rest = src.slice(i + marker.length)
  const next = rest.indexOf("addEventListener('")
  return next < 0 ? rest : rest.slice(0, next)
}
const installSrc = sliceHandler(SW_SRC, "addEventListener('install'")
const messageSrc = sliceHandler(SW_SRC, "addEventListener('message'")
t('install 里不调 skipWaiting（更新要问过用户，不能自己换掉）', !installSrc.includes('skipWaiting'))
t('只有 message 那一处会 skipWaiting，且认 SKIP_WAITING 这个暗号',
  messageSrc.includes('SKIP_WAITING') && messageSrc.includes('skipWaiting'))

// ═══ ② install：壳预缓存 ═══
console.log('\n[sw — install / 预缓存]')
const env1 = loadSw()
const ev1 = fire(env1, 'install', mkEvent())
await settle(ev1)
const shellName = 'mr-shell-testbuild'
t('install 建的是「带 BUILD 号」的壳缓存（版本化 ⇒ 换版本不会混用旧壳）', env1.stores.has(shellName))
t('清单里每条都进了缓存', eq([...env1.stores.get(shellName).keys()].sort(), [ORIGIN + '/assets/index-abc.js', ORIGIN + '/index.html'].sort()))
t('取壳时带 cache:"reload"（绕开 index.html 的 max-age=600，否则会装到上一版）',
  eq(env1.calls.addCache, ['reload', 'reload']))
t('install 自己不动 skipWaiting', env1.calls.skipWaiting === 0)

const env2 = loadSw({ fetchImpl: async (url) => (url.endsWith('/assets/index-abc.js') ? new Response('', { status: 404 }) : new Response('{"net":true}', { status: 200 })) })
const ev2 = fire(env2, 'install', mkEvent())
let installRejected = false
await Promise.all(ev2.waits.map((p) => Promise.resolve(p).catch(() => { installRejected = true })))
t('单条 404 不拖垮整次安装（逐条 add，失败即吞）', !installRejected && env2.calls.added.includes(ORIGIN + '/index.html'))
t('失败那条确实没进缓存', !env2.stores.get(shellName).has(ORIGIN + '/assets/index-abc.js'))

// ═══ ③ activate：清旧壳、claim ═══
console.log('\n[sw — activate / 清旧壳]')
const env3 = loadSw()
await settle(fire(env3, 'install', mkEvent()))   // 真机上 activate 之前一定先跑过 install
env3.stores.set('mr-shell-oldbuild', new Map())
env3.stores.set('mr-runtime-v1', new Map())
env3.stores.set('mr-dict-v1', new Map())
const ev3 = fire(env3, 'activate', mkEvent())
await settle(ev3)
t('旧版本的壳缓存被删', !env3.stores.has('mr-shell-oldbuild'))
t('当前版本的壳缓存留着', env3.stores.has('mr-shell-testbuild'))
t('运行时/词典缓存**不**跟着版本清（离线读过的书不该因一次部署就没了）',
  env3.stores.has('mr-runtime-v1') && env3.stores.has('mr-dict-v1'))
t('activate 里 claim 了（否则新 SW 要等下次导航才接管）', env3.calls.claim === 1)

// ═══ ④ message ═══
console.log('\n[sw — message]')
const env4 = loadSw()
fire(env4, 'message', { data: { type: 'SKIP_WAITING' } })
t('SKIP_WAITING 才 skipWaiting', env4.calls.skipWaiting === 1)
fire(env4, 'message', { data: { type: 'something-else' } })
fire(env4, 'message', {})
fire(env4, 'message', { data: null })
t('别的消息（含空对象）不误触发', env4.calls.skipWaiting === 1)

// ═══ ⑤ fetch：放行清单 ═══
console.log('\n[sw — 该放行的]')
const env5 = loadSw()
function bypasses(name, request) {
  const ev = fire(env5, 'fetch', fetchEv(request))
  t(name, ev.response === undefined)
}
bypasses('POST 一律放行', mkReq('/api/sync/push', { method: 'POST', body: '{}' }))
bypasses('跨域放行', mkRequest('https://example.com/x.js'))
bypasses('/api/auth/me 放行（缓存一份「我是谁」只会更糟）', mkReq('/api/auth/me'))
bypasses('/api/sync/state 放行', mkReq('/api/sync/state'))
bypasses('/api/gen/queue 放行', mkReq('/api/gen/queue'))
bypasses('/api/feedback 放行', mkReq('/api/feedback'))
bypasses('带 Range 的请求放行（206 半截不能当整份存）', mkReq('/data/phrases.json', { headers: { range: 'bytes=0-99' } }))
bypasses('音频文件放行（不清缓存、不预缓存，50 MB/本）', mkReq('/books/bk/audio/ch-01.mp3'))

// ═══ ⑥ fetch：壳资源 cache-first ═══
console.log('\n[sw — 壳资源]')
const env6 = loadSw()
const ev6 = fire(env6, 'install', mkEvent())
await settle(ev6)
env6.calls.fetches.length = 0   // install 自己也要抓一遍清单，下面只关心「这次 fetch 有没有打网络」
const hitEv = fire(env6, 'fetch', fetchEv(mkReq('/assets/index-abc.js')))
const hitRes = await hitEv.response
t('预缓存里有的 chunk：直接给缓存，不打网络', hitRes && hitRes.status === 200 && env6.calls.fetches.filter((u) => u.includes('index-abc')).length === 0)
const missEv = fire(env6, 'fetch', fetchEv(mkReq('/assets/index-nope.js')))
await missEv.response
t('预缓存里没有的：走网络（部署后新 chunk 不会因为 SW 而取不到）',
  env6.calls.fetches.some((u) => u.includes('index-nope')))

// ═══ ⑦ fetch：导航（网络优先，离线回壳）═══
console.log('\n[sw — 导航]')
const env7 = loadSw()
const idxRes = new Response('<html>shell</html>', { status: 200, headers: { 'content-type': 'text/html' } })
env7.stores.set(shellName, new Map([[ORIGIN + '/index.html', idxRes]]))
const navEv = fire(env7, 'fetch', fetchEv(navReq('/')))
const navRes = await navEv.response
t('在线导航给的是网络那份', navRes && (await navRes.text()) === '{"net":true}')
t('在线导航不把网络 index.html 写回壳缓存（壳缓存只属于它自己的 BUILD）',
  env7.stores.get(shellName).get(ORIGIN + '/') === undefined)
const envOff = loadSw({ fetchImpl: async () => { throw new Error('offline') } })
envOff.stores.set(shellName, new Map([[ORIGIN + '/index.html', idxRes]]))
const offEv = fire(envOff, 'fetch', fetchEv(navReq('/')))
const offRes = await offEv.response
t('离线导航退回预缓存的 index.html', offRes && (await offRes.text()) === '<html>shell</html>')

// ═══ ⑧ fetch：词典 ═══
console.log('\n[sw — 词典]')
const env8 = loadSw({ fetchImpl: async () => new Response('{"def":"miao"}', { status: 200 }) })
const dEv = fire(env8, 'fetch', fetchEv(mkReq('/api/dict/miao')))
await dEv.response
await settle(dEv)
t('查到的词进 mr-dict-v1（离线查过的词才有得查）', env8.stores.get('mr-dict-v1').has(ORIGIN + '/api/dict/miao'))
const env8b = loadSw({ fetchImpl: async () => { throw new Error('offline') } })
env8b.stores.set('mr-dict-v1', new Map([[ORIGIN + '/api/dict/miao', new Response('{"def":"cached"}', { status: 200 })]]))
const dEv2 = fire(env8b, 'fetch', fetchEv(mkReq('/api/dict/miao')))
t('离线时回缓存那份', (await (await dEv2.response).text()) === '{"def":"cached"}')
const dEv3 = fire(env8b, 'fetch', fetchEv(mkReq('/api/dict/never-seen')))
let dRejected = false
await Promise.resolve(dEv3.response).catch(() => { dRejected = true })
t('离线且没缓存过的词：照实失败（不编一个空释义出去）', dRejected)
const env8c = loadSw({ fetchImpl: async () => new Response('boom', { status: 500 }) })
const dEv4 = fire(env8c, 'fetch', fetchEv(mkReq('/api/dict/boom')))
await dEv4.response
await settle(dEv4)
t('非 200 不进缓存（5xx 缓存下来会一直重复坏结果）', !env8c.stores.has('mr-dict-v1'))

// ═══ ⑨ 词典缓存上限 ═══
console.log('\n[sw — 词典上限]')
const env9 = loadSw()
env9.stores.set('mr-dict-v1', new Map())
const dStore = env9.stores.get('mr-dict-v1')
for (let i = 0; i < 3000; i++) dStore.set(ORIGIN + '/api/dict/w' + i, new Response('{}', { status: 200 }))
t('先备好 3000 条（＝上限）', dStore.size === 3000)
const d9 = fire(env9, 'fetch', fetchEv(mkReq('/api/dict/fresh')))
await d9.response
await settle(d9)
t('多出来的那条被写进去', dStore.has(ORIGIN + '/api/dict/fresh'))
t('最老的被挤掉、总数锁回上限', !dStore.has(ORIGIN + '/api/dict/w0') && dStore.size === 3000)

// ═══ ⑩ fetch：静态 JSON 的 stale-while-revalidate ═══
console.log('\n[sw — 书 JSON（SWR）]')
const env10 = loadSw({ fetchImpl: async () => new Response('{"v":2}', { status: 200 }) })
env10.stores.set('mr-runtime-v1', new Map([[ORIGIN + '/books/bk/chapters.json', new Response('{"v":1}', { status: 200 })]]))
const sEv = fire(env10, 'fetch', fetchEv(mkReq('/books/bk/chapters.json')))
const sFirst = await sEv.response
t('先给手里那份（离线也能立刻读上次的书）', (await sFirst.text()) === '{"v":1}')
await settle(sEv)
t('后台把这趟的新版落盘（下次打开就是新的）',
  (await env10.stores.get('mr-runtime-v1').get(ORIGIN + '/books/bk/chapters.json').text()) === '{"v":2}')
const env10b = loadSw()
const sEv2 = fire(env10b, 'fetch', fetchEv(mkReq('/books/bk/chapters.json')))
t('没缓存过的 + 在线：直接给网络那份', (await (await sEv2.response).text()) === '{"net":true}')
const env10c = loadSw({ fetchImpl: async () => { throw new Error('offline') } })
const sEv3 = fire(env10c, 'fetch', fetchEv(mkReq('/books/bk/chapters.json')))
t('没缓存过的 + 离线：504（不假装读到了书）', (await sEv3.response).status === 504)

// ═══ ⑫ 块 B：运行时缓存的边界与体量闸 ═══
console.log('\n[sw — 运行时缓存：边界与体量闸]')

// 壳清单里的大件（phrases.json 367 KB）：由壳供给 —— 不打网络，也不在 runtime 存第二份
const env11 = loadSw({ precache: ['/index.html', '/assets/index-abc.js', '/data/phrases.json'] })
await settle(fire(env11, 'install', mkEvent()))
env11.calls.fetches.length = 0
const pEv = fire(env11, 'fetch', fetchEv(mkReq('/data/phrases.json')))
const pRes = await pEv.response
// 快照要在 settle 之前取：突变版会把「后台更新」也算成一次网络请求，settle 之后就看不出来了
const netForShell = env11.calls.fetches.length
await settle(pEv)
t('壳里有的（phrases.json）：命中即回', !!pRes && pRes.status === 200)
t('…也不再打一遍网络（省一次 367 KB）', netForShell === 0)
t('…更不在 runtime 里存第二份', !env11.stores.has('mr-runtime-v1'))

// 壳里没有的产物（按需才下的懒加载件，如 pdf worker 的 .mjs）：首次抓到就落 runtime
const env12 = loadSw()
env12.calls.fetches.length = 0
const aEv = fire(env12, 'fetch', fetchEv(mkReq('/assets/pdf.worker-AbC123.mjs')))
await aEv.response
await settle(aEv)
t('壳里没有的产物：走网络', env12.calls.fetches.some((u) => u.includes('pdf.worker')))
t('…并落 runtime（下次离线也有）', env12.stores.get('mr-runtime-v1').has(ORIGIN + '/assets/pdf.worker-AbC123.mjs'))
env12.calls.fetches.length = 0
const aEv2 = fire(env12, 'fetch', fetchEv(mkReq('/assets/pdf.worker-AbC123.mjs')))
await aEv2.response
t('…第二次直接吃缓存，不再打网络', env12.calls.fetches.length === 0)

// 体量闸：runtime 同样只留 400 条（无界增长的缓存＝迟早把用户磁盘吃满）
const env13 = loadSw()
env13.stores.set('mr-runtime-v1', new Map())
const rStore = env13.stores.get('mr-runtime-v1')
for (let i = 0; i < 400; i++) rStore.set(ORIGIN + '/books/bk/f' + i + '.json', new Response('{}', { status: 200 }))
const capEv = fire(env13, 'fetch', fetchEv(mkReq('/books/bk/fresh.json')))
await capEv.response
await settle(capEv)
t('runtime 写进新抓到的那条', rStore.has(ORIGIN + '/books/bk/fresh.json'))
t('runtime 锁回 400 条、最老的被丢', rStore.size === 400 && !rStore.has(ORIGIN + '/books/bk/f0.json'))

// 音频：连缓存都不进（离线不支持听书 —— 块 B 明写的边界，不是漏做）
const env14 = loadSw()
const mp3Ev = fire(env14, 'fetch', fetchEv(mkReq('/books/bk/audio/ch-01.mp3')))
t('音频请求连 respondWith 都不调', mp3Ev.response === undefined)
t('音频不会凭空建出 runtime 缓存', !env14.stores.has('mr-runtime-v1'))

// 壳清单里那条 install 时没抓到（404 被吞掉）：运行时请求它也不该炸，照实走网络
let holeServed = false
const env15 = loadSw({
  precache: ['/index.html', '/data/phrases.json'],
  fetchImpl: async (u) => {
    if (u.endsWith('/data/phrases.json') && !holeServed) { holeServed = true; return new Response('', { status: 404 }) }
    return new Response('{"net":true}', { status: 200 })
  },
})
await settle(fire(env15, 'install', mkEvent()))
const holeEv = fire(env15, 'fetch', fetchEv(mkReq('/data/phrases.json')))
const holeRes = await holeEv.response
t('壳里有名分但实际缺席：运行时照实走网络、不抛', !!holeRes && holeRes.status === 200)
// ═══ ⑪ 页面侧：注册与横幅 ═══
console.log('\n[sw — 页面侧]')
function fakeNav({ controller = null, registerImpl } = {}) {
  const map = new Map()
  return {
    map,
    serviceWorker: {
      controller,
      addEventListener: (ty, fn) => map.set(ty, (map.get(ty) || []).concat(fn)),
      register: registerImpl || (async () => ({ waiting: null, installing: null, addEventListener: () => {} })),
    },
    fire: (ty) => { for (const fn of (map.get(ty) || []).slice()) fn({}) },
  }
}
function fakeWin() {
  const w = { reloads: 0, location: { reload: () => { w.reloads++ } } }
  return w
}
function fakeReg({ waiting = null, installing = null } = {}) {
  const map = new Map()
  return {
    waiting, installing,
    addEventListener: (ty, fn) => map.set(ty, (map.get(ty) || []).concat(fn)),
    fire: (ty) => { for (const fn of (map.get(ty) || []).slice()) fn({}) },
  }
}
function fakeWorker(state = 'installing') {
  const map = new Map()
  return {
    state,
    addEventListener: (ty, fn) => map.set(ty, (map.get(ty) || []).concat(fn)),
    setState(s) { this.state = s; for (const fn of (map.get('statechange') || []).slice()) fn({}) },
    postMessage(msg) { this.posted = msg },
  }
}

t('横幅文案与按钮都是非空字符串', typeof SW.SW_UPDATE_MSG === 'string' && SW.SW_UPDATE_MSG.length > 0 && typeof SW.SW_UPDATE_ACTION === 'string' && SW.SW_UPDATE_ACTION.length > 0)
SW.resetSwUpdate()
t('没有 navigator（SSR/裸 node）时注册是空操作', SW.startServiceWorker({ navigator: null, window: null }) === null)
t('**dev 构建不注册**（node 里 import.meta.env 不存在 ⇒ 当 dev 处理）',
  SW.startServiceWorker({ navigator: fakeNav(), window: fakeWin() }) === null)

SW.resetSwUpdate()
let registered = null
const navA = fakeNav({ registerImpl: async (url, opts) => { registered = { url, opts }; return fakeReg() } })
const winA = fakeWin()
const pA = SW.startServiceWorker({ force: true, navigator: navA, window: winA })
await pA
t('注册的是 /sw.js', registered && registered.url === '/sw.js')
t('带 updateViaCache:"none"（挡的是「CF 缓存了一份旧 sw.js，浏览器永远看不到新版本」）',
  registered && registered.opts && registered.opts.updateViaCache === 'none')

SW.resetSwUpdate()
const navB = fakeNav({ registerImpl: async () => fakeReg() })
await SW.startServiceWorker({ force: true, navigator: navB, window: fakeWin() })
t('首次安装（没有旧 SW 在管）不点亮横幅', SW.swUpdateReady.value === false)

SW.resetSwUpdate()
const oldWorker = { postMessage() {} }
const navC = fakeNav({ controller: oldWorker, registerImpl: async () => fakeReg({ waiting: { postMessage() {} } }) })
await SW.startServiceWorker({ force: true, navigator: navC, window: fakeWin() })
t('已经有旧 SW 在管、且有 waiting ⇒ 点亮横幅', SW.swUpdateReady.value === true)

SW.resetSwUpdate()
const navD = fakeNav({ controller: oldWorker })
const regD = fakeReg()
const pD = SW.startServiceWorker({ force: true, navigator: navD, window: fakeWin(), })
await pD
const navE = fakeNav({ controller: oldWorker, registerImpl: async () => regD })
await SW.startServiceWorker({ force: true, navigator: navE, window: fakeWin() })
const nextWorker = fakeWorker()
regD.installing = nextWorker
regD.fire('updatefound')
t('updatefound 但还没 installed：先不点亮', SW.swUpdateReady.value === false)
nextWorker.setState('installed')
t('装好了（且有旧 SW 在管）⇒ 点亮', SW.swUpdateReady.value === true)

SW.resetSwUpdate()
t('没有 waiting 时 applySwUpdate 是空操作', SW.applySwUpdate() === false)

SW.resetSwUpdate()
const waitingWorker = fakeWorker('installed')
const navF = fakeNav({ controller: oldWorker, registerImpl: async () => fakeReg({ waiting: waitingWorker }) })
const winF = fakeWin()
await SW.startServiceWorker({ force: true, navigator: navF, window: winF })
t('有 waiting 时 applySwUpdate 返回 true', SW.applySwUpdate() === true)
t('并发出 SKIP_WAITING', eq(waitingWorker.posted, { type: 'SKIP_WAITING' }))
t('还没接管就重载＝白刷（重载要等 controllerchange）', winF.reloads === 0)
navF.fire('controllerchange')
t('controllerchange 到了才整页重载', winF.reloads === 1)

SW.resetSwUpdate()
const navG = fakeNav({ controller: oldWorker, registerImpl: async () => fakeReg({ waiting: fakeWorker('installed') }) })
const winG = fakeWin()
await SW.startServiceWorker({ force: true, navigator: navG, window: winG })
SW.applySwUpdate()
SW.resetSwUpdate()
navG.fire('controllerchange')
t('用户没点过（resetSwUpdate 后）controllerchange 不重载', winG.reloads === 0)

SW.resetSwUpdate()
const navH = fakeNav({ registerImpl: async () => { throw new Error('nope') } })
const gotH = await SW.startServiceWorker({ force: true, navigator: navH, window: fakeWin() })
t('注册被拒/抛错：吞掉、兑现 null（离线能力没了不该连读书一起挂）', gotH === null)

SW.resetSwUpdate()
const navI = fakeNav()
await SW.startServiceWorker({ force: true, navigator: navI, window: fakeWin() })
SW.resetSwUpdate()
t('resetSwUpdate 把横幅状态清回 false', SW.swUpdateReady.value === false)

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)