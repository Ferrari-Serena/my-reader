/**
 * dict-zh 六态（D2）验证 —— 冻结包 §三·6 六条机检判据 ＋ lookup 四值返回 ＋
 * 词组/笔记路径零回归 ＋ 事件接线。
 *
 * 不挂载组件、不触网：
 *   - `lookup` 用替身 fetch 驱动 manifest／片／irregular／网络失败／deadline；
 *   - 六态组合直接跑 `src/utils/zhState.js`（ReaderView 实际调用的同一份决策函数），
 *     读 `lookupState`／`dictEntry`／`zhReason`／`isOffline`；
 *   - ReaderView／WordPopup 的插入点与接线按本仓既有「来源级」检查读源码；
 *   - `src/utils/zhEvents.js` 直接驱动导出：session 复用、四事件载荷、满 20／1000 ms
 *     合批、哈希注入（含异步与坏形状）、网络失败与 429 丢弃（§五客户端前置／§六新增模块）。
 *
 * 用法: node verify-zhdict.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  LOOKUP_STATES,
  beginWordLookup,
  beginPhraseLookup,
  deadlineOutcome,
  resolveZhOutcome,
  resolveOnlineOutcome,
} from './src/utils/zhState.js'
import { lookup } from './src/utils/zhDict.js'
import {
  ZH_EVENTS_ROUTE,
  SESSION_STORAGE,
  SESSION_RE,
  MAX_QUEUE,
  MAX_BATCH,
  FLUSH_DELAY_MS,
  currentSession,
  emit,
  flush,
  resetZhEvents,
  setFetch,
  setHashWord,
  setLogger,
} from './src/utils/zhEvents.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8')
const rv = read('src/views/ReaderView.vue')
const popup = read('src/components/WordPopup.vue')
const zhEventsSrc = read('src/utils/zhEvents.js')
const at = (s, needle) => s.indexOf(needle)

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════════
// ① 六态判据（读 lookupState／dictEntry／zhReason／isOffline）
// ═══════════════════════════════════════════════════════════════════
console.log('\n[六态 — 每条判据一组 lookupState／dictEntry／zhReason／isOffline 组合]')

t('枚举就是规格那 8 个值', LOOKUP_STATES.join(',') === 'idle,loading,hit,english,miss,error,offline,phrase')

{
  // ① 加载中：lookupState==='loading' && selectedWord!==null
  const p = beginWordLookup('alpha', { definitions: ['旧英文条目'] })
  t('① 加载中：lookupState=loading、选中词非空、旧条目先不当作结果',
    p.lookupState === 'loading' && p.word === 'alpha' && p.dictEntry.definitions.length === 1 && p.zhReason === '')
}

{
  // ② 命中：lookupState==='hit' && dictEntry.definitions.length>0
  const out = resolveZhOutcome({
    zh: { status: 'hit', result: 'direct', entry: { word: 'alpha', definitions: ['n. 阿尔法'] } },
    entry: { definitions: ['old english'] },
    offline: false,
  })
  t('② 命中：中文条目胜出（B9 不被英文缓存抢先），definitions>0、zhReason=direct',
    out.lookupState === 'hit' && out.dictEntry.definitions.length > 0 &&
    out.dictEntry.definitions[0] === 'n. 阿尔法' && out.zhReason === 'direct')
}

{
  // ③ 英文兜底：lookupState==='english' && dictEntry.definitions.length>0
  const entry = { word: 'alpha', definitions: ['the first letter'] }
  const out = resolveZhOutcome({ zh: { status: 'miss', reason: 'miss_dict' }, entry, offline: false })
  t('③ 英文兜底：中文未收后回落英文缓存，definitions>0',
    out.lookupState === 'english' && out.dictEntry.definitions.length > 0 &&
    out.zhReason === 'miss_dict')
}

{
  // ④ 未收：lookupState==='miss' && 无 definitions && reason 属于 miss_dict／miss_empty

{
  // ④ 未收：entry.notFound 时 lookupState 的分支测试
  const testCases = [
    { reason: 'miss_dict', expected: 'miss' },
    { reason: 'miss_empty', expected: 'miss' },
    { reason: 'miss_shard', expected: 'error' },
    { reason: 'miss_net', expected: 'error' }
  ]
  testCases.forEach(({ reason, expected }) => {
    const out = resolveZhOutcome({
      zh: { status: 'miss', reason },
      entry: { notFound: true },
      offline: false
    })
    t(`④ 未收：entry.notFound 时 lookupState=${expected}，reason=${reason}`,
      out.lookupState === expected &&
      out.zhReason === reason)
  })
}
  const a = resolveZhOutcome({ zh: { status: 'miss', reason: 'miss_empty' }, entry: null, offline: true })
  const b = resolveOnlineOutcome({ reason: 'miss_dict', online: { notFound: true } })
  const ok = (o) => o.lookupState === 'miss' && !o.dictEntry?.definitions?.length &&
    (o.zhReason === 'miss_dict' || o.zhReason === 'miss_empty')
  t('④ 未收：miss_empty 离线落 miss（不是 offline）', ok(a) && a.zhReason === 'miss_empty')
  t('④ 未收：miss_dict 在线且 /api/dict 也未收落 miss', ok(b) && b.zhReason === 'miss_dict')
}

{
  // ⑤ 网络/超时：lookupState==='error'
  const net = resolveOnlineOutcome({ reason: 'miss_net', failed: true })
  const shard = resolveOnlineOutcome({ reason: 'miss_shard', online: { notFound: true } })
  const dl = deadlineOutcome()
  t('⑤ 网络/超时：在线失败 → error／miss_net', net.lookupState === 'error' && net.zhReason === 'miss_net')
  t('⑤ 网络/超时：miss_shard 在线 404 不落 miss，落 error', shard.lookupState === 'error' && shard.zhReason === 'miss_shard')
  t('⑤ 网络/超时：deadline abort → error／miss_net', dl.lookupState === 'error' && dl.zhReason === 'miss_net')
  const stale = resolveOnlineOutcome({ reason: 'miss_net', online: { notFound: false, definitions: [{ def: 'stale' }] }, failed: true })
  t('⑤ failed 优先于 stale definitions ⇒ error', stale.lookupState === 'error' && stale.zhReason === 'miss_net')
}

{
  // ⑥ 离线：lookupState==='offline' && isOffline===true && reason 不是 miss_dict／miss_empty
  const isOffline = true
  const out = resolveZhOutcome({ zh: { status: 'miss', reason: 'miss_shard' }, entry: null, offline: isOffline })
  t('⑥ 离线：分片没取到 → offline，且 reason≠miss_dict／miss_empty',
    out.lookupState === 'offline' && isOffline === true &&
    out.zhReason !== 'miss_dict' && out.zhReason !== 'miss_empty')
  const netOffline = resolveZhOutcome({ zh: { status: 'error', reason: 'miss_net' }, entry: null, offline: true })
  t('⑥ 离线：miss_net 且离线无英文缓存 → offline（不落 miss）', netOffline.lookupState === 'offline')
}

{
  // 词组专用值
  const p = beginPhraseLookup('account for')
  t('词组：lookupState=phrase 且 dictEntry=null（六态不参与）', p.lookupState === 'phrase' && p.dictEntry === null)
}

// ═══════════════════════════════════════════════════════════════════
// ② lookup 四值返回（替身 fetch）
// ═══════════════════════════════════════════════════════════════════
console.log('\n[zhDict.lookup — 四值返回]')

const SHARDS = {
  a: {
    alpha: { w: 'alpha', p: '/ˈælfə/', t: ['n. 阿尔法', 'adj. 第一的'] },
  },
  e: { empty: { w: 'empty', t: [] } },
  r: { run: { w: 'run', p: '/rʌn/', t: ['v. 跑'] } },
  g: { go: { w: 'go', t: ['v. 去'] } },
  w: {}, // 加载了，但没有 went
}
const IRREGULAR = { went: 'go' }
const calls = []

function jsonResponse(data, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => data })
}

globalThis.fetch = (url, init = {}) => {
  const u = String(url)
  calls.push(u)
  if (u.includes('manifest.json')) {
    return jsonResponse({
      source: { commit: 'zh-test' },
      shards: Object.keys(SHARDS).map(letter => ({ letter, sha1: `${letter}deadbeef` })),
    })
  }
  if (u.includes('irregular.json')) return jsonResponse(IRREGULAR)
  const m = /dict-zh\/([a-z])\.json/.exec(u)
  if (m) {
    const letter = m[1]
    if (letter === 'z') return jsonResponse({}, 404) // 片 404
    if (letter === 'k' || letter === 'l') return Promise.reject(new TypeError('network down'))
    if (letter === 'm') {
      // 只认 abort：用来验端到端 deadline
      return new Promise((_, reject) => {
        const abort = () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        }
        if (init.signal?.aborted) abort()
        else init.signal?.addEventListener('abort', abort, { once: true })
      })
    }
    return jsonResponse(SHARDS[letter] || {})
  }
  return Promise.reject(new Error(`unexpected fetch: ${u}`))
}

{
  const hit = await lookup('Alpha') // 归一化到大写 -> alpha
  t('direct 命中：{status:hit,result:direct,entry.definitions}',
    hit.status === 'hit' && hit.result === 'direct' && hit.entry.definitions.length === 2)

  const empty = await lookup('empty')
  t('record 在但零释义 ⇒ {status:miss,reason:miss_empty}，不是 hit',
    empty.status === 'miss' && empty.reason === 'miss_empty')

  const absent = await lookup('absent')
  t('片已加载、词不在片内 ⇒ miss_dict', absent.status === 'miss' && absent.reason === 'miss_dict')

  const stem = await lookup('running')
  t('屈折形还原命中 ⇒ result=stem，entry 是词头 run',
    stem.status === 'hit' && stem.result === 'stem' && stem.entry.word === 'run')

  const irregular = await lookup('went')
  t('不规则表命中 ⇒ result=irregular，entry 是词头 go',
    irregular.status === 'hit' && irregular.result === 'irregular' && irregular.entry.word === 'go')

  const shard404 = await lookup('zebra')
  t('所需片 404 ⇒ {status:miss,reason:miss_shard}', shard404.status === 'miss' && shard404.reason === 'miss_shard')

  const net = await lookup('kite')
  t('在线传输失败 ⇒ {status:error,reason:miss_net}', net.status === 'error' && net.reason === 'miss_net')

  const offNet = await lookup('lemon', { offline: true })
  t('离线传输失败 ⇒ miss_shard（不能断言未收）', offNet.status === 'miss' && offNet.reason === 'miss_shard')

  const off404 = await lookup('zebra', { offline: true })
  t('离线片 404 ⇒ miss_shard', off404.status === 'miss' && off404.reason === 'miss_shard')

  t('长度闸：单字母也回四值形状（不是 null）',
    (await lookup('a')).status === 'miss' && !!(await lookup('a')).reason)

  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 5)
  const aborted = await lookup('mango', { signal: ctrl.signal })
  t('端到端 signal 到点 abort ⇒ error／miss_net', aborted.status === 'error' && aborted.reason === 'miss_net')

  t('所有返回值都带 status（永不返回 null）',
    [hit, empty, absent, stem, irregular, shard404, net, offNet, off404, aborted]
      .every(r => r && (r.status === 'hit' || r.status === 'miss' || r.status === 'error')))
}

// ═══════════════════════════════════════════════════════════════════
// ③ ReaderView 插入点／B9／deadline／事件接线（来源级）
// ═══════════════════════════════════════════════════════════════════
console.log('\n[ReaderView — 六态状态机与 B9 顺序]')

t('lookupState=ref(\'idle\') 与 zhReason=ref(\'\') 同批声明',
  /const lookupState = ref\('idle'\)[\s\S]{0,200}const zhReason = ref\(''\)/.test(rv))
t('dictLoading 布尔已移除（只剩注释）', !/const dictLoading = ref/.test(rv))
t('isOffline 显式 import（ReaderView 原来没有）', /import \{ isOffline \} from '\.\.\/utils\/offline\.js'/.test(rv))
t('defineExpose 暴露 lookupState／dictEntry／zhReason／isOffline',
  /defineExpose\(\{\s*lookupState,\s*dictEntry,\s*zhReason,\s*isOffline\s*\}\)/.test(rv))
t('B9：lookupZh 前不再有英文缓存早退',
  at(rv, 'await lookupZh(word,') > 0 && !/if \(entry\?\.definitions\?\.length \|\| entry\?\.notFound\)/.test(rv))
t('B9：lookupZh 先于英文缓存／在线回落',
  at(rv, 'await lookupZh(word,') < at(rv, 'resolveZhOutcome({ zh, entry'))
t('端到端 deadline 8000 ms、一个 AbortController', /DICT_DEADLINE_MS = 8000/.test(rv) && /const deadline = new AbortController\(\)/.test(rv))
t('deadline 覆盖 lookupZh 与 /api/dict（同一 signal）',
  /lookupZh\(word, \{ offline: isOffline\.value, signal: deadline\.signal \}\)/.test(rv) &&
  /fetch\(`\$\{DICT_WORKER\}\/api\/dict\/\$\{encodeURIComponent\(word\)\}`, \{ signal: deadline\.signal \}\)/.test(rv))
t('到点 abort ⇒ error／miss_net（deadlineOutcome）',
  at(rv, 'deadline.abort()') > 0 && rv.includes('deadlineOutcome()'))
t('zh_lookup 在 await 返回后立即发（先于 selectedWord 守卫）',
  at(rv, 'zhLookup({') > 0 &&
  at(rv, 'zhLookup({') < at(rv, 'if (selectedWord.value !== word) return'))
t('zh_shown 只在 hit 且 definitions>0 时发',
  /if \(out\.lookupState === 'hit'\)[\s\S]{0,220}defs > 0 && selectedWord\.value === word[\s\S]{0,120}zhShown\(\{ word, result: out\.zhReason, defsCount: defs \}\)/.test(rv))
t('finally 只清 timer，不写 lookupState',
  /finally \{\s*\/\/[^\n]*\n\s*clearTimeout\(deadlineTimer\)\s*\}/.test(rv))
t('六态 DOM 不在 ReaderView 另起一套', !/v-if="lookupState/.test(rv) && !/v-else-if="lookupState/.test(rv))

console.log('\n[ReaderView — 词组/笔记路径零回归]')
{
  const phraseStart = at(rv, 'if (selectedPhrase.value?.senses?.length || selectedPhrase.value?.defs?.length)')
  const wordStart = at(rv, 'emitEnter(word, isBookId(bookId.value)')
  const phraseBlock = rv.slice(phraseStart, wordStart)
  t('词组早退：beginPhraseLookup ⇒ phrase ＋ dictEntry=null ＋ 不查词',
    phraseStart > 0 && wordStart > phraseStart &&
    phraseBlock.includes('beginPhraseLookup') &&
    !phraseBlock.includes('lookupZh') &&
    phraseBlock.includes('dictEntry.value = plan.dictEntry'))
  t('词组早退仍发 zh_enter via=phrase', phraseBlock.includes("emitEnter(word, 'phrase')"))

  const noteStart = at(rv, 'const marked = noteMarkOf(paraId, tokenIdx)')
  const spanStart = at(rv, 'const span = (paraPhraseSpans.value[paraId] || [])')
  const noteBlock = rv.slice(noteStart, spanStart)
  t('笔记早退：先发 enter(via=note) 再开笔记，且不设 lookupState',
    noteStart > 0 && spanStart > noteStart &&
    noteBlock.includes("emitEnter(word, 'note')") &&
    noteBlock.includes('selectedWord.value = null') &&
    noteBlock.includes('openNoteEditor(marked)') &&
    !noteBlock.includes('lookupState.value ='))
}

console.log('\n[ReaderView — zhEvents 接线]')
t('四事件与哈希注入都从 zhEvents 引入',
  /import \{ setHashWord, zhEnter, zhLookup, zhShown, zhAction \} from '\.\.\/utils\/zhEvents\.js'/.test(rv))
t('setHashWord 注入归一化＋SHA-256（不传真词）',
  /setHashWord\(async \(input\) =>[\s\S]{0,400}normalizeWord\(input\)[\s\S]{0,200}digest\('SHA-256'/.test(rv))
t('zh_enter 按分支发：note／phrase／byo|builtin',
  rv.includes("emitEnter(word, 'note')") && rv.includes("emitEnter(word, 'phrase')") &&
  rv.includes("emitEnter(word, isBookId(bookId.value) ? 'byo' : 'builtin')"))
t('zh_action 五个入口齐全（save/remove/close/speak/online）',
  ['save', 'remove', 'close', 'speak', 'online'].every(a => rv.includes(`emitAction('${a}')`)))
t('dwell_ms 从 zh_enter 起算', /popupOpenedAt\.value = Date\.now\(\)/.test(rv) &&
  /Date\.now\(\) - opened/.test(rv))
t('闭弹窗改走 closeWordPopup（不再内联 selectedWord=null）',
  /@close="closeWordPopup"/.test(rv) && !/@close="selectedWord = null"/.test(rv))
t('没有新建 /api/zh/events 服务端调用（只由 zhEvents 模块发）',
  !/fetch\(['"`]\/api\/zh\/events/.test(rv))
t('zh_enter 三支顺序：note → phrase → 单词（byo|builtin）',
  at(rv, "emitEnter(word, 'note')") > 0 &&
  at(rv, "emitEnter(word, 'note')") < at(rv, "emitEnter(word, 'phrase')") &&
  at(rv, "emitEnter(word, 'phrase')") < at(rv, 'emitEnter(word, isBookId(bookId.value)'))
t('zh_lookup result 取四值、ms 为点击起算实测值',
  /result: zh\.status === 'hit' \? zh\.result : zh\.reason,\s*ms: Date\.now\(\) - startedAt,/.test(rv))
t('closeWordPopup：先发 zh_action(close) 再清 selectedWord',
  /function closeWordPopup\(\) \{\s*emitAction\('close'\)\s*selectedWord\.value = null\s*\}/.test(rv))
t('hashWord 拿不到 crypto.subtle 时返回空串（由 zhEvents 丢弃，不回退原词）',
  /if \(!subtle\) return ''/.test(rv) && /catch \{\s*return ''\s*\}/.test(rv))

// ═══════════════════════════════════════════════════════════════════
// ④ WordPopup 插入点：六态只进 v-else，且在三支之后
// ═══════════════════════════════════════════════════════════════════
console.log('\n[WordPopup — 六态插入点]')

const iSenses = at(popup, 'v-if="hasSenses"')
const iSimple = at(popup, 'v-else-if="hasSimpleDefs"')
const iElse = at(popup, '<template v-else>')
const iGuard = at(popup, "lookupState !== 'phrase'")
const iLoading = at(popup, "lookupState === 'loading'")
t('hasSenses → hasSimpleDefs → v-else → 六态 guard → loading 顺序正确',
  iSenses > 0 && iSimple > iSenses && iElse > iSimple && iGuard > iElse && iLoading > iGuard)
t('六态各一支 DOM：hit／english／miss／error／offline',
  popup.includes("lookupState === 'hit' || lookupState === 'english'") &&
  popup.includes("lookupState === 'miss'") &&
  popup.includes("lookupState === 'error'") &&
  popup.includes("lookupState === 'offline'"))
t('词组不参与六态：前置 lookupState !== \'phrase\'',
  /<template v-if="lookupState !== 'phrase'">/.test(popup))
t('props 改成 lookupState／zhReason，loadingDict 已移除',
  /lookupState: \{ type: String/.test(popup) && /zhReason: \{ type: String/.test(popup) && !/loadingDict/.test(popup))
t('六态文案用候选句（miss_dict／miss_empty／miss_shard）',
  popup.includes('词典已加载，里面没有这个词。') &&
  popup.includes('词典里有这个词，但没有释义。') &&
  popup.includes('这个词所在的字母分片还没到本机。'))
t('error 文案给「稍后重试」，在线查词只出现在 miss／error（离线不置重试）',
  popup.includes('网络或限额，请稍后重试。') &&
  /v-if="lookupState === 'miss' \|\| lookupState === 'error'"[\s\S]{0,160}在线查词/.test(popup) &&
  !/v-if="[^"]*lookupState === 'offline'[^"]*"[\s\S]{0,40}在线查词/.test(popup))
t('speak／online 动作回调向 ReaderView 发事件',
  /emit\('speak'\)/.test(popup) && /emit\('online'\)/.test(popup) &&
  /defineEmits\(\['close', 'add-vocab', 'remove-vocab', 'speak', 'online'\]\)/.test(popup))

// ═══════════════════════════════════════════════════════════════════
// ⑤ zhEvents 行为（冻结包 §五／§六：session、批量队列、哈希注入、失败丢弃）
// 只驱动模块导出，不挂载组件、不触网；fetch 由 setFetch 注入替身。
// ═══════════════════════════════════════════════════════════════════
console.log('\n[zhEvents — session／批量队列／哈希注入／失败丢弃]')

const HASH_HEX = '0123456789abcdef'.repeat(4) // 64 位小写 hex，与 BE 入参校验同形
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** 收请求的 fetch 替身；body 解析出来直接给断言看 */
function captureFetch(status = 202) {
  const reqs = []
  const fn = (url, init = {}) => {
    reqs.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null })
    return Promise.resolve({ ok: status >= 200 && status < 300, status })
  }
  fn.reqs = reqs
  return fn
}

// Node 没有 sessionStorage：注入内存版，验证「重载保留」这一段
const sessionStore = new Map()
try {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => { sessionStore.set(k, String(v)) },
    },
  })
} catch { /* 覆盖不了就只测内存复用 */ }

setLogger(() => {}) // 测试期静默（非 Vite 构建本来也不 warn）

t('常量对齐 §五／§六：路由、session 键、队列 50／批 20／1000 ms',
  ZH_EVENTS_ROUTE === '/api/zh/events' && SESSION_STORAGE === 'mr-zh-session' &&
  MAX_QUEUE === 50 && MAX_BATCH === 20 && FLUSH_DELAY_MS === 1000)
t('队列满 50 丢最旧（splice 头部），不无限增长',
  /queue\.splice\(0, excess\)/.test(zhEventsSrc))
t('生命周期：pagehide／visibilitychange(hidden) 用 keepalive 补发',
  /addEventListener\('pagehide'[\s\S]{0,200}flush\(\{ keepalive: true \}\)/.test(zhEventsSrc) &&
  /visibilitychange[\s\S]{0,400}flush\(\{ keepalive: true \}\)/.test(zhEventsSrc))

{
  resetZhEvents()
  const s1 = currentSession()
  const s2 = currentSession()
  t('session：randomUUID 形状、标签页内复用、落到 mr-zh-session',
    SESSION_RE.test(s1) && s1 === s2 && sessionStore.get(SESSION_STORAGE) === s1)
  resetZhEvents()
  t('session：重载（内存清空）后从 sessionStorage 读回同一 id',
    currentSession() === s1)
}

{
  // 一次把四事件送完：字段名／枚举／原词边界逐项对 §五 契约
  resetZhEvents()
  const f = captureFetch()
  setFetch(f)
  setHashWord(() => HASH_HEX)
  const ok = [
    emit('zh_enter', { word: 'Zebra', via: 'byo' }),
    emit('zh_lookup', { word: 'Zebra', result: 'miss_dict', ms: 12.6 }),
    emit('zh_shown', { word: 'Zebra', result: 'direct', defsCount: 3 }),
    emit('zh_action', { word: 'Zebra', action: 'save', source: 'zh', dwellMs: 1234 }),
  ]
  const sent = flush()
  const req = f.reqs[0]
  const body = req?.body
  const evs = body?.events || []
  const byName = Object.fromEntries(evs.map(x => [x.e, x]))
  const wire = JSON.stringify(body || {})
  t('四事件同批：一次 POST、anon 空串、session 合形、原词不出设备',
    ok.every(Boolean) && sent === 4 && f.reqs.length === 1 &&
    req.url === ZH_EVENTS_ROUTE && req.init.method === 'POST' &&
    body.anon === '' && SESSION_RE.test(body.session) &&
    !wire.includes('Zebra') && !wire.includes('zebra'))
  t('载荷严格按 §五：word_hash 64 hex、via／result+ms／defs_count／action+source+dwell_ms',
    evs.length === 4 &&
    evs.every(x => /^[0-9a-f]{64}$/.test(x.word_hash) && Number.isFinite(x.ts)) &&
    byName.zh_enter.via === 'byo' && !('result' in byName.zh_enter) &&
    byName.zh_lookup.result === 'miss_dict' && byName.zh_lookup.ms === 13 &&
    !('via' in byName.zh_lookup) &&
    byName.zh_shown.result === 'direct' && byName.zh_shown.defs_count === 3 &&
    byName.zh_action.action === 'save' && byName.zh_action.source === 'zh' &&
    byName.zh_action.dwell_ms === 1234)
}

{
  // 异步注入：调用方不等；哈希落定后才入队；原词只活在闭包里
  resetZhEvents()
  const f = captureFetch()
  setFetch(f)
  let calls = 0
  setHashWord(async () => { calls++; return HASH_HEX })
  const ok = emit('zh_enter', { word: 'zebra', via: 'builtin' })
  const before = f.reqs.length
  await sleep(0)
  const sent = flush()
  t('hashWord 异步：emit 不 await、完成后才入队、只送哈希',
    ok === true && calls === 1 && before === 0 && sent === 1 &&
    f.reqs[0].body.events[0].word_hash === HASH_HEX)
}

{
  resetZhEvents()
  const f = captureFetch()
  setFetch(f)
  setHashWord(() => 'ABC') // 不是 64 位小写 hex
  t('哈希形状不对：单条丢弃、不入队',
    emit('zh_enter', { word: 'zebra', via: 'byo' }) === false &&
    flush() === 0 && f.reqs.length === 0)
  resetZhEvents()
  t('未注入 hashWord：不发（宁缺勿错，绝不回退传原词）',
    emit('zh_enter', { word: 'zebra', via: 'byo' }) === false && flush() === 0)
}

{
  resetZhEvents()
  const f = captureFetch()
  setFetch(f)
  setHashWord(() => HASH_HEX)
  for (let i = 0; i < MAX_BATCH; i++) {
    emit('zh_lookup', { word: `w${i}`, result: 'direct', ms: i })
  }
  t('满 20 条立即 flush：一次请求 20 条，不等 1000 ms',
    f.reqs.length === 1 && f.reqs[0].body.events.length === MAX_BATCH && flush() === 0)
}

{
  resetZhEvents()
  const f = captureFetch()
  setFetch(f)
  setHashWord(() => HASH_HEX)
  emit('zh_enter', { word: 'zebra', via: 'byo' })
  const immediately = f.reqs.length
  await sleep(FLUSH_DELAY_MS + 150)
  t('首条入队：1000 ms 内不合批，到点发 1 条',
    immediately === 0 && f.reqs.length === 1 && f.reqs[0].body.events.length === 1)
}

{
  resetZhEvents()
  let attempts = 0
  setFetch(() => { attempts++; return Promise.reject(new TypeError('network down')) })
  setHashWord(() => HASH_HEX)
  for (let i = 0; i < MAX_BATCH; i++) {
    emit('zh_lookup', { word: `w${i}`, result: 'direct', ms: i })
  }
  await sleep(20)
  t('发送失败：不重试、不抛给调用方、队列已丢弃',
    attempts === 1 && flush() === 0)
}

{
  resetZhEvents()
  let attempts = 0
  setFetch(() => { attempts++; return Promise.resolve({ ok: false, status: 429 }) })
  setHashWord(() => HASH_HEX)
  for (let i = 0; i < MAX_BATCH; i++) {
    emit('zh_enter', { word: `w${i}`, via: 'byo' })
  }
  await sleep(10)
  const after = emit('zh_enter', { word: 'later', via: 'byo' })
  const sentAfter = flush()
  await sleep(10)
  t('429：停本会话后续上报（之后的 emit 直接丢弃）',
    attempts === 1 && after === false && sentAfter === 0)
}

// ═══════════════════════════════════════════════════════════════════
console.log(`\n[zhdict] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1
