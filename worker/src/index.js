/**
 * my-reader Dictionary Worker
 * Merriam-Webster Collegiate 词典代理 + D1 边缘缓存。
 * 解决国内直连 M-W API 3-4 秒延迟的问题；查过的词全体用户共享缓存。
 *
 * GET /api/dict/<word>  → { lemma, phonetic, partOfSpeech, definitions[], audioUrl }
 *                         未收录时 → 404 { notFound: true, suggestions[] }
 *                         被限流时 → 429 { error, scope } + Retry-After 头
 * GET /api/audio/<bookId>/<file>  → R2 对象本体（支持 Range → 206 / 416）
 * HEAD /api/audio/<bookId>/<file> → 同上但不回 body（上传校验脚本探活用）
 * GET /health           → { status: 'ok' }
 *
 * 绑定：env.DB = D1 数据库（表见 schema.sql）；env.MW_API_KEY = wrangler secret
 */

import { handleSync } from './sync.js'
import { parseRange } from './range.js'
import { corsFor } from './cors.js'
import { takeToken, clientIp } from './ratelimit.js'

const MW_API_BASE = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/'

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra }
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    // 0.0 止血：CORS 不再用通配，改为按请求回显自家 Origin（见 cors.js）
    const cors = corsFor(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // 同步端点分发（匹配 /api/sync/*）
    const syncRes = await handleSync(request, env)
    if (syncRes !== null) return syncRes

    if (url.pathname === '/health') {
      return json(cors, { status: 'ok' })
    }

    // R2 音频代理：/api/audio/<bookId>/<file>
    const audioMatch = url.pathname.match(/^\/api\/audio\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/)
    if (audioMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const key = `${audioMatch[1]}/${audioMatch[2]}`
      const ct = key.endsWith('.mp3') ? 'audio/mpeg' : key.endsWith('.json') ? 'application/json' : 'application/octet-stream'
      const headers = {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=31536000, immutable',
        // 不声明这个，浏览器根本不会尝试 seek，只会整份下完
        'Accept-Ranges': 'bytes',
        ...cors,
      }
      const rangeHeader = request.headers.get('Range')

      // HEAD 只回元数据。上传校验脚本靠 HEAD 探活，不能让它把整章音频读出来；
      // 而且这里若不接住 HEAD，请求会掉到兜底的 404，校验脚本会误报「全部失败」。
      if (request.method === 'HEAD') {
        const meta = await env.AUDIO.head(key)
        if (!meta) return new Response(null, { status: 404, headers: cors })
        const r = parseRange(rangeHeader, meta.size)
        if (r === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${meta.size}` },
          })
        }
        if (r) {
          return new Response(null, {
            status: 206,
            headers: {
              ...headers,
              'Content-Range': `bytes ${r.offset}-${r.offset + r.length - 1}/${meta.size}`,
              'Content-Length': String(r.length),
            },
          })
        }
        return new Response(null, { headers: { ...headers, 'Content-Length': String(meta.size) } })
      }

      // 有 Range 时必须先 head 拿总长：后缀式（bytes=-N）和越界判定都得知道文件多大
      if (rangeHeader) {
        const meta = await env.AUDIO.head(key)
        if (!meta) return new Response('Not found', { status: 404, headers: cors })
        const r = parseRange(rangeHeader, meta.size)
        if (r === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${meta.size}` },
          })
        }
        if (r) {
          const obj = await env.AUDIO.get(key, { range: { offset: r.offset, length: r.length } })
          if (!obj || !obj.body) return new Response('Not found', { status: 404, headers: cors })
          return new Response(obj.body, {
            status: 206,
            headers: {
              ...headers,
              'Content-Range': `bytes ${r.offset}-${r.offset + r.length - 1}/${meta.size}`,
              'Content-Length': String(r.length),
            },
          })
        }
        // r === null：语法不认识（多段等）→ 按 RFC 忽略 Range，落到下面回整份 200
      }

      const obj = await env.AUDIO.get(key)
      if (!obj) return new Response('Not found', { status: 404, headers: cors })
      return new Response(obj.body, { headers })
    }

    // 先 decode 再匹配，兼容把撇号编码成 %27 的客户端
    let pathname = url.pathname
    try { pathname = decodeURIComponent(pathname) } catch { /* 非法编码按原样匹配 */ }
    const match = pathname.match(/^\/api\/dict\/([a-zA-Z][a-zA-Z'-]{0,49})$/)
    if (match && request.method === 'GET') {
      const word = match[1].toLowerCase()

      try {
        // 1. D1 缓存
        const cached = await env.DB
          .prepare('SELECT payload FROM dict_cache WHERE word = ?')
          .bind(word)
          .first()
        if (cached) {
          const payload = JSON.parse(cached.payload)
          return json(cors, payload, payload.notFound ? 404 : 200, { 'X-Cache': 'hit' })
        }

        // 2. 限流闸：只有走到这里（缓存未命中、真要去调 M-W）才计数；
        //    D1 缓存命中不烧 M-W 额度，也不受此限（见 ratelimit.js）
        const rl = await takeToken(env, { ip: clientIp(request) })
        if (!rl.allowed) {
          return json(cors, {
            error: rl.scope === 'quota' ? 'daily lookup quota exhausted' : 'too many lookups',
            scope: rl.scope,
          }, 429, { 'Retry-After': String(rl.retryAfter), 'Cache-Control': 'no-store' })
        }

        // 3. 查 M-W API（trim 防御 secret 值里混入的换行/空白）
        const apiKey = (env.MW_API_KEY || '').trim()
        const resp = await fetch(`${MW_API_BASE}${encodeURIComponent(word)}?key=${apiKey}`)
        if (!resp.ok) {
          return json(cors, { error: `M-W API ${resp.status}` }, 502)
        }
        const text = await resp.text()
        let data
        try {
          data = JSON.parse(text)
        } catch {
          // M-W 的鉴权错误是纯文本（"Invalid API key" 等），不是 JSON
          console.error('M-W non-JSON response:', text.slice(0, 100))
          return json(cors, { error: 'M-W API error' }, 502)
        }
        const payload = parseMW(word, data)

        // 4. 写缓存（未收录也缓存，节省 M-W 免费额度；写失败不影响返回）
        try {
          await env.DB
            .prepare('INSERT OR REPLACE INTO dict_cache (word, payload, fetched_at) VALUES (?, ?, ?)')
            .bind(word, JSON.stringify(payload), Date.now())
            .run()
        } catch (e) {
          console.error('D1 write failed:', e.message)
        }

        return json(cors, payload, payload.notFound ? 404 : 200, { 'X-Cache': 'miss' })
      } catch (err) {
        console.error('dict error:', err.message, err.stack)
        return json(cors, { error: 'lookup failed' }, 500)
      }
    }

    return new Response('Not found', { status: 404, headers: cors })
  }
}

/**
 * 解析 M-W Collegiate 响应为前端 dictEntry 结构。
 * 词不收录时 M-W 返回字符串数组（拼写建议）。
 */
function parseMW(word, data) {
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] === 'string') {
    return { notFound: true, suggestions: Array.isArray(data) ? data.slice(0, 5) : [] }
  }

  // 取第一个有释义的词条
  const entry = data.find(e => e.shortdef?.length) || data[0]
  const prs = entry.hwi?.prs?.[0]

  let definitions = entry.shortdef || []
  // 纯交叉引用条目（went/saw 等不规则变形）：shortdef 为空，用 cxs 拼 "past tense of go"
  if (!definitions.length && entry.cxs?.length) {
    const cx = entry.cxs[0]
    const targets = (cx.cxtis || []).map(t => t.cxt?.replace(/\*/g, '')).filter(Boolean).join(', ')
    if (cx.cxl && targets) definitions = [`${cx.cxl} ${targets}`]
  }
  // 仍无释义就按未收录处理，避免空释义的 200 被永久缓存
  if (!definitions.length) {
    return { notFound: true, suggestions: [] }
  }

  return {
    lemma: (entry.hwi?.hw || word).replace(/\*/g, ''), // hw 里的 * 是音节分隔符
    phonetic: prs?.mw || '',
    partOfSpeech: entry.fl || '',
    definitions,
    audioUrl: mwAudioUrl(prs?.sound?.audio)
  }
}

/** M-W 音频文件名 → 完整 URL（子目录规则见 dictionaryapi.com 文档） */
function mwAudioUrl(audio) {
  if (!audio) return ''
  let subdir
  if (audio.startsWith('bix')) subdir = 'bix'
  else if (audio.startsWith('gg')) subdir = 'gg'
  else if (/^[^a-zA-Z]/.test(audio)) subdir = 'number'
  else subdir = audio[0]
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`
}
