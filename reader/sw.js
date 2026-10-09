/**
 * my-reader 的 Service Worker（第 14 步 块 A —— 离线可用，U11）。
 *
 * 这份文件是**构建期产物**：`vite.config.js` 的 `mr-sw-precache` 插件把
 *   「版本号」→ CI 的 commit 短号（＝壳缓存的版本号）
 *   「清单」  → 产物清单（`index.html` ＋ 所有 hash chunk ＋ 图标/清单/phrases.json）
 * 两处置换掉再写进 `dist/sw.js`。**代码里那两个占位符必须原样留着、且各只出现一次**：
 * 少了插件当场报错；多写一处（例如写进本段注释）就会把真值注入到注释里、代码留空 ——
 * SW 一装就崩，而且崩得很难查。这条由 vite 插件与 verify-sw.mjs 两头钉住。
 *
 * 路线（决策见 Phase1 §14）：
 *   - App shell 预缓存；**不含** `/models/**`（本机 449 MB、CI 根本没有）、`/vendor/**`、
 *     `/books/**`、音频 —— 那些要么太大、要么按需才该下。
 *   - 壳清单里的（`index.html`、`/assets/*`、图标、`phrases.json`）走**纯 cache-first**：
 *     本次部署内它们不会变（BUILD 版本化），所以不打网络、也不在 runtime 里存第二份。
 *   - `/books/**` 等静态 JSON 走 **stale-while-revalidate**：先给上次抓到的那份，后台把这趟的
 *     新版落盘。书 JSON 的 URL 不随部署变、内容会变（第 12 步扩充公版书就是这情形）——
 *     所以不能 cache-first，否则一本书会**永远**停在第一次抓到的版本。
 *     两条缓存都有体量闸（runtime 400 条 ／ 词典 3000 条，按插入序丢最老）。
 *   - **音频不缓存**（一本 50 MB）：离线**不支持听书**，这是块 B 明写的边界，不是漏做。
 *   - `/api/dict/<word>`：成功即入缓存（有上限），失败回缓存 ⇒ 离线查过的词能查。
 *   - **其余 `/api/*` 一律不拦**（auth / sync / gen / feedback 直连网络，失败就失败 ——
 *     现有 UI 已经按「离线不该炸」写过）。缓存一份 `/api/auth/me` 或同步响应只会更糟。
 *   - 非 GET 与带 `Range` 的请求一律放行：音频拖动是 206 分片，存下来下次当整段发就是坏文件。
 *   - 更新是**问过再换**：install 里**不**调 `skipWaiting()`；页面拿到 waiting 的 SW 后
 *     弹一条「有新版本」横幅，用户点了才 `SKIP_WAITING` ＋ reload（读书中途自动重载会丢进度）。
 */

const BUILD = '__SW_BUILD__'
const PRECACHE = __SW_PRECACHE__

const SHELL_PREFIX = 'mr-shell-'
const SHELL_CACHE = SHELL_PREFIX + BUILD
const RUNTIME_CACHE = 'mr-runtime-v1'
const DICT_CACHE = 'mr-dict-v1'
const DICT_MAX = 3000
const RUNTIME_MAX = 400

/** 壳清单的成员判定（每次 fetch 都要问一遍，数组 includes 是线性扫） */
const PRECACHE_SET = new Set(PRECACHE)

/** 产物目录（`/assets/**`）：带 hash ⇒ 内容不变，cache-first 安全。只是兜底 ——
 *  真正说了算的是「壳清单里有没有它」 */
const SHELL_ASSET_RE = /^\/assets\//
const DICT_RE = /^\/api\/dict\//
const API_RE = /^\/api\//
const AUDIO_RE = /\/audio\//

/**
 * 这个请求走哪条路。纯判定、无副作用 —— verify-sw.mjs 直接喂 URL/Request 进来测它，
 * 不用起浏览器。
 */
function decide(url, request) {
  if (!request || request.method !== 'GET') return 'bypass'
  if (!self.location || url.origin !== self.location.origin) return 'bypass'
  if (request.headers && request.headers.get('range')) return 'bypass'
  if (DICT_RE.test(url.pathname)) return 'dict'
  if (API_RE.test(url.pathname)) return 'bypass'
  if (AUDIO_RE.test(url.pathname)) return 'bypass'
  if (request.mode === 'navigate') return 'shell'
  // 壳清单里有的：**纯 cache-first** —— 不打网络、也不写 runtime。
  //   壳缓存每次部署整份换新（BUILD 版本化），它在本次部署内不会变；再抓一遍既白花流量，
  //   又会把 `phrases.json`（367 KB）这类大件在 runtime 里存成第二份。
  if (PRECACHE_SET.has(url.pathname)) return 'shell-static'
  // 壳里没有的 `/assets/**`（例如按需才下的懒加载件）：cache-first，miss 时走网络并落 runtime。
  if (SHELL_ASSET_RE.test(url.pathname)) return 'asset'
  return 'swr'
}

/** 只缓存「完整的、自家的」200：opaque（跨域 no-cors）与 206 分片都不能当整份用 */
function cacheable(res) {
  return !!res && res.status === 200 && res.type !== 'opaque'
}

async function openCache(name) {
  try { return await caches.open(name) } catch { return null }
}

/**
 * 预缓存。**逐条**加：单条 404 不能拖垮整次安装（`addAll` 是一荣俱荣一损俱损）。
 * `cache: 'reload'` 绕开 HTTP 缓存 —— 部署后 `index.html` 的 `max-age=600`
 * 会让 SW 装到上一版的壳，那就等于没更新。
 */
async function precacheAll() {
  const cache = await openCache(SHELL_CACHE)
  if (!cache) return
  await Promise.all(PRECACHE.map((path) =>
    cache.add(new Request(path, { cache: 'reload' })).catch(() => {})
  ))
}

/** 词典缓存按插入序丢最老的（`keys()` 就是插入序，不需要另存时间戳） */
async function trimCache(cache, max) {
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

async function putCache(name, request, response) {
  const cache = await openCache(name)
  if (!cache) return
  try {
    await cache.put(request, response)
    const max = name === DICT_CACHE ? DICT_MAX : (name === RUNTIME_CACHE ? RUNTIME_MAX : 0)
    if (max) await trimCache(cache, max)
  } catch { /* 配额满 / 私有模式：缓存写失败不该影响这次请求 */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAll())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)))
    if (self.clients && self.clients.claim) await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  let url
  try { url = new URL(event.request.url) } catch { return }
  const how = decide(url, event.request)

  if (how === 'bypass') return

  // 壳清单里的：命中即回；**没命中也不写缓存**（壳缓存属于它自己的那个 BUILD）
  if (how === 'shell-static') {
    event.respondWith((async () => {
      const hit = await caches.match(event.request)
      if (hit) return hit
      return fetch(event.request)
    })())
    return
  }

  // 壳里没有的产物（按需才下的懒加载件）：首次抓到就落 runtime，下次离线也有
  if (how === 'asset') {
    event.respondWith((async () => {
      const hit = await caches.match(event.request)
      if (hit) return hit
      const res = await fetch(event.request)
      if (cacheable(res)) event.waitUntil(putCache(RUNTIME_CACHE, event.request, res.clone()))
      return res
    })())
    return
  }

  // 导航走**网络优先**：部署完第一次打开就该拿到新壳；离线才退回预缓存的那份。
  // 故意不把这趟的 index.html 写回壳缓存 —— 壳缓存属于它自己的那个 BUILD。
  if (how === 'shell') {
    event.respondWith((async () => {
      try {
        return await fetch(event.request)
      } catch (err) {
        const hit = await caches.match('/index.html')
        if (hit) return hit
        throw err
      }
    })())
    return
  }

  if (how === 'dict') {
    event.respondWith((async () => {
      try {
        const res = await fetch(event.request)
        if (cacheable(res)) event.waitUntil(putCache(DICT_CACHE, event.request, res.clone()))
        return res
      } catch (err) {
        const hit = await caches.match(event.request)
        if (hit) return hit
        throw err
      }
    })())
    return
  }

  // swr
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    const network = (async () => {
      try {
        const res = await fetch(event.request)
        if (cacheable(res)) await putCache(RUNTIME_CACHE, event.request, res.clone())
        return res
      } catch {
        return null
      }
    })()
    if (cached) {
      event.waitUntil(network)
      return cached
    }
    const res = await network
    if (res) return res
    return new Response('', { status: 504, statusText: 'Offline' })
  })())
})