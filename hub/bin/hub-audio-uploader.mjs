#!/usr/bin/env node
/**
 * W11-3 · hub 音频上传：result.json.outputs[] → staging 桶
 *
 * 用法：
 *   node hub-audio-uploader.mjs --campaign <id> [--book <bk_...>]
 *   node hub-audio-uploader.mjs --result <.../result.json>
 *   可选：--ttl <秒，60–3600，默认 1800>  --dry-run  --no-proxy
 *         --chapter <ch-xx>  --limit <n>  仅传指定章／前 n 章
 *         --test-fail-first <n>  仅验收用：模拟前 n 次 PUT 失败
 *
 * 流程（设计稿 §12.4）：
 *   1. 读 result.json.outputs[]，校验本地文件与 sha256；
 *   2. 调 Worker /api/internal/audio/staging-token 换临时写凭据（内存／stdin，不落盘）；
 *   3. curl + SigV4 直连 R2，PUT 到 staging/<campaignId>/<bookId>/<file>；
 *   4. 单文件最多 3 次；成功后 HEAD 校验 Content-Length/ETag；
 *   5. 写 upload.json 回执。
 *
 * 边界：只写 staging 桶；不碰正式 AUDIO 桶、不写索引；不打印正文/凭据。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()
const HUB = process.env.HUB_ROOT || path.join(HOME, 'hub')
const ARCHIVE_ROOT = process.env.HUB_AUDIO_ARCHIVE || path.join(HUB, '_archive/audio-campaigns')
const TOKEN_FILE = process.env.INTERNAL_TOKEN_FILE || path.join(HUB, '.secrets', 'internal-token')
const WORKER_URL = process.env.MY_READER_WORKER_URL || 'https://my-reader.ferrari11.com'
const PROXY = process.argv.includes('--no-proxy')
  ? null
  : (process.env.HUB_HTTP_PROXY ?? 'http://127.0.0.1:7890')
const MAX_ATTEMPTS = 3

function die(msg, code = 1) {
  console.error(JSON.stringify({ ok: false, error: msg }))
  process.exit(code)
}
function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function has(name) { return process.argv.includes('--' + name) }
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
function loadToken() {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN.trim()
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() }
  catch { die(`cannot read token file: ${TOKEN_FILE}`) }
}
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const md5hex = (buf) => crypto.createHash('md5').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** curl 配置从 stdin 读；凭据不进 argv、不落盘。 */
function curl(cfg, maxBuffer = 1 << 20) {
  return execFileSync('curl', ['-sS', '-K', '-'], { input: cfg, encoding: 'utf8', maxBuffer })
}

// ---------- 定位 result.json ----------
const resultArg = arg('result')
const campaignArg = arg('campaign')
const bookArg = arg('book')
const ttlArg = Number(arg('ttl') || 1800)
const ttlSeconds = Math.min(3600, Math.max(60, Number.isFinite(ttlArg) ? Math.floor(ttlArg) : 1800))
const dryRun = has('dry-run')
const testFailFirst = Number(arg('test-fail-first') || 0)
const chapterArg = arg('chapter')
const limitArg = Number(arg('limit') || 0)
const token = dryRun ? null : loadToken()

let resultPath
if (resultArg) {
  resultPath = path.resolve(resultArg)
} else {
  if (!campaignArg) die('missing --campaign or --result')
  const base = path.join(ARCHIVE_ROOT, campaignArg)
  if (!fs.existsSync(base)) die(`campaign dir not found: ${base}`)
  const books = fs.readdirSync(base).filter((d) => {
    try { return fs.statSync(path.join(base, d)).isDirectory() } catch { return false }
  })
  if (bookArg) {
    if (!books.includes(bookArg)) die(`book dir not found: ${path.join(base, bookArg)}`)
    resultPath = path.join(base, bookArg, 'result.json')
  } else if (books.length === 1) {
    resultPath = path.join(base, books[0], 'result.json')
  } else {
    die(`multiple books under ${base}; pass --book（${books.join(', ')}）`)
  }
}
if (!fs.existsSync(resultPath)) die(`result.json not found: ${resultPath}`)

const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
const campaignId = String(result.campaignId || (campaignArg || ''))
const bookId = String(result.bookId || (bookArg || ''))
if (!/^[A-Za-z0-9._-]{1,64}$/.test(campaignId)) die(`invalid campaignId: ${campaignId}`)
if (!/^bk_[0-9a-f]{16}$/.test(bookId)) die(`invalid bookId: ${bookId}`)
const outDir = path.resolve(result.outDir || path.dirname(resultPath))
if (!fs.existsSync(outDir)) die(`outDir not found: ${outDir}`)
const outputs = Array.isArray(result.outputs) ? result.outputs : []
if (outputs.length === 0) die('result.outputs is empty')

let selected = outputs
if (chapterArg) selected = selected.filter((o) => String(o.chapterId) === chapterArg)
if (limitArg > 0) {
  const ids = []
  for (const o of selected) {
    const c = String(o.chapterId)
    if (!ids.includes(c)) ids.push(c)
  }
  const keep = new Set(ids.slice(0, limitArg))
  selected = selected.filter((o) => keep.has(String(o.chapterId)))
}
if (selected.length === 0) die('no outputs matched --chapter/--limit')

// ---------- 本地校验 ----------
const plan = []
for (const o of selected) {
  const rel = String(o.path || '')
  const abs = path.resolve(outDir, rel)
  if (abs !== outDir && !abs.startsWith(outDir + path.sep)) die(`path traversal: ${rel}`)
  if (!fs.existsSync(abs)) die(`missing local file: ${rel}`)
  const buf = fs.readFileSync(abs)
  const sha = sha256hex(buf)
  if (o.sha256 && String(o.sha256) !== sha) die(`sha256 mismatch: ${rel}`)
  plan.push({
    kind: String(o.kind || ''), chapterId: String(o.chapterId || ''),
    rel, abs, bytes: buf.length, sha256: sha, md5: md5hex(buf),
    keyFile: path.basename(rel),
  })
}

if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, campaignId, bookId, outDir, files: plan.map((p) => ({ kind: p.kind, path: p.rel, bytes: p.bytes })) }, null, 2))
  process.exit(0)
}

// ---------- Worker：换临时写凭据 ----------
let workerCreds = null
async function mint(force = false) {
  if (workerCreds && !force) return workerCreds
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-uploader-'))
  try {
    const bodyFile = path.join(dir, 'body.json')
    fs.writeFileSync(bodyFile, JSON.stringify({ campaignId, bookId, ttlSeconds }), { mode: 0o600 })
    const cfg = [
      'silent', 'show-error',
      'http1.1',
      'max-time = 30',
      'connect-timeout = 10',
      `url = "${esc(WORKER_URL)}/api/internal/audio/staging-token"`,
      'request = "POST"',
      `header = "authorization: Bearer ${esc(token)}"`,
      'header = "content-type: application/json"',
      `data-binary = "@${esc(bodyFile)}"`,
      'write-out = "\\n%{http_code}"',
      ...(PROXY ? [`proxy = "${esc(PROXY)}"`] : []),
    ].join('\n')
    const RETRYABLE = new Set([0, 502, 503, 504])
    let last = { status: 0, json: null }
    for (let i = 0; i < 6; i++) {
      try {
        const out = curl(cfg)
        const cut = out.lastIndexOf('\n')
        const status = Number(out.slice(cut + 1).trim())
        let json = null
        try { json = JSON.parse(out.slice(0, cut)) } catch {}
        last = { status, json }
      } catch {
        last = { status: 0, json: null }
      }
      if (!RETRYABLE.has(last.status)) break
      await sleep(1500)
    }
    if (last.status !== 200 || !last.json || !last.json.ok) {
      die(`staging-token failed: ${last.status} ${JSON.stringify(last.json && (last.json.error || last.json.detail))}`)
    }
    workerCreds = last.json
    return workerCreds
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- R2 PUT / HEAD ----------
function signedPut(url, file, ak, sk, st) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-r2-put-'))
  try {
    const outFile = path.join(dir, 'body.txt')
    const cfg = [
      'silent', 'show-error',
      'http1.1',
      'max-time = 900',
      `url = "${esc(url)}"`,
      'request = "PUT"',
      `user = "${esc(ak)}:${esc(sk)}"`,
      'aws-sigv4 = "aws:amz:auto:s3"',
      `header = "x-amz-security-token: ${esc(st)}"`,
      `data-binary = "@${esc(file)}"`,
      `output = "${esc(outFile)}"`,
      'write-out = "%{http_code}"',
      ...(PROXY ? [`proxy = "${esc(PROXY)}"`] : []),
    ].join('\n')
    let status = 0
    try { status = Number(curl(cfg).trim()) } catch { status = 0 }
    const body = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').slice(0, 300) : ''
    return { status, body }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
function verifyObject(url, ak, sk, st) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-r2-head-'))
  try {
    const hdrFile = path.join(dir, 'headers.txt')
    const cfg = [
      'silent', 'show-error',
      'http1.1',
      'max-time = 30',
      `url = "${esc(url)}"`,
      `user = "${esc(ak)}:${esc(sk)}"`,
      'aws-sigv4 = "aws:amz:auto:s3"',
      `header = "x-amz-security-token: ${esc(st)}"`,
      'header = "Range: bytes=0-0"',
      `dump-header = "${esc(hdrFile)}"`,
      'output = "/dev/null"',
      'write-out = "%{http_code}"',
      ...(PROXY ? [`proxy = "${esc(PROXY)}"`] : []),
    ].join('\n')
    let status = 0
    try { status = Number(curl(cfg).trim()) } catch { status = 0 }
    const headers = fs.existsSync(hdrFile) ? fs.readFileSync(hdrFile, 'utf8') : ''
    const cl = (headers.match(/^content-length:\s*(\d+)/im) || [])[1]
    const cr = (headers.match(/^content-range:\s*bytes\s+\d+-\d+\/(\d+)/im) || [])[1]
    const etag = (headers.match(/^etag:\s*"?([^"\r\n]+)"?/im) || [])[1]
    return { status, contentLength: cr ? Number(cr) : (cl ? Number(cl) : null), etag: etag || null }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const EXPIRED_RE = /ExpiredToken|SignatureDoesNotMatch|InvalidAccessKeyId|TokenRefreshRequired/i

// ---------- 主循环 ----------
const startedAt = new Date().toISOString()
let creds = await mint()
console.log(JSON.stringify({ ok: true, phase: 'mint', bucket: creds.bucket, prefix: creds.prefix, ttlSeconds: creds.ttlSeconds }))

const uploaded = []
const failed = []
let simulated = 0
for (const p of plan) {
  let ok = false
  let lastErr = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (testFailFirst > 0 && simulated < testFailFirst) {
      simulated++
      lastErr = `simulated failure (${simulated}/${testFailFirst})`
      await sleep(200)
      continue
    }
    const key = `${creds.prefix}${encodeURIComponent(p.keyFile)}`
    const url = `${creds.endpoint}/${creds.bucket}/${key}`
    const put = signedPut(url, p.abs, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken)
    if (put.status === 200) {
      const head = verifyObject(url, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken)
      const lenOk = head.contentLength === null || head.contentLength === p.bytes
      const etagOk = !head.etag || head.etag.toLowerCase() === p.md5
      if ((head.status === 200 || head.status === 206) && lenOk && etagOk) {
        uploaded.push({ kind: p.kind, chapterId: p.chapterId, path: p.rel, bytes: p.bytes, sha256: p.sha256, etag: head.etag, attempts: attempt })
        console.log(JSON.stringify({ ok: true, file: p.rel, bytes: p.bytes, attempt }))
        ok = true
        break
      }
      lastErr = `verify failed: HEAD ${head.status} content-length ${head.contentLength} etag ${head.etag}`
    } else {
      lastErr = `PUT ${put.status}: ${put.body}`
      if (put.status === 403 && EXPIRED_RE.test(put.body)) {
        creds = await mint(true)
      }
    }
    console.log(JSON.stringify({ ok: false, file: p.rel, attempt, error: lastErr.slice(0, 220) }))
    if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt)
  }
  if (!ok) failed.push({ path: p.rel, attempts: MAX_ATTEMPTS, error: lastErr })
}

const receipt = {
  ok: failed.length === 0,
  campaignId,
  bookId,
  stagingBucket: creds.bucket,
  stagingPrefix: creds.prefix,
  ttlSeconds: creds.ttlSeconds,
  uploaded,
  failed,
  startedAt,
  finishedAt: new Date().toISOString(),
}
const receiptPath = path.join(outDir, 'upload.json')
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 })
console.log(JSON.stringify(receipt, null, 2))
process.exit(receipt.ok ? 0 : 1)
