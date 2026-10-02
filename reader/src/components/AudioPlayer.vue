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
import { audioStorageKey } from '../sync/progress.js'
import { nowIso } from '../sync/clock.js'

const CHUNK_MAX = 160

const props = defineProps({
  chapterText: { type: String, default: '' },
  audioUrl: { type: String, default: '' },
  bookId: { type: String, default: '' },
  chapterId: { type: String, default: '' },
  bookTitle: { type: String, default: '' },
  chapterTitle: { type: String, default: '' }
})

const emit = defineEmits(['time', 'next-track', 'prev-track'])

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
// 切章瞬间 props 已经变成新章了，所以不能在 stopAll 里读 props 取 key
// （那会把旧章的位置写进新章的键）。改为信任 playingIds —— 那是元素里实际装着的那一章。
// 换书时 chapterId 可能不变（不同书都有 ch-001），所以 bookId 也必须在依赖里。

watch([() => props.bookId, () => props.chapterId], () => stopAll())

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
  // 记下元素里装的到底是哪一章 —— 之后 props 会先于 stopAll 变掉
  playingIds = { bookId: props.bookId, chapterId: props.chapterId }

  el.src = props.audioUrl
  el.play().then(() => {
    if (mySid !== sessionId) return // stale
    clearLoadTimer()
    // 优先按点击的段落定位，否则恢复上次进度（快到结尾时不恢复，避免一点开就结束）
    const target = seekTo !== null ? seekTo : savedPosition()
    if (target > 0 && target < (el.duration || Infinity) - 3) {
      el.currentTime = target
    }
    state.value = 'playing'
    // Media Session 注册锁屏控件
    setupMediaSession()
    navigator.mediaSession.playbackState = 'playing'
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
//
// 键由 sync/progress.js 统一给出，不再用完整 audioUrl：
// URL 里嵌着域名（这个 app 已经换过一次域名），域名一变旧键全成孤儿，
// 而同步逻辑还得反过来硬编码域名去认它们。
// 值是 {seconds, updatedAt} 而不是光秃的秒数——纯数字没法参与跨设备的新旧比较。

let lastSavedAt = 0

/** 正在播的那一章（用于停止时把位置写回正确的键，而不是当前 props 的键） */
let playingIds = null

// 懒加载：进度保存很频繁，不该把同步栈塞进音频组件的静态依赖里
let _syncApi = undefined

function notifySync() {
  const poke = (api) => {
    if (document.visibilityState === 'hidden') api.flushNow()
    else api.pushSoon()
  }
  if (_syncApi === undefined) {
    import('../composables/useSync.js')
      .then(m => { _syncApi = m.useSync; return _syncApi() })
      .then(poke)
      .catch(() => { _syncApi = undefined })
  } else if (_syncApi) {
    poke(_syncApi())
  }
}

/**
 * @param {boolean} notify 是否顺带安排一次同步推送。
 *   定时保存（每 3 秒的 timeupdate）传 false——那会把整份进度载荷反复推上去；
 *   暂停 / 切章 / 听完这些「动作结束」的时刻才值得推一次。
 */
function saveAt(bookId, chapterId, seconds, notify) {
  if (!bookId || !chapterId) return
  try {
    localStorage.setItem(audioStorageKey(bookId, chapterId),
      JSON.stringify({ seconds, updatedAt: nowIso() }))
    if (notify) notifySync()
  } catch { /* quota/private mode */ }
}

function savePosition(seconds, notify = false) {
  saveAt(props.bookId, props.chapterId, seconds, notify)
}

function savedPosition() {
  if (!props.bookId || !props.chapterId) return 0
  try {
    const raw = localStorage.getItem(audioStorageKey(props.bookId, props.chapterId))
    if (!raw) return 0
    const v = JSON.parse(raw)
    // 旧格式是裸秒数（JSON.parse 出来是 number）→ 当 0 处理。
    // 值格式变更，旧的本地续播位置作废；影响仅限于「从哪儿接着听」。
    const s = (v && typeof v === 'object') ? Number(v.seconds) : NaN
    return Number.isFinite(s) ? s : 0
  } catch { return 0 }
}

// ---- Media Session API（锁屏音频控制）----

const hasMediaSession = 'mediaSession' in navigator
// iOS Safari 15+ 不支持 setPositionState / seek 按钮（Q4 fix）
const hasPositionState = hasMediaSession && typeof navigator.mediaSession.setPositionState === 'function'
let posStateThrottle = 0 // positionState 每秒最多更新一次

function mediaMeta() {
  // 回退 title：取 chapterText 第一句话，避免长篇文字截断成乱码（Q15 fix）
  const firstSentence = props.chapterText?.match(/^[^.!\n]+[.!\n]?/)?.[0]?.trim()
  const meta = {
    title: props.chapterTitle || firstSentence || 'Chapter',
    artist: props.bookTitle || 'my-reader',
    album: props.bookTitle || '',
    artwork: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }]
  }
  return new MediaMetadata(meta)
}

function setupMediaSession() {
  if (!hasMediaSession) return
  navigator.mediaSession.metadata = mediaMeta()

  // 锁屏 play 守卫：有 MP3 才调用 togglePlay，避免误触 Browser TTS（Issue E fix）
  navigator.mediaSession.setActionHandler('play', () => {
    if (props.audioUrl) togglePlay()
  })
  navigator.mediaSession.setActionHandler('pause', () => stopAll())
  navigator.mediaSession.setActionHandler('stop', () => stopAll()) // Issue F fix
  navigator.mediaSession.setActionHandler('previoustrack', () => emit('prev-track'))
  navigator.mediaSession.setActionHandler('nexttrack', () => emit('next-track'))

  if (hasPositionState) {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const el = audioEl.value
      if (el && Number.isFinite(el.duration)) {
        el.currentTime = Math.max(0, el.currentTime - (details.seekOffset || 10))
      }
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const el = audioEl.value
      if (el && Number.isFinite(el.duration)) {
        el.currentTime = Math.min(el.duration, el.currentTime + (details.seekOffset || 10))
      }
    })
  }
}

function updatePositionState() {
  if (!hasPositionState) return // iOS no-op（Q4 fix）
  const el = audioEl.value
  if (!el || !Number.isFinite(el.duration)) return
  const now = Date.now()
  if (now - posStateThrottle < 1000) return // 每秒最多一次
  posStateThrottle = now
  navigator.mediaSession.setPositionState({
    duration: el.duration,
    playbackRate: el.playbackRate || 1,
    position: el.currentTime
  })
}

function teardownMediaSession() {
  if (!hasMediaSession) return
  navigator.mediaSession.setActionHandler('play', null)
  navigator.mediaSession.setActionHandler('pause', null)
  navigator.mediaSession.setActionHandler('stop', null)
  navigator.mediaSession.setActionHandler('previoustrack', null)
  navigator.mediaSession.setActionHandler('nexttrack', null)
  if (hasPositionState) {
    navigator.mediaSession.setActionHandler('seekbackward', null)
    navigator.mediaSession.setActionHandler('seekforward', null)
  }
  navigator.mediaSession.metadata = null // Issue C fix
  navigator.mediaSession.playbackState = 'none'
}

// 切章/换书时 meta 数据变化 → 如果 Media Session 处于激活状态则同步更新（Q9 fix）
watch([() => props.bookTitle, () => props.chapterTitle], () => {
  if (!hasMediaSession) return
  // 仅在之前已设置了 metadata 的情况下更新（避免凭空创建 Now Playing 条目）
  if (navigator.mediaSession.metadata) {
    navigator.mediaSession.metadata = mediaMeta()
  }
})

function onTimeUpdate() {
  const el = audioEl.value
  if (!el || state.value !== 'playing') return
  emit('time', el.currentTime)
  updatePositionState()
  const now = Date.now()
  if (now - lastSavedAt > 3000) {
    lastSavedAt = now
    savePosition(el.currentTime) // 不推送：3 秒一次的位置不值得每次都跑一趟网络
  }
}

// 点击段落 ▶ 从指定秒数开始播（必须保持在用户手势调用栈内）
function playFrom(seconds) {
  if (!props.audioUrl) return
  const el = audioEl.value
  if (el && el.src && state.value === 'playing') {
    el.currentTime = seconds
    savePosition(seconds, true)
    return
  }
  startStaticAudio(seconds)
}

defineExpose({ playFrom, stop: stopAll })

// ---- audio element events ----
// 区分两类 error：加载期（404 等 → 亮出兜底按钮）vs 播放期（当作结束）。
// stopAll() 里 removeAttribute('src') 后即使个别浏览器触发 error，state 已是 idle，直接忽略。

function onAudioEnded() {
  // 写成 0 而不是删掉键：删键只是本机行为，同步层看不到「已经听完」这件事，
  // 另一台设备会一直保留它那边的非零位置。写 0 才是一次可比较的「回到开头」。
  savePosition(0, true)
  // 保持 paused 状态而非 none → 锁屏 play 按钮仍可用，用户可重播本章（Q5 fix）
  if (hasMediaSession) navigator.mediaSession.playbackState = 'paused'
  if (state.value === 'playing') stopAll()
}

function onAudioError() {
  if (state.value === 'loading') {
    state.value = 'error'
    source.value = 'Audio not found — use Browser TTS'
  } else if (state.value === 'playing') {
    if (hasMediaSession) navigator.mediaSession.playbackState = 'paused' // Issue D fix
    stopAll()
  }
}

// ---- manual browser TTS fallback (user clicks button) ----

function useBrowserTTS() {
  stopAll()
  startBrowserTTS()
}

function startBrowserTTS() {
  teardownMediaSession() // Browser TTS 锁屏不可靠，清除旧的 MP3 锁屏信息
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
  // 暂停时保持 handlers 存活 → 用户可从锁屏恢复播放（Q5 fix）
  if (hasMediaSession) navigator.mediaSession.playbackState = 'paused'
  sessionId++
  clearLoadTimer()
  stopBrowserTTS()
  // 手动停止 / 切章 / 换书时存一次进度。键取自 playingIds 而不是 props：
  // 切章是 props 先更新、随后才走到这里，读 props 会把旧章位置记到新章头上。
  // 这里也是「动作结束」的时刻，所以顺带安排一次同步推送。
  const el = audioEl.value
  if (el && el.src && !el.ended && el.currentTime > 0 && state.value === 'playing' && playingIds) {
    saveAt(playingIds.bookId, playingIds.chapterId, el.currentTime, true)
  }
  playingIds = null
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
  teardownMediaSession() // 组件销毁时彻底清理锁屏控件
})
</script>

<style scoped>
.audio-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
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
