<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="popup-overlay" @click.self="$emit('close')">
        <div class="popup-card">
          <div class="popup-header">
            <h3 class="popup-word">{{ word }}</h3>
            <button class="popup-close" @click="$emit('close')">✕</button>
          </div>

          <!-- 词组义项弹窗（§5.7 四块）：有 senses 时替代单词义区域 -->
          <div v-if="hasSenses" class="phrase-sense-panel">
            <section class="sense-block">
              <h4 class="sense-label">本句义</h4>
              <p v-if="currentSense" class="sense-current">{{ currentSense.zh }}</p>
              <p v-else class="sense-unresolved">{{ unresolvedText }}</p>
              <p v-if="currentSense && cloudSourceText" class="sense-source">{{ cloudSourceText }}</p>
            </section>

            <section class="sense-block">
              <h4 class="sense-label">词典义</h4>
              <ol class="sense-list">
                <li
                  v-for="s in phraseInfo.senses"
                  :key="s.rank"
                  class="sense-item"
                  :class="{ 'sense-hit': isHitSense(s), 'sense-current': isCurrentSense(s) }"
                >
                  <span>{{ s.zh }}</span>
                  <span v-if="isCurrentSense(s)" class="sense-star">（★ ＝ 本句用的这条）</span>
                </li>
              </ol>
            </section>
          </div>

          <!-- 无 senses 但有 defs 的词组：直接显示词组义，不再落单词义 -->
          <div v-else-if="hasSimpleDefs" class="phrase-sense-panel">
            <section class="sense-block">
              <h4 class="sense-label">词组义</h4>
              <ol class="sense-list">
                <li v-for="(def, i) in phraseInfo.defs" :key="i" class="sense-item">
                  <span>{{ def }}</span>
                </li>
              </ol>
            </section>
          </div>

          <!-- 无 senses 的词组/普通词：保留旧弹窗内容 -->
          <template v-else>
            <div v-if="phraseInfo" class="phrase-banner">
              <span class="phrase-text">{{ phraseInfo.phrase }}</span>
              <span class="phrase-defs">{{ phraseInfo.defs.join('；') }}</span>
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
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useTTS } from '../composables/useTTS.js'

const props = defineProps({
  word: { type: String, default: '' },
  dictEntry: { type: Object, default: null },
  loadingDict: { type: Boolean, default: false },
  isSaved: { type: Boolean, default: false },
  phraseInfo: { type: Object, default: null } // { phrase, defs: [] }
})

const emit = defineEmits(['close', 'add-vocab', 'remove-vocab'])

const tts = useTTS()
const visible = computed(() => !!props.word)

const hasSenses = computed(() =>
  Array.isArray(props.phraseInfo?.senses) && props.phraseInfo.senses.length > 0
)

const hasSimpleDefs = computed(() =>
  !hasSenses.value &&
  Array.isArray(props.phraseInfo?.defs) &&
  props.phraseInfo.defs.length > 0
)

const resolution = computed(() =>
  props.phraseInfo?.resolution || { state: 'zero', rank: null, hits: [] }
)

const currentSense = computed(() => {
  if (!hasSenses.value || !resolution.value.rank) return null
  if (!['unique', 'annotated', 'cloud'].includes(resolution.value.state)) return null
  return props.phraseInfo.senses.find(s => s.rank === resolution.value.rank) || null
})

const hitRanks = computed(() => (resolution.value.hits || []).map(hit => hit.rank))

const isHitSense = (sense) => hitRanks.value.includes(sense.rank)
const isCurrentSense = (sense) => currentSense.value?.rank === sense.rank

/** 来源标签：说「这话从哪来」，不说「有多确定」。 */
const cloudSourceText = computed(() => {
  if (resolution.value.cloudStatus !== 'cloud') return ''
  const source = resolution.value.cloudSource
  if (source === 'cache') return '缓存判断'
  if (source === 'legacy') return '旧版判断'
  if (source === 'model') return '模型判断'
  return ''
})

const unresolvedText = computed(() => {
  if (resolution.value.cloudStatus === 'loading') return '云端判断中…'
  if (resolution.value.cloudStatus === 'unavailable') return '云端暂不可用'
  if (resolution.value.cloudStatus === 'rate_limited') return '请求太频繁，稍后再试'
  if (resolution.value.cloudStatus === 'unauthorized') return '登录后可判断这本书'
  if (resolution.value.cloudStatus === 'invalid') return '这本书暂不支持云端判断'
  if (resolution.value.cloudStatus === 'error') return '云端判断失败'
  if (resolution.value.cloudStatus === 'uncertain' && resolution.value.cloudReason === 'insufficient_context') {
    return '上下文不足，云端判断不了'
  }
  if (resolution.value.cloudStatus === 'uncertain') return '云端未能确定'
  if (resolution.value.cloudStatus === 'offline') return '离线未确定'
  return '未确定'
})

function speakWord() {
  tts.speak(props.word)
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

/* 词组信息行 */
.phrase-banner {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--phrase-bg, rgba(52, 199, 89, 0.10));
  border-left: 3px solid var(--success-color, #34c759);
  border-radius: 6px;
}

.phrase-text {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary, #1d1d1f);
}

.phrase-defs {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

/* 词组义项四块弹窗（§5.7） */
.phrase-sense-panel {
  margin-bottom: 4px;
}

.sense-block {
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
}

.sense-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.sense-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-secondary, #6e6e73);
}

.sense-current {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-primary, #1d1d1f);
}

.sense-unresolved {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
}

.sense-source {
  margin: 4px 0 0;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--text-tertiary, #8a8a8e);
}

.sense-list {
  margin: 0;
  padding-left: 20px;
}

.sense-item {
  margin-bottom: 6px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary, #1d1d1f);
}

.sense-item.sense-hit {
  font-weight: 600;
}

.sense-item.sense-current {
  font-weight: 700;
  color: var(--accent-color, #1a73e8);
}

.sense-star {
  margin-left: 4px;
  font-size: 12px;
  color: var(--accent-color, #1a73e8);
  white-space: nowrap;
}

.sense-pattern {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
}

.sense-literal {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary, #1d1d1f);
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
