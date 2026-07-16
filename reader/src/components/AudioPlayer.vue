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

    <select v-model="voiceName" class="voice-select" v-if="voices.length">
      <option value="">Default voice</option>
      <option v-for="v in voices" :key="v.name" :value="v.name">
        {{ v.name }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  chapterText: { type: String, default: '' }
})

const isPlaying = ref(false)
const voices = ref([])
const voiceName = ref('')
const source = ref('Browser TTS')

let utteranceId = 0
let sentenceQueue = []
let queueIndex = 0
let resumeTimer = null
let pollTimer = null
let chunkCompleted = false

// ---- chunk splitting ----

function splitIntoChunks(text, maxLen = 180) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]
  const result = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    if (trimmed.length <= maxLen) {
      result.push(trimmed)
      continue
    }
    // split long sentences at word boundaries
    const words = trimmed.split(/\s+/)
    let chunk = ''
    for (const word of words) {
      const candidate = chunk ? chunk + ' ' + word : word
      if (candidate.length > maxLen && chunk.length > 0) {
        result.push(chunk)
        chunk = word
      } else {
        chunk = candidate
      }
    }
    if (chunk) result.push(chunk)
  }
  return result.length > 0 ? result : [text]
}

// ---- voice loading ----

function loadVoices() {
  if ('speechSynthesis' in window) {
    voices.value = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
  }
}

// ---- play / pause ----

function togglePlay() {
  if (!('speechSynthesis' in window)) {
    alert('Text-to-speech not supported in this browser.')
    return
  }
  // Force-load voices (mobile may not have loaded them yet)
  speechSynthesis.getVoices()
  if (isPlaying.value) {
    stopPlayback()
    return
  }
  startPlayback()
}

// ---- start / stop ----

function startPlayback() {
  const wasActive = speechSynthesis.speaking || speechSynthesis.pending
  if (wasActive) {
    speechSynthesis.cancel()
  }
  const myId = ++utteranceId

  const text = props.chapterText?.trim()
  if (!text) return

  sentenceQueue = splitIntoChunks(text, 180)
  queueIndex = 0
  chunkCompleted = false
  isPlaying.value = true

  // P0 fix: iOS Safari needs a tick after cancel before speak.
  // Without this delay, iOS drops the new utterance silently.
  const delay = wasActive ? 80 : 10
  setTimeout(() => {
    if (myId === utteranceId) {
      speakNext(myId)
    }
  }, delay)
}

function stopPlayback() {
  utteranceId++
  clearResumeTimer()
  clearPollTimer()
  speechSynthesis.cancel()
  isPlaying.value = false
}

// ---- speak one chunk ----

function speakNext(myId) {
  if (myId !== utteranceId || queueIndex >= sentenceQueue.length) {
    if (myId === utteranceId && queueIndex >= sentenceQueue.length) {
      stopPlayback()
    }
    return
  }

  const chunk = sentenceQueue[queueIndex].trim()
  if (!chunk) {
    queueIndex++
    speakNext(myId)
    return
  }

  chunkCompleted = false
  const utterance = new SpeechSynthesisUtterance(chunk)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  utterance.pitch = 1.0

  const voice = voices.value.find(v => v.name === voiceName.value)
  if (voice) utterance.voice = voice

  // --- onstart: resume timer (Chrome pause-bug workaround) ---
  utterance.onstart = () => {
    clearResumeTimer()
    resumeTimer = setInterval(() => {
      if (myId !== utteranceId) { clearResumeTimer(); return }
      if (speechSynthesis.paused) speechSynthesis.resume()
      if (!speechSynthesis.speaking && speechSynthesis.pending) speechSynthesis.resume()
    }, 200)
  }

  // --- onend: fast path (desktop Chrome) ---
  utterance.onend = () => {
    if (chunkCompleted) return
    chunkCompleted = true
    clearPollTimer()
    if (myId === utteranceId) {
      queueIndex++
      speakNext(myId)
    }
  }

  // --- onerror: log and (possibly) recover ---
  utterance.onerror = (e) => {
    if (e.error === 'canceled' || e.error === 'interrupted') return
    console.warn('TTS error:', e.error)
    if (chunkCompleted) return
    chunkCompleted = true
    clearPollTimer()
    if (myId === utteranceId) {
      setTimeout(() => {
        if (myId === utteranceId) {
          queueIndex++
          speakNext(myId)
        }
      }, 300)
    }
  }

  speechSynthesis.speak(utterance)

  // --- P0 fix: poll timer — advances queue even if onend never fires (iOS Safari) ---
  const estimatedMs = Math.max(3000, chunk.length * 50)
  const pollStart = Date.now()
  clearPollTimer()
  pollTimer = setInterval(() => {
    if (myId !== utteranceId) { clearPollTimer(); return }

    const elapsed = Date.now() - pollStart
    const silent = !speechSynthesis.speaking

    if (silent && elapsed > 1000) {
      if (chunkCompleted) return
      chunkCompleted = true
      clearPollTimer()
      if (myId === utteranceId) {
        queueIndex++
        speakNext(myId)
      }
      return
    }

    // safety timeout: force advance if chunk runs way over estimate
    if (elapsed > estimatedMs + 5000) {
      if (chunkCompleted) return
      chunkCompleted = true
      clearPollTimer()
      speechSynthesis.cancel()
      if (myId === utteranceId) {
        queueIndex++
        speakNext(myId)
      }
    }
  }, 500)
}

// ---- timer cleanup ----

function clearResumeTimer() {
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null }
}

function clearPollTimer() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ---- lifecycle ----

onMounted(() => {
  loadVoices()
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = loadVoices
  }
})

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
