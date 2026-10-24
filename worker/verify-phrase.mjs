/**
 * Worker 词组云端终判纯逻辑验证。
 * 用法: node verify-phrase.mjs
 *
 * 不触网：模型调用用 fetch 替身；D1 不在本文件真跑（表结构在 verify-sql.mjs 真跑）。
 */

import {
  ROUTE_PATH,
  CONFIG_PATH,
  parsePhrasePayload,
  cleanPhraseSenses,
  canonicalPhrasePayload,
  phraseCacheKey,
  phraseCacheVersions,
  phrasePublicBookIds,
  DEFAULT_PUBLIC_BOOK_IDS,
  CACHE_SCHEMA_VERSION,
  PROMPT_VERSION,
  LEXICON_VERSION,
  phraseLlmConfig,
  phraseConfigPayload,
  parseModelDecision,
  rankFromModelText,
  callPhraseLlm,
  handlePhraseResolve,
  handlePhraseConfig,
} from './src/phrase.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const BASE = 'https://my-reader.ferrari11.com'

const GOOD_SENSES = [
  { id: 'account for#account_for.v.01', rank: 1, zh: '解释；说明（原因）' },
  { id: 'account for#account_for.v.02', rank: 2, zh: '占（比例）；构成' },
]
const GOOD_BODY = {
  bookId: 'dr-jekyll-and-mr-hyde',
  chapterId: 'ch-25',
  paragraphId: 'p-25-003',
  start: 3,
  end: 4,
  phrase: 'account for',
  sentence: 'This does not account for the delay.',
  senses: GOOD_SENSES,
}

console.log('\n[parsePhrasePayload — 白名单净化]')
{
  const r = parsePhrasePayload(GOOD_BODY)
  t('合法载荷被收下', r.payload && r.payload.phrase === 'account for')
  t('多余字段被丢弃（不出现在载荷）', r.payload && !('extra' in r.payload) && !('zh' in r.payload))
  t('start/end 原样保留', r.payload && r.payload.start === 3 && r.payload.end === 4)
  t('字符串字段被 trim 并限长', parsePhrasePayload({ ...GOOD_BODY, phrase: '  abc  ' }).payload.phrase === 'abc')
}

console.log('\n[parsePhrasePayload — 非法形状]')
{
  t('空 body 拒', parsePhrasePayload(null).error)
  t('少 senses 拒', parsePhrasePayload({ ...GOOD_BODY, senses: [] }).error)
  t('单义项拒', parsePhrasePayload({ ...GOOD_BODY, senses: [GOOD_SENSES[0]] }).error)
  t('重复 rank 拒', parsePhrasePayload({ ...GOOD_BODY, senses: [GOOD_SENSES[0], GOOD_SENSES[0]] }).error)
  t('缺 id 拒', parsePhrasePayload({ ...GOOD_BODY, senses: [{ rank: 1, zh: 'x' }, GOOD_SENSES[1]] }).error)
  t('重复 id 拒', parsePhrasePayload({ ...GOOD_BODY, senses: [GOOD_SENSES[0], { ...GOOD_SENSES[1], id: GOOD_SENSES[0].id }] }).error)
  t('rank 非整数拒', parsePhrasePayload({ ...GOOD_BODY, senses: [{ id: 'a', rank: '1', zh: 'x' }, { id: 'b', rank: 2, zh: 'y' }] }).error)
  t('zh 非字符串拒', parsePhrasePayload({ ...GOOD_BODY, senses: [{ id: 'a', rank: 1, zh: 1 }, { id: 'b', rank: 2, zh: 'y' }] }).error)
  t('缺 sentence 拒', parsePhrasePayload({ ...GOOD_BODY, sentence: '  ' }).error)
  t('start 非整数拒', parsePhrasePayload({ ...GOOD_BODY, start: '3' }).error)
  t('end < start 拒', parsePhrasePayload({ ...GOOD_BODY, start: 8, end: 4 }).error)
  t('senses 超过 12 拒', parsePhrasePayload({
    ...GOOD_BODY,
    senses: Array.from({ length: 13 }, (_, i) => ({ id: 's' + i, rank: i + 1, zh: '义项' + (i + 1) })),
  }).error)
}

console.log('\n[cleanPhraseSenses — 与前端同口径]')
{
  t('干净数组保留 id/rank/zh 三个字段', JSON.stringify(cleanPhraseSenses(GOOD_SENSES)) === JSON.stringify(GOOD_SENSES))
  t('zh 截断到 160 字', cleanPhraseSenses([{ id: 'a', rank: 1, zh: 'a'.repeat(200) }, { id: 'b', rank: 2, zh: 'b' }])[0].zh.length === 160)
  t('zh 前后空白被清', cleanPhraseSenses([{ id: 'a', rank: 1, zh: '  x  ' }, { id: 'b', rank: 2, zh: 'y' }])[0].zh === 'x')
  t('id 前后空白被清', cleanPhraseSenses([{ id: '  a  ', rank: 1, zh: 'x' }, { id: 'b', rank: 2, zh: 'y' }])[0].id === 'a')
  t('非数组回 null', cleanPhraseSenses('x') === null)
}

console.log('\n[canonicalPhrasePayload / phraseCacheKey — 摘要不落可读句子]')
{
  const p = parsePhrasePayload(GOOD_BODY).payload
  const c = canonicalPhrasePayload(p)
  t('canonical 是稳定 JSON', c.startsWith('[') && c.includes('account for'))
  const k1 = await phraseCacheKey(p, '')
  const k2 = await phraseCacheKey(p, '')
  t('同载荷同用户生成同键', k1 === k2)
  t('公开键带 public: 前缀', k1.startsWith('public:'))
  t('BYO 键带 user:<id>: 前缀', (await phraseCacheKey(p, { userId: 'u_1' })).startsWith('user:u_1:'))
  t('BYO 与公开同载荷不同键', k1 !== await phraseCacheKey(p, { userId: 'u_1' }))

  const base = phraseCacheVersions({}, 'model-a')
  const withModel = await phraseCacheKey(p, base)
  t('模型版本进入缓存键', withModel !== await phraseCacheKey(p, { ...base, model: 'model-b' }))
  t('prompt 版本进入缓存键', withModel !== await phraseCacheKey(p, { ...base, prompt: 'p3' }))
  t('词表版本进入缓存键', withModel !== await phraseCacheKey(p, { ...base, lexicon: 'l2' }))
  t('schema 版本进入缓存键', withModel !== await phraseCacheKey(p, { ...base, schema: 'v3' }))
  const senseChanged = parsePhrasePayload({
    ...GOOD_BODY,
    senses: [{ ...GOOD_SENSES[0], id: 'account for#account_for.v.99' }, GOOD_SENSES[1]],
  }).payload
  t('sense id 进入缓存键', withModel !== await phraseCacheKey(senseChanged, base))
}

console.log('\n[公开书白名单 — 与 book-index.json 同口径]')
{
  const index = JSON.parse(readFileSync(new URL('../reader/public/books/book-index.json', import.meta.url), 'utf8'))
  const fromIndex = index.books.filter(b => b.visibility === 'public').map(b => b.id)
  t('代码默认白名单与公开书单逐项一致',
    JSON.stringify([...DEFAULT_PUBLIC_BOOK_IDS].sort()) === JSON.stringify(fromIndex.sort()))
  t('公开书可识别', phrasePublicBookIds({}).has('dr-jekyll-and-mr-hyde') === true)
  t('未在书单的 slug 不可识别', phrasePublicBookIds({}).has('divergent') === false)
  t('环境变量可覆盖白名单', phrasePublicBookIds({ PHRASE_PUBLIC_BOOK_IDS: 'a, b' }).has('b') === true)
}

console.log('\n[phraseLlmConfig — 三要素齐备才算可用]')
{
  t('三要素齐备 ready', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x/v1/chat/completions', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }).ready === true)
  t('缺 key 不可用', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_MODEL: 'm' }).ready === false)
  t('缺 model 不可用', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_API_KEY: 'k' }).ready === false)
  t('base 末尾斜杠被裁掉', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x/', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }).base === 'https://x')
}

console.log('\n[phraseConfigPayload / handlePhraseConfig — 前端缓存代际]')
{
  const env = {
    PHRASE_LLM_BASE_URL: 'https://llm.example/v1/chat/completions',
    PHRASE_LLM_API_KEY: 'super-secret',
    PHRASE_LLM_MODEL: 'model-m2',
    PHRASE_CACHE_SCHEMA_VERSION: 'v9',
    PHRASE_PROMPT_VERSION: 'p9',
    PHRASE_LEXICON_VERSION: 'l9',
  }
  const payload = phraseConfigPayload(env)
  t('配置载荷含 ready 与四元版本', payload.ready === true && payload.versions.schema === 'v9' && payload.versions.model === 'model-m2' && payload.versions.prompt === 'p9' && payload.versions.lexicon === 'l9')
  t('配置载荷不含密钥或地址', !JSON.stringify(payload).includes('super-secret') && !JSON.stringify(payload).includes('llm.example'))

  const req = (path, method = 'GET') => new Request(`https://my-reader.ferrari11.com${path}`, {
    method,
    headers: { Origin: 'https://my-reader.ferrari11.com' },
  })
  const ok = await handlePhraseConfig(req(CONFIG_PATH), env)
  const okBody = await ok.json()
  t('GET 配置 → 200 + 版本', ok.status === 200 && okBody.versions.model === 'model-m2')
  t('配置响应 no-store', ok.headers.get('Cache-Control') === 'no-store')

  const wrongMethod = await handlePhraseConfig(req(CONFIG_PATH, 'POST'), env)
  t('非 GET → 405', wrongMethod.status === 405)
  t('别的路径回 null（路由继续 fallthrough）', await handlePhraseConfig(req('/api/dict/word'), env) === null)
}

console.log('\n[parseModelDecision — 只认精确输出]')
{
  const senses = [{ id: 'a', rank: 1, zh: 'a' }, { id: 'c', rank: 3, zh: 'c' }, { id: 'l', rank: 12, zh: 'l' }]
  t('裸整数', parseModelDecision('3', senses).status === 'cloud' && parseModelDecision('3', senses).rank === 3)
  t('ABSTAIN 明确放弃', parseModelDecision('ABSTAIN', senses).status === 'uncertain' && parseModelDecision('ABSTAIN', senses).confidence === 'uncertain')
  t('上下文不足单独标记', parseModelDecision('INSUFFICIENT_CONTEXT', senses).confidence === 'insufficient_context')
  t('带解释的输出一律不认', rankFromModelText('2, but 3 also possible', senses) === null)
  t('带标点的输出不认', rankFromModelText('Answer: 3.', senses) === null)
  t('候选中没有的整数不认', rankFromModelText('2', senses) === null)
  t('空输出不认', rankFromModelText('', senses) === null)
  t('非字符串不认', rankFromModelText(null, senses) === null)
  t('ABSTAIN 不带 rank', parseModelDecision('ABSTAIN', senses).rank === null)
  t('INSUFFICIENT_CONTEXT 不带 rank', parseModelDecision('INSUFFICIENT_CONTEXT', senses).rank === null)
  t('版本常量已定义', CACHE_SCHEMA_VERSION === 'v2' && PROMPT_VERSION === 'p2-abstain' && LEXICON_VERSION === 'l1')
}

console.log('\n[callPhraseLlm — 用替身 fetch 走 OpenAI-compatible 协议]')
{
  const payload = parsePhrasePayload(GOOD_BODY).payload
  const noFetch = await callPhraseLlm({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }, payload, {
    fetchImpl: async () => { throw new Error('network down') }
  })
  t('网络异常恒不抛、如实失败', noFetch.ok === false && noFetch.status === 0)

  let seenUrl = '', seenBody = null
  const okFetch = async (url, init) => {
    seenUrl = url
    seenBody = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '2' } }] }) }
  }
  const good = await callPhraseLlm({ PHRASE_LLM_BASE_URL: 'https://x/v1/chat/completions', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }, payload, { fetchImpl: okFetch })
  t('模型输出被解析成确定 rank', good.ok === true && good.status === 'cloud' && good.rank === 2 && good.confidence === 'certain')
  t('请求打到 base URL', seenUrl === 'https://x/v1/chat/completions')
  t('system 提示词允许 ABSTAIN', seenBody.messages[0].content.includes('ABSTAIN'))
  t('system 提示词声明句子只是数据', seenBody.messages[0].content.includes('quoted data'))
  t('user 消息带句子与候选义项', seenBody.messages[1].content.includes('account for') && seenBody.messages[1].content.includes('解释'))
  t('max_tokens 收到 8', seenBody.max_tokens === 8)

  const badStatus = await callPhraseLlm({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }, payload, {
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  })
  t('上游 429 如实回 429', badStatus.ok === false && badStatus.status === 429)
}

console.log('\n[handlePhraseResolve — 路由闸]')
{
  const fakeDb = ({ cacheRow = null, cacheError = false, rateRow = { ip_n: 0, day_n: 0 }, rateError = false, insertError = false } = {}) => ({
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() {
          if (sql.includes('FROM phrase_cloud_cache')) {
            if (cacheError) throw new Error('cache down')
            return cacheRow
          }
          if (sql.includes('FROM phrase_rate_events')) {
            if (rateError) throw new Error('rate down')
            return rateRow
          }
          return null
        },
        async run() {
          if (insertError && sql.includes('INSERT INTO phrase_rate_events')) throw new Error('insert down')
          return { meta: { changes: 1 } }
        },
      }
      return stmt
    },
  })
  const cfg = {
    PHRASE_LLM_BASE_URL: 'https://llm.example/v1/chat/completions',
    PHRASE_LLM_API_KEY: 'k',
    PHRASE_LLM_MODEL: 'm',
  }
  const authEnv = { ...cfg, DB: fakeDb() }
  const req = (path, method = 'POST', body = GOOD_BODY) => new Request(`https://my-reader.ferrari11.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://my-reader.ferrari11.com',
      'CF-Connecting-IP': '203.0.113.10',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
  const miss = await handlePhraseResolve(req('/api/dict/word'), authEnv)
  t('不匹配路径回 null（路由继续 fallthrough）', miss === null)

  const noConfig = await handlePhraseResolve(req(ROUTE_PATH), { DB: null })
  t('未配模型回 503 unavailable', noConfig.status === 503 && (await noConfig.json()).status === 'unavailable')

  const bad = await handlePhraseResolve(req(ROUTE_PATH, 'POST', { senses: [] }), { DB: null })
  t('非法载荷回 400 invalid', bad.status === 400 && (await bad.json()).status === 'invalid')

  let modelCalls = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    modelCalls++
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '1' } }] }) }
  }
  try {
    const fakeBook = await handlePhraseResolve(req(ROUTE_PATH, 'POST', { ...GOOD_BODY, bookId: 'x' }), authEnv)
    t('伪造公开书 id → 400，不是 429', fakeBook.status === 400 && (await fakeBook.json()).error === 'unknown book')
    t('伪造书 id 不触发模型', modelCalls === 0)

    const byo = await handlePhraseResolve(req(ROUTE_PATH, 'POST', { ...GOOD_BODY, bookId: 'bk_0123456789abcdef' }), authEnv)
    t('BYO 书未登录 → 401', byo.status === 401 && (await byo.json()).status === 'unauthorized')

    const hit = await handlePhraseResolve(req(ROUTE_PATH), {
      ...authEnv,
      DB: fakeDb({ cacheRow: { rank: 2 } }),
    })
    const hitBody = await hit.json()
    t('公开书缓存命中 → certain + cache', hit.status === 200 && hitBody.rank === 2 && hitBody.confidence === 'certain' && hitBody.source === 'cache')
    t('缓存命中不调模型', modelCalls === 0)

    const fresh = await handlePhraseResolve(req(ROUTE_PATH), authEnv)
    const freshBody = await fresh.json()
    t('公开书模型命中 → certain + model', fresh.status === 200 && freshBody.rank === 1 && freshBody.confidence === 'certain' && freshBody.source === 'model')
    t('真正调模型一次', modelCalls === 1)

    const hitDespiteLimits = await handlePhraseResolve(req(ROUTE_PATH), {
      ...authEnv,
      PHRASE_RATE_PER_MIN: '1',
      PHRASE_DAILY_LIMIT: '1',
      DB: fakeDb({ cacheRow: { rank: 2 }, rateRow: { ip_n: 99, day_n: 99 } }),
    })
    t('缓存命中不消耗限流额度（即使账本已满也放行）',
      hitDespiteLimits.status === 200 && (await hitDespiteLimits.json()).source === 'cache')

    const limited = await handlePhraseResolve(req(ROUTE_PATH), {
      ...authEnv,
      PHRASE_RATE_PER_MIN: '1',
      DB: fakeDb({ rateRow: { ip_n: 1, day_n: 1 } }),
    })
    const limitedBody = await limited.json()
    t('超过每 IP 窗口 → 429', limited.status === 429 && limitedBody.status === 'rate_limited' && limitedBody.scope === 'ip')
    t('429 带 Retry-After', limited.headers.get('Retry-After') === '60')
    t('429 不调模型', modelCalls === 1)

    const dailyLimited = await handlePhraseResolve(req(ROUTE_PATH), {
      ...authEnv,
      PHRASE_RATE_PER_MIN: '99',
      PHRASE_DAILY_LIMIT: '1',
      DB: fakeDb({ rateRow: { ip_n: 0, day_n: 1 } }),
    })
    const dailyBody = await dailyLimited.json()
    t('超过全局日配额 → 429 quota',
      dailyLimited.status === 429 && dailyBody.status === 'rate_limited' && dailyBody.scope === 'quota')
    t('日配额 429 也带 Retry-After', Number(dailyLimited.headers.get('Retry-After')) > 0)
    t('日配额拦截不调模型', modelCalls === 1)

    const cacheDown = await handlePhraseResolve(req(ROUTE_PATH), { ...authEnv, DB: fakeDb({ cacheError: true }) })
    t('D1 缓存读失败 → fail-closed 503', cacheDown.status === 503 && (await cacheDown.json()).status === 'unavailable')

    const rateDown = await handlePhraseResolve(req(ROUTE_PATH), { ...authEnv, DB: fakeDb({ rateError: true }) })
    t('限流读失败 → fail-closed 503', rateDown.status === 503 && (await rateDown.json()).status === 'unavailable')

    const insertDown = await handlePhraseResolve(req(ROUTE_PATH), { ...authEnv, DB: fakeDb({ insertError: true }) })
    t('限流写失败 → fail-closed 503', insertDown.status === 503 && (await insertDown.json()).status === 'unavailable')
  } finally {
    globalThis.fetch = origFetch
  }
}


console.log('\n[index.js 接线 — 真入口分发到 /api/phrase/resolve]')
{
  const worker = (await import('./src/index.js')).default
  const prevLog = console.log
  console.log = () => {}
  const body = JSON.stringify(GOOD_BODY)
  const post = await worker.fetch(new Request(`${BASE}/api/phrase/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body,
  }), {})
  const noModel = await worker.fetch(new Request(`${BASE}/api/phrase/resolve`), {})
  const config = await worker.fetch(new Request(`${BASE}/api/phrase/config`), {})
  console.log = prevLog
  t('未配模型从真入口进来 → 503而不是兜底 404', post.status === 503 && (await post.json()).status === 'unavailable')
  t('非 POST 从真入口进来 → 405', noModel.status === 405)
  const configBody = await config.json()
  t('配置端点从真入口进来 → 200 + 内置版本', config.status === 200 && configBody.versions.schema === CACHE_SCHEMA_VERSION)
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
