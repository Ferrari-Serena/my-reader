<template>
  <div class="audio-player" v-if="chapterText">
    <button class="play-btn" @click="togglePlay" :disabled="state === 'loading'">
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
  <audio ref="audioEl" @ended="onAudioDone" @error="onAudioDone" style="display:none"></audio>
</template>

<script setup>
import { ref, watch, onUnmounted, computed } from 'vue'

const TTS_WORKER = 'https://my-reader-tts.serena605371358.workers.dev'
const FETCH_TIMEOUT = 30000
const CHUNK_MAX = 160

const props = defineProps({
  chapterText: { type: String, default: '' }
})

// ---- state machine ----

const state = ref('idle') // idle | loading | playing | error
const source = ref('Cloud TTS')

const audioEl = ref(null)
let sessionId = 0
let abortController = null
let blobUrl = null

// browser TTS state
let browserSessionId = 0
let resumeTimer = null
let pollTimer = null
let chunkDone = false

const statusLabel = computed(() => {
  switch (state.value) {
    case 'loading': return 'Loading...'
    case 'playing': return 'Playing...'
    case 'error': return 'Cloud TTS unavailable'
    default: return 'Read aloud'
  }
})

// ---- chapter change → stop ----

watch(() => props.chapterText, () => {
  stopAll()
})

// ---- click handler ----

async function togglePlay() {
  if (state.value === 'playing') {
    stopAll()
    return
  }
  if (state.value === 'loading') {
    stopAll()
    return
  }
  await startCloudTTS()
}

// ---- Cloud TTS (primary) ----

async function startCloudTTS() {
  const text = props.chapterText?.trim()
  if (!text) return

  // clean up any previous session
  stopAll()
  const mySid = ++sessionId

  // P0: pre-warm audio element within user gesture to lock autoplay permission
  await preWarmAudio()

  state.value = 'loading'
  source.value = 'Cloud TTS'

  try {
    abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), FETCH_TIMEOUT)

    const resp = await fetch(`${TTS_WORKER}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: 'asteria' }),
      signal: abortController.signal
    })
    clearTimeout(timeoutId)

    if (mySid !== sessionId) return // stale

    if (!resp.ok) throw new Error(`Worker returned ${resp.status}`)

    const blob = await resp.blob()
    if (mySid !== sessionId) return // stale

    // revoke previous blob URL
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null }
    blobUrl = URL.createObjectURL(blob)

    const el = audioEl.value
    if (!el) { state.value = 'error'; return }

    el.src = blobUrl
    await el.play()

    if (mySid !== sessionId) return // stale
    state.value = 'playing'

  } catch (err) {
    if (mySid !== sessionId) return
    if (err.name === 'AbortError') {
      state.value = 'error'
      source.value = 'Request timed out'
      console.error('Cloud TTS: request timed out (30s)')
      return
    }
    console.error('Cloud TTS failed:', err.name, err.message)
    state.value = 'error'
    source.value = err.message || 'Cloud TTS unavailable'
  }
}

// ---- pre-warm: unlock audio autoplay within user gesture ----

async function preWarmAudio() {
  const el = audioEl.value
  if (!el) return
  // tiny silent WAV — locks the user gesture for subsequent play() calls
  el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
  try { await el.play() } catch { /* expected to throw or be silent */ }
  el.src = ''
}

// ---- audio element done (ended or error) ----

function onAudioDone() {
  if (state.value === 'playing') {
    stopAll()
  }
}

// ---- manual browser TTS fallback (user clicks button) ----

function useBrowserTTS() {
  stopAll()
  sessionId++  // invalidate any pending Cloud TTS callbacks
  startBrowserTTS()
}

function startBrowserTTS() {
  if (!('speechSynthesis' in window)) {
    state.value = 'error'
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
  if (abortController) { abortController.abort(); abortController = null }
  if (audioEl.value) {
    audioEl.value.pause()
    audioEl.value.src = ''
  }
  stopBrowserTTS()
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null }
  state.value = 'idle'
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

.voice-select {
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  max-width: 120px;
}
</style>
