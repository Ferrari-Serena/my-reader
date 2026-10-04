/**
 * 账号会话单例（module-level reactive，仿 useSync）。
 *
 * 与「同步码」的关系：**两套并存**（第 2 步已裁「不破坏现有同步码用户」）。
 * 账号只管身份（注册 / 登录 / 登出 / 重发验证信 / 申请重置 / 认领同步码）；本地数据仍走本机存储 ＋ 同步码，
 * 把本地数据并到账号底下是第 3 步（租户键 c:<码> → u:<id>）的事 —— **本文件不碰存储层**。
 *
 * 安全口径（与 worker/src/authapi.js 逐条对应）：
 *   - cookie 是 httpOnly + Secure + SameSite=Lax，站点与 /api/* 同源 → fetch 默认就带 cookie；
 *     前端**读不到**它，这正是设计（取令牌只在服务端）
 *   - 登出是敏感写操作，要带 X-CSRF-Token：值来自 /api/auth/me 回的 csrf。
 *     它是**会话派生**的，只活在内存里（刷新页面靠 me() 重新取），**不进 localStorage**
 *   - 登出**一律清本地登录态、绝不动本地数据**（书 / 生词 / 进度照旧）
 *
 * 失败姿态：网络、超时、5xx 一律不抛，回 { ok:false }，账号层挂了不影响读书（与 useSync 同姿态）。
 */

import { reactive, computed } from 'vue'
import { authErrorMessage } from '../utils/authForm.js'

const AUTH_BASE = '/api/auth'
const TIMEOUT = 15000

const state = reactive({
  user: null,   // { id, email, emailVerified } | null
  csrf: '',     // 会话派生令牌（只存内存）
  ready: false, // 首次 me() 是否已回来
  busy: false,
  error: '',
  notice: ''
})

let _started = false

/** 一次请求。恒不抛：网络/超时 -> { status: 0, data: { error: 'network' } } */
async function api(path, { method = 'GET', body, csrf } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(AUTH_BASE + path, {
      method,
      signal: ctrl.signal,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    let data = {}
    try { data = await res.json() } catch { data = {} }
    return { status: res.status, data: data || {} }
  } catch {
    return { status: 0, data: { error: 'network' } }
  } finally {
    clearTimeout(timer)
  }
}

/** 拉当前账号。200 -> 填 user/csrf；401 -> 清空；网络错 -> **保持现状**（别把离线说成已登出） */
export async function loadMe() {
  const r = await api('/me')
  if (r.status === 200 && r.data.user) {
    state.user = r.data.user
    state.csrf = r.data.csrf || ''
  } else if (r.status === 401) {
    state.user = null
    state.csrf = ''
  }
  state.ready = true
  return state.user
}

async function post(path, body, extra = {}) {
  state.busy = true
  state.error = ''
  state.notice = ''
  try {
    const r = await api(path, { method: 'POST', body, ...extra })
    if (r.status >= 400 || r.status === 0) {
      state.error = authErrorMessage(r.status, r.data)
      return { ok: false, status: r.status, data: r.data }
    }
    return { ok: true, status: r.status, data: r.data }
  } finally {
    state.busy = false
  }
}

export async function signIn(email, password) {
  const r = await post('/login', { email, password })
  if (r.ok && r.data.user) {
    state.user = r.data.user
    state.csrf = r.data.csrf || ''
    state.ready = true
  }
  return r
}

/** 注册（后端只建号 + 发信，**不下发会话**）；成功回 { ok, data:{ mailSent } } */
export async function signUp(email, password) {
  return await post('/register', { email, password })
}

export async function sendReset(email) {
  const r = await post('/reset-request', { email })
  // 一律 200 且不区分「这个邮箱有没有账号」（防枚举）—— 所以文案也只能这么写
  if (r.ok) state.notice = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.'
  return r
}

export async function resendVerify() {
  const email = state.user && state.user.email
  if (!email) return { ok: false, status: 0, data: {} }
  const r = await post('/verify-request', { email })
  if (r.ok) state.notice = 'Sent. Check your inbox (and spam folder).'
  return r
}

/**
 * 登出。服务端答什么都不重要：**本地一律当已登出**（登出不该失败），
 * 而本地数据（书 / 生词 / 进度）本来就一动不动。
 */
export async function signOut() {
  state.busy = true
  state.error = ''
  state.notice = ''
  try {
    if (!state.csrf) await loadMe()
    let r = await api('/logout', { method: 'POST', csrf: state.csrf })
    if (r.status === 403 && r.data && r.data.error === 'bad-csrf') {
      // 令牌过期/丢失：重取一次再试；还不行也照样本地登出
      await loadMe()
      r = await api('/logout', { method: 'POST', csrf: state.csrf })
    }
  } finally {
    state.user = null
    state.csrf = ''
    state.ready = true
    state.busy = false
  }
}

/**
 * 认领本机同步码（D 块 · 登录 ↔ 数据）。服务端答 { ok, code, claimed }：
 * code = 这个账号的**主码**（不管本次是真认领，还是账号早就有了）。
 * 认领是「带会话的敏感写操作」—— 与登出同一道 CSRF 闸，所以必须带 X-CSRF-Token。
 */
export async function claim(code) {
  if (!state.csrf) await loadMe()
  const r = await post('/claim', { code: code || '' }, { csrf: state.csrf })
  if (r.ok && r.data && r.data.code && state.user) {
    state.user = { ...state.user, syncCode: r.data.code }
  }
  return r
}

export function note(msg) { state.notice = msg }
export function clearMessages() { state.error = ''; state.notice = '' }

export function useAuth() {
  if (!_started) { _started = true; loadMe() }
  return {
    user: computed(() => state.user),
    csrf: computed(() => state.csrf),
    ready: computed(() => state.ready),
    busy: computed(() => state.busy),
    error: computed(() => state.error),
    notice: computed(() => state.notice),
    signIn, signUp, signOut, sendReset, resendVerify, claim, loadMe, note, clearMessages
  }
}
