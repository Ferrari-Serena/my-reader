/**
 * W11-2a · 输入 fetch · Worker 端：现签 R2 临时读凭据
 *
 * POST /api/internal/audio/input-token
 *   Authorization: Bearer <INTERNAL_TOKEN>
 *   body: { bookId, code }
 *   返回：{ ok, bookId, code, bucket, key, endpoint,
 *           accessKeyId, secretAccessKey, sessionToken, expiration }
 *
 * 边界：
 *   · parent token 只在 Worker secret（R2_TEMP_TOKEN），hub 永远拿不到。
 *   · 临时凭据 ObjectReadOnly + prefixes=`books/<code>/` + TTL=600s。
 *   · 不写 R2、不碰索引。
 */
import { bookObjectKey } from './booksync.js'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export async function handleInputToken(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/internal/audio/input-token') return null
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const auth = request.headers.get('authorization') || ''
  if (!env.INTERNAL_TOKEN || auth !== 'Bearer ' + env.INTERNAL_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }
  const bookId = String((body && body.bookId) || '')
  const code = String((body && body.code) || '')
  if (!/^bk_[0-9a-f]{16}$/.test(bookId)) return json({ error: 'invalid bookId' }, 400)
  if (!/^[A-Z0-9]{8}$/.test(code)) return json({ error: 'invalid code' }, 400)
  if (!env.CF_ACCOUNT_ID || !env.AUDIO_BUCKET || !env.R2_TEMP_TOKEN || !env.R2_PARENT_ACCESS_KEY_ID) {
    return json({ error: 'input token not configured' }, 500)
  }

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
        bucket: env.AUDIO_BUCKET,
        parentAccessKeyId: env.R2_PARENT_ACCESS_KEY_ID,
        prefixes: [`books/${code}/`],
        permission: 'object-read-only',
        ttlSeconds: 600,
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
    bookId,
    code,
    bucket: env.AUDIO_BUCKET,
    key: bookObjectKey(code, bookId),
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: r.accessKeyId,
    secretAccessKey: r.secretAccessKey,
    sessionToken: r.sessionToken,
    expiration: r.expiration,
  })
}
