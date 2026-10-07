/**
 * 第 17 步 · 块 D-3 —— 「浏览器朗读 → 云端音色」就地热切的自检（不依赖浏览器）。
 *   src/utils/ttsChunks.js          纯逻辑：段落表 / chunk 偏移 / 偏移→段落
 *   src/components/AudioPlayer.vue   来源级：三态源名、静默起播的顺序、放行口
 *   src/generate/GenAudioPanel.vue   来源级：就绪轮询（间隔 / 收口 / no-store / 后台不发）
 *   src/views/ReaderView.vue         来源级：段落表同源、@ready 的接线顺序
 * 用法: node verify-hotswitch.mjs
 */

import { buildParagraphStarts, chunkOffsets, paragraphIdAt } from './src/utils/ttsChunks.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const at = (s, needle) => s.indexOf(needle)
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8')

// ═══ buildParagraphStarts ═══
console.log('\n[ttsChunks — 章文本与段落起点同源]')
{
  const items = [
    { id: '', text: 'Chapter One' },
    { id: 'p-001', text: 'Hello world.' },
    { id: 'p-002', text: 'Second one.' },
  ]
  const { text, starts } = buildParagraphStarts(items)
  t('文本逐字复现旧写法（join 空格）', text === items.map(i => i.text).join(' '), text)
  t('标题占第 0 项、id 留空、起点 0', starts[0].id === '' && starts[0].start === 0)
  t('表项数与段数一致', starts.length === items.length)
  t('每项按起点切片就是它自己（同源铁证）',
    items.every((it, i) => text.slice(starts[i].start, starts[i].start + it.text.length) === it.text))
  t('起点严格递增', starts[1].start > starts[0].start && starts[2].start > starts[1].start)
}
t('空数组 → 空文本空表', eq(buildParagraphStarts([]), { text: '', starts: [] }))
t('非数组入参不抛（undefined 当空）', eq(buildParagraphStarts(undefined), { text: '', starts: [] }))
t('text 缺失的项与 join 同口径（都算空串）',
  buildParagraphStarts([{ id: 'a', text: 'x' }, { id: 'b' }]).text === ['x', undefined].join(' '))
t('中文与全角标点照样对得上', (() => {
  const items = [{ id: '', text: '第一章' }, { id: 'p-001', text: '他说：“走。”' }]
  const { text, starts } = buildParagraphStarts(items)
  return text === items.map(i => i.text).join(' ') &&
    text.slice(starts[1].start, starts[1].start + items[1].text.length) === items[1].text
})())

// ═══ chunkOffsets ═══
console.log('\n[ttsChunks — 每个 chunk 在章文本里的起点]')
{
  // 与播放器同款切句口径：/[^.!?\n]+[.!?\n]+/g 再 trim
  const text = 'Hello world. Hello again. Last one.'
  const chunks = (text.match(/[^.!?\n]+[.!?\n]+/g) || []).map(c => c.trim())
  const offs = chunkOffsets(text, chunks)
  t('偏移数 = chunk 数', offs.length === chunks.length)
  t('按偏移切片就是那个 chunk（精确，不是近似）',
    chunks.every((c, i) => text.slice(offs[i], offs[i] + c.length) === c))
  t('重复句子不会各指同一处（游标在走）', chunks[0] === 'Hello world.' && offs[1] > offs[0])
  t('偏移单调不减', offs.every((v, i) => i === 0 || v >= offs[i - 1]))
}
t('chunk 不在原文里 → 退回游标、不倒挂、不抛', eq(chunkOffsets('abc', ['zzz']), [0]))
t('空 chunk 列表 → 空表', eq(chunkOffsets('abc', []), []))
t('text 为 null 不抛', eq(chunkOffsets(null, ['a']), [0]))
t('chunks 非数组不抛', eq(chunkOffsets('abc', 'ab'), []))

// ═══ paragraphIdAt ═══
console.log('\n[ttsChunks — 字符偏移落在哪一段]')
{
  const { text, starts } = buildParagraphStarts([
    { id: '', text: 'Chapter One' },
    { id: 'p-001', text: 'Hello world.' },
    { id: 'p-002', text: 'Second one.' },
  ])
  t('标题区 → 空串（调用方按「从章首接」）',
    paragraphIdAt(starts, 0) === '' && paragraphIdAt(starts, 5) === '')
  t('正好落在段首 → 就是那一段', paragraphIdAt(starts, starts[1].start) === 'p-001')
  t('段中间 → 那一段', paragraphIdAt(starts, starts[1].start + 3) === 'p-001')
  t('末段之后 → 末段（不是空串）', paragraphIdAt(starts, text.length + 99) === 'p-002')
}
t('空表 → 空串', paragraphIdAt([], 5) === '')
t('偏移不是数 → 空串', paragraphIdAt([{ id: 'p', start: 0 }], 'x') === '' &&
  paragraphIdAt([{ id: 'p', start: 0 }], NaN) === '')
t('表不是数组 → 空串', paragraphIdAt(null, 0) === '')
t('缺 id 的项算空串（＝无段落身份）', paragraphIdAt([{ start: 0 }], 0) === '')

// ═══ AudioPlayer ═══
console.log('\n[AudioPlayer — 三态源名 ＋ 热切的顺序形状]')
const player = read('src/components/AudioPlayer.vue')
t('引了位置换算纯函数（不自己写一套）', player.includes("from '../utils/ttsChunks.js'"))
t('三态源名齐：Cloud voice ／ Browser TTS ／ Generating…',
  player.includes("ref('Cloud voice')") && player.includes("source.value = 'Browser TTS'") &&
  player.includes("'Browser TTS · Generating…'"))
t('旧源名 Chapter audio 不再当「源」用',
  !/source(\.value)?\s*=\s*'Chapter audio'/.test(player))
t('pending 分支只在「正在朗读」时出现',
  /source\.value === 'Browser TTS' && state\.value === 'playing' && props\.cloudPending/.test(player))
t('放行口：hotSwitch ＋ ttsParagraphId 都对外',
  /defineExpose\(\{[^}]*hotSwitch[^}]*\}\)/.test(player) &&
  /defineExpose\(\{[^}]*ttsParagraphId[^}]*\}\)/.test(player))
t('没在朗读 → null（调用方据此跳过热切）',
  player.includes("if (source.value !== 'Browser TTS') return null"))
t('① 静音起播在 play() 之前（无手势也放行）',
  at(player, 'el.muted = true') > 0 && at(player, 'el.muted = true') < at(player, 'await el.play()'))
t('② 起来了才停朗读（起不来就别打断用户）',
  at(player, 'await el.play()') < at(player, 'stopBrowserTTS() // 起来了才停朗读'))
t('③ 起不来的分支：还原静音标志 ＋ 原样返回 false',
  /\} catch \(err\) \{\n    el\.muted = false[\s\S]{0,200}return false/.test(player))
t('切过去之后才改状态（接着放 ＋ 源名换成云端）',
  at(player, 'await el.play()') < at(player, "state.value = 'playing'\n  source.value = 'Cloud voice'"))
t('热切时等 duration 可用（否则按秒定位会落空）', player.includes('waitForMetadata(el)'))
t('期间用户切章 → 放弃换源（sessionId 守卫）',
  player.includes('if (mySid !== sessionId) { el.muted = false; return false }'))
t('朗读游标：每句开念记一次起点', player.includes('spokenOffset = chunkStarts[idx] || 0'))
t('切句后立刻算起点表', player.includes('chunkStarts = chunkOffsets(text, chunks)'))

// ═══ GenAudioPanel ═══
console.log('\n[GenAudioPanel — 就绪轮询]')
const panel = read('src/generate/GenAudioPanel.vue')
{
  const m = /const POLL_MS = (\d+)/.exec(panel)
  t('轮询间隔落在 5–10 s（§13.2）', !!m && +m[1] >= 5000 && +m[1] <= 10000, m ? m[1] : '缺 POLL_MS')
}
t('轮询口径复用 audioGenGate（不另写一份）',
  panel.includes('chapterToken') && panel.includes('staleReply') &&
  panel.includes('pendingCheckUrl') && panel.includes('stillPending(props.audioIndex'))
t('不走缓存（否则永远读到旧索引）', panel.includes("cache: 'no-store'"))
t('过期答复丢弃（切章后旧答复不写回）', panel.includes('staleReply(token, chapterToken('))
t('命中 → emit ready 并带索引', panel.includes("emit('ready', { chapterId: id, index: body || null })"))
t('标签页在后台不发请求', panel.includes("document.visibilityState === 'hidden'"))
t('已就绪 → 停轮询（不空转）',
  panel.includes('if (!stillPending(props.audioIndex, id)) { stopPoll(); return }'))
t('卸载时收掉定时器', /onBeforeUnmount\(\(\) => \{[\s\S]{0,400}stopPoll\(\)/.test(panel))
t('状态外报带 chapterId（切章不串台）',
  panel.includes('chapterId: chapterId.value, running: running.value, pending: pending.value'))
t('入口可见性由面板外报（主包拿不到闸，不重写判定）', panel.includes('entry: gate.value.show'))

// —— 2026-10-07 实报修复：加载模型阶段进度条一动不动 ——
t('模型阶段的百分比接上了线（panel → chapterGen → engine 的 progress_callback）',
  panel.includes('onProgress: (p) => { progress.value = { ...progress.value, model: modelProgress(p) } }') &&
  /function modelProgress\(p\)/.test(panel))
t('自己走的秒表：模型阶段「已用」也在动',
  /function startTick\(\)/.test(panel) && panel.includes('tickMs.value = Date.now() - t0'))
t('秒表开跑时起、收工与卸载时停',
  panel.includes('  startTick()') &&
  /stopTick\(\)[\s\S]{0,120}running\.value = false/.test(panel) &&
  /onBeforeUnmount\(\(\) => \{[\s\S]{0,600}stopTick\(\)/.test(panel))
t('没有百分比可算的阶段不画 0% 死条（走「来回跑」态）',
  panel.includes(`:class="{ 'gen-bar-wait': !pct }"`) &&
  panel.includes(`:style="pct ? { width: pct + '%' } : {}"`) &&
  panel.includes('.gen-bar-wait > i'))
t('模型阶段有下载字节就按它算真百分比',
  /if \(stage\.value === 'model'\) return p\.model && p\.model\.total \? p\.model\.pct : 0/.test(panel))
t('进度文案把「下载了多少」说出来（不是只说「加载中」）',
  panel.includes('模型已就绪，正在初始化') && panel.includes('首次需下载约 90 MB'))
t('前台那条说清楚了：后台标签页会被降速甚至冻结',
  read('src/generate/audioGenGate.js').includes('留在前台（别切走、别最小化）') &&
  read('src/generate/audioGenGate.js').includes('后台标签页会被浏览器降速甚至冻结'))

// ═══ ReaderView ═══
console.log('\n[ReaderView — 段落表同源 ＋ @ready 的接线顺序]')
const view = read('src/views/ReaderView.vue')
t('段落表与朗读文本同源（同一 computed 产出）',
  /const chapterSpeech = computed[\s\S]{0,700}buildParagraphStarts\(/.test(view) &&
  view.includes('const currentChapterText = computed(() => chapterSpeech.value.text)') &&
  view.includes('const chapterParagraphStarts = computed(() => chapterSpeech.value.starts)'))
t('标题占第 0 项、id 留空', view.includes("{ id: '', text: currentChapter.value.title }"))
t('图片书既不发文本也不发段落表',
  view.includes("if (!currentChapter.value || isImageBook.value) return { text: '', starts: [] }"))
t('两个新 prop 绑到播放器',
  view.includes(':paragraph-starts="chapterParagraphStarts"') &&
  view.includes(':cloud-pending="cloudGenerating"'))
t('面板 status 有人接', view.includes('@status="onPanelStatus"'))
t('面板状态带 chapterId 比对（切章不串台）',
  view.includes("st.chapterId === (currentChapter.value?.id || '')"))
t('@ready：先问「念到哪一段」', view.includes('audioPlayerRef.value?.ttsParagraphId?.()'))
t('没在朗读 → 不热切', view.includes('if (pid === null || pid === undefined) return'))
t('就绪的是别的章 → 只落索引', view.includes('if (id !== currentChapter.value?.id) return'))
t('标题段（id 空）从章首接', view.includes('const sec = pid ? paraStart(pid) : 0'))
t('timings 里没这一段 → 不动，让朗读继续', view.includes('if (sec === null) return'))
t('顺序：问段 → 查秒 → nextTick → 换源',
  at(view, 'ttsParagraphId?.()') > 0 &&
  at(view, 'ttsParagraphId?.()') < at(view, 'paraStart(pid)') &&
  at(view, 'paraStart(pid)') < at(view, 'await nextTick()') &&
  at(view, 'await nextTick()') < at(view, 'hotSwitch?.(sec)'))
t('换算模块在主包侧、且不静态引生成器',
  !/(^|\n)\s*(import|export)[^\n]*generate/.test(read('src/utils/ttsChunks.js')))

console.log('\n[第 17 步块 E — 索引缓存：预取垫首帧 / 拉回写回 / 删书清掉]')
{
  t('打开书：先用缓存垫首帧（loadAudioIndex → indexUsable），再拉一次覆盖',
    view.includes('const cached = loadAudioIndex(bookId.value)') &&
    view.includes('audioIndex.value = indexUsable(cached, bookId.value) ? cached : null') &&
    at(view, 'const cached = loadAudioIndex(bookId.value)') < at(view, 'await fetchCloudIndex(bookId.value)'))
  t('拉回来的更真：写回缓存（saveAudioIndex）',
    view.includes('saveAudioIndex(bookId.value, cloud.index)'))
  t('本机刚生成的那份也写回缓存（onCloudAudioReady）',
    /onCloudAudioReady[\s\S]{0,500}saveAudioIndex\(bookId\.value, index\)/.test(view))
  t('缓存模块在主包侧、不引生成器',
    !/(^|\n)\s*(import|export)[^\n]*generate/.test(read('src/sync/audioIndexCache.js')))

  // —— 2026-10-07 Ferrari 裁 A：入口进播放器条、点开才展开 ——
  t('生成入口 ＋ 面板 ＋ 播放器同处一个停靠区',
    view.includes('<div ref="bottomDockRef" class="bottom-dock">') && view.includes('v-if="genEntry"'))
  t('入口文案就是裁的那句；展开时变「收起」',
    view.includes('genOpen ? \'收起\' : \'本章可以生成真人朗读\''))
  t('入口可见性来自面板外报（主包不重写闸判定）',
    view.includes('const genEntry = computed(() => !!panelStatus.value.entry)'))
  t('收起 ≠ 卸载：面板一直挂着，生成与轮询不会被展开状态掐断',
    view.includes(':open="genOpen"') && panel.includes('!!props.open && !!chapterId.value'))
  // 2026-10-07 真机实测踩过：留白口径只写在基础规则里，三个断点又各写死一个底部值 →
  // 桌面宽度下媒体查询盖掉它，面板展开时正文被压住。所以这里**逐个 .reader-view 块**查：
  // 每一条 padding 的底值都必须走 --dock-pad，谁写死一个 px 就红。
  const dockBlocks = view.match(/\.reader-view \{[^}]*\}/g) || []
  const dockBottoms = dockBlocks.flatMap((b) =>
    [...b.matchAll(/padding:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/).pop()))
  t('正文底部留白口径只有一处（各断点不许再写死底部值）',
    dockBottoms.length >= 2 &&
    dockBottoms.every((v) => v.includes('var(--dock-pad)')) &&
    /--dock-pad:\s*calc\(var\(--dock-h, 88px\) \+ 16px\);/.test(view),
    JSON.stringify({ blocks: dockBlocks.length, bottoms: dockBottoms }))
  t('正文底部按停靠区实测高度留白（面板展开不会被压住）',
    /new ResizeObserver\(\(\) => \{[^}]*dockH\.value = el\.offsetHeight/.test(view))
  t('播放器不再自己 fixed（定位交给停靠区）',
    !/\.audio-player \{[\s\S]{0,400}position:\s*fixed/.test(player))
}

// ═══ 2026-10-07 Ferrari 裁「3＋1」：真中断（取消掉断模型下载）＋ 防中断（唤醒锁／关页拦）═══
console.log('\n[第 17 步 · 裁「3＋1」— 真中断 ＋ 防中断]')
{
  const chapterGen = read('src/generate/chapterGen.js')
  const engine = read('src/generate/engine.js')

  t('面板持一个可中断信号（真中断的把手）',
    panel.includes('let abortCtrl = null') && panel.includes('abortCtrl = new AbortController()'))
  t('点取消 → 当场 abort（不是只举旗子等它走完）',
    /function cancel\(\) \{[\s\S]{0,300}abortCtrl\.abort\(\)/.test(panel))
  t('信号交给编排，一路传到引擎',
    panel.includes('signal: abortCtrl.signal') &&
    chapterGen.includes('signal = null,') &&
    chapterGen.includes('await load({ device, dtype, onProgress, signal })'))
  t('取消 ≠ 失败：中断按 cancelled 出，不报「加载语音模型失败」',
    // 两条都要点名：① catch 里就该分流（不能落到 model-failed）；
    // ② 模型装完才发现已取消的那一道也得在（不然白合成一整章）。
    /catch \(e\) \{[^}]{0,220}if \(aborted\(\)\) return fail\('cancelled', 'cancelled'\)/.test(chapterGen) &&
    /if \(aborted\(\)\) return fail\('cancelled', 'cancelled'\)\n  \}/.test(chapterGen) &&
    panel.includes("res.step === 'cancelled'"))
  t('引擎：模型请求挂信号、收工必清、别的请求不动',
    engine.includes('let activeModelSignal = null') &&
    /if \(activeModelSignal && isModelUrl\(url\)\)/.test(engine) &&
    /finally \{\s*activeModelSignal = null\s*\}/.test(engine))

  t('防中断①：生成期间申请屏幕唤醒锁',
    panel.includes("navigator.wakeLock.request('screen')") &&
    /function startKeepAlive\(\)[\s\S]{0,200}acquireWake\(\)/.test(panel))
  t('防中断①：回前台补一次（后台会被系统收走）',
    /visibilitychange', onVisibility/.test(panel) && /function onVisibility\(\) \{ if \(running\.value\)/.test(panel))
  t('防中断①：收工与卸载都释放（只挂不摘就是漏）',
    /function stopKeepAlive\(\)[\s\S]{0,260}releaseWake\(\)/.test(panel) &&
    /onBeforeUnmount\(\(\) => \{[\s\S]{0,500}stopKeepAlive\(\)/.test(panel) &&
    /abortCtrl = null\n  stopTick\(\)\n  stopKeepAlive\(\)/.test(panel))
  t('防中断②：生成中关页／刷新会弹原生确认',
    panel.includes("window.addEventListener('beforeunload', onBeforeUnload)") &&
    panel.includes('e.returnValue =') &&
    /function stopKeepAlive\(\)[\s\S]{0,260}removeEventListener\('beforeunload', onBeforeUnload\)/.test(panel))
  t('两条都是尽力而为（不支持／被拒不拦生成）',
    /catch \{ wakeSentinel = null \}/.test(panel) &&
    panel.includes("if (typeof navigator === 'undefined' || !navigator.wakeLock) return"))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
