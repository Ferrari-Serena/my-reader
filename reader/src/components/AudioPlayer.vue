<template>
  <div class="audio-player" v-if="chapterText">
    <button class="play-btn" @click="togglePlay" :disabled="loading">
      <span v-if="loading" class="spinner-sm"></span>
      <span v-else>{{ isPlaying ? '⏸' : '▶' }}</span>
    </button>

    <div class="audio-info">
      <span class="audio-label">{{ isPlaying ? 'Playing...' : 'Read aloud' }}</span>
      <span class="audio-source">{{ source }}</span>
    </div>
  </div>
  <audio ref="audioEl" @ended="onAudioEnded" @error="onAudioError" style="display:none"></audio>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'

const TTS_WORKER = 'https://my-reader-tts.serena605371358.workers.dev'

const props = defineProps({
  chapterText: { type: String, default: '' }
})

const isPlaying = ref(false)
const loading = ref(false)
const source = ref('Cloud TTS')

const audioEl = ref(null)
let abortController = null

// ---- play / pause ----

async function togglePlay() {
  if (isPlaying.value) {
    stopPlayback()
    return
  }
  await startPlayback()
}

// ---- start ----

async function startPlayback() {
  const text = props.chapterText?.trim()
  if (!text) return

  stopPlayback()
  loading.value = true
  source.value = 'Cloud TTS'
  isPlaying.value = true

  try {
    abortController = new AbortController()

    const resp = await fetch(`${TTS_WORKER}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: 'asteria' }),
      signal: abortController.signal
    })

    if (!resp.ok) throw new Error(`Worker returned ${resp.status}`)

    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)

    if (audioEl.value) {
      audioEl.value.src = url
      audioEl.value.play().catch(e => {
        console.warn('Audio play failed:', e)
        fallbackToBrowser()
      })
    }

    loading.value = false

  } catch (err) {
    if (err.name === 'AbortError') return
    console.warn('Cloud TTS failed, falling back to browser:', err.message)
    loading.value = false
    fallbackToBrowser()
  }
}

// ---- stop ----

function stopPlayback() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  if (audioEl.value) {
    audioEl.value.pause()
    audioEl.value.src = ''
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel()
  }
  isPlaying.value = false
  loading.value = false
}

// ---- audio element events ----

function onAudioEnded() {
  stopPlayback()
}

function onAudioError(e) {
  console.warn('Audio playback error, falling back to browser')
  stopPlayback()
  fallbackToBrowser()
}

// ---- browser speechSynthesis fallback ----

function fallbackToBrowser() {
  if (!('speechSynthesis' in window)) return

  source.value = 'Browser TTS'
  isPlaying.value = true

  const text = props.chapterText?.trim()
  if (!text) {
    isPlaying.value = false
    return
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = 0.9

  utterance.onend = () => { isPlaying.value = false }
  utterance.onerror = () => { isPlaying.value = false }

  speechSynthesis.speak(utterance)
}

// ---- lifecycle ----

onUnmounted(() => {
  stopPlayback()
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
