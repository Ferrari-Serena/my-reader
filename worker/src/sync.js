/**
 * my-reader 跨设备数据同步端点
 *
 * POST /api/sync/create        → 生成 8 位随机同步码
 * POST /api/sync/push          → body: { code, words: { lemma: entry, ... } }
 *                                 对每个词 INSERT OR REPLACE（updated_at 比较）
 * GET  /api/sync/pull?code=X   → 全量拉取 { words, updatedAt }
 *
 * 合并策略由前端执行（last-write-wins per word）。
 */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉了容易混淆的 0/O/1/I
const CODE_LEN = 8

function randCode() {
  const buf = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join('')
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  })
}

/**
 * 主入口：根据 pathname 分发到子处理器
 * 仅在 method + path 匹配时调用；不匹配时返回 null 让主路由继续 fallthrough
 */
export async function handleSync(request, env) {
  const url = new URL(request.url)

  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: json('').headers })
  }

  // POST /api/sync/create
  if (request.method === 'POST' && url.pathname === '/api/sync/create') {
    const code = randCode()
    // 插入一条空占位（也可直接依赖 push 的第一批数据，但无占位则无法配对校验）
    await env.DB.prepare(
      'INSERT OR IGNORE INTO sync_data (code, word, payload, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(code, '__meta__', JSON.stringify({ created: Date.now() }), new Date().toISOString()).run()
    return json({ code })
  }

  // POST /api/sync/push
  if (request.method === 'POST' && url.pathname === '/api/sync/push') {
    let body
    try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }
    const { code, words } = body || {}
    if (!code || typeof code !== 'string' || !words || typeof words !== 'object') {
      return json({ error: 'missing code or words' }, 400)
    }

    const stmt = env.DB.prepare(
      'INSERT OR REPLACE INTO sync_data (code, word, payload, updated_at) VALUES (?, ?, ?, ?)'
    )
    const batch = []
    let accepted = 0, skipped = 0
    for (const [word, entry] of Object.entries(words)) {
      if (word === '__proto__' || word === 'constructor') continue
      const ts = entry.addedAt || entry.updatedAt || new Date().toISOString()
      // updated_at 比较：只有新版本才覆盖（前端已做 merge，此处为多设备并发写兜底）
      // 简化处理：直接 UPRSERT；真正的冲突解决在拉取时由客户端 merge 完成
      batch.push(stmt.bind(code, word.toLowerCase(), JSON.stringify(entry), ts))
      accepted++
    }

    try {
      await env.DB.batch(batch)
    } catch (e) {
      console.error('sync push batch error:', e.message)
      return json({ error: 'db write failed' }, 500)
    }
    return json({ accepted, skipped })
  }

  // GET /api/sync/pull?code=X
  if (request.method === 'GET' && url.pathname === '/api/sync/pull') {
    const code = (url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!code || code.length !== CODE_LEN) {
      return json({ error: 'invalid code' }, 400)
    }

    try {
      const { results } = await env.DB.prepare(
        'SELECT word, payload, updated_at FROM sync_data WHERE code = ? AND word != ?'
      ).bind(code, '__meta__').all()
      const words = {}
      let latest = ''
      for (const row of results) {
        try {
          words[row.word] = JSON.parse(row.payload)
        } catch { /* 损坏行跳过 */ }
        if (row.updated_at > latest) latest = row.updated_at
      }
      return json({ words, updatedAt: latest || new Date().toISOString() })
    } catch (e) {
      console.error('sync pull error:', e.message)
      return json({ error: 'db read failed' }, 500)
    }
  }

  return null // 不匹配任何同步端点，让主路由继续
}
