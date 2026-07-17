<template>
  <div class="audio-player" v-if="chapterText">
    <button class="play-btn" @click="togglePlay">
      <span v-if="state === 'loading'" class="spinner-sm"></span>
      <span v-else>{{ state === 'playing' ? '⏸' : '▶' }}</span>
    </button>

    <div class="audio-info">
      <span class="audio-label">{{ statusLabel }}</span>
      <span class="audio-source">{{ source }}</span>
    </div>

    <button
      v-if="state === 'error'"
      class="fallback-btn"
      @click="useBrowserTTS"
    >
      Use Browser TTS
    </button>
  </div>
  <audio ref="audioEl" @ended="onAudioEnded" @error="onAudioError" @timeupdate="onTimeUpdate" style="display:none"></audio>
</template>

<script setup>
import { ref, watch, onUnmounted, computed } from 'vue'

const CHUNK_MAX = 160

const props = defineProps({
  chapterText: { type: String, default: '' },
  audioUrl: { type: String, default: '' }
})

const emit = defineEmits(['time'])

// ---- state machine ----

const state = ref('idle') // idle | loading | playing | error
const source = ref('Chapter audio')

const audioEl = ref(null)
let sessionId = 0

// browser TTS state
let browserSessionId = 0
let resumeTimer = null
let pollTimer = null
let chunkDone = false

const statusLabel = computed(() => {
  switch (state.value) {
    case 'loading': return 'Loading...'
    case 'playing': return 'Playing...'
    case 'error': return 'Chapter audio unavailable'
    default: return 'Read aloud'
  }
})

// ---- chapter change → stop ----
// 用 audioUrl 的 watch 拿旧值：切章瞬间 props 已更新，
// 在 stopAll 里存进度会把旧章的位置记到新章的 key 上

watch(() => props.audioUrl, (_, oldUrl) => {
  const el = audioEl.value
  if (el && el.src && !el.ended && el.currentTime > 0 && oldUrl) {
    savePosition(oldUrl, el.currentTime)
  }
  stopAll()
})

// ---- click handler ----

function togglePlay() {
  if (state.value === 'playing' || state.value === 'loading') {
    stopAll()
    return
  }
  if (props.audioUrl) {
    startStaticAudio()
  } else {
    stopAll()
    startBrowserTTS()
  }
}

// ---- static chapter MP3 (primary) ----
// 约定路径 books/<bookId>/audio/<chapterId>.mp3；404 时降级 browser TTS。
// src 只在点击时赋值（等效 preload="none"），避免翻章就预下载整章音频。
// el.play() 必须留在 click 调用栈内，满足 iOS 自动播放策略。

const LOAD_TIMEOUT = 20000
let loadTimer = null

function clearLoadTimer() {
  if (loadTimer) { clearTimeout(loadTimer); loadTimer = null }
}

function startStaticAudio(seekTo = null) {
  stopAll()
  const mySid = ++sessionId

  const el = audioEl.value
  if (!el) { startBrowserTTS(); return }

  state.value = 'loading'
  source.value = 'Chapter audio'

  el.src = props.audioUrl
  el.play().then(() => {
    if (mySid !== sessionId) return // stale
    clearLoadTimer()
    // 优先按点击的段落定位，否则恢复上次进度（快到结尾时不恢复，避免一点开就结束）
    const target = seekTo !== null ? seekTo : savedPosition(props.audioUrl)
    if (target > 0 && target < (el.duration || Infinity) - 3) {
      el.currentTime = target
    }
    state.value = 'playing'
  }).catch((err) => {
    if (mySid !== sessionId) return
    clearLoadTimer()
    console.error('Chapter audio failed:', err.name, err.message)
    state.value = 'error'
    source.value = err.name === 'NotAllowedError'
      ? 'Playback blocked — tap Browser TTS'
      : 'Audio not found — use Browser TTS'
  })

  // 慢速网络守卫：超时仍在 loading 就放弃，亮出兜底按钮
  loadTimer = setTimeout(() => {
    if (mySid !== sessionId || state.value !== 'loading') return
    if (audioEl.value) { audioEl.value.pause(); audioEl.value.removeAttribute('src') }
    state.value = 'error'
    source.value = 'Loading timed out — use Browser TTS'
  }, LOAD_TIMEOUT)
}

// ---- playback position memory + paragraph seek ----

const POS_PREFIX = 'reader-audio-pos:'
let lastSavedAt = 0

function savePosition(url, seconds) {
  try { localStorage.setItem(POS_PREFIX + url, String(seconds)) } catch { /* quota/private mode */ }
}

function savedPosition(url) {
  try {
    const v = parseFloat(localStorage.getItem(POS_PREFIX + url))
    return Number.isFinite(v) ? v : 0
  } catch { return 0 }
}

function clearPosition(url) {
  try { localStorage.removeItem(POS_PREFIX + url) } catch { /* ignore */ }
}

function onTimeUpdate() {
  const el = audioEl.value
  if (!el || state.value !== 'playing') return
  emit('time', el.currentTime)
  const now = Date.now()
  if (now - lastSavedAt > 3000) {
    lastSavedAt = now
    savePosition(props.audioUrl, el.currentTime)
  }
}

// 点击段落 ▶ 从指定秒数开始播（必须保持在用户手势调用栈内）
function playFrom(seconds) {
  if (!props.audioUrl) return
  const el = audioEl.value
  if (el && el.src && state.value === 'playing') {
    el.currentTime = seconds
    savePosition(props.audioUrl, seconds)
    return
  }
  startStaticAudio(seconds)
}

defineExpose({ playFrom })

// ---- audio element events ----
// 区分两类 error：加载期（404 等 → 亮出兜底按钮）vs 播放期（当作结束）。
// stopAll() 里 removeAttribute('src') 后即使个别浏览器触发 error，state 已是 idle，直接忽略。

function onAudioEnded() {
  clearPosition(props.audioUrl) // 读完整章，下次从头开始
  if (state.value === 'playing') stopAll()
}

function onAudioError() {
  if (state.value === 'loading') {
    state.value = 'error'
    source.value = 'Audio not found — use Browser TTS'
  } else if (state.value === 'playing') {
    stopAll()
  }
}

// ---- manual browser TTS fallback (user clicks button) ----

function useBrowserTTS() {
  stopAll()
  startBrowserTTS()
}

function startBrowserTTS() {
  if (!('speechSynthesis' in window)) {
    state.value = 'error'
    source.value = 'Browser TTS not supported'
    return
  }

  const text = props.chapterText?.trim()
  if (!text) return

  const mySid = ++browserSessionId

  // chunk text into sentences ≤ CHUNK_MAX chars each
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]
  const chunks = []
  for (const s of sentences) {
    const t = s.trim()
    if (!t) continue
    if (t.length <= CHUNK_MAX) { chunks.push(t); continue }
    const words = t.split(/\s+/)
    let cur = ''
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w
      if (cand.length > CHUNK_MAX && cur.length > 0) { chunks.push(cur); cur = w }
      else cur = cand
    }
    if (cur) chunks.push(cur)
  }
  if (chunks.length === 0) chunks.push(text)

  let idx = 0
  state.value = 'playing'
  source.value = 'Browser TTS'

  function speakNext() {
    if (mySid !== browserSessionId || idx >= chunks.length) {
      if (mySid === browserSessionId && idx >= chunks.length) stopBrowserTTS()
      return
    }

    const chunk = chunks[idx].trim()
    if (!chunk) { idx++; speakNext(); return }

    chunkDone = false
    const utt = new SpeechSynthesisUtterance(chunk)
    utt.lang = 'en-US'
    utt.rate = 0.9

    utt.onstart = () => {
      clearTimers()
      resumeTimer = setInterval(() => {
        if (mySid !== browserSessionId) { clearTimers(); return }
        if (speechSynthesis.paused) speechSynthesis.resume()
      }, 200)
    }

    utt.onend = () => {
      if (chunkDone) return; chunkDone = true
      clearTimers()
      if (mySid === browserSessionId) { idx++; speakNext() }
    }

    utt.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return
      if (chunkDone) return; chunkDone = true
      clearTimers()
      if (mySid === browserSessionId) {
        setTimeout(() => { if (mySid === browserSessionId) { idx++; speakNext() } }, 300)
      }
    }

    speechSynthesis.speak(utt)

    // poll fallback: advance even if onend never fires (iOS Safari)
    const estMs = Math.max(3000, chunk.length * 50)
    const start = Date.now()
    pollTimer = setInterval(() => {
      if (mySid !== browserSessionId) { clearTimers(); return }
      const elap = Date.now() - start
      if (!speechSynthesis.speaking && elap > 1000) {
        if (chunkDone) return; chunkDone = true
        clearTimers()
        if (mySid === browserSessionId) { idx++; speakNext() }
        return
      }
      if (elap > estMs + 5000) {
        if (chunkDone) return; chunkDone = true
        clearTimers()
        speechSynthesis.cancel()
        if (mySid === browserSessionId) { idx++; speakNext() }
      }
    }, 500)
  }

  speakNext()
}

function stopBrowserTTS() {
  browserSessionId++
  clearTimers()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
  if (state.value === 'playing') state.value = 'idle'
}

function clearTimers() {
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ---- stop everything ----

function stopAll() {
  sessionId++
  clearLoadTimer()
  stopBrowserTTS()
  // 手动停止时顺手存一次进度。切章场景由 audioUrl watcher 用旧 key 保存，
  // 此处规范化比对 URL 确认 el 里放的还是当前章，防止把旧章位置写进新章的 key
  const el = audioEl.value
  if (el && el.src && !el.ended && el.currentTime > 0 && state.value === 'playing'
      && props.audioUrl && new URL(props.audioUrl, location.href).href === el.src) {
    savePosition(props.audioUrl, el.currentTime)
  }
  state.value = 'idle'
  if (el) {
    el.pause()
    el.removeAttribute('src')
  }
  emit('time', -1)
}

// ---- lifecycle ----

onUnmounted(() => {
  stopAll()
})
</script>

<style scoped>
.audio-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-primary, #fff);
  border-top: 1px solid var(--border-color, #d2d2d7);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 150;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.08);
}

.play-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--accent-color, #1a73e8);
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.play-btn:hover {
  transform: scale(1.05);
}

.play-btn:disabled {
  opacity: 0.6;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.audio-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.audio-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #1d1d1f);
}

.audio-source {
  font-size: 11px;
  color: var(--text-secondary, #6e6e73);
}

.fallback-btn {
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid var(--accent-color, #1a73e8);
  border-radius: 6px;
  background: transparent;
  color: var(--accent-color, #1a73e8);
  cursor: pointer;
  white-space: nowrap;
}

.fallback-btn:hover {
  background: var(--accent-color, #1a73e8);
  color: white;
}
</style>
