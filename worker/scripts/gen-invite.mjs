#!/usr/bin/env node
/**
 * 生成邀请码（单次可用，默认 30 天）。
 *
 *   node worker/scripts/gen-invite.mjs --count 10 --note "M2 batch" --days 30 --out /tmp/invite.sql
 *   npx wrangler d1 execute my-reader-dict --remote --file=/tmp/invite.sql
 *
 * 字母表去掉易混的 0/O/1/I；批内唯一。只输出 SQL 与一张码表，不写库。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))
const count = clamp(parseInt(opt('--count', '10'), 10), 1, 50)
const note = opt('--note', '')
const createdBy = opt('--created-by', 'ferrari')
const days = parseInt(opt('--days', '30'), 10)
const expiresArg = opt('--expires', '')
const out = opt('--out', '')
const now = Date.now()

let expiresAt = null
if (expiresArg) {
  const t = Date.parse(expiresArg)
  if (!Number.isFinite(t)) { console.error('--expires 不是合法日期：' + expiresArg); process.exit(2) }
  expiresAt = t
} else if (Number.isFinite(days) && days > 0) {
  expiresAt = now + days * 86400000
}

const codes = new Set()
while (codes.size < count) {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  codes.add(s)
}

const esc = (s) => String(s).replace(/'/g, "''")
const rows = [...codes].map((code) => ({ code, now, createdBy, note, expiresAt }))
const sql = rows.map((r) =>
  `INSERT INTO invite_codes (code, created_at, created_by, note, expires_at) VALUES ('${r.code}', ${r.now}, '${esc(r.createdBy)}', '${esc(r.note)}', ${r.expiresAt === null ? 'NULL' : r.expiresAt});`
).join('\n')

console.log('code\tnote\texpires')
for (const r of rows) console.log(`${r.code}\t${r.note || '-'}\t${r.expiresAt ? new Date(r.expiresAt).toISOString() : 'never'}`)
if (out) {
  fs.writeFileSync(out, sql + '\n', 'utf8')
  console.log(`\nSQL -> ${out}`)
} else {
  console.log('\n' + sql)
}
