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
 *   - `/books/**`、`/data/**` 等静态 JSON 走 **stale-while-revalidate**：先给上次抓到的那份，
 *     后台把这趟的新版落盘。离线时「上次读过的书还能读」就是这条路。
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

/** 壳资源（带 hash ⇒ 内容不变，cache-first 安全） */
const SHELL_ASSET_RE = /^\/(assets\/|favicon\.svg$|icon-\d+\.png$|manifest\.json$)/
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
  if (SHELL_ASSET_RE.test(url.pathname)) return 'shell-static'
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
    if (name === DICT_CACHE) await trimCache(cache, DICT_MAX)
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

  if (how === 'shell-static') {
    event.respondWith((async () => {
      const hit = await caches.match(event.request)
      if (hit) return hit
      return fetch(event.request)
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