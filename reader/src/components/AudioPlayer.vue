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
let currentUtterance = null
let sentenceQueue = []
let queueIndex = 0
let resumeTimer = null

function loadVoices() {
  if ('speechSynthesis' in window) {
    voices.value = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
  }
}

function togglePlay() {
  if (!('speechSynthesis' in window)) {
    alert('Text-to-speech not supported in this browser.')
    return
  }
  if (isPlaying.value) {
    stopPlayback()
    return
  }
  startPlayback()
}

function startPlayback() {
  // Cancel any previous playback first
  speechSynthesis.cancel()
  // Increment ID to invalidate any pending callbacks from old utterances
  const myId = ++utteranceId

  const text = props.chapterText?.trim()
  if (!text) return

  // Split into sentences (~200 char chunks to avoid Chrome pause bug)
  sentenceQueue = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]
  if (sentenceQueue.length === 0) sentenceQueue = [text]

  queueIndex = 0
  isPlaying.value = true
  speakNext(myId)
}

function speakNext(myId) {
  // Guard: if playback was stopped or a new playback started, abort
  if (myId !== utteranceId || queueIndex >= sentenceQueue.length) {
    if (myId === utteranceId && queueIndex >= sentenceQueue.length) {
      // This playback session completed normally
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

  currentUtterance = new SpeechSynthesisUtterance(chunk)
  currentUtterance.lang = 'en-US'
  currentUtterance.rate = 0.9
  currentUtterance.pitch = 1.0

  const voice = voices.value.find(v => v.name === voiceName.value)
  if (voice) currentUtterance.voice = voice

  currentUtterance.onstart = () => {
    // Start periodic resume check (fixes both Chrome desktop pause bug and mobile silent bug)
    clearResumeTimer()
    resumeTimer = setInterval(() => {
      if (myId !== utteranceId) {
        clearResumeTimer()
        return
      }
      if (speechSynthesis.paused) {
        speechSynthesis.resume()
      }
      if (!speechSynthesis.speaking && speechSynthesis.pending) {
        speechSynthesis.resume()
      }
    }, 200)
  }

  currentUtterance.onend = () => {
    if (myId === utteranceId) {
      queueIndex++
      speakNext(myId)
    }
  }

  currentUtterance.onerror = (e) => {
    if (e.error === 'canceled' || e.error === 'interrupted') {
      return
    }
    console.warn('TTS error:', e.error)
    if (myId === utteranceId) {
      setTimeout(() => {
        if (myId === utteranceId) {
          queueIndex++
          speakNext(myId)
        }
      }, 300)
    }
  }

  speechSynthesis.speak(currentUtterance)
}

function clearResumeTimer() {
  if (resumeTimer) {
    clearInterval(resumeTimer)
    resumeTimer = null
  }
}

function stopPlayback() {
  utteranceId++
  clearResumeTimer()
  speechSynthesis.cancel()
  isPlaying.value = false
}

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
