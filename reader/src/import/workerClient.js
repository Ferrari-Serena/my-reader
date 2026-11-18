/**
 * importWorker 的浏览器侧客户端（RK-15 根治）。
 *
 * 职责只有四件：
 *   ① 起一个模块 Worker（Vite 静态分析需要 `new Worker(new URL(...))` 保持字面量）；
 *   ② 把 { format, bytes, title } 递过去，等 { ok, parsed | error } 回来；
 *   ③ 把 worker 的 { code, message } 还原成 ImportError（文案仍只出自 errors.js）；
 *   ④ 接 AbortSignal：中止 -> terminate() 并抛 CANCELLED（与导入层其余取消口同码）。
 *
 * 失败分两类，importBook 靠 `workerInfraFailure` 区分：
 *   · 基础设施失败（构造炸 / onerror / messageerror / 消息形状坏）—— 可以回退主线程一次；
 *   · 解析失败（worker 回 ok:false）—— 文件本身的问题，回退也只会再错一次，原样上抛。
 */
import { ImportError, IMPORT_ERRORS } from './errors.js'

/** Worker 本身没跑起来（不是书的问题）。不进错误文案表，用户看不到它。 */
export class WorkerInfraError extends Error {
  constructor(detail) {
    super(String(detail || 'import worker unavailable'))
    this.name = 'WorkerInfraError'
    this.workerInfraFailure = true
  }
}

/** 当前环境有没有 Worker 全局（Node 单测里没有；注入 workerFactory 时不受此限）。 */
export function hasWorkerSupport() {
  return typeof Worker !== 'undefined'
}

/**
 * 默认构造器。**必须保持字面量**：Vite 靠 `new Worker(new URL('./importWorker.js', import.meta.url))`
 * 这条静态形状把 worker 拆成独立 chunk —— 改成变量或拼接字符串就检测不到了。
 */
export function defaultWorkerFactory() {
  return new Worker(new URL('./importWorker.js', import.meta.url), { type: 'module' })
}

/**
 * 交给 worker 的**副本**（不是调用方那块内存）。
 * 理由：worker 基础设施失败时要回退主线程，原字节必须还在；直接 transfer `bytes.buffer`
 * 会把它 detach 掉，回退路径就没材料了。bookId 也在交接前用原字节算好。
 */
function copyForTransfer(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return u8.slice().buffer
}

/** worker 的 { code, message } -> ImportError（hint 从同一张码表取）。未知码退回 UNSUPPORTED_FORMAT。 */
function importErrorFromWorker(error) {
  const code = error && error.code && IMPORT_ERRORS[error.code] ? String(error.code) : 'UNSUPPORTED_FORMAT'
  const detail = error && (error.detail || error.message)
  return new ImportError(code, detail)
}

/**
 * 在 worker 里解析一本 TXT / EPUB。
 * @param {object} opts
 * @param {'txt'|'epub'} opts.format
 * @param {Uint8Array|ArrayBuffer} opts.bytes
 * @param {string} [opts.title]
 * @param {AbortSignal} [opts.signal]
 * @param {() => Worker} [opts.workerFactory] 测试注入用
 * @returns {Promise<object>} parseTxt / parseEpub 的原始产物（makeBook 之前）
 */
export function runParseInWorker({ format, bytes, title = '', signal, workerFactory } = {}) {
  const factory = typeof workerFactory === 'function' ? workerFactory : defaultWorkerFactory

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new ImportError('CANCELLED')); return }

    let worker = null
    let settled = false

    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
    }
    // 每条出口都走这里：只结算一次、摘掉 abort 监听、把 worker 收掉（一次性 worker，不留 50 MB 缓冲区）
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      try {
        if (worker && typeof worker.terminate === 'function') worker.terminate()
      } catch { /* terminate 失败不影响结果 */ }
      fn(value)
    }
    const failInfra = (detail) => finish(reject, new WorkerInfraError(detail))
    function onAbort() {
      finish(reject, new ImportError('CANCELLED'))
    }

    try {
      worker = factory()
    } catch (err) {
      failInfra(err && err.message)
      return
    }
    if (!worker || typeof worker.postMessage !== 'function') {
      failInfra('workerFactory returned no postMessage')
      return
    }

    worker.onmessage = (event) => {
      const data = event && event.data
      if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
        failInfra('malformed worker response')
        return
      }
      if (data.ok) finish(resolve, data.parsed)
      else finish(reject, importErrorFromWorker(data.error))
    }
    worker.onerror = (event) => {
      failInfra((event && (event.message || event.type)) || 'worker error')
    }
    worker.onmessageerror = () => failInfra('worker message could not be deserialized')

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    // 监听挂上后复查一次，堵住「check 与 addEventListener 之间 abort」的窄缝
    if (signal && signal.aborted) { onAbort(); return }

    let payload
    try {
      payload = copyForTransfer(bytes)
    } catch (err) {
      failInfra(err && err.message)
      return
    }
    try {
      worker.postMessage({ format, bytes: payload, title }, [payload])
    } catch (err) {
      // 例如环境不支持模块 worker / CSP 拦了 worker-src：按基础设施失败处理，交给调用方回退
      failInfra(err && err.message)
    }
  })
}
