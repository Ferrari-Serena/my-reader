/**
 * W11-3 · Uploader→staging · Worker 端：现签 R2 临时写凭据
 *
 * POST /api/internal/audio/staging-token
 *   Authorization: Bearer <INTERNAL_TOKEN>
 *   body: { campaignId, bookId, ttlSeconds? }
 *   返回：{ ok, campaignId, bookId, bucket, prefix, endpoint,
 *           accessKeyId, secretAccessKey, sessionToken, expiration }
 *
 * 边界：
 *   · parent token 只在 Worker secret（R2_TEMP_TOKEN），hub 永远拿不到。
 *   · 凭据只绑 staging 桶 + 前缀 `staging/<campaignId>/<bookId>/`，TTL 默认 1800s（上限 3600s）。
 *   · Cloudflare 临时凭据 API 只有 object-read-write / object-read-only 两档；
 *     没有 object-write-only。故这里用 object-read-write，靠独立 staging 桶 + 前缀 + 短 TTL 收窄。
 *   · 2026-11-13：parent R2 key 已扩到 my-reader-audio-staging，STAGING_BUCKET 指向独立桶。
 *   · 不碰正式 AUDIO 桶、不写索引。
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function clampTtl(v, dflt = 1800) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return dflt
  return Math.min(3600, Math.max(60, Math.floor(n)))
}

export async function handleStagingToken(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/internal/audio/staging-token') return null
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const auth = request.headers.get('authorization') || ''
  if (!env.INTERNAL_TOKEN || auth !== 'Bearer ' + env.INTERNAL_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }
  const campaignId = String((body && body.campaignId) || '')
  const bookId = String((body && body.bookId) || '')
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(campaignId)) return json({ error: 'invalid campaignId' }, 400)
  if (!/^bk_[0-9a-f]{16}$/.test(bookId)) return json({ error: 'invalid bookId' }, 400)
  if (!env.CF_ACCOUNT_ID || !env.STAGING_BUCKET || !env.R2_TEMP_TOKEN || !env.R2_PARENT_ACCESS_KEY_ID) {
    return json({ error: 'staging token not configured' }, 500)
  }

  const ttlSeconds = clampTtl(body && body.ttlSeconds)
  const prefix = `staging/${campaignId}/${bookId}/`
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/r2/temp-access-credentials`
  let res, data
  try {
    res = await fetch(api, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.R2_TEMP_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: env.STAGING_BUCKET,
        parentAccessKeyId: env.R2_PARENT_ACCESS_KEY_ID,
        prefixes: [prefix],
        permission: 'object-read-write',
        ttlSeconds,
      }),
    })
    data = await res.json()
  } catch (e) {
    return json({ error: 'cloudflare api failed', message: String((e && e.message) || e) }, 502)
  }
  if (!res.ok || !data || !data.success || !data.result) {
    return json({ error: 'temp credentials failed', status: res.status, detail: data && data.errors }, 502)
  }

  const r = data.result
  return json({
    ok: true,
    campaignId,
    bookId,
    bucket: env.STAGING_BUCKET,
    prefix,
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    ttlSeconds,
    accessKeyId: r.accessKeyId,
    secretAccessKey: r.secretAccessKey,
    sessionToken: r.sessionToken,
    expiration: r.expiration,
  })
}
