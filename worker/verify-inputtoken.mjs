/**
 * inputtoken.js 自检：Worker 现签 R2 临时读凭据
 * 用法: node verify-inputtoken.mjs
 */
import { handleInputToken } from './src/inputtoken.js'

let pass = 0, fail = 0
function t(name, ok) {
  if (ok) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const BOOK = 'bk_aaf76be7487fc467'
const CODE = '7AGQUXZ9'
const env = {
  INTERNAL_TOKEN: 'secret',
  R2_TEMP_TOKEN: 'parent',
  CF_ACCOUNT_ID: 'acct',
  AUDIO_BUCKET: 'my-reader-audio',
  R2_PARENT_ACCESS_KEY_ID: 'parentAK',
}
const origFetch = globalThis.fetch
let seen = null
globalThis.fetch = async (url, init) => {
  seen = { url: String(url), body: JSON.parse(init.body) }
  return new Response(JSON.stringify({
    success: true,
    result: { accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST', expiration: '2026-11-12T18:00:00Z' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const req = (body, headers = {}) => new Request('https://x/api/internal/audio/input-token', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

try {
  let r = await handleInputToken(req({ bookId: BOOK, code: CODE }), env)
  t('无 auth → 401', r.status === 401)

  r = await handleInputToken(req({ bookId: 'bad', code: CODE }, { authorization: 'Bearer secret' }), env)
  t('坏 bookId → 400', r.status === 400)

  r = await handleInputToken(req({ bookId: BOOK, code: 'bad' }, { authorization: 'Bearer secret' }), env)
  t('坏 code → 400', r.status === 400)

  r = await handleInputToken(req({ bookId: BOOK, code: CODE }, { authorization: 'Bearer secret' }), env)
  const j = await r.json()
  t('200 + 临时凭据', r.status === 200 && j.ok && j.accessKeyId === 'AK' && j.secretAccessKey === 'SK' && j.sessionToken === 'ST')
  t('prefix/permission/ttl/parentAK', !!seen && seen.body.bucket === 'my-reader-audio' && seen.body.prefixes[0] === 'books/7AGQUXZ9/' && seen.body.permission === 'object-read-only' && seen.body.ttlSeconds === 600 && seen.body.parentAccessKeyId === 'parentAK')
  t('key/endpoint', j.key === 'books/7AGQUXZ9/bk_aaf76be7487fc467.json' && j.endpoint === 'https://acct.r2.cloudflarestorage.com')

  r = await handleInputToken(new Request('https://x/other', { method: 'POST' }), env)
  t('非本路由 → null', r === null)
} finally {
  globalThis.fetch = origFetch
}

console.log(`\ninputtoken selftest ${pass}/${pass + fail} ${fail ? 'FAIL' : 'PASS'}`)
process.exit(fail ? 1 : 0)
