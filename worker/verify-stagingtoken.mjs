/**
 * stagingtoken.js 自检：Worker 现签 R2 临时写凭据（staging 桶）
 * 用法: node verify-stagingtoken.mjs
 */
import { handleStagingToken } from './src/stagingtoken.js'

let pass = 0, fail = 0
function t(name, ok) {
  if (ok) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const BOOK = 'bk_aaf76be7487fc467'
const CAMPAIGN = 'w11-3-test'
const env = {
  INTERNAL_TOKEN: 'secret',
  R2_TEMP_TOKEN: 'parent',
  CF_ACCOUNT_ID: 'acct',
  STAGING_BUCKET: 'my-reader-audio-staging',
  R2_PARENT_ACCESS_KEY_ID: 'parentAK',
}
const origFetch = globalThis.fetch
let seen = null
globalThis.fetch = async (url, init) => {
  seen = { url: String(url), body: JSON.parse(init.body) }
  return new Response(JSON.stringify({
    success: true,
    result: { accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST', expiration: '2026-11-13T08:30:00Z' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const req = (body, headers = {}) => new Request('https://x/api/internal/audio/staging-token', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

try {
  let r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: BOOK }), env)
  t('无 auth → 401', r.status === 401)

  r = await handleStagingToken(req({ campaignId: '../bad', bookId: BOOK }, { authorization: 'Bearer secret' }), env)
  t('坏 campaignId → 400', r.status === 400)

  r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: 'bad' }, { authorization: 'Bearer secret' }), env)
  t('坏 bookId → 400', r.status === 400)

  seen = null
  r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: BOOK }, { authorization: 'Bearer secret' }), env)
  const j = await r.json()
  t('200 + 临时凭据', r.status === 200 && j.ok && j.accessKeyId === 'AK' && j.secretAccessKey === 'SK' && j.sessionToken === 'ST' && j.ttlSeconds === 1800)
  t('bucket/prefix/permission/ttl/parentAK', !!seen && seen.body.bucket === 'my-reader-audio-staging'
    && seen.body.prefixes[0] === `staging/${CAMPAIGN}/${BOOK}/`
    && seen.body.permission === 'object-read-write'
    && seen.body.ttlSeconds === 1800
    && seen.body.parentAccessKeyId === 'parentAK')
  t('prefix/endpoint', j.prefix === `staging/${CAMPAIGN}/${BOOK}/` && j.endpoint === 'https://acct.r2.cloudflarestorage.com')

  seen = null
  r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: BOOK, ttlSeconds: 10 }, { authorization: 'Bearer secret' }), env)
  t('ttl 下限 60', r.status === 200 && seen.body.ttlSeconds === 60)

  seen = null
  r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: BOOK, ttlSeconds: 99999 }, { authorization: 'Bearer secret' }), env)
  t('ttl 上限 3600', r.status === 200 && seen.body.ttlSeconds === 3600)

  const noBucket = { ...env }
  delete noBucket.STAGING_BUCKET
  r = await handleStagingToken(req({ campaignId: CAMPAIGN, bookId: BOOK }, { authorization: 'Bearer secret' }), noBucket)
  t('缺 STAGING_BUCKET → 500', r.status === 500)

  r = await handleStagingToken(new Request('https://x/other', { method: 'POST' }), env)
  t('非本路由 → null', r === null)
} finally {
  globalThis.fetch = origFetch
}

console.log(`\nstagingtoken selftest ${pass}/${pass + fail} ${fail ? 'FAIL' : 'PASS'}`)
process.exit(fail ? 1 : 0)
