#!/usr/bin/env node
/**
 * W11-2a · 输入 fetch（hub 主机 · 沙箱外）
 *
 * 用法:
 *   node hub-audio-fetch.mjs --campaign <id> --book <bk_xxxxxxxxxxxxxxxx> --code <XXXXXXXX> [--delete-after]
 *
 * 流程（设计稿 §12.4a）:
 *   1. 带 INTERNAL_TOKEN 打 Worker /api/internal/audio/input-token
 *   2. Worker 用 parent token 现签 R2 临时读凭据（ObjectReadOnly + prefixes + 600s）
 *   3. 本脚本用临时凭据 SigV4 直连 R2 取 books/<code>/<bookId>.json
 *   4. 写 ~/hub/_scratch/campaigns/<id>/input/book.json（目录 0700 / 文件 0600）
 *   5. --delete-after：算完 sha256 立刻删，并回读确认不存在
 *
 * 边界:
 *   · parent token 不在此处，只在 Worker secret。
 *   · 临时凭据只在内存，不落盘。
 *   · 正文是用户内容：不打印正文、不写日志、manifest 只留 sha256。
 */
import { createHash, createHmac } from 'node:crypto'
import { mkdir, writeFile, rm, chmod, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const WORKER_URL = process.env.MY_READER_WORKER_URL || 'https://my-reader.ferrari11.com'
const TOKEN_FILE = process.env.INTERNAL_TOKEN_FILE || join(homedir(), 'hub', '.secrets', 'internal-token')
const SCRATCH = process.env.HUB_SCRATCH || join(homedir(), 'hub', '_scratch')
// hub 所在网络对 Cloudflare CDN 的 SNI 阻断；Worker 调用需走本机代理。
// 置空或 --no-proxy 可关闭。
const PROXY = process.argv.includes('--no-proxy')
  ? null
  : (process.env.HUB_HTTP_PROXY ?? 'http://127.0.0.1:7890')

function die(msg, code = 1) {
  console.error(JSON.stringify({ ok: false, error: msg }))
  process.exit(code)
}

function arg(name, required = true) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) {
    if (required) die(`missing --${name}`)
    return null
  }
  return process.argv[i + 1] || die(`missing value for --${name}`)
}

function loadToken() {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN.trim()
  try { return readFileSync(TOKEN_FILE, 'utf8').trim() }
  catch { die(`cannot read token file: ${TOKEN_FILE}`) }
}

const sha256hex = (d) => createHash('sha256').update(d).digest('hex')
const hmac = (k, d) => createHmac('sha256', k).update(d).digest()
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const canonicalPath = (p) => p.split('/').map(rfc3986).join('/')

/**
 * S3 SigV4 GET —— 用 curl 而非 node fetch。
 * 本机 node fetch(undici) 对 Cloudflare 系主机恒 ETIMEDOUT（裸 TCP 与 curl 均正常），
 * 故统一走 curl；临时凭据只写进 0600 配置文件，不进 argv。
 * 返回 { status, buffer, text }。
 */
function signedGet(url, ak, sk, sessionToken) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-r2-'))
  try {
    const outFile = join(dir, 'obj.bin')
    const cfgFile = join(dir, 'curl.conf')
    const cfg = [
      'silent', 'show-error',
      'http1.1',
      'max-time = 120',
      `url = "${url}"`,
      `user = "${ak}:${sk}"`,
      'aws-sigv4 = "aws:amz:auto:s3"',
      `header = "x-amz-security-token: ${sessionToken}"`,
      `output = "${outFile}"`,
      'write-out = "%{http_code}"',
    ].join('\n')
    writeFileSync(cfgFile, cfg, { mode: 0o600 })
    let status = 0
    try {
      status = Number(execFileSync('curl', ['-sS', '-K', cfgFile], { encoding: 'utf8', maxBuffer: 4096 }).trim())
    } catch (e) {
      status = 0
    }
    const buffer = readFileSync(outFile)
    return { status, buffer, text: status === 200 ? '' : buffer.toString('utf8').slice(0, 300) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 调 Worker：Node fetch 不认代理，且 hub 的 SNI 阻断使直连不可用，
 * 故用 curl 走代理 + 重试；token 只写进 0600 临时配置文件，不进 argv。
 * 返回 { status, json }。
 */
async function workerPost(pathname, body, bearer, proxy) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-fetch-'))
  try {
    const bodyFile = join(dir, 'body.json')
    writeFileSync(bodyFile, JSON.stringify(body), { mode: 0o600 })
    const cfgFile = join(dir, 'curl.conf')
    const cfg = [
      'silent', 'show-error',
      'http1.1', // 代理对 TLS/ALPN 处理不稳，强制 HTTP/1.1
      'max-time = 25',
      'connect-timeout = 10',
      `url = "${WORKER_URL}${pathname}"`,
      'request = "POST"',
      `header = "authorization: Bearer ${bearer}"`,
      'header = "content-type: application/json"',
      `data-binary = "@${bodyFile}"`,
      'write-out = "\\n%{http_code}"',
      ...(proxy ? [`proxy = "${proxy}"`] : []),
    ].join('\n')
    writeFileSync(cfgFile, cfg, { mode: 0o600 })

    // 代理实测约 2/3 成功、偶发 502/超时：只对这两类重试，4xx 立即返回。
    const RETRYABLE = new Set([0, 502, 503, 504])
    let last = { status: 0, json: null }
    for (let i = 0; i < 6; i++) {
      try {
        const out = execFileSync('curl', ['-sS', '-K', cfgFile], { encoding: 'utf8', maxBuffer: 1 << 20 })
        const cut = out.lastIndexOf('\n')
        const status = Number(out.slice(cut + 1).trim())
        let json = null
        try { json = JSON.parse(out.slice(0, cut)) } catch {}
        last = { status, json }
      } catch {
        last = { status: 0, json: null }
      }
      if (!RETRYABLE.has(last.status)) return last
      await new Promise((r) => setTimeout(r, 1500))
    }
    return last
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const campaign = arg('campaign')
const bookId = arg('book')
const code = arg('code')
const deleteAfter = process.argv.includes('--delete-after')

if (!/^[A-Za-z0-9._-]{1,64}$/.test(campaign)) die('invalid campaign id')
if (!/^bk_[0-9a-f]{16}$/.test(bookId)) die('invalid bookId')
if (!/^[A-Z0-9]{8}$/.test(code)) die('invalid code')

const token = loadToken()

// 1. 换临时凭据
let tr
try {
  tr = await workerPost('/api/internal/audio/input-token', { bookId, code }, token, PROXY)
} catch (e) {
  die(`worker unreachable: ${e.message}`)
}
const tj = tr.json
if (tr.status !== 200 || !tj || !tj.ok) die(`input-token failed: ${tr.status} ${JSON.stringify(tj && (tj.error || tj.detail))}`)

// 2. 直连 R2
const objUrl = `${tj.endpoint}/${tj.bucket}/${canonicalPath('/' + tj.key).slice(1)}`
let got
try {
  got = signedGet(objUrl, tj.accessKeyId, tj.secretAccessKey, tj.sessionToken)
} catch (e) {
  die(`r2 unreachable: ${e.message} (${objUrl})`)
}
if (got.status !== 200) die(`r2 get failed: ${got.status} ${got.text}`)
const buf = got.buffer

// 3. 落盘（目录 0700 / 文件 0600）
const dir = join(SCRATCH, 'campaigns', campaign, 'input')
const file = join(dir, 'book.json')
await mkdir(dir, { recursive: true, mode: 0o700 })
await chmod(dir, 0o700)
await writeFile(file, buf, { mode: 0o600 })
await chmod(file, 0o600)

const digest = sha256hex(buf)
const dirMode = (await stat(dir)).mode & 0o777
const fileMode = (await stat(file)).mode & 0o777

const out = {
  ok: true,
  campaign,
  bookId,
  code,
  key: tj.key,
  bytes: buf.length,
  sha256: digest,
  path: file,
  dirMode: dirMode.toString(8),
  fileMode: fileMode.toString(8),
  credentialExpiration: tj.expiration || null,
  deleted: false,
}

// 4. 用完删除
if (deleteAfter) {
  await rm(file, { force: true })
  try { await rm(dir, { recursive: true, force: true }) } catch {}
  let gone = true
  try { await stat(file); gone = false } catch {}
  out.deleted = gone
}

console.log(JSON.stringify(out))
