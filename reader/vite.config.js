import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { WORKER_VERSION, WORKER_SERVICE, isWorkerVersion } from '../worker/src/version.js'

// ─────────────────────────────────────────────────────────────────────────────
// 3.1b 修复项 ① / ②：版本只有一个来源，且**没有 dev 回退**
//
//   BUILD_ID（前端构建身份）  ← CI 的 GITHUB_SHA（前 12 位），本机必须显式 MR_BUILD_ID。
//   WORKER_VERSION（后端版本）← worker/src/version.js，构建期 import，同一常量也由 /version 返回。
//
// 缺失 / 格式错 / 前后端不一致 ⇒ 构建当场红。曾经的 `|| 'dev'` 已删除：
// 一个 `dev` 兜底会让「版本对不上」在生产里长得像正常状态，3.1b 第二间验判 FAIL 的正是这个口子。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 构建身份格式：**恰好 12 位十六进制**（GITHUB_SHA 前 12 位；本机 `git rev-parse --short=12 HEAD`）。
 * 为什么收窄到 12：扫描器要能在成品里认出「版本形串」，而 7–11 位的短十六进制会撞上
 * 输入校验常量（"12345678"、"abc12345"）和依赖内部的短 hash（"d0991a0d5"）——那会把构建误杀。
 * 12 位仍是 git SHA 的合法短形式，且与注入值一一对应。
 */
export const BUILD_ID_RE = /^[0-9a-f]{12}$/

/** 机器可读的版本形串形状。只认：12 位构建身份 / 40 位完整 SHA、Worker 的 YYYY.MM.DD.N。 */
export const VERSION_SHAPES = {
  sha: /^(?:[0-9a-f]{12}|[0-9a-f]{40})$/,
  stamp: /^\d{4}\.\d{2}\.\d{2}\.\d+$/,
}

/**
 * 构建身份解析。**没有任何回退值**：
 *   - CI：GITHUB_SHA 必存在，取前 12 位；
 *   - 本机：必须 `MR_BUILD_ID=$(git rev-parse --short=12 HEAD) npm run build`；
 *   - 空 / `dev` / 非十六进制 ⇒ throw。
 */
export function resolveBuildId(env = process.env) {
  const raw = String(env.MR_BUILD_ID || env.GITHUB_SHA || '').trim()
  if (!raw) {
    throw new Error(
      "BUILD_ID 缺失：CI 需 GITHUB_SHA，本机构建需显式 MR_BUILD_ID（3.1b 已禁止 'dev' 回退）"
    )
  }
  const id = raw.slice(0, 12).toLowerCase()
  if (!BUILD_ID_RE.test(id)) {
    throw new Error(`BUILD_ID 格式错：${JSON.stringify(raw)}（要求 12 位十六进制，不允许 dev/test 之类自由串）`)
  }
  return id
}

/**
 * dev server 的身份：本机 git HEAD 的 12 位短 SHA（真值，不是 'dev'）。
 * 生产构建**不走这里** —— `vite build` 必须由 CI/env 显式给（见 resolveBuildId）。
 * 这样本地 `npm run dev` 不用配环境变量，也不会把 'dev' 这种自由串带进缓存键。
 */
export function resolveDevBuildId(env = process.env) {
  if (env.MR_BUILD_ID || env.GITHUB_SHA) return resolveBuildId(env)
  let head = ''
  try { head = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim() } catch {
    throw new Error('dev 身份无法确定：不在 git 仓库且未提供 MR_BUILD_ID（不提供 dev 兜底）')
  }
  return resolveBuildId({ MR_BUILD_ID: head })
}

/**
 * SOURCE_ALLOW / 版本登记表（机器可读）。
 * 每一条都必须写全：身份、注册槽、消费者、登记人、原因。
 * 构建期与成品期扫描会把所有版本形串拿来对这张表；**没登记的 ⇒ fail-closed**。
 */
export const SOURCE_ALLOW = [
  {
    id: 'reader-build-id',
    kind: 'build-id',
    slot: 'reader/vite.config.js::BUILD_ID → sw.js const BUILD / __APP_VERSION__',
    valueKind: 'env',
    value: null,
    valueFrom: 'MR_BUILD_ID | GITHUB_SHA[:12]',
    consumer: 'sw.js 壳缓存名（mr-shell-<BUILD>）、utils/feedback.js appVersion、utils/swUpdate.js ?v=',
    registrant: 'CI（GITHUB_SHA）；本机由执行人显式提供 MR_BUILD_ID',
    reason: '构建身份只允许这一个来源；无 dev 回退，缺失/格式错即 fail-closed',
  },
  {
    id: 'worker-version',
    kind: 'worker-version',
    slot: 'worker/src/version.js::WORKER_VERSION → GET /version / sw.js const WORKER_VERSION',
    valueKind: 'literal',
    value: WORKER_VERSION,
    valueFrom: 'worker/src/version.js',
    consumer: 'Worker GET /version、GET /api/version；SW 安装期握手；CI 版本握手',
    registrant: 'worker maintainer（手工 bump，格式 YYYY.MM.DD.N）',
    reason: '前后端一致性握手的唯一 Worker 版本号；其它位置的版本形串一律视为泄漏',
  },
]

/** 把动态的 BUILD_ID 填进登记表，得到本次构建的「允许值」清单 */
export function buildSourceAllow(buildId) {
  return SOURCE_ALLOW.map((e) => (e.kind === 'build-id' ? { ...e, value: buildId } : { ...e }))
}

/** 本次构建允许出现的版本形串（扫描器用） */
export function allowedValues(buildId, workerVersion = WORKER_VERSION) {
  return [buildId, workerVersion].filter(Boolean)
}

const QUOTED_LITERAL = /(['"`])([0-9A-Za-z][0-9A-Za-z._-]{6,63})\1/g

/** 找出文本里所有「版本形」的字符串字面量（引号内的 git 短 SHA / YYYY.MM.DD.N） */
export function findVersionShapedStrings(text) {
  const out = []
  const src = String(text == null ? '' : text)
  let m
  QUOTED_LITERAL.lastIndex = 0
  while ((m = QUOTED_LITERAL.exec(src)) !== null) {
    const value = m[2]
    if (VERSION_SHAPES.sha.test(value) || VERSION_SHAPES.stamp.test(value)) out.push(value)
  }
  return out
}

/**
 * 扫描一组文件：任何版本形串只要不在 allowed 里就返回违规项（空数组＝全登记）。
 * files: [{ path, text }]
 */
export function scanVersionStrings(files, allowed) {
  const allow = new Set(allowed || [])
  const bad = []
  for (const f of files || []) {
    for (const value of findVersionShapedStrings(f.text)) {
      if (!allow.has(value)) bad.push({ path: f.path || '', value })
    }
  }
  return bad
}

/** 与 scanVersionStrings 同义，但违规即 throw（构建/CI 用） */
export function assertNoUnregisteredVersions(files, allowed, where = '版本扫描') {
  const bad = scanVersionStrings(files, allowed)
  if (bad.length) {
    const list = bad.map((b) => `${b.path ? b.path + ': ' : ''}${JSON.stringify(b.value)}`).join('；')
    throw new Error(`${where}发现未登记版本形串（fail-closed）：${list}`)
  }
  return true
}

/**
 * 前端期望值 vs Worker `/version` 载荷的一致校验。
 * 返回 { ok, reason }，reason ∈ missing | format | mismatch；调用方一律按失败处理。
 */
export function judgeWorkerPayload(payload, expected = WORKER_VERSION) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'missing' }
  if (typeof payload.version !== 'string' || payload.version === '') return { ok: false, reason: 'missing' }
  if (!isWorkerVersion(payload.version)) return { ok: false, reason: 'format' }
  if (payload.version !== expected) return { ok: false, reason: 'mismatch' }
  return { ok: true, reason: '' }
}

/** 构建/CI 握手：BUILD_ID 格式、Worker 版本格式、`/version` 载荷一致性，任一不满足即 throw */
export function assertVersionConsistency({ buildId, workerVersion = WORKER_VERSION, workerPayload }) {
  if (!BUILD_ID_RE.test(String(buildId || ''))) {
    throw new Error(`版本握手失败：BUILD_ID 格式错 ${JSON.stringify(buildId)}`)
  }
  if (!isWorkerVersion(workerVersion)) {
    throw new Error(`版本握手失败：期望的 WORKER_VERSION 格式错 ${JSON.stringify(workerVersion)}`)
  }
  const verdict = judgeWorkerPayload(workerPayload, workerVersion)
  if (!verdict.ok) {
    const shown = workerPayload && workerPayload.version !== undefined ? JSON.stringify(workerPayload.version) : '（无 version 字段）'
    throw new Error(`版本握手失败：${verdict.reason}（前端期望 ${workerVersion}，Worker /version 回 ${shown}）`)
  }
  return true
}

// 第 14 步 块 A：Service Worker 的壳预缓存清单在**构建期**注入（源码里的三个占位符见 sw.js 头部）。
// 清单只放「壳」：产物 chunk ＋ 图标/清单 ＋ phrases.json ＋ **书架入口索引**；单本书的 JSON 与音频走运行时按需缓存。
const SW_TEMPLATE = new URL('./sw.js', import.meta.url)
const PUBLIC_SHELL = [
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/data/phrases.json',
  // 第 14 步 块 C：书架的**入口索引**（784 B）也进壳 —— 不进去的话「断网打开 App → 进书架」
  // 会把公开书库留空（它平时落在 SWR 那条路上，只在**在线访问过书架之后**才有缓存）。
  '/books/book-index.json'
]

/**
 * 3.1b 第三项补钉：三个占位符必须落在**可执行赋值语句**上（如 `const BUILD = ...`）。
 *
 * 只数「出现次数」＋成品里 `includes(buildId)` 不够：把唯一占位符移进注释时，
 * 次数仍是 1、成品里也仍能找到注入值 —— 但真正执行的 `const BUILD = ''` 是空的，
 * SW 一 install 就坏。这里先按「代码 / 字符串 / 注释」逐字符分型，再校验锚点；
 * 注释或其它字符串里的占位符一律不算。
 */
const SW_ANCHORS = [
  { token: '__SW_BUILD__', target: 'BUILD', quoted: true },
  { token: '__SW_WORKER_VERSION__', target: 'WORKER_VERSION', quoted: true },
  { token: '__SW_PRECACHE__', target: 'PRECACHE', quoted: false },
]

/**
 * 把源码切成「代码 / 字符串 / 注释」三类（下标与源码一一对应）。
 * strings 只记完整的字符串字面量：start/end 是引号下标，content* 是内容下标。
 * 正则字面量按代码处理；本模板里的正则形如 /^\/assets\//，不含 `//` 或 `/*` 的误导。
 */
function classifySwSource(src) {
  const n = src.length
  const kind = new Array(n).fill('code')
  const strings = []
  let i = 0
  while (i < n) {
    const c = src[i]
    const next = i + 1 < n ? src[i + 1] : ''
    if (c === '/' && next === '/') {
      const start = i
      i += 2
      while (i < n && src[i] !== '\n') i++
      for (let k = start; k < i; k++) kind[k] = 'comment'
      continue
    }
    if (c === '/' && next === '*') {
      const start = i
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(n, i + 2)
      for (let k = start; k < i; k++) kind[k] = 'comment'
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = i
      i += 1
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === quote) { i += 1; break }
        i += 1
      }
      const end = Math.min(n - 1, i - 1)
      for (let k = start; k <= end; k++) kind[k] = (k === start || k === end) ? 'code' : 'string'
      strings.push({ start, end, contentStart: start + 1, contentEnd: end - 1 })
      continue
    }
    i += 1
  }
  return { kind, strings }
}

/**
 * 校验三个占位符各恰好 1 次，且落在可执行赋值语句上：
 *   const BUILD = '__SW_BUILD__'
 *   const WORKER_VERSION = '__SW_WORKER_VERSION__'
 *   const PRECACHE = __SW_PRECACHE__
 * 注释 / 其它字符串里的占位符不算；不满足即 throw。
 */
export function assertSwTemplateAnchors(source) {
  const src = String(source == null ? '' : source)
  const { kind, strings } = classifySwSource(src)
  // 注释与字符串内容抹成空格（引号保留）：只留可执行代码骨架，且下标不变。
  let codeOnly = ''
  for (let i = 0; i < src.length; i++) codeOnly += kind[i] === 'code' ? src[i] : ' '

  for (const { token, target, quoted } of SW_ANCHORS) {
    let occ = 0
    let at = -1
    for (let from = 0; ;) {
      const idx = src.indexOf(token, from)
      if (idx < 0) break
      occ += 1
      at = idx
      from = idx + token.length
    }
    if (occ !== 1) {
      throw new Error(
        `sw.js 模板的 ${token} 必须恰好出现 1 次（实得 ${occ}），且必须位于可执行赋值 const ${target} = ...（注释/字符串里的不算）`
      )
    }
    if (kind[at] === 'comment') {
      throw new Error(
        `sw.js 模板的 ${token} 只出现在注释里：注释/字符串里的占位符不算，必须位于可执行赋值 const ${target} = ...`
      )
    }
    if (quoted) {
      const span = strings.find((s) => s.contentStart === at && s.contentEnd === at + token.length - 1)
      if (!span) {
        throw new Error(`sw.js 模板的 ${token} 不在字符串字面量里（必须写成 const ${target} = '${token}'）`)
      }
      const before = codeOnly.slice(0, span.start)
      if (!new RegExp(`(?:^|[^A-Za-z0-9_$])const\\s+${target}\\s*=\\s*$`).test(before)) {
        throw new Error(`sw.js 模板的 ${token} 不在可执行赋值语句上（要求 const ${target} = '...'；注释/字符串里的不算）`)
      }
    } else {
      if (kind[at] !== 'code') {
        throw new Error(`sw.js 模板的 ${token} 被包进了字符串（必须裸写成 const ${target} = ${token}）`)
      }
      const before = codeOnly.slice(0, at)
      if (!new RegExp(`(?:^|[^A-Za-z0-9_$])const\\s+${target}\\s*=\\s*$`).test(before)) {
        throw new Error(`sw.js 模板的 ${token} 不在可执行赋值语句上（要求 const ${target} = ${token}；注释/字符串里的不算）`)
      }
    }
  }
  return true
}

/**
 * 构建期版本守卫的扫描面：模板（注入前）＋ Worker 版本源。两者都只允许出现登记过的版本形串。
 * 注意：sw.js 里的 `'__SW_BUILD__'` 等占位符不是版本形串，不会被误判。
 */
function scanBuildSources(buildId, workerVersion, templateText) {
  const files = [{ path: 'reader/sw.js', text: templateText }]
  try {
    files.push({ path: 'worker/src/version.js', text: readFileSync(new URL('../worker/src/version.js', import.meta.url), 'utf8') })
  } catch { /* 版本源缺失会在 import 阶段就炸，这里不掩盖 */ }
  return scanVersionStrings(files, allowedValues(buildId, workerVersion))
}

/**
 * vite 插件：注入 SW 的三个占位符，并做「构建期 + 成品期」两轮版本扫描。
 * 选项只给测试用（fixtures 在 D:/Temp/31b-fix）：template 可换成字符串模板。
 */
export function mrSwPrecache(opts = {}) {
  return {
    name: 'mr-sw-precache',
    apply: 'build',
    enforce: 'post',
    buildStart() {
      const buildId = opts.buildId || resolveBuildId()
      const workerVersion = opts.workerVersion || WORKER_VERSION
      const templateText = opts.template != null ? String(opts.template) : readFileSync(SW_TEMPLATE, 'utf8')
      try {
        assertSwTemplateAnchors(templateText)
      } catch (e) {
        this.error(e.message)
      }
      const bad = scanBuildSources(buildId, workerVersion, templateText)
      if (bad.length) {
        this.error(`构建期版本扫描失败（未登记版本形串）：${bad.map((b) => `${b.path}: ${JSON.stringify(b.value)}`).join('；')}`)
      }
    },
    generateBundle(_options, bundle) {
      const buildId = opts.buildId || resolveBuildId()
      const workerVersion = opts.workerVersion || WORKER_VERSION
      if (!BUILD_ID_RE.test(buildId)) this.error(`BUILD_ID 格式错：${JSON.stringify(buildId)}（禁止 dev 等自由串）`)
      if (!isWorkerVersion(workerVersion)) this.error(`WORKER_VERSION 格式错：${JSON.stringify(workerVersion)}`)

      const files = new Set(PUBLIC_SHELL)
      for (const [name, out] of Object.entries(bundle)) {
        if (/\.(js|css|html)$/.test(name)) files.add('/' + name)
        else if (out.type === 'asset' && /\.(svg|png|json)$/.test(name)) files.add('/' + name)
      }
      const source = opts.template != null ? String(opts.template) : readFileSync(SW_TEMPLATE, 'utf8')
      try {
        assertSwTemplateAnchors(source)
      } catch (e) {
        this.error(e.message)
      }
      const rendered = source
        .replace('__SW_BUILD__', buildId)
        .replace('__SW_WORKER_VERSION__', workerVersion)
        .replace('__SW_PRECACHE__', JSON.stringify([...files].sort(), null, 2))
      if (rendered.includes('__SW_')) this.error('sw.js 注入后仍残留 __SW_ 占位符（漏注）')

      // 成品期扫描：sw.js 成品 + 本次产出的所有 chunk/asset
      const artifacts = [{ path: 'sw.js', text: rendered }]
      for (const [name, out] of Object.entries(bundle)) {
        if (name === 'sw.js') continue
        const text = out && (typeof out.source === 'string' ? out.source : out.code)
        if (typeof text === 'string') artifacts.push({ path: name, text })
      }
      const bad = scanVersionStrings(artifacts, allowedValues(buildId, workerVersion))
      if (bad.length) {
        this.error(`成品期版本扫描失败（未登记版本形串）：${bad.map((b) => `${b.path}: ${JSON.stringify(b.value)}`).join('；')}`)
      }
      // 正例自证：注入的值确实出现在产物里（扫不到 ≠ 通过，可能注入错位了）
      if (!rendered.includes(buildId)) this.error('成品 sw.js 找不到 BUILD_ID（注入错位）')
      if (!rendered.includes(workerVersion)) this.error('成品 sw.js 找不到 WORKER_VERSION（注入错位）')

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: rendered })
    }
  }
}

export default defineConfig(({ command } = {}) => {
  const BUILD_ID = command === 'serve' ? resolveDevBuildId() : resolveBuildId()
  return {
    plugins: [vue(), mrSwPrecache()],
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_ID),
      // 前端也留一份期望的 Worker 版本，供 SW 安装期握手与 CI 核对
      __WORKER_VERSION__: JSON.stringify(WORKER_VERSION),
    },
    // 自定义域名（my-reader.ferrari11.com）直接部署在根目录；import.meta.env.BASE_URL 自动为 '/'
    // 旧 GitHub Pages 子路径: 如需恢复 ferari-serena.github.io/my-reader/，改回 '/my-reader/'
    base: '/',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    // 本地 dev：/api/* 代理到线上 Worker。应用里用的是同源相对路径，没有这段 dev 下点词/朗读全挂。
    server: {
      proxy: {
        '/api': { target: 'https://my-reader.ferrari11.com', changeOrigin: true }
      }
    }
  }
})
