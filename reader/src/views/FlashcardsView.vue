<template>
  <div class="flashcards-view">
    <!-- loading -->
    <div v-if="phase === 'loading'" class="placeholder-view">
      <div class="spinner"></div>
      <p>正在准备复习…</p>
    </div>

    <!-- empty -->
    <div v-else-if="phase === 'empty'" class="placeholder-view">
      <h2>暂无需要复习的卡片</h2>
      <p>阅读时收藏生词，或在测验中答错词组，就能开始复习。</p>
      <router-link to="/books" class="action-btn primary">去书架</router-link>
    </div>

    <!-- nothing-due -->
    <div v-else-if="phase === 'nothing-due'" class="placeholder-view">
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
      <!-- 今日进度 -->
      <div class="srow">
        <span>今日已复习 <b>{{ todayCount }}</b> 张</span>
        <router-link class="lnk" to="/books">退出</router-link>
      </div>
      <div class="bar"><i :style="{ width: ((currentIdx + 1) / sessionCards.length * 100) + '%' }"></i></div>
      <p class="smeta">本次队列 {{ sessionCards.length }} 张 · 第 {{ currentIdx + 1 }} 张</p>
      <p class="smeta">连续 <b>{{ streakDays }}</b> 天 · 未来 7 天到期 <b>{{ due7 }}</b> 张</p>

      <!-- card -->
      <div class="flash-card-container" @click="flipIfFront">
        <div :class="['flash-card-inner', { flipped }]">
          <!-- front -->
          <div class="flash-card-front">
            <h2 class="flash-word">{{ currentItem?.content?.text }}</h2>
            <p v-if="currentItem?.content?.phonetic" class="flash-phonetic">
              {{ currentItem.content.phonetic }}
            </p>
            <button v-if="!isPhraseCard" class="speak-btn" @click.stop="speakWord" title="朗读">朗读</button>
            <p class="flip-hint">点击显示释义</p>
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
              <button class="rating-btn easy" @click.stop="rateCard(4)" title="键盘：4">容易</button>
            </div>
          </div>
        </div>
      </div>

      <p class="kb-hint">空格 = 显示释义 · 1–4 = 评级</p>

      <div class="qinfo">
        <div class="qrow"><span>本次队列</span><b>{{ sessionCards.length }} 张</b></div>
        <div class="qrow"><span>预计用时</span><b>{{ estimate }}</b></div>
        <div class="qrow"><span>来源</span><b>{{ sourceText }}</b></div>
        <div class="qnote">复习只覆盖收藏过的词；答错的卡片会缩短下次间隔。</div>
      </div>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'" class="placeholder-view">
      <h2>本轮复习完成</h2>
      <p>本轮已复习 {{ sessionReviewed }} 张 · 今日共 {{ todayCount }} 张。</p>
      <button v-if="canReviewAgain" class="action-btn primary" @click="resetToSetup">再复习一轮</button>
      <button v-else class="action-btn primary" @click="resetToSetup">完成</button>
    </div>

    <p v-if="phase === 'empty' || phase === 'nothing-due'" class="fsrs-note">
      卡片按 FSRS 间隔重复安排复习：你选的「重来／困难／良好／容易」决定下次出现的时间。
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
import { dailyReviewedCount, estimateText, queueSourceText } from '../utils/reviewView.js'

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

const canReviewAgain = computed(() => {
  return buildQueueFromItems(reviewItems.value, { newLimit: 20 }).due.length > 0
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

// 今日进度／队列估算／来源（纯展示，数字都从现有数据算，不编每日目标）
const todayCount = computed(() => dailyReviewedCount(reviewItems.value))

const streakDays = computed(() => {
  const days = new Set()
  for (const e of Object.values(vocab.words.value || {})) {
    const last = (e.srs && e.srs.last_review) || e.addedAt
    if (!last) continue
    const d = new Date(last)
    if (Number.isNaN(d.getTime())) continue
    days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  let n = 0
  const cursor = new Date()
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (!days.has(key(cursor))) cursor.setDate(cursor.getDate() - 1)
  for (;;) {
    if (!days.has(key(cursor))) break
    n++
    cursor.setDate(cursor.getDate() - 1)
  }
  return n
})

const due7 = computed(() => {
  const horizon = Date.now() + 7 * 864e5
  let n = 0
  for (const e of Object.values(vocab.words.value || {})) {
    if (e.srs && e.srs.due && Date.parse(e.srs.due) <= horizon) n++
  }
  return n
})
const estimate = computed(() => estimateText(sessionCards.value.length))
const sourceText = computed(() => queueSourceText(reviewItems.value))

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

/* 3D flip / 拼写 / 差异：旧块迁入（灰阶块未重定义） */
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
.spelling-section {
  margin-bottom: 12px;
  flex-shrink: 0;
}
.diff-display {
  display: block;
  margin-top: 4px;
  font-family: monospace;
  font-size: 16px;
}

/* ── UI-05 · 线框 v0.2 灰阶（覆盖上方旧配色；后写同权重即生效）────────── */
.flashcards-view {
  max-width: 390px;
  padding: 12px 14px 24px;
  color: var(--text, #333);
  font-size: 13px;
  line-height: 1.55;
  background: var(--bg, #fff);
}
.placeholder-view { padding: 56px 12px 24px; color: var(--muted, #666); }
.placeholder-view h2 { font-size: 18px; color: var(--ink, #000); font-weight: 600; }
.placeholder-view p { font-size: 12px; color: var(--muted, #666); }
.fsrs-note {
  max-width: 390px;
  margin: 18px auto 0;
  padding: 9px 10px;
  border: 1px solid var(--line, #e5e5e5);
  border-radius: 3px;
  background: var(--bg, #fff);
  color: var(--muted, #666);
  font-size: 12px;
}
.spinner { border-color: var(--line, #e5e5e5); border-top-color: var(--ink, #000); }
.action-btn {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--faint, #767676);
  border-radius: 3px;
  background: var(--bg, #fff);
  color: var(--text, #333);
  font-size: 12px;
  line-height: 42px;
}
.action-btn.primary { background: var(--ink, #000); border-color: var(--ink, #000); color: var(--bg, #fff); }

/* 今日进度 */
.srow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: var(--text, #333);
}
.srow b { font-size: 12px; color: var(--ink, #000); }
.bar {
  height: 4px;
  margin: 6px 0 4px;
  background: var(--line, #e5e5e5);
  border-radius: 2px;
  overflow: hidden;
}
.bar i { display: block; height: 100%; background: var(--text, #333); }
.smeta { margin: 0 0 10px; font-size: 12px; color: var(--muted, #666); }
.lnk {
  font-size: 12px;
  color: var(--text, #333);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 卡片 */
.flash-card-container {
  height: 320px;
  max-width: 362px;
  width: 100%;
  margin: 0 auto;
  perspective: 1000px;
  cursor: pointer;
}
.flash-card-front,
.flash-card-back {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  border-radius: 3px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.flash-card-front {
  border: 1px solid var(--faint);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
.flash-card-back {
  border: 1px solid var(--faint);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  padding: 16px;
  transform: rotateY(180deg);
}
.flash-word { font-size: 26px; color: var(--ink, #000); font-weight: 600; }
.flash-phonetic { font-size: 12px; color: var(--muted, #666); }
.speak-btn {
  width: 52px;
  height: 44px;
  border-radius: 3px;
  border: 1px solid var(--faint, #767676);
  background: var(--surface, #f5f5f5);
  color: var(--text, #333);
  font-size: 12px;
}
.flip-hint { font-size: 12px; color: var(--muted, #666); }
.back-word { font-size: 18px; color: var(--ink, #000); font-weight: 600; }
.def-list li { font-size: 13px; color: var(--text, #333); }

/* 拼写 */
.spelling-label { font-size: 12px; color: var(--muted, #666); }
.spelling-input {
  min-height: 44px;
  border: 1px solid var(--faint, #767676);
  border-radius: 3px;
  font-size: 13px;
  color: var(--text, #333);
}
.spelling-input.correct { border-color: var(--ink, #000); border-width: 2px; }
.spelling-input.wrong { border-color: var(--ink, #000); border-style: dashed; }
.spelling-feedback { font-size: 12px; }
.correct-fb { color: var(--ink, #000); font-weight: 600; }
.wrong-fb { color: var(--ink, #000); text-decoration: underline; }
.close-fb { color: var(--text, #333); }
.check-btn {
  min-height: 32px;
  border: 1px solid var(--text, #333);
  border-radius: 3px;
  color: var(--text, #333);
  font-size: 12px;
}

/* 四档评分（灰阶） */
.rating-row { gap: 6px; }
.rating-btn {
  min-height: 44px;
  border: 1px solid var(--ink, #000);
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}
.rating-btn.again { background: var(--ink, #000); color: var(--bg, #fff); }
.rating-btn.hard { background: var(--text, #333); color: var(--bg, #fff); border-color: var(--text, #333); }
.rating-btn.good { background: var(--muted, #666); color: var(--bg, #fff); border-color: var(--muted, #666); }
.rating-btn.easy { background: var(--bg, #fff); color: var(--ink, #000); border-color: var(--ink, #000); }
.kb-hint { font-size: 12px; color: var(--muted, #666); margin-top: 10px; }

/* 队列信息 */
.qinfo {
  margin-top: 12px;
  border: 1px solid var(--line, #e5e5e5);
  border-radius: 3px;
  padding: 8px 10px;
}
.qrow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: var(--text, #333);
}
.qrow b { font-size: 12px; color: var(--ink, #000); font-weight: 600; }
.qnote { margin-top: 4px; font-size: 12px; color: var(--muted, #666); line-height: 1.6; }
</style>
