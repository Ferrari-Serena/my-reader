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
  cloudRankFromResponse,
  resolveCloudSense,
  CLOUD_CACHE_PREFIX,
} from './src/utils/phraseCloud.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const SENSES = [
  { rank: 1, zh: '解释；说明（原因）', cue: 'should-not-be-sent' },
  { rank: 2, zh: '占（比例）；构成' },
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
  t('senses 只保留 rank + zh（cue 被剪掉）', p.senses.every(s => Object.keys(s).join(',') === 'rank,zh'))
  t('多余字段不出现', p && !('sentenceRaw' in p) && !('extra' in p))
  t('缺 start/end 拒', buildCloudPayload({ ...INPUT, start: undefined }) === null)
  t('单义项拒', buildCloudPayload({ ...INPUT, senses: [SENSES[0]] }) === null)
  t('重复 rank 拒', buildCloudPayload({ ...INPUT, senses: [SENSES[0], SENSES[0]] }) === null)
  t('sentence 超长被截断', buildCloudPayload({ ...INPUT, sentence: 'a'.repeat(2000) }).sentence.length === 1200)
}

console.log('\n[cloudCacheKey / readCloudCache / writeCloudCache]')
{
  const p = buildCloudPayload(INPUT)
  const storage = fakeStorage()
  t('空缓存未命中回 undefined', readCloudCache(storage, p) === undefined)
  writeCloudCache(storage, p, 2)
  t('写后命中 rank', readCloudCache(storage, p) === 2)
  t('缓存键有前缀', Object.keys(storage._dump()).every(k => k.startsWith(CLOUD_CACHE_PREFIX)))

  const other = buildCloudPayload({ ...INPUT, sentence: 'Another sentence.' })
  t('不同句子不是同一条缓存', readCloudCache(storage, other) === undefined)
  writeCloudCache(storage, other, 1)
  t('两条并存', Object.keys(storage._dump()).length === 2)
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

console.log('\n[cloudRankFromResponse — 响应 rank 必须在义项表里]')
{
  t('合法 rank', cloudRankFromResponse({ rank: 2 }, SENSES) === 2)
  t('表外 rank 不认', cloudRankFromResponse({ rank: 9 }, SENSES) === null)
  t('非整数不认', cloudRankFromResponse({ rank: '2' }, SENSES) === null)
  t('非对象不认', cloudRankFromResponse(null, SENSES) === null)
}

console.log('\n[resolveCloudSense — 判定与降级]')
{
  const p = buildCloudPayload(INPUT)
  t('载荷非法 → invalid', (await resolveCloudSense({ ...INPUT, senses: [] })).status === 'invalid')

  const hitStorage = fakeStorage()
  writeCloudCache(hitStorage, p, 2)
  let fetchCalls = 0
  const cached = await resolveCloudSense(INPUT, {
    storage: hitStorage,
    fetchImpl: async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ rank: 1 }) } }
  })
  t('本地缓存命中不发请求', cached.status === 'cloud' && cached.rank === 2 && fetchCalls === 0)

  const ok = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rank: 2 }) })
  })
  t('云端确认 → cloud rank', ok.status === 'cloud' && ok.rank === 2)

  const uncertain = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rank: 99 }) })
  })
  t('模型给了表外 rank → uncertain', uncertain.status === 'uncertain')

  const unavailable = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
  })
  t('503 → unavailable', unavailable.status === 'unavailable')

  const offline = await resolveCloudSense(INPUT, {
    storage: fakeStorage(),
    fetchImpl: async () => { throw new Error('net down') }
  })
  t('网络错误 → offline（不抛）', offline.status === 'offline')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
