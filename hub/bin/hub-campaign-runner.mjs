#!/usr/bin/env node
/**
 * W11-7 · hub campaign runner
 *
 * 轮询 Worker 的 queued campaign，认领一条，跑完整链：
 *   fetch 书体 → 生成指定章 → 上传 staging → promote 转正。
 *
 * 用法：
 *   node hub-campaign-runner.mjs --once
 *   可选：--dry-run（只列 queued，不认领）
 *
 * 调度：cron 每 5 分钟一次；flock/自身 lock 防止重叠。单次只处理一条 campaign。
 * 边界：不直接读 D1／R2；一切经 Worker 内部接口（INTERNAL_TOKEN）＋三个已验证脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()
const HUB = process.env.HUB_ROOT || path.join(HOME, 'hub')
const BIN = path.join(HUB, 'bin')
const ARCHIVE = process.env.HUB_AUDIO_ARCHIVE || path.join(HUB, '_archive/audio-campaigns')
const TOKEN_FILE = process.env.INTERNAL_TOKEN_FILE || path.join(HUB, '.secrets', 'internal-token')
const WORKER_URL = process.env.MY_READER_WORKER_URL || 'https://my-reader.ferrari11.com'
const PROXY = process.argv.includes('--no-proxy')
  ? null
  : (process.env.HUB_HTTP_PROXY ?? 'http://127.0.0.1:7890')
const LOCK = path.join(HUB, '_dispatch/log/campaign-runner.lock')
const DRY = process.argv.includes('--dry-run')

function log(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }))
}
function die(msg, code = 1) {
  log({ ok: false, error: msg })
  process.exit(code)
}
function loadToken() {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN.trim()
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() }
  catch { die(`cannot read token file: ${TOKEN_FILE}`) }
}
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
function curl(cfg, maxBuffer = 1 << 20) {
  return execFileSync('curl', ['-sS', '-K', '-'], { input: cfg, encoding: 'utf8', maxBuffer })
}

const token = loadToken()

/** Worker 内部接口（curl 走 stdin，token 不进 argv） */
async function worker(pathname, method = 'GET', body = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-campaign-'))
  try {
    let dataLine = ''
    if (body) {
      const bf = path.join(dir, 'body.json')
      fs.writeFileSync(bf, JSON.stringify(body), { mode: 0o600 })
      dataLine = `data-binary = "@${esc(bf)}"`
    }
    const cfg = [
      'silent', 'show-error',
      'http1.1',
      'max-time = 60',
      'connect-timeout = 10',
      `url = "${esc(WORKER_URL)}${esc(pathname)}"`,
      `request = "${method}"`,
      `header = "authorization: Bearer ${esc(token)}"`,
      'header = "content-type: application/json"',
      ...(dataLine ? [dataLine] : []),
      'write-out = "\\n%{http_code}"',
      ...(PROXY ? [`proxy = "${esc(PROXY)}"`] : []),
    ].join('\n')
    const RETRYABLE = new Set([0, 502, 503, 504])
    for (let i = 0; i < 6; i++) {
      try {
        const out = curl(cfg)
        const cut = out.lastIndexOf('\n')
        const status = Number(out.slice(cut + 1).trim())
        let json = null
        try { json = JSON.parse(out.slice(0, cut)) } catch {}
        if (!RETRYABLE.has(status)) return { status, json }
      } catch {}
      await new Promise((r) => setTimeout(r, 1500))
    }
    return { status: 0, json: null }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx')
    fs.writeSync(fd, String(process.pid))
    fs.closeSync(fd)
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    let pid = 0
    try { pid = Number(fs.readFileSync(LOCK, 'utf8')) } catch {}
    let alive = false
    if (pid > 0) { try { process.kill(pid, 0); alive = true } catch {} }
    if (!alive) {
      fs.rmSync(LOCK, { force: true })
      return acquireLock()
    }
    return false
  }
}
process.on('exit', () => { try { fs.rmSync(LOCK, { force: true }) } catch {} })

function runScript(script, args) {
  log({ event: 'exec', script, args })
  try {
    execFileSync('node', [path.join(BIN, script), ...args], { stdio: 'inherit', maxBuffer: 1 << 20 })
    return true
  } catch (e) {
    log({ event: 'exec_failed', script, code: e && e.status })
    return false
  }
}

async function markFailed(campaignId, error) {
  const r = await worker(`/api/internal/audio/campaign/${encodeURIComponent(campaignId)}/status`, 'POST', { status: 'failed', error: String(error).slice(0, 300) })
  log({ event: 'mark_failed', campaignId, status: r.status })
}

if (!acquireLock()) {
  log({ ok: true, event: 'locked' })
  process.exit(0)
}

const list = await worker('/api/internal/audio/campaigns?status=queued')
if (list.status !== 200 || !list.json || !list.json.ok) die(`campaign list failed: ${list.status}`)
const campaigns = Array.isArray(list.json.campaigns) ? list.json.campaigns : []
if (campaigns.length === 0) {
  log({ ok: true, event: 'no_queued' })
  process.exit(0)
}
const c = campaigns[0]
const campaignId = String(c.id)
log({ event: 'candidate', campaignId, bookId: c.book_id, chaptersTotal: c.chapters_total, chapters: c.chapters })

if (DRY) {
  log({ ok: true, event: 'dry_run', campaignId })
  process.exit(0)
}

const claim = await worker(`/api/internal/audio/campaign/${encodeURIComponent(campaignId)}/claim`, 'POST', {})
if (claim.status !== 200 || !claim.json || !claim.json.ok) die(`claim failed: ${claim.status}`)
const row = claim.json.campaign || {}
const chapters = Array.isArray(row.chapters) ? row.chapters.map(String) : []
if (chapters.length === 0) {
  await markFailed(campaignId, 'NO_CHAPTERS：campaign 没有 chapters_json（旧行或缺迁移）')
  die('NO_CHAPTERS')
}
const bookId = String(row.book_id || c.book_id)
const code = String(row.code || c.code)
if (!/^bk_[A-Za-z0-9._-]{1,64}$/.test(bookId) || !/^[A-Z0-9]{8}$/.test(code)) {
  await markFailed(campaignId, 'BAD_CAMPAIGN_ROW')
  die('BAD_CAMPAIGN_ROW')
}

for (const [script, args] of [
  ['hub-audio-fetch.mjs', ['--campaign', campaignId, '--book', bookId, '--code', code]],
  ['hub-audio-campaign.mjs', ['--campaign', campaignId, '--chapters', chapters.join(','), '--max-chapters', '60']],
  ['hub-audio-uploader.mjs', ['--campaign', campaignId]],
]) {
  if (!runScript(script, args)) {
    await markFailed(campaignId, `${script} failed`)
    process.exit(1)
  }
}

const uploadPath = path.join(ARCHIVE, campaignId, bookId, 'upload.json')
let upload
try { upload = JSON.parse(fs.readFileSync(uploadPath, 'utf8')) } catch {
  await markFailed(campaignId, 'upload.json missing')
  die('UPLOAD_RECEIPT_MISSING')
}
if (!upload.ok || (Array.isArray(upload.failed) && upload.failed.length)) {
  await markFailed(campaignId, 'upload failed')
  die('UPLOAD_FAILED')
}

const byChapter = new Map()
for (const o of upload.uploaded || []) {
  const cid = String(o.chapterId)
  if (!byChapter.has(cid)) byChapter.set(cid, { chapterId: cid })
  const e = byChapter.get(cid)
  if (o.kind === 'mp3') { e.mp3 = o.path; e.sha256 = o.sha256; e.bytes = o.bytes }
  if (o.kind === 'timings') { e.timings = o.path }
}
const promoteChapters = [...byChapter.values()]
  .filter((e) => e.mp3 && e.timings && e.sha256 && e.bytes)
  .map((e) => ({ ...e, status: 'done' }))
if (promoteChapters.length !== chapters.length) {
  await markFailed(campaignId, `partial upload：${promoteChapters.length}/${chapters.length}`)
  die('PARTIAL_UPLOAD')
}

const promote = await worker('/api/internal/audio/promote', 'POST', {
  campaignId,
  bookId,
  stagingPrefix: `staging/${campaignId}/${bookId}/`,
  chapters: promoteChapters,
})
if (promote.status !== 200 || !promote.json || !promote.json.ok) {
  if (promote.status === 422 || promote.status === 409) {
    log({ ok: false, event: 'promote_blocked', campaignId, status: promote.status, error: promote.json && promote.json.error })
    process.exit(1)
  }
  await markFailed(campaignId, `promote failed: ${promote.status}`)
  die(`promote failed: ${promote.status}`)
}
log({ ok: true, event: 'done', campaignId, promoted: (promote.json.promoted || []).length, index: promote.json.index })
