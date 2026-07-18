<template>
  <div class="quiz-view">
    <!-- ═══ SETUP ═══ -->
    <div v-if="phase === 'setup'" class="quiz-setup">
      <h2 class="setup-title">Quiz Setup</h2>

      <div class="setup-group">
        <label class="setup-label">Source</label>
        <div class="source-options">
          <button
            v-for="s in sourceOptions" :key="s.value"
            :class="['source-btn', { active: source === s.value, disabled: s.disabled }]"
            :disabled="s.disabled"
            @click="source = s.value"
          >
            <span class="source-name">{{ s.label }}</span>
            <span class="source-count">{{ s.count }}</span>
          </button>
        </div>
      </div>

      <div class="setup-group">
        <label class="setup-label">Questions</label>
        <div class="count-options">
          <button
            v-for="c in [10, 20, 30, 'All']" :key="c"
            :class="['count-btn', { active: count === c }]"
            @click="count = c"
          >{{ c }}</button>
        </div>
      </div>

      <div class="setup-stats" v-if="totalAttempts > 0">
        📊 Answered {{ totalAttempts }} · Accuracy {{ accuracy }}%
        <span v-if="vocab.errorPool.value.length"> · Error pool: {{ vocab.errorPool.value.length }}</span>
      </div>

      <button class="start-btn" :disabled="!canStart" @click="startQuiz">
        Start Quiz
      </button>
      <p v-if="!canStart" class="start-hint">
        {{ vocab.count.value === 0 ? 'Save words while reading first, or choose SAT Practice.' : 'Selected source has no words.' }}
      </p>
    </div>

    <!-- ═══ LOADING ═══ -->
    <div v-else-if="phase === 'loading'" class="placeholder-view">
      <div class="spinner"></div>
      <p>Preparing questions...</p>
    </div>

    <!-- ═══ ERROR ═══ -->
    <div v-else-if="phase === 'error'" class="placeholder-view">
      <p>{{ errorMsg }}</p>
      <button class="action-btn" @click="phase = 'setup'">Back</button>
    </div>

    <!-- ═══ ACTIVE ═══ -->
    <div v-else-if="phase === 'active'" class="quiz-active">
      <!-- progress -->
      <div class="quiz-progress">
        <span class="progress-text">Q{{ currentIdx + 1 }}/{{ questions.length }}</span>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: ((currentIdx + 1) / questions.length * 100) + '%' }"></div>
        </div>
        <span class="score-live">✓{{ correctCount }} ✗{{ wrongCount }}</span>
      </div>

      <!-- question -->
      <div class="question-card">
        <p class="question-stem">{{ current.stem }}</p>
        <p v-if="current.hint" class="question-hint">💡 {{ current.hint }}</p>

        <!-- 选择题 -->
        <div v-if="current.options" class="options-grid">
          <button
            v-for="(opt, i) in current.options" :key="i"
            :class="optionClass(i)"
            :disabled="answered"
            @click="answerChoice(i)"
          >
            <span class="opt-letter">{{ 'ABCD'[i] }}</span>
            <span class="opt-text">{{ opt }}</span>
          </button>
        </div>

        <!-- 输入题 -->
        <div v-else class="input-answer">
          <input
            ref="answerInput"
            v-model="typedAnswer"
            :class="['answer-input', answered && (lastCorrect ? 'correct' : 'wrong')]"
            :disabled="answered"
            autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"
            placeholder="Type your answer..."
            @keyup.enter="answerTyped"
          />
          <button v-if="!answered" class="submit-btn" @click="answerTyped">Submit</button>
        </div>

        <!-- feedback -->
        <div v-if="answered" :class="['feedback', lastCorrect ? 'fb-correct' : 'fb-wrong']" aria-live="polite">
          <template v-if="lastCorrect">✅ Correct!</template>
          <template v-else>
            ❌ Incorrect. Answer:
            <strong>{{ current.options ? current.options[current.answerIndex] : current.answer }}</strong>
          </template>
          <p v-if="current.explanation" class="fb-explanation">{{ current.explanation }}</p>
        </div>

        <button v-if="answered" class="next-btn" @click="nextQuestion">
          {{ currentIdx + 1 >= questions.length ? 'See Results' : 'Next →' }}
        </button>
      </div>
    </div>

    <!-- ═══ RESULTS ═══ -->
    <div v-else-if="phase === 'results'" class="quiz-results">
      <div class="result-score">
        <span class="score-big">{{ correctCount }}/{{ questions.length }}</span>
        <span class="score-pct">{{ Math.round(correctCount / questions.length * 100) }}%</span>
      </div>
      <div class="result-bar">
        <div class="bar-correct" :style="{ width: (correctCount / questions.length * 100) + '%' }"></div>
      </div>

      <div v-if="wrongList.length" class="wrong-section">
        <h3 class="wrong-title">Review these words</h3>
        <div
          v-for="w in wrongList" :key="w.word"
          :class="['wrong-card', { expanded: expandedWrong === w.word }]"
          @click="expandedWrong = expandedWrong === w.word ? null : w.word"
        >
          <div class="wrong-row">
            <span class="wrong-word">{{ w.word }}</span>
            <span class="wrong-type">{{ w.type }}</span>
          </div>
          <p v-if="expandedWrong === w.word" class="wrong-detail">{{ w.explanation }}</p>
        </div>
      </div>

      <div class="result-actions">
        <button v-if="wrongList.length" class="action-btn primary" @click="retryWrong">
          Retry Wrong ({{ wrongList.length }})
        </button>
        <button class="action-btn" @click="phase = 'setup'">New Quiz</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useVocabulary } from '../composables/useVocabulary'
import { generateQuestions, generatePhraseQuestions } from '../quizGen.js'
import { checkSpelling } from '../utils/spelling.js'
import { usePhrases } from '../composables/usePhrases.js'

const vocab = useVocabulary()
vocab.init()

const phrases = usePhrases()

// ─── setup state ───

const phase = ref('setup') // setup | loading | active | results | error
const source = ref('all')
const count = ref(20)
const errorMsg = ref('')

// SAT 数据缓存（首次选择 SAT 来源时 fetch）
const satDict = ref(null)     // entry[] （适配为 {word, snapshot} 形状）
const satChapters = ref(null)

const sourceOptions = computed(() => {
  const opts = [
    { value: 'all', label: 'All Words', count: vocab.count.value, disabled: vocab.count.value === 0 },
    { value: 'error-pool', label: 'Error Pool', count: vocab.errorPool.value.length, disabled: vocab.errorPool.value.length === 0 },
    { value: 'sat', label: 'SAT Practice', count: satDict.value ? satDict.value.length : '4400+', disabled: false },
    { value: 'phrases', label: 'Phrases', count: phrases.count.value || '—', disabled: !phrases.loaded.value || phrases.count.value === 0 },
  ]
  return opts
})

const canStart = computed(() => {
  const opt = sourceOptions.value.find(o => o.value === source.value)
  return opt && !opt.disabled
})

const totalAttempts = computed(() => {
  let n = 0
  for (const e of Object.values(vocab.words.value)) n += e.quiz?.totalAttempts || 0
  return n
})

const accuracy = computed(() => {
  let a = 0, c = 0
  for (const e of Object.values(vocab.words.value)) {
    a += e.quiz?.totalAttempts || 0
    c += e.quiz?.totalCorrect || 0
  }
  return a ? Math.round(c / a * 100) : 0
})

// ─── quiz session state ───

const questions = ref([])
const currentIdx = ref(0)
const answered = ref(false)
const lastCorrect = ref(false)
const correctCount = ref(0)
const wrongCount = ref(0)
const wrongList = ref([]) // { word, type, explanation }
const typedAnswer = ref('')
const answerInput = ref(null)
const selectedIdx = ref(-1)
const expandedWrong = ref(null)

const current = computed(() => questions.value[currentIdx.value] || {})

// ─── data loading ───

/** SAT dictionary.json 词条 → quizGen 期望的 entry 形状 */
function satEntryAdapter(word, d) {
  return {
    word,
    bookId: 'sat-practice',
    chapterId: (d.chapters || [])[0] || null,
    snapshot: {
      lemma: d.lemma || word,
      phonetic: d.phonetic || '',
      partOfSpeech: d.partOfSpeech || '',
      definitions: d.definitions || [],
      audioUrl: d.audioUrl || '',
      level: d.level ?? null,
      chapters: d.chapters || []
    }
  }
}

async function loadSatData() {
  if (satDict.value) return
  const base = import.meta.env.BASE_URL
  const [dictRes, chapRes] = await Promise.all([
    fetch(`${base}books/sat-practice/dictionary.json`),
    fetch(`${base}books/sat-practice/chapters.json`)
  ])
  if (!dictRes.ok || !chapRes.ok) throw new Error('Failed to load SAT practice data')
  const dictData = await dictRes.json()
  const chapData = await chapRes.json()
  satDict.value = Object.entries(dictData.words || {}).map(([w, d]) => satEntryAdapter(w, d))
  satChapters.value = chapData.chapters || []
}

/** 生词本词的 chapters：取候选词最多的 bookId 的书 */
async function loadVocabChapters(candidates) {
  const byBook = {}
  for (const e of candidates) {
    if (e.bookId) byBook[e.bookId] = (byBook[e.bookId] || 0) + 1
  }
  const bookId = Object.entries(byBook).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!bookId) return []
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}books/${bookId}/chapters.json`)
    if (!res.ok) return []
    return (await res.json()).chapters || []
  } catch { return [] }
}

// ─── quiz flow ───

async function startQuiz() {
  phase.value = 'loading'
  errorMsg.value = ''
  try {
    let qs = []
    const maxCount = count.value === 'All' ? Infinity : count.value

    if (source.value === 'phrases') {
      await phrases.init()
      qs = generatePhraseQuestions(phrases.all.value, maxCount === Infinity ? 30 : maxCount)
    } else if (source.value === 'sat') {
      await loadSatData()
      const candidates = satDict.value
      qs = generateQuestions(
        candidates,
        satDict.value,
        satChapters.value,
        maxCount === Infinity ? 30 : maxCount
      )
    } else {
      // all | error-pool
      const candidates = source.value === 'error-pool'
        ? vocab.errorPool.value.filter(e => e.snapshot?.definitions?.length)
        : Object.values(vocab.words.value).filter(e => e.snapshot?.definitions?.length)
      if (!candidates.length) throw new Error('No words with definitions available. Tap words online while reading to fill definitions.')

      // 错题池词优先排在前（generateQuestions 内部会 shuffle 类型分配，此处将错题词放进候选前列）
      const errorSet = new Set(vocab.errorPool.value.map(e => e.word))
      const sorted = [...candidates].sort((a, b) => (errorSet.has(b.word) ? 1 : 0) - (errorSet.has(a.word) ? 1 : 0))

      const chapters = await loadVocabChapters(candidates)
      // 干扰项池：生词本 + SAT 词典（若已加载）保证质量
      let distractorPool = candidates
      if (candidates.length < 8) {
        try { await loadSatData(); distractorPool = candidates.concat(satDict.value) } catch { /* SAT 数据可选 */ }
      }
      qs = generateQuestions(sorted, distractorPool, chapters, maxCount === Infinity ? candidates.length : maxCount)
    }

    if (!qs.length) throw new Error('Could not generate questions from this source.')

    questions.value = qs
    currentIdx.value = 0
    answered.value = false
    correctCount.value = 0
    wrongCount.value = 0
    wrongList.value = []
    typedAnswer.value = ''
    selectedIdx.value = -1
    phase.value = 'active'
  } catch (e) {
    errorMsg.value = e.message
    phase.value = 'error'
  }
}

function optionClass(i) {
  const cls = ['option-btn']
  if (!answered.value) return cls
  if (i === current.value.answerIndex) cls.push('opt-correct')
  else if (i === selectedIdx.value) cls.push('opt-wrong')
  else cls.push('opt-dim')
  return cls
}

async function recordAnswer(correct) {
  answered.value = true
  lastCorrect.value = correct
  if (correct) correctCount.value++
  else {
    wrongCount.value++
    wrongList.value.push({
      word: current.value.word,
      type: current.value.type,
      explanation: current.value.explanation || (current.value.answer ? `Answer: ${current.value.answer}` : '')
    })
  }

  const word = current.value.word
  // 词组题不入生词本统计；SAT 词答错自动加入生词本
  if (current.value.type !== 'phraseCloze') {
    if (vocab.has(word)) {
      await vocab.recordQuizAnswer(word, correct, current.value.type)
    } else if (!correct && source.value === 'sat') {
      const entry = satDict.value?.find(e => e.word === word)
      if (entry) {
        await vocab.add({
          word,
          dictEntry: { ...entry.snapshot },
          bookId: 'sat-practice',
          chapterId: entry.chapterId
        })
        await vocab.recordQuizAnswer(word, false, current.value.type)
      }
    }
  }

  // 答对 1s 自动下一题
  if (correct) {
    setTimeout(() => { if (answered.value && lastCorrect.value) nextQuestion() }, 1000)
  }
}

function answerChoice(i) {
  if (answered.value) return
  selectedIdx.value = i
  recordAnswer(i === current.value.answerIndex)
}

function answerTyped() {
  if (answered.value || !typedAnswer.value.trim()) return
  const { correct } = checkSpelling(typedAnswer.value, current.value.answer)
  recordAnswer(correct)
}

function nextQuestion() {
  if (currentIdx.value + 1 >= questions.value.length) {
    phase.value = 'results'
    expandedWrong.value = null
    return
  }
  currentIdx.value++
  answered.value = false
  typedAnswer.value = ''
  selectedIdx.value = -1
  if (!questions.value[currentIdx.value].options) {
    nextTick(() => answerInput.value?.focus())
  }
}

function retryWrong() {
  // 用错词重新生成题目（从当前题目列表中筛出错词的题）
  const wrongWords = new Set(wrongList.value.map(w => w.word))
  const retryQs = questions.value.filter(q => wrongWords.has(q.word))
  questions.value = retryQs
  currentIdx.value = 0
  answered.value = false
  correctCount.value = 0
  wrongCount.value = 0
  wrongList.value = []
  typedAnswer.value = ''
  selectedIdx.value = -1
  phase.value = 'active'
}

onMounted(() => {
  // 预热 phrases（如已有缓存则瞬间完成；失败静默，Phrases 选项保持禁用）
  phrases.init().catch(() => {})
})
</script>

<style scoped>
.quiz-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}

/* ═══ shared ═══ */
.placeholder-view {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-secondary, #6e6e73);
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
  padding: 8px 18px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #1d1d1f);
}

.action-btn.primary {
  background: var(--accent-color, #1a73e8);
  color: #fff;
  border-color: var(--accent-color, #1a73e8);
}

/* ═══ setup ═══ */
.setup-title {
  font-size: 20px;
  margin: 8px 0 20px;
  color: var(--text-primary, #1d1d1f);
}

.setup-group { margin-bottom: 20px; }

.setup-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #6e6e73);
  margin-bottom: 8px;
}

.source-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.source-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #1d1d1f);
  transition: border-color 0.15s;
}

.source-btn.active {
  border-color: var(--accent-color, #1a73e8);
  border-width: 2px;
  padding: 11px 13px;
}

.source-btn.disabled { opacity: 0.4; cursor: default; }

.source-count {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 10px;
  padding: 2px 8px;
}

.count-options { display: flex; gap: 8px; }

.count-btn {
  flex: 1;
  padding: 10px 0;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #1d1d1f);
}

.count-btn.active {
  background: var(--accent-color, #1a73e8);
  color: #fff;
  border-color: var(--accent-color, #1a73e8);
}

.setup-stats {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  margin-bottom: 20px;
}

.start-btn {
  width: 100%;
  padding: 14px 0;
  border: none;
  border-radius: 12px;
  background: var(--accent-color, #1a73e8);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.start-btn:disabled { opacity: 0.4; cursor: default; }

.start-hint {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  margin-top: 10px;
}

/* ═══ active ═══ */
.quiz-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.progress-text { font-weight: 600; min-width: 48px; }

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
  transition: width 0.3s;
}

.score-live { white-space: nowrap; }

.question-card {
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 14px;
  padding: 20px;
  background: var(--bg-primary, #fff);
}

.question-stem {
  font-size: 17px;
  line-height: 1.6;
  color: var(--text-primary, #1d1d1f);
  margin: 0 0 8px;
}

.question-hint {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  margin: 0 0 12px;
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 14px;
}

.option-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  color: var(--text-primary, #1d1d1f);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.option-btn:not(:disabled):hover { border-color: var(--accent-color, #1a73e8); }

.opt-letter {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: var(--bg-secondary, #f5f5f7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.opt-text { flex: 1; word-break: break-word; }

.option-btn.opt-correct {
  background: var(--quiz-correct-bg, rgba(52,199,89,0.12));
  border-color: var(--success-color, #34c759);
}

.option-btn.opt-wrong {
  background: var(--quiz-wrong-bg, rgba(255,59,48,0.10));
  border-color: var(--danger-color, #ff3b30);
}

.option-btn.opt-dim { opacity: 0.5; }

.input-answer {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.answer-input {
  flex: 1;
  padding: 12px 14px;
  border: 2px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  font-size: 16px;
  color: var(--text-primary, #1d1d1f);
  background: var(--bg-primary, #fff);
}

.answer-input.correct { border-color: var(--success-color, #34c759); }
.answer-input.wrong { border-color: var(--danger-color, #ff3b30); }

.submit-btn {
  padding: 0 20px;
  border: none;
  border-radius: 10px;
  background: var(--accent-color, #1a73e8);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.feedback {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 14px;
}

.fb-correct {
  background: var(--quiz-correct-bg, rgba(52,199,89,0.12));
  color: var(--success-color, #34c759);
}

.fb-wrong {
  background: var(--quiz-wrong-bg, rgba(255,59,48,0.10));
  color: var(--danger-color, #ff3b30);
}

.fb-explanation {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.next-btn {
  width: 100%;
  margin-top: 14px;
  padding: 12px 0;
  border: none;
  border-radius: 10px;
  background: var(--accent-color, #1a73e8);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

/* ═══ results ═══ */
.result-score {
  text-align: center;
  margin: 24px 0 12px;
}

.score-big {
  font-size: 40px;
  font-weight: 700;
  color: var(--text-primary, #1d1d1f);
}

.score-pct {
  font-size: 18px;
  color: var(--text-secondary, #6e6e73);
  margin-left: 10px;
}

.result-bar {
  height: 8px;
  background: var(--quiz-wrong-bg, rgba(255,59,48,0.10));
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 24px;
}

.bar-correct {
  height: 100%;
  background: var(--success-color, #34c759);
  border-radius: 4px;
}

.wrong-title {
  font-size: 15px;
  color: var(--text-primary, #1d1d1f);
  margin: 0 0 10px;
}

.wrong-card {
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  cursor: pointer;
}

.wrong-card.expanded { border-color: var(--accent-color, #1a73e8); }

.wrong-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.wrong-word {
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.wrong-type {
  font-size: 11px;
  color: var(--text-secondary, #6e6e73);
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 4px;
  padding: 2px 8px;
}

.wrong-detail {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.result-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 20px;
}

/* ═══ responsive ═══ */
@media (max-width: 480px) {
  .options-grid { grid-template-columns: 1fr; }
  .source-options { grid-template-columns: 1fr; }
  .question-stem { font-size: 16px; }
}
</style>
