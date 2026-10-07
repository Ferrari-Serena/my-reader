<template>
  <div v-if="show" class="gen-panel">
    <div class="gen-head">
      <span class="gen-title">云端音色朗读</span>
      <span class="gen-sub">{{ chapterId }}</span>
    </div>

    <div v-if="justDone" class="gen-done">✅ 生成好了 —— 这一章在别的设备上现在也能直接听。</div>

    <template v-else>
      <p class="gen-lead">{{ GEN_SCOPE_NOTE }}{{ GEN_ESTIMATE_NOTE }}</p>

      <div class="gen-actions">
        <button v-if="!running" class="gen-btn" :disabled="!gate.offer" @click="start">生成这一章</button>
        <button v-else class="gen-btn gen-btn-stop" @click="cancel">取消</button>
        <span v-if="!gate.offer && !running" class="gen-hint">{{ reasonHint }}</span>
      </div>

      <div v-if="running" class="gen-progress">
        <!-- 没有百分比可算的阶段（下载模型 / 还没合成完第一块）走「来回跑」的条 ——
             0% 的死条会让人以为卡死了（Ferrari 2026-10-07 实报）。 -->
        <div class="gen-bar" :class="{ 'gen-bar-wait': !pct }">
          <i :style="pct ? { width: pct + '%' } : {}"></i>
        </div>
        <div class="gen-line">{{ progressLine }}</div>
      </div>

      <div v-if="error" class="gen-error">
        <div class="gen-error-line">{{ errorLine }}</div>
        <div class="gen-actions">
          <button class="gen-btn" @click="start">重试</button>
          <button class="gen-btn gen-btn-ghost" @click="$emit('browser-tts')">改用浏览器朗读</button>
        </div>
      </div>

      <div v-if="notice" class="gen-notice">{{ notice }}</div>

      <details class="gen-notes">
        <summary>生成前请看（{{ GEN_NOTES.length }} 条）</summary>
        <ul>
          <li v-for="n in GEN_NOTES" :key="n.id">{{ n.text }}</li>
        </ul>
      </details>
    </template>
  </div>
</template>

<script setup>
/**
 * 第 17 步（D17／D20）· 块 D —— 「生成这一章」面板。
 *
 * 位置为什么在 `src/generate/` 而不是 `src/components/`：它**静态**引 `audioGenGate.js` 与
 * `chapterGen.js`，而主包不许静态引本目录（见 verify-generate.mjs 的卫生断言）。放在这一侧
 * 就自洽了 —— 组件连同引擎一起落在懒加载 chunk 里；主包那边只用
 * `defineAsyncComponent(() => import(...))` 动态取它。
 *
 * 口径全在 `audioGenGate.js`：准入闸、pending 判定、六条说明、ETA 文案。这里只负责
 * 「跑起来、画进度、把失败说人话」，判定一行都不重复（免得两处漂）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  detectWebGPU, shouldOfferGeneration, stillPending, GEN_REASON_HINT,
  GEN_NOTES, GEN_SCOPE_NOTE, GEN_ESTIMATE_NOTE, estimateRemainingMs, formatEta,
  chapterToken, staleReply, pendingCheckUrl,
} from './audioGenGate.js'
import { generateChapterAudio } from './chapterGen.js'

const props = defineProps({
  bookId: { type: String, default: '' },
  chapter: { type: Object, default: null },
  audioIndex: { type: Object, default: null },
  isByo: { type: Boolean, default: false },
  loggedIn: { type: Boolean, default: false },
  /** 展开／收起（2026-10-07 裁 A）：**收起只是不渲染，组件本身不移除** ——
   *  生成一刻不能停、就绪轮询也要照跑（移除组件会触发 cancelFlag）。 */
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['ready', 'browser-tts', 'status'])

const STAGE_LABEL = { model: '加载语音模型', synth: '合成音频', encode: '编码 mp3', upload: '上传到你的账号空间' }
const EMPTY_PROGRESS = { index: 0, total: 0, elapsedMs: 0, etaMs: 0, model: null }

const running = ref(false)
const justDone = ref(false)
const error = ref(null)
const notice = ref('')
const stage = ref('')
const progress = ref({ ...EMPTY_PROGRESS })
const tickMs = ref(0) // 自己走的秒表（见 startTick）：模型那几分钟没有 onChunk，靠它让「已用」动起来
let cancelFlag = false
let doneTimer = null
/** 「取消」要能掐断**正在飞**的模型下载：这个信号一路传到 engine 的 fetch 包装（见 engine.js） */
let abortCtrl = null

const chapterId = computed(() => props.chapter?.id || '')

/**
 * transformers.js `progress_callback` 的回执 → 面板要的四个数。**认不出来就当没有** ——
 * 宁可显示「正在下载」也不要拿错的百分比骗人（形状见 engine.loadModel 的接线）。
 */
function modelProgress(p) {
  if (!p || typeof p !== 'object') return null
  const total = Number(p.total) || 0
  const loaded = Number(p.loaded) || 0
  let pct = Number(p.progress)
  if (!Number.isFinite(pct)) pct = total ? (loaded / total) * 100 : 0
  pct = Math.max(0, Math.min(100, Math.round(pct)))
  const done = p.status === 'done' || p.status === 'ready'
  return { pct: done ? 100 : pct, loaded, total, file: String(p.file || p.name || '') }
}
const mb = (n) => (Number(n) > 0 ? (Number(n) / 1048576).toFixed(1) + ' MB' : '')

/**
 * 自己走的秒表（块 D-3 后的实报修复，2026-10-07）。**为什么必须有**：模型阶段（下载 90 MB ＋
 * 初始化）到第一块合成完成之间**一个 onChunk 都没有** —— 只靠回调的话，「已用」整段时间是空的、
 * 进度条停在 0%，用户只能盯着一个不动的界面猜「是不是卡了」。秒表只在前台走：后台标签页
 * setInterval 会被浏览器降到分钟级，那是它的规矩，不跟它斗。
 */
let tickTimer = null
function startTick() {
  stopTick()
  const t0 = Date.now()
  tickMs.value = 0
  tickTimer = setInterval(() => { tickMs.value = Date.now() - t0 }, 1000)
}
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null } }

// ── 防中断（2026-10-07 裁「3＋1」）─────────────────────────────────────────────
// 这一章要跑 15–20 分钟，被系统休眠／误关标签页掐断就得从零重来。两条**最便宜**的防线：
//   ① 屏幕唤醒锁：生成期间别让屏幕（连带系统）睡着。锁只在页面可见时有效 —— 切后台会被系统
//      收走，所以回前台要补一次（visibilitychange）。
//   ② 关页/刷新拦一下：正在生成时让浏览器弹原生确认，别一点就没了。
// 两条都是**尽力而为**：不支持／被拒就静默放过，绝不拦生成。
let wakeSentinel = null

async function acquireWake() {
  try {
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (wakeSentinel) return
    wakeSentinel = await navigator.wakeLock.request('screen')
    wakeSentinel.addEventListener('release', () => { wakeSentinel = null })
  } catch { wakeSentinel = null }
}
async function releaseWake() {
  const s = wakeSentinel
  wakeSentinel = null
  try { if (s) await s.release() } catch { /* 已经自己没了 */ }
}
function onVisibility() { if (running.value) acquireWake() }
function onBeforeUnload(e) {
  e.preventDefault()
  e.returnValue = '' // 现代浏览器只认这一句：给了就弹原生确认（文案由浏览器定，改不了）
  return ''
}
function startKeepAlive() {
  acquireWake()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload)
}
function stopKeepAlive() {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
  releaseWake()
}

/**
 * 已就绪 = 清单里点了名。
 * ⚠️ 与播放器的 `chapterHasAudio` **故意不同**：那边清单缺失时按「有音频」兜底（不妄断），
 * 这里清单缺失恰恰＝「还没生成过」→ 要**给**生成入口（见 audioGenGate.stillPending 的头注）。
 */
const alreadyReady = computed(() => !stillPending(props.audioIndex, chapterId.value))
const gate = computed(() => shouldOfferGeneration({
  hasWebGPU: detectWebGPU(), isByo: props.isByo, loggedIn: props.loggedIn, alreadyReady: alreadyReady.value
}))
const reasonHint = computed(() => GEN_REASON_HINT[gate.value.reason] || '')
/** 刚生成完那几秒里哪怕闸已经判「就绪」也留着 —— 否则面板会在成功的同一帧消失，像什么都没发生 */
const show = computed(() => !!props.open && !!chapterId.value && (gate.value.show || justDone.value))

const pct = computed(() => {
  const p = progress.value
  // 模型阶段没有「第几块」—— 有下载字节就按它算（真百分比），没有就交回 0（条走「来回跑」态）
  if (stage.value === 'model') return p.model && p.model.total ? p.model.pct : 0
  return p.total ? Math.round((p.index / p.total) * 100) : 0
})

function fmtElapsed(ms) {
  const s = Math.round((ms || 0) / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

const progressLine = computed(() => {
  const p = progress.value
  const bits = [STAGE_LABEL[stage.value] || '准备中']
  if (stage.value === 'model') {
    const m = p.model
    if (m && m.total) bits.push(`${m.pct}%`)
    if (m && m.total) bits.push(`${mb(m.loaded)} / ${mb(m.total)}`)
    else if (m && m.pct >= 100) bits.push('模型已就绪，正在初始化')
    else bits.push('首次需下载约 90 MB（之后走浏览器缓存）')
  } else if (p.total) {
    bits.push(`${p.index}/${p.total}`)
    bits.push(`预计还需${formatEta(p.etaMs)}`)
  }
  // 「已用」取「秒表」与「引擎回报」的较大者：切换阶段时不会往回跳
  const el = Math.max(p.elapsedMs || 0, tickMs.value)
  if (el >= 1000) bits.push(`已用 ${fmtElapsed(el)}`)
  return bits.join(' · ')
})

const errorLine = computed(() => {
  const e = error.value
  if (!e) return ''
  if (e.reason === 'model-failed') return `加载语音模型失败：${e.message || '未知原因'}`
  if (e.reason === 'synth-failed') return `合成失败：${e.message || '未知原因'}`
  if (e.reason === 'encode-failed') return `音频编码失败：${e.message || '未知原因'}`
  if (e.step === 'upload') {
    if (e.status === 401) return '登录状态已失效 —— 重新登录后再试。'
    if (e.status === 403) return '你的账号空间已满（或这本书超出配额），这一章传不上去。可以继续用浏览器朗读。'
    if (e.status === 429) return '上传太频繁被临时限流了。等一会儿再试，或继续用浏览器朗读。'
    return `上传失败（${e.substep || 'upload'} · ${e.status || e.reason || '未知'}）。可以重试，或继续用浏览器朗读。`
  }
  return '生成失败。可以重试，或继续用浏览器朗读。'
})

function reset() {
  cancelFlag = true
  error.value = null
  notice.value = ''
  if (!running.value) { stage.value = ''; progress.value = { ...EMPTY_PROGRESS } }
}

// ---- 就绪轮询（第 17 步块 D-3）----
// 这一章还没就绪时，隔几秒问一次「这本书的云端索引变了没」。命中就 emit('ready')，
// ReaderView 落索引并让播放器热切。轮询放在**懒加载这一侧**是刻意的：本文件已经引了
// audioGenGate，判定口径天然一处，主包不必再养第二份。
// 收口三处：① 已就绪 → 停；② 切章/换书/索引变 → 重判；③ 卸载 → 停。标签页在后台不发请求。
const POLL_MS = 6000
let pollTimer = null
let pollBusy = false

const pending = computed(() => stillPending(props.audioIndex, chapterId.value))

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function pollOnce() {
  const id = chapterId.value
  if (!id || !props.bookId) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return // 后台不空转
  if (!stillPending(props.audioIndex, id)) { stopPoll(); return }
  if (pollBusy) return
  const token = chapterToken(props.bookId, id)
  pollBusy = true
  try {
    const res = await fetch(pendingCheckUrl(props.bookId), { cache: 'no-store', credentials: 'same-origin' })
    const body = res.ok ? await res.json().catch(() => null) : null
    // 过期答复（用户已经切章/换书）一律丢弃 —— 别把上一章的索引写到这一章头上
    if (staleReply(token, chapterToken(props.bookId, chapterId.value))) return
    if (!stillPending(body, id)) emit('ready', { chapterId: id, index: body || null })
  } catch { /* 网络抖动：下个 tick 再来 */ }
  finally { pollBusy = false }
}

function startPoll() {
  stopPoll()
  const id = chapterId.value
  if (!id || !props.bookId) return
  if (!stillPending(props.audioIndex, id)) return
  pollTimer = setInterval(pollOnce, POLL_MS)
}

// 状态外报：ReaderView 拿它决定播放器副标题要不要写「Generating…」。
// 带 chapterId 一起报 —— 调用方因此不必另设「切章清空」钩子，也不会把上一章的状态串过来。
watch([pending, running, chapterId], () => {
  emit('status', {
    chapterId: chapterId.value, running: running.value, pending: pending.value,
    // 入口那一行跟不跟着播放器走，由**这里**一个人说了算（闸口径只有一处）——
    // 主包拿不到 audioGenGate，别再在播放器那边重写一份判定。
    entry: gate.value.show,
  })
}, { immediate: true })

watch([() => props.bookId, chapterId, () => props.audioIndex], startPoll, { immediate: true })

watch(chapterId, () => {
  justDone.value = false
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null }
  reset()
})

onBeforeUnmount(() => {
  cancelFlag = true // 离开这本书就别再算了（结果会以 cancelled 回来，没人接）
  if (doneTimer) clearTimeout(doneTimer)
  stopPoll() // 就绪轮询：组件没了就别再问了
  stopTick() // 秒表：组件没了就停
  stopKeepAlive() // 唤醒锁 ＋ 关页拦截：组件没了就撤
})

function cancel() {
  cancelFlag = true
  // 真中断：光举旗子只能等模型那一步自己走完（合成阶段才查旗子），这里**当场**把下载掐掉
  if (abortCtrl) abortCtrl.abort()
  notice.value = '已取消。这一章还没生成。'
}

async function start() {
  if (running.value || !gate.value.offer) return
  running.value = true
  error.value = null
  notice.value = ''
  justDone.value = false
  cancelFlag = false
  stage.value = 'model'
  progress.value = { ...EMPTY_PROGRESS }
  startTick()
  startKeepAlive()

  abortCtrl = new AbortController()
  const res = await generateChapterAudio({
    bookId: props.bookId,
    chapterId: chapterId.value,
    chapter: props.chapter,
    signal: abortCtrl.signal,
    onStage: (s) => { stage.value = s },
    // 模型阶段的百分比只有它报得上来：engine.loadModel 早就把 progress_callback 接好了，
    // 面板这边不接线就等于白接（2026-10-07 实报：加载时一点反应都没有）。
    onProgress: (p) => { progress.value = { ...progress.value, model: modelProgress(p) } },
    onChunk: ({ index, total, elapsedMs }) => {
      // 进到合成阶段：模型那份百分比到此为止（切回「第几块」口径）
      progress.value = { index, total, elapsedMs, etaMs: estimateRemainingMs(index, total, elapsedMs), model: null }
    },
    shouldCancel: () => cancelFlag
  })

  abortCtrl = null
  stopTick()
  stopKeepAlive()
  running.value = false
  stage.value = ''
  progress.value = { ...EMPTY_PROGRESS }

  if (res.ok) {
    justDone.value = true
    if (doneTimer) clearTimeout(doneTimer)
    doneTimer = setTimeout(() => { justDone.value = false }, 8000)
    emit('ready', { chapterId: res.chapterId || chapterId.value, index: res.index })
    return
  }
  if (res.step === 'cancelled') { notice.value = '已取消。这一章还没生成。'; return }
  error.value = res
}
</script>

<style scoped>
.gen-panel {
  /* 在 .bottom-dock 里：左右下都不再留边（贴播放器条），太高就自己滚 */
  margin: 0;
  padding: 12px 14px;
  border: 0;
  border-top: 1px solid var(--border-color, #e5e5ea);
  border-radius: 10px 10px 0 0;
  max-height: 46vh;
  overflow-y: auto;
  background: var(--panel-bg, #fafafa);
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
}
.gen-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.gen-title { font-weight: 600; }
.gen-sub { color: var(--text-secondary, #6e6e73); font-size: 12px; }
.gen-lead { margin: 0 0 8px; color: var(--text-secondary, #6e6e73); line-height: 1.5; }
.gen-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gen-btn {
  padding: 6px 12px; border-radius: 8px; border: 1px solid var(--accent-color, #1a73e8);
  background: var(--accent-color, #1a73e8); color: #fff; cursor: pointer; font-size: 13px;
}
.gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gen-btn-stop { background: transparent; color: var(--accent-color, #1a73e8); }
.gen-btn-ghost { background: transparent; color: var(--text-secondary, #6e6e73); border-color: var(--border-color, #e5e5ea); }
.gen-hint { color: var(--text-secondary, #6e6e73); }
.gen-progress { margin-top: 10px; }
.gen-bar { height: 6px; border-radius: 3px; background: var(--border-color, #e5e5ea); overflow: hidden; }
.gen-bar > i { display: block; height: 100%; background: var(--accent-color, #1a73e8); transition: width 0.3s; }
.gen-line { margin-top: 6px; color: var(--text-secondary, #6e6e73); }
/* 没有百分比可算时的「来回跑」条：宽度由 CSS 给（内联 width 此时是空的） */
.gen-bar-wait > i { width: 38%; animation: gen-slide 1.4s ease-in-out infinite; }
@keyframes gen-slide { 0% { margin-left: 0 } 50% { margin-left: 62% } 100% { margin-left: 0 } }
.gen-error { margin-top: 8px; color: #b3261e; }
.gen-error-line { margin-bottom: 8px; line-height: 1.5; }
.gen-done { color: var(--success-color, #34c759); line-height: 1.5; }
.gen-notice { margin-top: 8px; color: var(--text-secondary, #6e6e73); }
.gen-notes { margin-top: 10px; color: var(--text-secondary, #6e6e73); }
.gen-notes summary { cursor: pointer; }
.gen-notes ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.6; }
</style>