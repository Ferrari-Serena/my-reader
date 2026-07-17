/**
 * my-reader Dictionary Worker
 * Merriam-Webster Collegiate 词典代理 + D1 边缘缓存。
 * 解决国内直连 M-W API 3-4 秒延迟的问题；查过的词全体用户共享缓存。
 *
 * GET /api/dict/<word>  → { lemma, phonetic, partOfSpeech, definitions[], audioUrl }
 *                         未收录时 → 404 { notFound: true, suggestions[] }
 * GET /health           → { status: 'ok' }
 *
 * 绑定：env.DB = D1 数据库（表见 schema.sql）；env.MW_API_KEY = wrangler secret
 */

const MW_API_BASE = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extra }
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok' })
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
          return json(payload, payload.notFound ? 404 : 200, { 'X-Cache': 'hit' })
        }

        // 2. 查 M-W API（trim 防御 secret 值里混入的换行/空白）
        const apiKey = (env.MW_API_KEY || '').trim()
        const resp = await fetch(`${MW_API_BASE}${encodeURIComponent(word)}?key=${apiKey}`)
        if (!resp.ok) {
          return json({ error: `M-W API ${resp.status}` }, 502)
        }
        const text = await resp.text()
        let data
        try {
          data = JSON.parse(text)
        } catch {
          // M-W 的鉴权错误是纯文本（"Invalid API key" 等），不是 JSON
          console.error('M-W non-JSON response:', text.slice(0, 100))
          return json({ error: 'M-W API error' }, 502)
        }
        const payload = parseMW(word, data)

        // 3. 写缓存（未收录也缓存，节省 M-W 免费额度；写失败不影响返回）
        try {
          await env.DB
            .prepare('INSERT OR REPLACE INTO dict_cache (word, payload, fetched_at) VALUES (?, ?, ?)')
            .bind(word, JSON.stringify(payload), Date.now())
            .run()
        } catch (e) {
          console.error('D1 write failed:', e.message)
        }

        return json(payload, payload.notFound ? 404 : 200, { 'X-Cache': 'miss' })
      } catch (err) {
        console.error('dict error:', err.message, err.stack)
        return json({ error: 'lookup failed' }, 500)
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
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
