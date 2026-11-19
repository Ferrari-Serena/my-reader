/**
 * Worker 版本的**唯一机器可读源**（3.1b 修复项 ①）。
 *
 * 谁读它：
 *   - `worker/src/index.js`：`GET /version` / `GET /api/version` 返回 `versionPayload()`。
 *   - `reader/vite.config.js`：构建期 import `WORKER_VERSION`，注入 SW 的 `__SW_WORKER_VERSION__`
 *     与前端 `__WORKER_VERSION__`；CI 握手也拿它与 `/version` 载荷比对。
 *   - `reader/verify-sw.mjs`：SW 安装期握手的负例（缺失 / 格式错 / mismatch）都用它当「正确值」。
 *
 * 规则：
 *   - **没有 'dev' 回退**。本文件缺失、或被改成非 `YYYY.MM.DD.N`，构建/CI 一律红。
 *   - 升版＝改这一行的第 4 段序号（同日多次部署）或日期；改完必须让 `reader` 重新构建，
 *     否则前端注入的期望值与线上 Worker 不一致，SW 安装会 fail-closed（这是设计，不是事故）。
 *   - 本文件在 `reader/vite.config.js` 的 `SOURCE_ALLOW` 里登记为唯一 Worker 版本槽；
 *     任何其它位置的版本形串都会被构建期/成品期扫描判红。
 */
export const WORKER_SERVICE = 'my-reader-tts'

/** 格式：YYYY.MM.DD.N（N 为当日递增序号，至少 1 段数字） */
export const WORKER_VERSION = '2026.11.19.1'

/** 机器可读格式校验（前后端共用同一形状；SW 里有一份字面量副本，由扫描器钉住一致） */
export const WORKER_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d+$/

export function isWorkerVersion(v) {
  return typeof v === 'string' && WORKER_VERSION_RE.test(v)
}

export function assertWorkerVersion(v = WORKER_VERSION) {
  if (!isWorkerVersion(v)) {
    throw new Error(`WORKER_VERSION 格式错：${JSON.stringify(v)}（要求 YYYY.MM.DD.N，禁止 dev 等自由串）`)
  }
  return v
}

/** `/version` 的机器可读载荷（字段名固定，前端握手按键取值） */
export function versionPayload() {
  return { service: WORKER_SERVICE, version: assertWorkerVersion() }
}
