<template>
  <div class="quiz-view">
    <!-- ═══ SETUP ═══ -->
    <div v-if="phase === 'setup'" class="quiz-setup">
      <h2 class="setup-title">测验设置</h2>

      <div class="setup-group">
        <label class="setup-label">来源</label>
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
        <label class="setup-label">题目数量</label>
        <div class="count-options">
          <button
            v-for="c in QUIZ_COUNT_OPTIONS" :key="c"
            :class="['count-btn', { active: count === c }]"
            @click="count = c"
          >{{ c === 'All' ? '全部' : c }}</button>
        </div>
      </div>

      <div class="setup-group">
        <label class="setup-label">题型</label>
        <div class="count-options">
          <button
            v-for="t in QUIZ_TYPES" :key="t.value"
            :class="['count-btn', { active: quizType === t.value }]"
            @click="quizType = t.value"
          >{{ t.label }}</button>
        </div>
      </div>

      <div class="setup-stats" v-if="totalAttempts > 0">
        已答 {{ totalAttempts }} 题 · 正确率 {{ accuracy }}%
        <span v-if="vocab.errorPool.value.length"> · 错题池：{{ vocab.errorPool.value.length }}</span>
      </div>

      <button class="start-btn" :disabled="!canStart" @click="startQuiz">
        开始测验
      </button>
      <p v-if="!canStart" class="start-hint">
        {{ vocab.count.value === 0 ? '请先在阅读时收藏生词。' : '所选来源没有可用的生词。' }}
      </p>
    </div>

    <!-- ═══ LOADING ═══ -->
    <div v-else-if="phase === 'loading'" class="placeholder-view">
      <div class="spinner"></div>
      <p>正在生成题目…</p>
    </div>

    <!-- ═══ ERROR ═══ -->
    <div v-else-if="phase === 'error'" class="placeholder-view">
      <p>{{ errorMsg }}</p>
      <button class="action-btn" @click="phase = 'setup'">返回</button>
    </div>

    <!-- ═══ ACTIVE ═══ -->
    <div v-else-if="phase === 'active'" class="quiz-active">
      <!-- progress -->
      <div class="quiz-progress">
        <span class="progress-text">第 {{ currentIdx + 1 }}/{{ questions.length }} 题</span>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: ((currentIdx + 1) / questions.length * 100) + '%' }"></div>
        </div>
        <span class="score-live">对 {{ correctCount }} · 错 {{ wrongCount }}</span>
        <router-link class="quit-link" to="/books">退出</router-link>
      </div>

      <!-- question -->
      <div class="question-card">
        <p class="question-stem">{{ current.stem }}</p>
        <p v-if="current.hint" class="question-hint">{{ current.hint }}</p>

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
            placeholder="输入答案…"
            @keyup.enter="answerTyped"
          />
          <button v-if="!answered" class="submit-btn" @click="answerTyped">提交</button>
        </div>

        <!-- feedback -->
        <div v-if="answered" :class="['feedback', lastCorrect ? 'fb-correct' : 'fb-wrong']" aria-live="polite">
          <template v-if="lastCorrect">回答正确</template>
          <template v-else>
            回答错误。答案：
            <strong>{{ current.options ? current.options[current.answerIndex] : current.answer }}</strong>
          </template>
          <p v-if="current.explanation" class="fb-explanation">{{ current.explanation }}</p>
        </div>

        <button v-if="answered" class="next-btn" @click="nextQuestion">
          {{ currentIdx + 1 >= questions.length ? '查看结果' : '下一题 →' }}
        </button>
      </div>
    </div>

    <!-- ═══ RESULTS ═══ -->
    <div v-else-if="phase === 'results'" class="quiz-results">
      <div class="result-score">
        <span class="score-big">{{ correctCount }}/{{ questions.length }}</span>
        <span class="score-pct">{{ Math.round(correctCount / questions.length * 100) }}%</span>
        <span class="score-split">正确 {{ correctCount }} · 错误 {{ wrongCount }}</span>
        <span v-if="vocab.errorPool.value.length" class="score-split">错题池：{{ vocab.errorPool.value.length }} 张</span>
      </div>
      <div class="result-bar">
        <div class="bar-correct" :style="{ width: (correctCount / questions.length * 100) + '%' }"></div>
      </div>

      <div v-if="wrongList.length" class="wrong-section">
        <h3 class="wrong-title">复习这些生词</h3>
        <div
          v-for="w in wrongList" :key="w.word"
          :class="['wrong-card', { expanded: expandedWrong === w.word }]"
          @click="expandedWrong = expandedWrong === w.word ? null : w.word"
        >
          <div class="wrong-row">
            <span class="wrong-word">{{ w.word }}</span>
            <span class="wrong-type">{{ w.typeLabel || w.type }}</span>
          </div>
          <p v-if="expandedWrong === w.word" class="wrong-detail">{{ w.explanation }}</p>
        </div>
      </div>

      <div class="result-actions">
        <button v-if="wrongList.length" class="action-btn primary" @click="retryWrong">
          重做错题（{{ wrongList.length }}）
        </button>
        <button class="action-btn" @click="phase = 'setup'">新测验</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useVocabulary } from '../composables/useVocabulary'
import { generateQuestions, generatePhraseQuestions } from '../quizGen.js'
import { QUIZ_COUNT_OPTIONS, QUIZ_TYPES, filterQuestionsByType, generationCount } from '../utils/quizView.js'
import { checkSpelling } from '../utils/spelling.js'
import { usePhrases } from '../composables/usePhrases.js'
import { createCard } from '../fsrs.js'
import { phraseCardId, normalizePhraseKey, phraseDueTomorrowIso, makePhraseCard } from '../review.js'
import { putRecord } from '../sync/recordStore.js'
import { nowIso } from '../sync/clock.js'
import { useSync } from '../composables/useSync.js'

const vocab = useVocabulary()
vocab.init()

const phrases = usePhrases()
const sync = useSync()

// ─── setup state ───

const phase = ref('setup') // setup | loading | active | results | error
const source = ref('all')
const count = ref(20)
const quizType = ref('mixed')
const errorMsg = ref('')

const sourceOptions = computed(() => {
  const opts = [
    { value: 'all', label: '全部生词', count: vocab.count.value, disabled: vocab.count.value === 0 },
    { value: 'error-pool', label: '错题池', count: vocab.errorPool.value.length, disabled: vocab.errorPool.value.length === 0 },
    { value: 'phrases', label: '词组', count: phrases.count.value || '—', disabled: !phrases.loaded.value || phrases.count.value === 0 },
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
    const wantAll = count.value === 'All'

    if (source.value === 'phrases') {
      await phrases.init()
      qs = generatePhraseQuestions(phrases.all.value, generationCount(count.value, quizType.value, 30))
    } else {
      // all | error-pool
      const candidates = source.value === 'error-pool'
        ? vocab.errorPool.value.filter(e => e.snapshot?.definitions?.length)
        : Object.values(vocab.words.value).filter(e => e.snapshot?.definitions?.length)
      if (!candidates.length) throw new Error('没有带释义的生词。联网时在阅读页点一下单词即可补全释义。')

      // 错题池词优先排在前（generateQuestions 内部会 shuffle 类型分配，此处将错题词放进候选前列）
      const errorSet = new Set(vocab.errorPool.value.map(e => e.word))
      const sorted = [...candidates].sort((a, b) => (errorSet.has(b.word) ? 1 : 0) - (errorSet.has(a.word) ? 1 : 0))

      const chapters = await loadVocabChapters(candidates)
      // 干扰项池：生词本
      const distractorPool = candidates
      qs = generateQuestions(sorted, distractorPool, chapters, generationCount(count.value, quizType.value, candidates.length))
    }

    // 单一题型：生成时多要一些，再筛到目标题量
    if (quizType.value !== 'mixed') {
      const only = filterQuestionsByType(qs, quizType.value)
      if (!only.length) {
        throw new Error(quizType.value === 'choice' ? '所选来源没有选择题。' : '所选来源没有拼写题。')
      }
      qs = wantAll ? only : only.slice(0, Number(count.value))
    }

    if (!qs.length) throw new Error('无法从所选来源生成题目。')

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
      typeLabel: current.value.options ? '选择题' : '拼写题',
      explanation: current.value.explanation || (current.value.answer ? `答案：${current.value.answer}` : '')
    })
  }

  const word = current.value.word
  if (current.value.type.startsWith('phrase')) {
    // 第 11 步最小闭环：词组答错落一张 card（次日 00:00 到期）+ 一条 wrong 记录；
    // 答对不落卡，也不进生词本。
    if (!correct) {
      const refKey = normalizePhraseKey(word)
      const due = phraseDueTomorrowIso(new Date())
      if (refKey && due) {
        const now = nowIso()
        const srs = { ...createCard(), due }
        // W-08 D-1／D-2：卡片版本 ＋ 来源锚由 makePhraseCard 统一产出（可在单测里断言）
        putRecord('card', makePhraseCard({ refKey, srs, now }), { id: phraseCardId(refKey) })
        putRecord('wrong', {
          type: current.value.type,
          refKey,
          yourAnswer: selectedIdx.value >= 0 && current.value.options ? current.value.options[selectedIdx.value] : '',
          rightAnswer: current.value.options ? current.value.options[current.value.answerIndex] : (current.value.answer || ''),
          createdAt: now,
          updatedAt: now
        })
        sync.pushSoon()
      }
    }
  } else {
    if (vocab.has(word)) {
      await vocab.recordQuizAnswer(word, correct, current.value.type)
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

/* ── UI-07 · 线框 v0.2 灰阶（覆盖上方旧配色）──────────────────────────── */
.quiz-view {
  max-width: 390px;
  padding: 12px 14px 24px;
  color: #333;
  font-size: 13px;
  line-height: 1.55;
  background: #fff;
}
.placeholder-view { padding: 56px 12px; color: #666; }
.spinner { border-color: #e5e5e5; border-top-color: #000; }
.action-btn {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid #999;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
}
.action-btn.primary { background: #000; border-color: #000; color: #fff; }

.setup-title { margin: 4px 0 14px; font-size: 15px; color: #000; font-weight: 600; }
.setup-group { margin-bottom: 14px; }
.setup-label { font-size: 11px; color: #666; font-weight: 400; margin-bottom: 6px; }
.source-options { display: grid; grid-template-columns: 1fr; gap: 6px; }
.source-btn {
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
}
.source-btn.active { border-color: #000; box-shadow: inset 0 0 0 1px #000; }
.source-btn.disabled { border-style: dashed; color: #999; opacity: 1; }
.source-count { font-size: 10px; color: #666; background: #f5f5f5; border-radius: 2px; }
.source-btn.disabled .source-count { color: #999; }

.count-options { display: flex; gap: 0; border: 1px solid #333; border-radius: 3px; overflow: hidden; }
.count-btn {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-right: 1px solid #333;
  border-radius: 0;
  background: #fff;
  color: #333;
  font-size: 12px;
}
.count-btn:last-child { border-right: 0; }
.count-btn.active { background: #000; color: #fff; }

.setup-stats { margin: 4px 0 10px; font-size: 10px; color: #666; }
.start-btn {
  width: 100%;
  min-height: 44px;
  margin-top: 10px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #000;
  color: #fff;
  font-size: 13px;
}
.start-btn:disabled { background: #999; border-color: #999; }
.start-hint { margin-top: 8px; font-size: 10px; color: #666; }

.quiz-progress { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 10px; color: #666; }
.progress-text { font-size: 11px; color: #333; white-space: nowrap; }
.progress-bar { flex: 1; height: 4px; background: #e5e5e5; border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: #333; }
.score-live { font-size: 10px; color: #333; white-space: nowrap; }
.quit-link { font-size: 10px; color: #333; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }

.question-card { border: 1px solid #999; border-radius: 3px; padding: 12px; }
.question-stem { font-size: 14px; color: #000; line-height: 1.6; }
.question-hint { font-size: 10px; color: #666; }
.options-grid { display: grid; grid-template-columns: 1fr; gap: 6px; margin-top: 10px; }
.option-btn {
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
  text-align: left;
}
.option-btn.opt-correct { border-color: #000; box-shadow: inset 0 0 0 1px #000; font-weight: 600; }
.option-btn.opt-wrong { border-style: dashed; border-color: #333; }
.option-btn.opt-dim { color: #999; }
.opt-letter { font-size: 10px; color: #666; margin-right: 6px; }
.answer-input {
  min-height: 44px;
  border: 1px solid #999;
  border-radius: 3px;
  font-size: 13px;
  color: #333;
}
.answer-input.correct { border-color: #000; border-width: 2px; }
.answer-input.wrong { border-color: #000; border-style: dashed; }
.submit-btn {
  min-height: 44px;
  border: 1px solid #333;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
}
.feedback { margin-top: 10px; padding: 8px 10px; border-radius: 3px; font-size: 12px; }
.fb-correct { border: 1px solid #000; background: #f5f5f5; color: #000; font-weight: 600; }
.fb-wrong { border: 1px dashed #333; background: #fff; color: #000; }
.fb-explanation { margin: 4px 0 0; font-size: 11px; font-weight: 400; color: #333; }
.next-btn {
  width: 100%;
  min-height: 44px;
  margin-top: 10px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #000;
  color: #fff;
  font-size: 12px;
}

.quiz-results { padding-top: 6px; }
.result-score { display: flex; align-items: baseline; gap: 10px; }
.score-big { font-size: 28px; color: #000; font-weight: 600; }
.score-pct { font-size: 13px; color: #333; }
.result-bar { height: 6px; margin: 10px 0 16px; background: #e5e5e5; border-radius: 2px; overflow: hidden; }
.bar-correct { height: 100%; background: #333; }
.wrong-title { font-size: 12px; color: #000; font-weight: 600; }
.wrong-card { border: 1px solid #e5e5e5; border-radius: 3px; padding: 8px 10px; margin-top: 6px; }
.wrong-row { display: flex; justify-content: space-between; font-size: 12px; color: #333; }
.wrong-word { color: #000; font-weight: 600; }
.wrong-type { font-size: 10px; color: #666; }
.wrong-detail { margin: 4px 0 0; font-size: 11px; color: #333; }
.result-actions { display: flex; gap: 8px; margin-top: 14px; }
.result-actions .action-btn { flex: 1; }
</style>
