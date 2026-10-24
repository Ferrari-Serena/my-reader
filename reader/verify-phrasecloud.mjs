/**
 * 词组「运行时云端终判」前端纯逻辑验证。
 * 用法: node verify-phrasecloud.mjs
 *
 * 不触网：fetch / localStorage 都用替身；浏览器 globals 不出现在被验证函数内。
 */

import {
  cloudNeeded,
  buildCloudPayload,
  cloudCacheKey,
  readCloudCache,
  writeCloudCache,
  pruneCloudCache,
  cloudAnswerFromResponse,
  cloudRankFromResponse,
  resolveCloudSense,
  fetchCloudVersions,
  resetCloudVersionsCache,
  DEFAULT_CLOUD_VERSIONS,
  CLOUD_CACHE_PREFIX,
  CLOUD_CONFIG_PATH,
  CLOUD_VERSIONS_STORAGE_KEY,
  CLOUD_CACHE_SCHEMA_VERSION,
  CLOUD_CACHE_MODEL_VERSION,
  CLOUD_CACHE_PROMPT_VERSION,
  CLOUD_CACHE_LEXICON_VERSION,
  CLOUD_CLIENT_VERSION,
} from './src/utils/phraseCloud.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const SENSES = [
  { id: 'account for#account_for.v.01', rank: 1, zh: '解释；说明（原因）', cue: 'should-not-be-sent' },
  { id: 'account for#account_for.v.02', rank: 2, zh: '占（比例）；构成' },
]
const INPUT = {
  bookId: 'divergent',
  chapterId: 'ch-25',
  paragraphId: 'p-25-003',
  start: 3,
  end: 4,
  phrase: 'account for',
  sentence: 'This does not account for the delay.',
  senses: SENSES,
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() { return map.size },
    key(i) { return Array.from(map.keys())[i] ?? null },
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(String(k), String(v)) },
    removeItem(k) { map.delete(k) },
    _dump() { return Object.fromEntries(map) },
  }
}

console.log('\n[cloudNeeded — 只有多义且未被静态/L1 解决时才问云端]')
{
  t('多义 + 无 resolution → 需要', cloudNeeded(SENSES, null) === true)
  t('多义 + zero → 需要', cloudNeeded(SENSES, { state: 'zero', rank: null, hits: [] }) === true)
  t('多义 + multi → 需要', cloudNeeded(SENSES, { state: 'multi', rank: null, hits: [] }) === true)
  t('多义 + fallback → 需要（fallback 不打星）', cloudNeeded(SENSES, { state: 'fallback', rank: 1, hits: [] }) === true)
  t('已 unique → 不需要', cloudNeeded(SENSES, { state: 'unique', rank: 1, hits: [] }) === false)
  t('已 annotated → 不需要', cloudNeeded(SENSES, { state: 'annotated', rank: 1, hits: [] }) === false)
  t('单义项 → 不需要', cloudNeeded([SENSES[0]], { state: 'zero' }) === false)
}

console.log('\n[buildCloudPayload — 前端净化]')
{
  const p = buildCloudPayload(INPUT)
  t('合法载荷被收下', p && p.phrase === 'account for')
  t('载荷带当前客户端版本', p && p.clientVersion === CLOUD_CLIENT_VERSION)
  t('senses 只保留 id + rank + zh（cue 被剪掉）', p.senses.every(s => Object.keys(s).join(',') === 'id,rank,zh'))
  t('多余字段不出现', p && !('sentenceRaw' in p) && !('extra' in p))
  t('缺 start/end 拒', buildCloudPayload({ ...INPUT, start: undefined }) === null)
  t('单义项拒', buildCloudPayload({ ...INPUT, senses: [SENSES[0]] }) === null)
  t('重复 rank 拒', buildCloudPayload({ ...INPUT, senses: [SENSES[0], SENSES[0]] }) === null)
  t('重复 sense id 拒', buildCloudPayload({ ...INPUT, senses: [SENSES[0], { ...SENSES[1], id: SENSES[0].id }] }) === null)
  t('sentence 超长被截断', buildCloudPayload({ ...INPUT, sentence: 'a'.repeat(2000) }).sentence.length === 1200)
}

console.log('\n[cloudCacheKey / readCloudCache / writeCloudCache]')
{
  const p = buildCloudPayload(INPUT)
  const storage = fakeStorage()
  const key = cloudCacheKey(p)
  t('缓存键含 schema / model / prompt / lexicon 版本',
    key.includes(CLOUD_CACHE_SCHEMA_VERSION) &&
    key.includes(CLOUD_CACHE_MODEL_VERSION) &&
    key.includes(CLOUD_CACHE_PROMPT_VERSION) &&
    key.includes(CLOUD_CACHE_LEXICON_VERSION))
  t('空缓存未命中回 undefined', readCloudCache(storage, p) === undefined)
  writeCloudCache(storage, p, 2)
  t('写后命中 rank', readCloudCache(storage, p) === 2)
  t('缓存键有前缀', Object.keys(storage._dump()).every(k => k.startsWith(CLOUD_CACHE_PREFIX)))

  const other = buildCloudPayload({ ...INPUT, sentence: 'Another sentence.' })
  t('不同句子不是同一条缓存', readCloudCache(storage, other) === undefined)
  writeCloudCache(storage, other, 1)
  t('两条并存', Object.keys(storage._dump()).length === 2)

  const legacyKey = 'mr.phrase.cloud.' + 'legacy-answer'
  storage.setItem(legacyKey, JSON.stringify({ rank: 1, at: 1 }))
  t('旧前缀缓存不会被当作新缓存命中', readCloudCache(storage, p) === 2)
  pruneCloudCache(storage)
  t('prune 会清掉旧前缀缓存', !Object.keys(storage._dump()).includes(legacyKey))
}

console.log('\n[pruneCloudCache — 容量只留最近 MAX 条]')
{
  const storage = fakeStorage()
  for (let i = 0; i < 205; i++) {
    const p = buildCloudPayload({ ...INPUT, paragraphId: 'p-' + i, sentence: `Sentence ${i}.` })
    writeCloudCache(storage, p, (i % 2) + 1)
  }
  t('写入 205 条后被裁到 200', Object.keys(storage._dump()).length === 200)
}

console.log('\n[cloudAnswerFromResponse — 三代 Worker 兼容]')
{
  const selected = cloudAnswerFromResponse({ status: 'cloud', confidence: 'selected', rank: 2, source: 'model' }, SENSES)
  t('新响应 selected + model', selected && selected.rank === 2 && selected.source === 'model')
  const cached = cloudAnswerFromResponse({ status: 'cloud', confidence: 'selected', rank: 2, source: 'cache' }, SENSES)
  t('新响应 selected + cache', cached && cached.rank === 2 && cached.source === 'cache')
  const certain = cloudAnswerFromResponse({ status: 'cloud', confidence: 'certain', rank: 2, source: 'model' }, SENSES)
  t('第 0 步首版 certain 仍认', certain && certain.rank === 2 && certain.source === 'model')
  const legacy = cloudAnswerFromResponse({ status: 'cloud', rank: 2 }, SENSES)
  t('旧 Worker 缺 confidence → legacy，不当确定', legacy && legacy.rank === 2 && legacy.source === 'legacy')
  t('旧接口仍能取 rank', cloudRankFromResponse({ status: 'cloud', confidence: 'selected', rank: 2 }, SENSES) === 2)
  t('缺 status 不认', cloudAnswerFromResponse({ confidence: 'selected', rank: 2 }, SENSES) === null)
  t('uncertain 不认', cloudAnswerFromResponse({ status: 'cloud', confidence: 'uncertain', rank: 2 }, SENSES) === null)
  t('表外 rank 不认', cloudAnswerFromResponse({ status: 'cloud', confidence: 'selected', rank: 9 }, SENSES) === null)
  t('非整数不认', cloudAnswerFromResponse({ status: 'cloud', confidence: 'selected', rank: '2' }, SENSES) === null)
  t('非对象不认', cloudRankFromResponse(null, SENSES) === null)
}

console.log('\n[fetchCloudVersions — 本地缓存跟随服务端模型代际]')
{
  resetCloudVersionsCache()
  const storage = fakeStorage()
  const serverVersions = { schema: 'v3', model: 'm2', prompt: 'p3', lexicon: 'l2' }
  let configCalls = 0
  let seenUrl = ''
  const fetchImpl = async (url) => {
    configCalls++
    seenUrl = url
    return { ok: true, status: 200, json: async () => ({ versions: serverVersions }) }
  }
  const got = await fetchCloudVersions({ storage, fetchImpl })
  t('从配置端读到版本元组', JSON.stringify(got) === JSON.stringify(serverVersions))
  t('配置请求打 /api/phrase/config', seenUrl === CLOUD_CONFIG_PATH)
  t('版本写入 localStorage', !!storage.getItem(CLOUD_VERSIONS_STORAGE_KEY))

  resetCloudVersionsCache()
  const again = await fetchCloudVersions({
    storage,
    fetchImpl: async () => { configCalls++; throw new Error('should not fetch') },
  })
  t('TTL 内复用本机记录、不再请求', configCalls === 1 && again.model === 'm2')

  const p = buildCloudPayload(INPUT)
  t('模型代际进入本地缓存键', cloudCacheKey(p, serverVersions) !== cloudCacheKey(p, DEFAULT_CLOUD_VERSIONS))
  const stale = fakeStorage()
  writeCloudCache(stale, p, 2, DEFAULT_CLOUD_VERSIONS)
  t('换模型后旧本地缓存不命中', readCloudCache(stale, p, serverVersions) === undefined)

  resetCloudVersionsCache()
  const fallback = await fetchCloudVersions({
    storage: fakeStorage(),
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  })
  t('配置端不可用时退回内置版本', fallback.model === DEFAULT_CLOUD_VERSIONS.model)
}

console.log('\n[resolveCloudSense — 判定与降级]')
{
  const p = buildCloudPayload(INPUT)
  t('载荷非法 → invalid', (await resolveCloudSense({ ...INPUT, senses: [] })).status === 'invalid')

  const hitStorage = fakeStorage()
  writeCloudCache(hitStorage, p, 2, DEFAULT_CLOUD_VERSIONS)
  let fetchCalls = 0
  const cached = await resolveCloudSense(INPUT, {
    storage: hitStorage,
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ rank: 1 }) } }
  })
  t('本地缓存命中不发请求，来源标 cache',
    cached.status === 'cloud' && cached.rank === 2 && cached.source === 'cache' && fetchCalls === 0)

  let seenRequest = null
  const ok = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async (url, init) => {
      seenRequest = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ status: 'cloud', confidence: 'selected', rank: 2, source: 'model' }) }
    }
  })
  t('云端已选 → cloud rank + model', ok.status === 'cloud' && ok.rank === 2 && ok.source === 'model')
  t('请求体带 clientVersion:2', seenRequest && seenRequest.clientVersion === CLOUD_CLIENT_VERSION)

  const legacy = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'cloud', rank: 2 }) })
  })
  t('旧 Worker 缺 confidence → legacy', legacy.status === 'cloud' && legacy.rank === 2 && legacy.source === 'legacy')

  const uncertainConfidence = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'cloud', confidence: 'uncertain', rank: 2 }) })
  })
  t('rank 合法但 confidence 不是 selected/certain → uncertain', uncertainConfidence.status === 'uncertain')

  const insufficient = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'uncertain', confidence: 'insufficient_context', rank: null }),
    })
  })
  t('上下文不足原因透传到 UI', insufficient.status === 'uncertain' && insufficient.reason === 'insufficient_context')

  const uncertain = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'cloud', confidence: 'selected', rank: 99 }) })
  })
  t('模型给了表外 rank → uncertain', uncertain.status === 'uncertain')

  const unavailable = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
  })
  t('503 → unavailable', unavailable.status === 'unavailable')

  const rateLimited = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  })
  t('429 → rate_limited', rateLimited.status === 'rate_limited')

  const unauthorized = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  })
  t('401 → unauthorized', unauthorized.status === 'unauthorized')

  const invalid = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) })
  })
  t('400 → invalid', invalid.status === 'invalid')

  const offline = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    versions: DEFAULT_CLOUD_VERSIONS,
    fetchImpl: async () => { throw new Error('net down') }
  })
  t('网络错误 → offline（不抛）', offline.status === 'offline')

  resetCloudVersionsCache()
  const serverVersions = { schema: 'v3', model: 'm2', prompt: 'p3', lexicon: 'l2' }
  const calls = []
  const liveStorage = fakeStorage()
  const live = await resolveCloudSense(INPUT, {
    storage: liveStorage,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url === CLOUD_CONFIG_PATH) {
        return { ok: true, status: 200, json: async () => ({ versions: serverVersions }) }
      }
      return { ok: true, status: 200, json: async () => ({ status: 'cloud', confidence: 'selected', rank: 2, source: 'model' }) }
    },
  })
  t('解析前先取服务端版本', calls[0] === CLOUD_CONFIG_PATH && live.status === 'cloud')
  t('答案写进服务端代际的键', readCloudCache(liveStorage, p, serverVersions) === 2)
  t('默认代际读不到这条答案', readCloudCache(liveStorage, p, DEFAULT_CLOUD_VERSIONS) === undefined)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
