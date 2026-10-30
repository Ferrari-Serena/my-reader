<template>
  <div class="flashcards-view">
    <!-- loading -->
    <div v-if="phase === 'loading'" class="placeholder-view">
      <div class="spinner"></div>
      <p>正在准备复习…</p>
    </div>

    <!-- empty -->
    <div v-else-if="phase === 'empty'" class="placeholder-view">
      <div class="placeholder-icon">🔄</div>
      <h2>暂无需要复习的卡片</h2>
      <p>阅读时收藏生词，或在测验中答错词组，就能开始复习。</p>
      <router-link to="/books" class="action-btn primary">去书架</router-link>
    </div>

    <!-- nothing-due -->
    <div v-else-if="phase === 'nothing-due'" class="placeholder-view">
      <div class="placeholder-icon">⏳</div>
      <h2>当前没有待复习的卡片</h2>
      <p v-if="nextDue">下次复习：{{ nextDueStr }}</p>
      <p v-else>还没有安排复习的卡片 —— 阅读时收藏生词，或在测验中答错词组即可开始。</p>
      <button v-if="freshCount" class="action-btn primary" @click="startSession('fresh')">
        学习 {{ freshCount }} 张新卡
      </button>
      <button v-if="dueAheadCount" class="action-btn" @click="startSession('ahead')">
        提前复习 {{ dueAheadCount }} 张卡片
      </button>
    </div>

    <!-- reviewing -->
    <div v-else-if="phase === 'reviewing'" class="review-session">
      <!-- progress -->
      <div class="session-progress">
        <span class="progress-text">{{ currentIdx + 1 }} / {{ sessionCards.length }}</span>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: ((currentIdx + 1) / sessionCards.length * 100) + '%' }"></div>
        </div>
        <span class="progress-due">待复习：{{ freshDone > 0 ? freshDone + ' 张新卡，' : '' }}{{ dueReviewCount }} 张</span>
      </div>

      <!-- card -->
      <div class="flash-card-container" @click="flipIfFront">
        <div :class="['flash-card-inner', { flipped }]">
          <!-- front -->
          <div class="flash-card-front">
            <h2 class="flash-word">{{ currentItem?.content?.text }}</h2>
            <p v-if="currentItem?.content?.phonetic" class="flash-phonetic">
              {{ currentItem.content.phonetic }}
            </p>
            <button v-if="!isPhraseCard" class="speak-btn" @click.stop="speakWord" title="朗读">🔊</button>
            <p class="flip-hint">点卡片翻面</p>
          </div>

          <!-- back -->
          <div class="flash-card-back" @click.stop>
            <h3 class="back-word">{{ currentItem?.content?.text }}</h3>

            <ol v-if="currentItem?.content?.definitions?.length" class="def-list">
              <li v-for="(def, i) in currentItem.content.definitions" :key="i">{{ def }}</li>
            </ol>

            <!-- spelling input -->
            <div v-if="!isPhraseCard" class="spelling-section">
              <label class="spelling-label">凭记忆拼写这个单词：</label>
              <input
                ref="spellingInputEl"
                v-model="spellingInput"
                :class="['spelling-input', { correct: spellingResult === 'correct', wrong: spellingResult === 'wrong' }]"
                autocapitalize="none"
                autocorrect="off"
                autocomplete="off"
                spellcheck="false"
                placeholder="在这里输入…"
                @keyup.enter="checkSpelling"
              />
              <div v-if="spellingResult === 'correct'" class="spelling-feedback correct-fb">
                ✅ 拼写正确
              </div>
              <div v-else-if="spellingResult === 'wrong'" class="spelling-feedback wrong-fb">
                ❌ 正确答案：<strong>{{ currentItem?.content?.text }}</strong>
                <span v-if="spellingDiffHtml" class="diff-display" v-html="spellingDiffHtml"></span>
              </div>
              <div v-else-if="spellingResult === 'close'" class="spelling-feedback close-fb">
                ⚠️ 很接近，可能有一处拼写错误。
                <span v-if="spellingDiffHtml" class="diff-display" v-html="spellingDiffHtml"></span>
              </div>
              <button v-if="!spellingResult" class="check-btn" @click.stop="checkSpelling">检查</button>
            </div>

            <!-- FSRS rating -->
            <div class="rating-row">
              <button class="rating-btn again" @click.stop="rateCard(1)" title="键盘：1">重来</button>
              <button class="rating-btn hard" @click.stop="rateCard(2)" title="键盘：2">困难</button>
              <button class="rating-btn good" @click.stop="rateCard(3)" title="键盘：3">良好</button>
              <button class="rating-btn easy" @click.stop="rateCard(4)" title="键盘：4">简单</button>
            </div>
          </div>
        </div>
      </div>

      <p class="kb-hint">空格 = 翻面 · 1–4 = 评级</p>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'" class="placeholder-view">
      <div class="placeholder-icon">🎉</div>
      <h2>本轮复习完成</h2>
      <p>已复习 {{ sessionReviewed }} 张卡片。</p>
      <button class="action-btn primary" @click="resetToSetup">完成</button>
    </div>

    <p v-if="phase === 'empty' || phase === 'nothing-due'" class="fsrs-note">
      卡片按 FSRS 间隔重复安排复习：你选的「重来／困难／良好／简单」决定下次出现的时间。
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVocabulary } from '../composables/useVocabulary'
import { usePhrases } from '../composables/usePhrases.js'
import { useSync } from '../composables/useSync.js'
import { createCard, rate, buildQueueFromItems, nextDueFromItems } from '../fsrs.js'
import { checkSpelling as spellCheck, diffHtml } from '../utils/spelling.js'
import { useTTS } from '../composables/useTTS.js'
import * as recordStore from '../sync/recordStore.js'
import { nowIso } from '../sync/clock.js'
import {
  collectReviewItems,
  normalizePhraseKey,
  phraseCardId,
  REF_KIND_PHRASE
} from '../review.js'

const tts = useTTS()
const vocab = useVocabulary()
const phrases = usePhrases()
const sync = useSync()
vocab.init()

// ---- utility ----

function speakWord() {
  if (isPhraseCard.value) return
  const text = currentItem.value?.content?.text
  if (!text) return
  tts.speak(text)
}

// ---- state machine ----

const phase = ref('loading') // loading | empty | nothing-due | reviewing | complete
const sessionCards = ref([]) // entry objects for this session
const currentIdx = ref(0)
const flipped = ref(false)
const dueReviewCount = ref(0) // due cards left (non-new)
const freshDone = ref(0) // new cards reviewed this session
const sessionReviewed = ref(0)

// ---- build queue ----

let allNew = [] // new cards (srs===null) that were initialized this session
const localRecordRev = ref(0) // 本地 recordStore 写入不是响应式，用它触发队列重算

const phraseEntries = computed(() => {
  const map = {}
  for (const entry of phrases.all.value || []) {
    const key = normalizePhraseKey(entry.phrase)
    if (key) map[key] = entry
  }
  return map
})

const reviewItems = computed(() => {
  // 建立响应式依赖：本地落卡（localRecordRev）与远端记录写回（sync.recordRevision）
  localRecordRev.value
  sync.recordRevision.value
  return collectReviewItems(vocab.words.value, recordStore.loadRecordsMap(), phraseEntries.value)
})

function resetToSetup() {
  flipped.value = false
  spellingInput.value = ''
  spellingResult.value = null
  currentIdx.value = 0
  sessionReviewed.value = 0
  freshDone.value = 0
  allNew = []

  const { due, fresh } = buildQueueFromItems(reviewItems.value, { newLimit: 20 })
  if (due.length === 0 && fresh.length === 0) {
    if (reviewItems.value.length === 0) { phase.value = 'empty'; return }
    phase.value = 'nothing-due'
    return
  }

  // 初始化新卡
  const freshCards = fresh.map(item => {
    if (!item.srs) allNew.push(item.key)
    return { ...item, srs: item.srs || createCard() }
  })

  sessionCards.value = [...due, ...freshCards]
  dueReviewCount.value = due.length
  freshDone.value = 0
  currentIdx.value = 0
  sessionReviewed.value = 0
  flipped.value = false
  spellingInput.value = ''
  spellingResult.value = null
  phase.value = 'reviewing'
}

function startSession(mode) {
  if (mode === 'fresh') {
    const { fresh } = buildQueueFromItems(reviewItems.value, { newLimit: 20 })
    const freshCards = fresh.map(item => {
      if (!item.srs) allNew.push(item.key)
      return { ...item, srs: item.srs || createCard() }
    })
    sessionCards.value = freshCards
    dueReviewCount.value = 0
  } else {
    // ahead: include non-due cards too
    const all = reviewItems.value.filter(item => item.srs)
    sessionCards.value = all
    dueReviewCount.value = sessionCards.value.length
  }
  freshDone.value = 0
  currentIdx.value = 0
  sessionReviewed.value = 0
  flipped.value = false
  spellingInput.value = ''
  spellingResult.value = null
  phase.value = 'reviewing'
}

// ---- computed helpers ----

const currentItem = computed(() => sessionCards.value[currentIdx.value] || null)
const isPhraseCard = computed(() => currentItem.value?.refKind === REF_KIND_PHRASE)

const nextDue = computed(() => nextDueFromItems(reviewItems.value))
const nextDueStr = computed(() => {
  const d = nextDue.value
  if (!d) return ''
  const now = new Date()
  const diff = d - now
  const mins = Math.ceil(diff / 60000)
  if (mins <= 0) return '现在'
  if (mins < 60) return `${mins} 分钟后`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时后`
  const days = Math.floor(hrs / 24)
  return `${days} 天后`
})

const freshCount = computed(() => {
  return reviewItems.value.filter(item => !item.srs).length
})

const dueAheadCount = computed(() => {
  return reviewItems.value.filter(item => item.srs).length
})

// ---- flip ----

const spellingInput = ref('')
const spellingResult = ref(null) // null | 'correct' | 'close' | 'wrong'
const spellingDiffHtml = ref('')

function flipIfFront() {
  if (flipped.value) return
  flipped.value = true
  // focus spelling input after flip animation
  if (!isPhraseCard.value) setTimeout(() => spellingInputEl.value?.focus(), 600)
}

const spellingInputEl = ref(null)

function checkSpelling() {
  const input = spellingInput.value
  if (!input.trim()) return
  const result = spellCheck(input, currentItem.value?.content?.text || '')
  if (result.correct) {
    spellingResult.value = 'correct'
    spellingDiffHtml.value = ''
  } else if (result.distance === 1) {
    spellingResult.value = 'close'
    spellingDiffHtml.value = diffHtml(input, currentItem.value?.content?.text || '')
  } else {
    spellingResult.value = 'wrong'
    spellingDiffHtml.value = diffHtml(input, currentItem.value?.content?.text || '')
  }
}

// 评级（提醒模式：拼写结果不影响评级，用户自主决定）
async function rateCard(rating) {
  const item = currentItem.value
  if (!item) return

  const srs = rate(item.srs || createCard(), rating)
  if (item.refKind === REF_KIND_PHRASE) {
    const now = nowIso()
    recordStore.putRecord('card', {
      refKind: REF_KIND_PHRASE,
      refKey: item.refKey,
      srs,
      createdAt: item.addedAt || now,
      updatedAt: now
    }, { id: phraseCardId(item.refKey) })
    localRecordRev.value++
    sync.pushSoon()
  } else {
    await vocab.updateSRS(item.refKey, srs)
  }

  // 新卡计数
  if (allNew.includes(item.key)) {
    freshDone.value++
    allNew = allNew.filter(key => key !== item.key)
  }

  if (item.srs) dueReviewCount.value = Math.max(0, dueReviewCount.value - 1)
  sessionReviewed.value++
  advanceCard()
}

function advanceCard() {
  flipped.value = false
  spellingInput.value = ''
  spellingResult.value = null
  spellingDiffHtml.value = ''

  if (currentIdx.value + 1 >= sessionCards.value.length) {
    phase.value = 'complete'
    return
  }
  currentIdx.value++
}

// ---- keyboard ----

function onKeyDown(e) {
  if (phase.value !== 'reviewing') return
  if (e.target.tagName === 'INPUT') return // spelling input handles its own keys

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault()
    if (flipped.value) return
    flipped.value = true
    if (!isPhraseCard.value) setTimeout(() => spellingInputEl.value?.focus(), 600)
    return
  }

  if (!flipped.value) return
  const num = Number(e.key)
  if (num >= 1 && num <= 4) {
    e.preventDefault()
    rateCard(num)
  }
}

// ---- lifecycle ----

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  Promise.all([vocab.init(), phrases.init().catch(() => {})]).then(() => {
    if (reviewItems.value.length === 0) { phase.value = 'empty'; return }
    const { due, fresh } = buildQueueFromItems(reviewItems.value, { newLimit: 20 })
    if (due.length === 0 && fresh.length === 0) { phase.value = 'nothing-due'; return }
    resetToSetup()
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.flashcards-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}

/* ---- shared states ---- */
.placeholder-view {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-secondary, #6e6e73);
}

.placeholder-icon { font-size: 48px; margin-bottom: 12px; }

.placeholder-view h2 {
  margin: 0 0 8px;
  color: var(--text-primary, #1d1d1f);
  font-size: 20px;
}

.placeholder-view p { margin-bottom: 12px; }

.fsrs-note {
  max-width: 520px;
  margin: 24px auto 0;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--surface-secondary, #f5f5f7);
  color: var(--text-secondary, #6e6e73);
  font-size: 13px;
  line-height: 1.5;
}

.spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border-color, #d2d2d7);
  border-top-color: var(--accent-color, #1a73e8);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin { to { transform: rotate(360deg); } }

.action-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #1d1d1f);
  text-decoration: none;
  display: inline-block;
  margin: 4px;
}

.action-btn.primary {
  background: var(--accent-color, #1a73e8);
  color: #fff;
  border-color: var(--accent-color, #1a73e8);
}

/* ---- progress ---- */
.session-progress {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.progress-text { font-weight: 600; min-width: 56px; }

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-color, #1a73e8);
  border-radius: 3px;
  transition: width 0.3s;
}

.progress-due { font-size: 11px; white-space: nowrap; }

/* ---- 3D card ---- */
.flash-card-container {
  perspective: 1000px;
  width: 100%;
  max-width: 400px;
  height: 360px;
  margin: 0 auto;
  cursor: pointer;
}

.flash-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
  will-change: transform;
}

.flash-card-inner.flipped {
  transform: rotateY(180deg);
  cursor: default;
}

.flash-card-front,
.flash-card-back {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  border-radius: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* front */
.flash-card-front {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #d2d2d7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.flash-word {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary, #1d1d1f);
  margin: 0 0 8px;
}

.flash-phonetic {
  font-size: 15px;
  color: var(--text-secondary, #6e6e73);
  margin: 0 0 16px;
}

.speak-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--bg-secondary, #f5f5f7);
  font-size: 22px;
  cursor: pointer;
  margin-bottom: 20px;
}

.flip-hint {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

/* back */
.flash-card-back {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--accent-color, #1a73e8);
  display: flex;
  flex-direction: column;
  padding: 20px;
  transform: rotateY(180deg);
}

.back-word {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary, #1d1d1f);
  margin: 0 0 12px;
}

.def-list {
  margin: 0 0 12px;
  padding-left: 20px;
  flex-shrink: 0;
}

.def-list li {
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-primary, #1d1d1f);
  margin-bottom: 3px;
}

/* ---- spelling ---- */
.spelling-section {
  margin-bottom: 12px;
  flex-shrink: 0;
}

.spelling-label {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
  display: block;
  margin-bottom: 6px;
}

.spelling-input {
  width: 100%;
  padding: 10px 12px;
  border: 2px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  font-size: 16px;
  color: var(--text-primary, #1d1d1f);
  background: var(--bg-primary, #fff);
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.spelling-input.correct { border-color: var(--success-color, #34c759); }
.spelling-input.wrong { border-color: var(--danger-color, #ff3b30); }

.spelling-feedback { font-size: 13px; margin-top: 6px; }

.correct-fb { color: var(--success-color, #34c759); }
.wrong-fb { color: var(--danger-color, #ff3b30); }
.close-fb { color: var(--rating-hard, #ff9500); }

.diff-display {
  display: block;
  margin-top: 4px;
  font-family: monospace;
  font-size: 16px;
}

.check-btn {
  margin-top: 6px;
  padding: 4px 14px;
  border: 1px solid var(--accent-color, #1a73e8);
  border-radius: 6px;
  background: transparent;
  color: var(--accent-color, #1a73e8);
  font-size: 13px;
  cursor: pointer;
}

/* ---- rating ---- */
.rating-row {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  margin-top: auto;
}

.rating-btn {
  flex: 1;
  padding: 10px 0;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}

.rating-btn:active { transform: scale(0.96); }

.rating-btn.again { background: var(--rating-again, #ff3b30); }
.rating-btn.hard  { background: var(--rating-hard, #ff9500); }
.rating-btn.good  { background: var(--rating-good, #34c759); }
.rating-btn.easy  { background: var(--rating-easy, #007aff); }

.kb-hint {
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary, #6e6e73);
  margin-top: 14px;
}

/* ---- responsive ---- */
@media (max-width: 480px) {
  .flash-card-container { height: 320px; }
  .flash-word { font-size: 26px; }
  .rating-btn { font-size: 13px; padding: 8px 0; }
}

@media (min-width: 768px) {
  .flash-card-container { max-width: 440px; height: 400px; }
}
</style>
