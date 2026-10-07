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
        <div class="gen-bar"><i :style="{ width: pct + '%' }"></i></div>
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
} from './audioGenGate.js'
import { generateChapterAudio } from './chapterGen.js'

const props = defineProps({
  bookId: { type: String, default: '' },
  chapter: { type: Object, default: null },
  audioIndex: { type: Object, default: null },
  isByo: { type: Boolean, default: false },
  loggedIn: { type: Boolean, default: false }
})
const emit = defineEmits(['ready', 'browser-tts'])

const STAGE_LABEL = { model: '加载语音模型', synth: '合成音频', encode: '编码 mp3', upload: '上传到你的账号空间' }
const EMPTY_PROGRESS = { index: 0, total: 0, elapsedMs: 0, etaMs: 0 }

const running = ref(false)
const justDone = ref(false)
const error = ref(null)
const notice = ref('')
const stage = ref('')
const progress = ref({ ...EMPTY_PROGRESS })
let cancelFlag = false
let doneTimer = null

const chapterId = computed(() => props.chapter?.id || '')

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
const show = computed(() => !!chapterId.value && (gate.value.show || justDone.value))

const pct = computed(() => (progress.value.total ? Math.round((progress.value.index / progress.value.total) * 100) : 0))

function fmtElapsed(ms) {
  const s = Math.round((ms || 0) / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

const progressLine = computed(() => {
  const p = progress.value
  const bits = [STAGE_LABEL[stage.value] || '准备中']
  if (p.total) bits.push(`${p.index}/${p.total}`)
  if (p.elapsedMs) bits.push(`已用 ${fmtElapsed(p.elapsedMs)}`)
  if (p.etaMs) bits.push(`预计还需${formatEta(p.etaMs)}`)
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

watch(chapterId, () => {
  justDone.value = false
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null }
  reset()
})

onBeforeUnmount(() => {
  cancelFlag = true // 离开这本书就别再算了（结果会以 cancelled 回来，没人接）
  if (doneTimer) clearTimeout(doneTimer)
})

function cancel() {
  cancelFlag = true
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

  const res = await generateChapterAudio({
    bookId: props.bookId,
    chapterId: chapterId.value,
    chapter: props.chapter,
    onStage: (s) => { stage.value = s },
    onChunk: ({ index, total, elapsedMs }) => {
      progress.value = { index, total, elapsedMs, etaMs: estimateRemainingMs(index, total, elapsedMs) }
    },
    shouldCancel: () => cancelFlag
  })

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
  margin: 16px 0;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #e5e5ea);
  border-radius: 10px;
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
.gen-error { margin-top: 8px; color: #b3261e; }
.gen-error-line { margin-bottom: 8px; line-height: 1.5; }
.gen-done { color: var(--success-color, #34c759); line-height: 1.5; }
.gen-notice { margin-top: 8px; color: var(--text-secondary, #6e6e73); }
.gen-notes { margin-top: 10px; color: var(--text-secondary, #6e6e73); }
.gen-notes summary { cursor: pointer; }
.gen-notes ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.6; }
</style>