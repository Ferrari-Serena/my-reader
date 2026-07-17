<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="popup-overlay" @click.self="$emit('close')">
        <div class="popup-card">
          <div class="popup-header">
            <h3 class="popup-word">{{ word }}</h3>
            <button class="popup-close" @click="$emit('close')">✕</button>
          </div>

          <div v-if="loadingDict" class="popup-loading">
            <div class="spinner-sm"></div>
            <span>Looking up...</span>
          </div>

          <template v-else-if="dictEntry">
            <div class="popup-meta">
              <span v-if="dictEntry.phonetic" class="phonetic">{{ dictEntry.phonetic }}</span>
              <span v-if="dictEntry.partOfSpeech" class="pos-tag">{{ dictEntry.partOfSpeech }}</span>
              <span v-if="dictEntry.level" class="level-tag" :class="dictEntry.level.toLowerCase()">
                ★ {{ dictEntry.level }}
              </span>
            </div>

            <ol v-if="dictEntry.definitions?.length" class="def-list">
              <li v-for="(def, i) in dictEntry.definitions" :key="i" class="def-item">
                {{ def }}
              </li>
            </ol>
            <p v-else-if="dictEntry.notFound" class="notfound-hint">
              Not found in Merriam-Webster.
              <template v-if="dictEntry.suggestions?.length">
                Did you mean: {{ dictEntry.suggestions.slice(0, 3).join(', ') }}?
              </template>
            </p>

            <div class="popup-chapters" v-if="dictEntry.chapters?.length">
              <span class="chapters-label">Appears in:</span>
              <span v-for="ch in dictEntry.chapters" :key="ch" class="chapter-badge">{{ ch }}</span>
            </div>

            <div class="popup-actions">
              <button class="action-btn" @click="speakWord">
                🔊 Listen
              </button>
              <button v-if="isSaved" class="action-btn saved" @click="$emit('remove-vocab', word)">
                ✓ In Words
              </button>
              <button v-else class="action-btn primary" @click="addToVocab">
                + Add to Words
              </button>
            </div>
          </template>

          <div v-else class="popup-notfound">
            <p>Definition not available offline.</p>
            <div class="popup-actions">
              <button class="action-btn" @click="lookupOnline">
                🌐 Look up online
              </button>
              <button v-if="isSaved" class="action-btn saved" @click="$emit('remove-vocab', word)">
                ✓ In Words
              </button>
              <button v-else class="action-btn primary" @click="addToVocab">
                + Add to Words
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  word: { type: String, default: '' },
  dictEntry: { type: Object, default: null },
  loadingDict: { type: Boolean, default: false },
  isSaved: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'add-vocab', 'remove-vocab'])

const visible = computed(() => !!props.word)

function speakWord() {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(props.word)
    utterance.lang = 'en-US'
    utterance.rate = 0.9
    speechSynthesis.speak(utterance)
  }
}

function addToVocab() {
  emit('add-vocab', props.word)
}

function lookupOnline() {
  window.open(`https://www.merriam-webster.com/dictionary/${props.word}`, '_blank')
}
</script>

<script>
import { computed } from 'vue'
export default { inheritAttrs: false }
</script>

<style>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 300;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding: 16px;
}

.popup-card {
  background: var(--bg-primary, #fff);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 500px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.popup-word {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #1d1d1f);
}

.popup-close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-secondary, #6e6e73);
  cursor: pointer;
  padding: 4px;
}

.popup-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary, #6e6e73);
  padding: 16px 0;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #d2d2d7);
  border-top-color: var(--accent-color, #1a73e8);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.popup-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.phonetic {
  color: var(--text-secondary, #6e6e73);
  font-size: 14px;
}

.pos-tag {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 4px;
  color: var(--text-secondary, #6e6e73);
  font-style: italic;
}

.level-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.level-tag.sat {
  background: #e3f2fd;
  color: #1565c0;
}

.level-tag.ap {
  background: #fce4ec;
  color: #c62828;
}

.def-list {
  margin: 0 0 16px;
  padding-left: 20px;
}

.def-item {
  margin-bottom: 6px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary, #1d1d1f);
}

.popup-chapters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.chapters-label {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.chapter-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 4px;
  color: var(--text-secondary, #6e6e73);
}

.popup-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #1d1d1f);
  transition: background 0.2s;
}

.action-btn:hover {
  background: var(--bg-secondary, #f5f5f7);
}

.action-btn.saved {
  border-color: var(--success-color, #34c759);
  color: var(--success-color, #34c759);
  background: transparent;
}

.notfound-hint {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  font-style: italic;
  margin: 4px 0 12px;
}

.action-btn.primary {
  background: var(--accent-color, #1a73e8);
  color: white;
  border-color: var(--accent-color, #1a73e8);
}

.popup-notfound {
  text-align: center;
  padding: 16px 0;
  color: var(--text-secondary, #6e6e73);
}

.popup-notfound .action-btn {
  margin-top: 8px;
}

/* Transitions */
.popup-enter-active,
.popup-leave-active {
  transition: opacity 0.25s ease;
}

.popup-enter-active .popup-card,
.popup-leave-active .popup-card {
  transition: transform 0.25s ease;
}

.popup-enter-from,
.popup-leave-to {
  opacity: 0;
}

.popup-enter-from .popup-card,
.popup-leave-to .popup-card {
  transform: translateY(100%);
}

/* Desktop: center card */
@media (min-width: 768px) {
  .popup-overlay {
    align-items: center;
  }
  .popup-card {
    border-radius: 16px;
    max-height: 70vh;
  }
}
</style>
