/**
 * UI-02（02 阅读页）现状核对 —— 只读源码，不挂组件、不触网、不改文件。
 *
 * 把本轮要确认的三件事固化成可复跑的结论：
 *   ① UI-02 验收项（返回条／章标题／目录／Aa／进度／正文／选中浮条）各自现状；
 *   ② `npm test` / `npm run build` 的命令口径与脚本清单；
 *   ③ dict-zh 六态回归清单及其所在测试。
 * 同时钉住 book/gen/clear 调用链的路径口径（避免 UI-02 照抄线框时写死示例数据）。
 *
 * 用法：
 *   node verify-readerui.mjs            报告 + 基线校验；基线失败 exit 1
 *   node verify-readerui.mjs --strict   UI-02 缺口未闭合也 exit 1（给验收闸用）
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { LOOKUP_STATES } from './src/utils/zhState.js'
import { GEN_ROUTE, clearBookAudioPath } from './src/utils/genApi.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const STRICT = process.argv.includes('--strict')

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const has = (src, re) => (re instanceof RegExp ? re.test(src) : src.includes(re))

let pass = 0
let fail = 0
const failures = []
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}

const reader = read('src/views/ReaderView.vue')
const nav = read('src/components/ChapterNav.vue')
const popup = read('src/components/WordPopup.vue')
const settings = read('src/components/ReadingSettings.vue')
const player = read('src/components/AudioPlayer.vue')
const app = read('src/App.vue')
const bookList = read('src/views/BookListView.vue')
const bookCard = read('src/components/BookCard.vue')
const genApi = read('src/utils/genApi.js')
const progressUtil = read('src/utils/readingProgress.js')
const zhdictTest = read('verify-zhdict.mjs')
const pkg = JSON.parse(read('package.json'))

// ═══════════════════════════════════════════════════════════════════
// ① 基线：文件、命令、调用链、六态枚举
// ═══════════════════════════════════════════════════════════════════
console.log('\n[基线 — UI-02 读取面的文件与依赖]')
for (const f of [
  'src/views/ReaderView.vue', 'src/components/ChapterNav.vue', 'src/components/WordPopup.vue',
  'src/components/ReadingSettings.vue', 'src/components/AudioPlayer.vue',
  'src/views/BookListView.vue', 'src/components/BookCard.vue',
  'src/utils/genApi.js', 'src/utils/zhState.js', 'src/utils/readingProgress.js',
]) t(`存在 ${f}`, has(read(f), /.+/))

console.log('\n[命令 — npm test / npm run build]')
const chain = String(pkg.scripts?.test || '').split('&&').map(s => s.trim()).filter(Boolean)
const chainFiles = chain.map(s => s.replace(/^node\s+/, ''))
const expected = [
  'verify-core.mjs', 'verify-senses.mjs', 'verify-vueimports.mjs', 'verify-sync.mjs',
  'verify-review.mjs', 'verify-booksync.mjs', 'verify-import.mjs', 'verify-books.mjs',
  'verify-importui.mjs', 'smoke-test.mjs', 'verify-authui.mjs', 'verify-audio.mjs',
  'verify-genui.mjs', 'verify-generate.mjs', 'verify-hotswitch.mjs', 'verify-feedbackui.mjs',
  'verify-sw.mjs', 'verify-offline.mjs', 'verify-phrasecloud.mjs', 'verify-zhdict.mjs',
]
t('npm test 是 20 个 node 脚本的顺序链', chainFiles.length === 20 && expected.every(f => chainFiles.includes(f)))
t('npm run build = vite build', pkg.scripts?.build === 'vite build')
t('六态测试在 npm test 链末（verify-zhdict.mjs）', chainFiles[chainFiles.length - 1] === 'verify-zhdict.mjs')

console.log('\n[book / gen / clear 调用链 — 真实数据，不写死示例]')
t('gen 状态路由 = /api/gen/book/', GEN_ROUTE === '/api/gen/book/' && genApi.includes("GEN_ROUTE = '/api/gen/book/'"))
t('clear 走音频路由（不是删书路由）', clearBookAudioPath('bk_demo') === '/api/book/bk_demo/audio' &&
  genApi.includes("clearBookAudioPath(bookId)"))
t('书架：gen 入口由 genApi 三态判定', bookList.includes('genEntryState(') && bookList.includes('function genOf(') && bookCard.includes("v-if=\"gen\""))
t('书架：clear 入口由 genApi 判定并二次确认', bookList.includes('clearEntryState(') && bookList.includes('clearAudioConfirm(') && bookList.includes('clearBookAudioRemote('))
t('书架：进度读真实 chapterIds（progressOfBook）', bookList.includes('progressOfBook(book, loadPosition)') && progressUtil.includes('chapterIds'))
t('阅读器：真实书体内置/BYO 两路（无示例数据）', reader.includes('loadBuiltinBook()') && reader.includes('loadByoBook()') &&
  reader.includes("await loadByoBook()") && reader.includes("await loadBuiltinBook()"))
t('阅读器：章内生成面板已撤（D21-b），只留状态轮询', reader.includes('fetchGenStatus(') &&
  !/<GenAudioPanel/.test(reader) && !/import\s+GenAudioPanel/.test(reader))

console.log('\n[六态 — 枚举与回归测试]')
t('LOOKUP_STATES = idle/loading/hit/english/miss/error/offline/phrase', LOOKUP_STATES.join(',') === 'idle,loading,hit,english,miss,error,offline,phrase')
for (const marker of ['① 加载中', '② 命中', '③ 英文兜底', '④ 未收', '⑤ 网络/超时', '⑥ 离线']) {
  t(`verify-zhdict.mjs 覆盖 ${marker}`, zhdictTest.includes(marker))
}
t('WordPopup 六态分支齐全', ['loading', 'hit', 'english', 'miss', 'error', 'offline'].every(s => popup.includes(`lookupState === '${s}'`)))

// ═══════════════════════════════════════════════════════════════════
// ② UI-02 验收项现状（验收口径：任务清单 §三之二 UI-02）
// ═══════════════════════════════════════════════════════════════════
console.log('\n[UI-02 验收项现状]')
const ui = []
function item(name, status, evidence) {
  ui.push({ name, status, evidence })
  console.log(`  ${status.padEnd(7)} ${name}  — ${evidence}`)
}

const shellBack = has(app, /showBack[\s\S]*?\['Reader'/) && has(app, /function goBack\(\)[\s\S]*?router\.push\('\/books'\)/)
const readerBack = has(reader, /to="\/books"/)
item('返回条', shellBack ? (readerBack ? 'PRESENT' : 'PARTIAL') : 'MISSING',
  shellBack
    ? '外壳已给「← Home」→ /books（App.vue showBack 含 Reader）；阅读页自身无「← 书架」，也不是设计的一行顶栏'
    : '未找到返回 /books 的入口')

const titleLabel = has(nav, /current-chapter-label/) && has(nav, /chapterTitle/)
const titleTotal = has(nav, /共\s*\{\{|共\s*\d+\s*章|第[^<]*章[^<]*共/)
item('章标题', titleLabel && titleTotal ? 'PRESENT' : 'PARTIAL',
  titleLabel
    ? `ChapterNav 显示章名（current-chapter-label）；「共 N 章」只在目录按钮的「当前/总数」里，标题行没有${titleTotal ? '（标题里也有）' : ''}`
    : '未找到章标题')

item('目录', has(nav, /toc-btn/) && has(nav, /toc-dropdown/) && has(nav, /v-for="\(ch, i\) in tocItems"/) ? 'PRESENT' : 'MISSING',
  'ChapterNav：☰ 当前/总数 → toc-dropdown 章列表（含无音频标记）')

item('Aa', (has(nav, /aa-btn/) || has(reader, /aa-btn/)) && has(reader, /@settings="settingsOpen = true"/) && settings.includes('defineProps') ? 'PRESENT' : 'MISSING',
  'ChapterNav Aa → ReadingSettings 抽屉')

const readerProgress = has(reader, /class="progrow"|progress-row|全书已读|剩余约/)
const progressUsedInReader = has(reader, /progressOfBook/)
item('进度', readerProgress ? 'PRESENT' : (progressUsedInReader ? 'PARTIAL' : 'MISSING'),
  readerProgress
    ? '阅读页有进度行'
    : `阅读页无进度行；progressOfBook() 只在书架卡片用（BookListView/BookCard），ReaderView ${progressUsedInReader ? '已引用' : '未引用'}`)

item('正文', has(reader, /class="chapter-content"/) && has(reader, /v-for="para in currentChapter\.paragraphs"/) &&
  (has(reader, /class="word"/) || reader.includes("'word'")) && has(reader, /paraPhraseSpans/) ? 'PRESENT' : 'MISSING',
  '正文段落＋词级 span＋词组高亮＋图片模式（isImageBook）')

const noteBar = has(reader, /class="note-bar"/)
const barHasLookup = /note-bar[\s\S]{0,1200}查词/.test(reader)
const barHasSpeak = /note-bar[\s\S]{0,1200}朗读/.test(reader)
item('选中浮条', noteBar && barHasLookup && barHasSpeak ? 'PRESENT' : (noteBar ? 'PARTIAL' : 'MISSING'),
  noteBar
    ? `有 note-bar（划线四色＋＋笔记）；设计写「查词／笔记／朗读」，当前查词走点词开 WordPopup，浮条${barHasLookup ? '' : '无查词'}${barHasSpeak ? '' : '、无朗读'}`
    : '未找到选中浮条')

// 线框不可照抄四处：全局迷你播放器已裁、Public Books 已隐藏、E2 条件条不实现、示例数据不写死
console.log('\n[线框禁抄项 — 只核对代码没有被重新引入]')
t('全局迷你播放器未引入（底部是 N5 阅读器音频条）', !reader.includes('GlobalMiniPlayer') && player.includes('class="audio-player"'))
t('Public Books 未重新出现在阅读页', !reader.includes('Public Books'))
t('阅读页没有复习/测验条件条', !/Flashcards|QuizView|flashcards|quiz/.test(reader))

// ═══════════════════════════════════════════════════════════════════
// ③ 结论汇总
// ═══════════════════════════════════════════════════════════════════
const gaps = ui.filter(x => x.status !== 'PRESENT')
console.log('\n[UI-02 待补结论]')
if (!gaps.length) {
  console.log('  UI-02 验收项已全部具备（仍需真机读一章并回归六态）。')
} else {
  for (const g of gaps) console.log(`  - ${g.name}（${g.status}）：${g.evidence}`)
}

console.log('\n[六态回归清单 — 真机读一章后逐态点词]')
for (const [i, s] of [
  ['① 加载', "lookupState='loading'：弹窗「查词中…」"],
  ['② 命中', "lookupState='hit'：中文释义（B9 中文优先于英文缓存）"],
  ['③ 英文兜底', "lookupState='english'：回落到英文词典条目"],
  ['④ 未收', "lookupState='miss'：按 miss_dict／miss_empty 分文案，可点「在线查词」"],
  ['⑤ 错误', "lookupState='error'：网络/限额文案＋「在线查词」"],
  ['⑥ 离线', "lookupState='offline'：分片未到本机文案，不置「在线查词」"],
].entries()) console.log(`  ${s[0]}  ${s[1]}`)

console.log(`\n[结果] 基线 ${pass} 通过 / ${fail} 失败；UI-02 缺口 ${gaps.length} 项。`)
if (fail) {
  console.log('基线失败：' + failures.join('；'))
  process.exit(1)
}
if (STRICT && gaps.length) process.exit(1)
process.exit(0)
