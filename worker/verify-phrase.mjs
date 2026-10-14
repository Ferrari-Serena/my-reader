/**
 * Worker 词组云端终判纯逻辑验证。
 * 用法: node verify-phrase.mjs
 *
 * 不触网：模型调用用 fetch 替身；D1 不在本文件真跑（表结构在 verify-sql.mjs 真跑）。
 */

import {
  ROUTE_PATH,
  parsePhrasePayload,
  cleanPhraseSenses,
  canonicalPhrasePayload,
  phraseCacheKey,
  phraseLlmConfig,
  rankFromModelText,
  callPhraseLlm,
  handlePhraseResolve,
} from './src/phrase.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const BASE = 'https://my-reader.ferrari11.com'

const GOOD_SENSES = [
  { rank: 1, zh: '解释；说明（原因）' },
  { rank: 2, zh: '占（比例）；构成' },
]
const GOOD_BODY = {
  bookId: 'divergent',
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
  t('rank 非整数拒', parsePhrasePayload({ ...GOOD_BODY, senses: [{ rank: '1', zh: 'x' }, { rank: 2, zh: 'y' }] }).error)
  t('zh 非字符串拒', parsePhrasePayload({ ...GOOD_BODY, senses: [{ rank: 1, zh: 1 }, { rank: 2, zh: 'y' }] }).error)
  t('缺 sentence 拒', parsePhrasePayload({ ...GOOD_BODY, sentence: '  ' }).error)
  t('start 非整数拒', parsePhrasePayload({ ...GOOD_BODY, start: '3' }).error)
  t('end < start 拒', parsePhrasePayload({ ...GOOD_BODY, start: 8, end: 4 }).error)
  t('senses 超过 12 拒', parsePhrasePayload({
    ...GOOD_BODY,
    senses: Array.from({ length: 13 }, (_, i) => ({ rank: i + 1, zh: '义项' + (i + 1) })),
  }).error)
}

console.log('\n[cleanPhraseSenses — 与前端同口径]')
{
  t('干净数组保留 rank/zh 两个字段', JSON.stringify(cleanPhraseSenses(GOOD_SENSES)) === JSON.stringify(GOOD_SENSES))
  t('zh 截断到 160 字', cleanPhraseSenses([{ rank: 1, zh: 'a'.repeat(200) }, { rank: 2, zh: 'b' }])[0].zh.length === 160)
  t('zh 前后空白被清', cleanPhraseSenses([{ rank: 1, zh: '  x  ' }, { rank: 2, zh: 'y' }])[0].zh === 'x')
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
  t('BYO 键带 user:<id>: 前缀', (await phraseCacheKey(p, 'u_1')).startsWith('user:u_1:'))
  t('BYO 与公开同载荷不同键', k1 !== await phraseCacheKey(p, 'u_1'))
}

console.log('\n[phraseLlmConfig — 三要素齐备才算可用]')
{
  t('三要素齐备 ready', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x/v1/chat/completions', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }).ready === true)
  t('缺 key 不可用', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_MODEL: 'm' }).ready === false)
  t('缺 model 不可用', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_API_KEY: 'k' }).ready === false)
  t('base 末尾斜杠被裁掉', phraseLlmConfig({ PHRASE_LLM_BASE_URL: 'https://x/', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }).base === 'https://x')
}

console.log('\n[rankFromModelText — 只认候选 rank]')
{
  const senses = [{ rank: 1, zh: 'a' }, { rank: 3, zh: 'c' }, { rank: 12, zh: 'l' }]
  t('裸整数', rankFromModelText('3', senses) === 3)
  t('带标点', rankFromModelText('Answer: 3.', senses) === 3)
  t('候选中没有的整数不认', rankFromModelText('2', senses) === null)
  t('空输出不认', rankFromModelText('', senses) === null)
  t('非字符串不认', rankFromModelText(null, senses) === null)
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
  t('模型输出被解析成 rank', good.ok === true && good.rank === 2)
  t('请求打到 base URL', seenUrl === 'https://x/v1/chat/completions')
  t('system 提示词要求只回整数', seenBody.messages[0].content.includes('integer'))
  t('user 消息带句子与候选义项', seenBody.messages[1].content.includes('account for') && seenBody.messages[1].content.includes('解释'))

  const badStatus = await callPhraseLlm({ PHRASE_LLM_BASE_URL: 'https://x', PHRASE_LLM_API_KEY: 'k', PHRASE_LLM_MODEL: 'm' }, payload, {
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  })
  t('上游 429 如实回 429', badStatus.ok === false && badStatus.status === 429)
}

console.log('\n[handlePhraseResolve — 路由闸]')
{
  const env = { DB: null }
  const req = (path, method = 'POST', body = GOOD_BODY) => new Request(`https://my-reader.ferrari11.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://my-reader.ferrari11.com' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
  const miss = await handlePhraseResolve(req('/api/dict/word'), env)
  t('不匹配路径回 null（路由继续 fallthrough）', miss === null)

  const noConfig = await handlePhraseResolve(req(ROUTE_PATH), { DB: null })
  t('未配模型回 503 unavailable', noConfig.status === 503 && (await noConfig.json()).status === 'unavailable')

  const bad = await handlePhraseResolve(req(ROUTE_PATH, 'POST', { senses: [] }), { DB: null })
  t('非法载荷回 400 invalid', bad.status === 400 && (await bad.json()).status === 'invalid')
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
  console.log = prevLog
  t('未配模型从真入口进来 → 503而不是兜底 404', post.status === 503 && (await post.json()).status === 'unavailable')
  t('非 POST 从真入口进来 → 405', noModel.status === 405)
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
