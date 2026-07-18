<template>
  <div class="flashcards-view">
    <!-- loading -->
    <div v-if="phase === 'loading'" class="placeholder-view">
      <div class="spinner"></div>
      <p>Loading review...</p>
    </div>

    <!-- empty -->
    <div v-else-if="phase === 'empty'" class="placeholder-view">
      <div class="placeholder-icon">🔄</div>
      <h2>No words to review</h2>
      <p>Save words while reading to start reviewing.</p>
      <router-link to="/books" class="action-btn primary">Go to Books</router-link>
    </div>

    <!-- nothing-due -->
    <div v-else-if="phase === 'nothing-due'" class="placeholder-view">
      <div class="placeholder-icon">⏳</div>
      <h2>All caught up!</h2>
      <p v-if="nextDue">Next review: {{ nextDueStr }}</p>
      <p v-else>No cards scheduled yet — add words and rate them once.</p>
      <button v-if="freshCount" class="action-btn primary" @click="startSession('fresh')">
        Learn {{ freshCount }} new word{{ freshCount > 1 ? 's' : '' }}
      </button>
      <button v-if="dueAheadCount" class="action-btn" @click="startSession('ahead')">
        Review {{ dueAheadCount }} card{{ dueAheadCount > 1 ? 's' : '' }} ahead of schedule
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
        <span class="progress-due">Due: {{ freshDone > 0 ? freshDone + ' new, ' : '' }}{{ dueReviewCount }} to review</span>
      </div>

      <!-- card -->
      <div class="flash-card-container" @click="flipIfFront">
        <div :class="['flash-card-inner', { flipped }]">
          <!-- front -->
          <div class="flash-card-front">
            <h2 class="flash-word">{{ currentWord?.word }}</h2>
            <p v-if="currentWord?.snapshot?.phonetic" class="flash-phonetic">
              {{ currentWord.snapshot.phonetic }}
            </p>
            <button class="speak-btn" @click.stop="speakWord" title="Pronounce">🔊</button>
            <p class="flip-hint">Tap card to flip</p>
          </div>

          <!-- back -->
          <div class="flash-card-back" @click.stop>
            <h3 class="back-word">{{ currentWord?.word }}</h3>

            <ol v-if="currentWord?.snapshot?.definitions?.length" class="def-list">
              <li v-for="(def, i) in currentWord.snapshot.definitions" :key="i">{{ def }}</li>
            </ol>

            <!-- spelling input -->
            <div class="spelling-section">
              <label class="spelling-label">Type the word from memory:</label>
              <input
                ref="spellingInputEl"
                v-model="spellingInput"
                :class="['spelling-input', { correct: spellingResult === 'correct', wrong: spellingResult === 'wrong' }]"
                autocapitalize="none"
                autocorrect="off"
                autocomplete="off"
                spellcheck="false"
                placeholder="Type here..."
                @keyup.enter="checkSpelling"
              />
              <div v-if="spellingResult === 'correct'" class="spelling-feedback correct-fb">
                ✅ Correct!
              </div>
              <div v-else-if="spellingResult === 'wrong'" class="spelling-feedback wrong-fb">
                ❌ Correct answer: <strong>{{ currentWord?.word }}</strong>
                <span v-if="spellingDiffHtml" class="diff-display" v-html="spellingDiffHtml"></span>
              </div>
              <div v-else-if="spellingResult === 'close'" class="spelling-feedback close-fb">
                ⚠️ Close! You may have a typo.
                <span v-if="spellingDiffHtml" class="diff-display" v-html="spellingDiffHtml"></span>
              </div>
              <button v-if="!spellingResult" class="check-btn" @click.stop="checkSpelling">Check</button>
            </div>

            <!-- FSRS rating -->
            <div class="rating-row">
              <button class="rating-btn again" @click.stop="rateCard(1)" title="Keyboard: 1">Again</button>
              <button class="rating-btn hard" @click.stop="rateCard(2)" title="Keyboard: 2">Hard</button>
              <button class="rating-btn good" @click.stop="rateCard(3)" title="Keyboard: 3">Good</button>
              <button class="rating-btn easy" @click.stop="rateCard(4)" title="Keyboard: 4">Easy</button>
            </div>
          </div>
        </div>
      </div>

      <p class="kb-hint">Space = flip · 1–4 = rate</p>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'" class="placeholder-view">
      <div class="placeholder-icon">🎉</div>
      <h2>Review Complete!</h2>
      <p>{{ sessionReviewed }} card{{ sessionReviewed > 1 ? 's' : '' }} reviewed.</p>
      <button class="action-btn primary" @click="resetToSetup">Done</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVocabulary } from '../composables/useVocabulary'
import * as storage from '../storage/index.js'
import { createCard, rate, Rating, buildQueue, nextDueAt } from '../fsrs.js'
import { checkSpelling as spellCheck, diffHtml } from '../utils/spelling.js'

const vocab = useVocabulary()
vocab.init()

// ---- utility ----

function speakWord() {
  if (!('speechSynthesis' in window)) return
  const word = currentWord.value?.word
  if (!word) return
  const utt = new SpeechSynthesisUtterance(word)
  utt.lang = 'en-US'
  utt.rate = 0.9
  speechSynthesis.speak(utt)
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

function resetToSetup() {
  flipped.value = false
  spellingInput.value = ''
  spellingResult.value = null
  currentIdx.value = 0
  sessionReviewed.value = 0
  freshDone.value = 0
  allNew = []

  const { due, fresh } = buildQueue(vocab.words.value, { newLimit: 20 })
  if (due.length === 0 && fresh.length === 0) {
    if (vocab.count.value === 0) { phase.value = 'empty'; return }
    phase.value = 'nothing-due'
    return
  }

  // 初始化新卡
  const freshCards = fresh.map(entry => {
    if (!entry.srs) allNew.push(entry.word)
    return { ...entry, srs: entry.srs || createCard() }
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
    const { fresh } = buildQueue(vocab.words.value, { newLimit: 20 })
    const freshCards = fresh.map(entry => {
      if (!entry.srs) allNew.push(entry.word)
      return { ...entry, srs: entry.srs || createCard() }
    })
    sessionCards.value = freshCards
    dueReviewCount.value = 0
  } else {
    // ahead: include non-due words too
    const all = Object.values(vocab.words.value)
      .filter(e => e.snapshot?.definitions?.length && e.srs)
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

const currentWord = computed(() => sessionCards.value[currentIdx.value] || null)

const nextDue = computed(() => nextDueAt(vocab.words.value))
const nextDueStr = computed(() => {
  const d = nextDue.value
  if (!d) return ''
  const now = new Date()
  const diff = d - now
  const mins = Math.ceil(diff / 60000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs} hr`
  const days = Math.floor(hrs / 24)
  return `in ${days} day${days > 1 ? 's' : ''}`
})

const freshCount = computed(() => {
  return Object.values(vocab.words.value)
    .filter(e => !e.srs && e.snapshot?.definitions?.length).length
})

const dueAheadCount = computed(() => {
  return Object.values(vocab.words.value)
    .filter(e => e.srs && e.snapshot?.definitions?.length).length
})

// ---- flip ----

const spellingInput = ref('')
const spellingResult = ref(null) // null | 'correct' | 'close' | 'wrong'
const spellingDiffHtml = ref('')

function flipIfFront() {
  if (flipped.value) return
  flipped.value = true
  // focus spelling input after flip animation
  setTimeout(() => spellingInputEl.value?.focus(), 600)
}

const spellingInputEl = ref(null)

function checkSpelling() {
  const input = spellingInput.value
  if (!input.trim()) return
  const result = spellCheck(input, currentWord.value?.word || '')
  if (result.correct) {
    spellingResult.value = 'correct'
    spellingDiffHtml.value = ''
  } else if (result.distance === 1) {
    spellingResult.value = 'close'
    spellingDiffHtml.value = diffHtml(input, currentWord.value?.word || '')
  } else {
    spellingResult.value = 'wrong'
    spellingDiffHtml.value = diffHtml(input, currentWord.value?.word || '')
  }
}

// 评级（提醒模式：拼写结果不影响评级，用户自主决定）
async function rateCard(rating) {
  const entry = currentWord.value
  if (!entry) return

  const srs = rate(entry.srs || createCard(), rating)
  await storage.updateWord(entry.word, { srs })
  // 同步 reactive state（新卡片是用 spread copy 创建的，需回写）
  if (vocab.words.value[entry.word]) {
    vocab.words.value[entry.word].srs = srs
  }
  // 异步推送到远程
  Promise.resolve().then(() => import('../composables/useSync.js').then(m => m.useSync().push()).catch(() => {}))

  // 新卡计数
  if (allNew.includes(entry.word)) {
    freshDone.value++
    allNew = allNew.filter(w => w !== entry.word)
  }

  if (entry.srs) dueReviewCount.value = Math.max(0, dueReviewCount.value - 1)
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
    setTimeout(() => spellingInputEl.value?.focus(), 600)
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
  if (vocab.count.value === 0) { phase.value = 'empty'; return }
  const { due, fresh } = buildQueue(vocab.words.value, { newLimit: 20 })
  if (due.length === 0 && fresh.length === 0) { phase.value = 'nothing-due'; return }
  resetToSetup()
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
