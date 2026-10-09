/**
 * 第 14 步 块 A：Service Worker 的注册，与「有新版本」横幅的状态。
 *
 * 只在**生产构建**里注册：`/sw.js` 是构建产物（见 `vite.config.js` 的 `mr-sw-precache`），
 * dev 下根本不存在，注册只会 404 白记一条控制台错误。
 *
 * 更新是**问过再换**：SW 自己不在 install 里 `skipWaiting`（见 `sw.js`），新版本会停在
 * waiting；页面拿到它就点亮这条横幅，用户点了才 `SKIP_WAITING` ＋ 整页 reload。
 * 不自动重载的理由：读到一半整页刷新会丢滚动位置与播放进度（真机验收要盯这条）。
 */
import { ref } from 'vue'
import { appVersion } from './feedback.js'

/** 横幅文案与按钮：组件与单测读同一份，免得两边各抄一遍抄歪 */
export const SW_UPDATE_MSG = 'A new version is ready.'
export const SW_UPDATE_ACTION = 'Refresh'

/** 有新版本停在 waiting 时为 true（页面据此显示横幅） */
export const swUpdateReady = ref(false)

/** 单测里 `import.meta.env` 不存在 ⇒ 一律 false（不必为此 fake 一整个 env） */
const IS_PROD = typeof import.meta !== 'undefined' && !!(import.meta.env && import.meta.env.PROD)

let _waiting = null
let _reloading = false

/**
 * 点「Refresh」：叫 waiting 的 SW 立刻接管，`controllerchange` 一到就整页重载。
 * 没有 waiting 时是空操作并返回 `false` —— 免得误点后白刷一次页面。
 */
export function applySwUpdate() {
  if (!_waiting) return false
  _reloading = true
  _waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

/** 把模块级状态清回初始（单测用；也顺手给热重载留个把手） */
export function resetSwUpdate() {
  _waiting = null
  _reloading = false
  swUpdateReady.value = false
}

/** 已有旧 SW 在管这个页时，waiting 的那个才叫「更新」；首次安装不弹横幅 */
function noteWaiting(reg, nav) {
  if (!reg || !reg.waiting || !nav.serviceWorker.controller) return
  _waiting = reg.waiting
  swUpdateReady.value = true
}

function watchRegistration(reg, nav) {
  noteWaiting(reg, nav)
  if (!reg || typeof reg.addEventListener !== 'function') return
  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    if (!next || typeof next.addEventListener !== 'function') return
    next.addEventListener('statechange', () => {
      if (next.state === 'installed' && nav.serviceWorker.controller) {
        _waiting = next
        swUpdateReady.value = true
      }
    })
  })
}

/**
 * 注册用的脚本 URL：**带上构建版本当查询串**（`/sw.js?v=<commit>`）。
 *
 * 非带不可（2026-10-09 实测）：`/sw.js` 会被 **CF 边缘**缓存 —— 裸请求就是
 * `cf-cache-status: HIT` ＋ `max-age=14400`，带 `Cache-Control: no-cache` 也照样 HIT；
 * 而 `updateViaCache:'none'` 只管**浏览器**那层 HTTP 缓存，**管不到边缘**。后果两档：
 *   ① 部署后十来分钟内，新访客装到**上一版** sw.js —— 更新横幅要等边缘过期才来；
 *   ② 更糟：上一版壳清单指向**已删的旧 hash chunk**，install 逐条 add 全 404（被吞）——
 *      壳缓存残缺，页面上却看不出来。
 * 换 URL ＝ 换缓存键 ⇒ 新版那次注册在边缘必 MISS、必回源，**部署即生效**。
 *
 * 版本为空（dev / 裸 node / 构建未注入）退回裸 `/sw.js`：空查询串只会白换一个缓存键。
 */
function registerUrl() {
  const v = appVersion()
  return v ? '/sw.js?v=' + encodeURIComponent(v) : '/sw.js'
}

/**
 * 注册 SW。返回注册 Promise（拿不到时兑现 `null`）—— 注册失败（老浏览器 / 私有模式 /
 * 被策略挡）**一律吞**，离线能力没了不该连读书一起挂。
 * `options` 只为单测留口（`navigator` / `window` / `force`）。
 */
export function startServiceWorker(options = {}) {
  const nav = options.navigator !== undefined ? options.navigator : (typeof navigator !== 'undefined' ? navigator : null)
  const win = options.window !== undefined ? options.window : (typeof window !== 'undefined' ? window : null)
  if (!nav || !nav.serviceWorker || !win) return null
  if (!options.force && !IS_PROD) return null

  // 接管完成才重载：注册时立刻 reload 会加载回**旧**壳（新 SW 还没 claim）
  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloading && win.location && win.location.reload) win.location.reload()
  })

  return nav.serviceWorker.register(registerUrl(), { updateViaCache: 'none' })
    .then((reg) => {
      watchRegistration(reg, nav)
      return reg
    })
    .catch(() => null)
}