/**
 * dict-zh 六态（D2）验证 —— 冻结包 §三·6 六条机检判据 ＋ lookup 四值返回 ＋
 * 词组/笔记路径零回归 ＋ 事件接线。
 *
 * 不挂载组件、不触网：
 *   - `lookup` 用替身 fetch 驱动 manifest／片／irregular／网络失败／deadline；
 *   - 六态组合直接跑 `src/utils/zhState.js`（ReaderView 实际调用的同一份决策函数），
 *     读 `lookupState`／`dictEntry`／`zhReason`／`isOffline`；
 *   - ReaderView／WordPopup 的插入点与接线按本仓既有「来源级」检查读源码。
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8')
const rv = read('src/views/ReaderView.vue')
const popup = read('src/components/WordPopup.vue')
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
console.log(`\n[zhdict] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1
