<template>
  <div class="reader-view">
    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading book...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="loadBook">Retry</button>
    </div>

    <!-- Reader -->
    <template v-else-if="currentChapter">
      <ChapterNav
        :current-index="currentChapterIndex"
        :total="chapters.length"
        :chapter-title="currentChapter.title"
        :book-title="bookTitle"
        :toc-items="chapters"
        @prev="prevChapter"
        @next="nextChapter"
        @jump="jumpToChapter"
      />

      <article
        class="chapter-content"
        @click="onWordClick"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <h2 class="chapter-title">{{ currentChapter.title }}</h2>
        <p
          v-for="para in currentChapter.paragraphs"
          :key="para.id"
          :id="'para-' + para.id"
          :class="['paragraph', { 'playing-para': para.id === playingParaId }]"
        >
          <button
            v-if="paraStart(para.id) !== null"
            class="para-play"
            title="Play from here"
            @click.stop="playFromPara(para.id)"
          >▶</button>
          <span
            v-for="(word, wi) in para.text.split(/(\s+)/)" :key="para.id + '-' + wi"
            :class="['word', Object.fromEntries(
              [...(paraWordTags[para.id]?.get(wi) || [])].map(t => [t, true])
            )]"
            :data-word="word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase()"
            :data-para="para.id"
            :data-idx="wi"
          >{{ word }}</span>
        </p>
      </article>

      <ChapterNav
        :current-index="currentChapterIndex"
        :total="chapters.length"
        :chapter-title="currentChapter.title"
        :book-title="bookTitle"
        :toc-items="chapters"
        @prev="prevChapter"
        @next="nextChapter"
        @jump="jumpToChapter"
      />

      <AudioPlayer
        ref="audioPlayerRef"
        :chapter-text="currentChapterText"
        :audio-url="currentAudioUrl"
        @time="onAudioTime"
      />
    </template>

    <WordPopup
      v-if="selectedWord"
      :word="selectedWord"
      :dict-entry="dictEntry"
      :loading-dict="dictLoading"
      :is-saved="isSelectedSaved"
      :phrase-info="selectedPhrase"
      @close="selectedWord = null"
      @add-vocab="onAddVocab"
      @remove-vocab="onRemoveVocab"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChapterNav from '../components/ChapterNav.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WordPopup from '../components/WordPopup.vue'
import { useVocabulary } from '../composables/useVocabulary'
import { usePhrases } from '../composables/usePhrases'

const route = useRoute()
const router = useRouter()

// M-W 词典代理 Worker（Phase 6b；名字沿用旧 TTS Worker，产品化前改名）
const DICT_WORKER = 'https://my-reader-tts.serena605371358.workers.dev'

const bookId = computed(() => route.params.bookId)
const chapterId = computed(() => route.params.chapterId)

const loading = ref(true)
const error = ref(null)
const bookTitle = ref('')
const chapters = ref([])
const currentChapter = ref(null)
const currentChapterIndex = ref(0)
const dictionary = ref({})

// Word popup state
const selectedWord = ref(null)
const dictEntry = ref(null)
const dictLoading = ref(false)

const currentChapterText = computed(() => {
  if (!currentChapter.value) return ''
  // 标题也读（与预生成 MP3 的内容保持一致，见 generator/pipeline/tts.py）
  return [currentChapter.value.title, ...currentChapter.value.paragraphs.map(p => p.text)].join(' ')
})

// 约定路径：books/<bookId>/audio/<chapterId>.mp3（未生成时前端 404 降级 browser TTS）
const currentAudioUrl = computed(() => {
  if (!currentChapter.value) return ''
  return `${import.meta.env.BASE_URL}books/${bookId.value}/audio/${currentChapter.value.id}.mp3`
})

// ---- 段落定位播放（时间表 + 高亮跟随）----

const audioPlayerRef = ref(null)
const audioTimings = ref(null) // { duration, paragraphs: { 段落id: 起始秒 } }
const audioTime = ref(-1)      // AudioPlayer 回报的当前播放秒数；-1 = 未在播
const timingsCache = {}

async function loadTimings(chId) {
  audioTimings.value = null
  const key = `${bookId.value}/${chId}`
  if (!(key in timingsCache)) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}books/${bookId.value}/audio/${chId}.timings.json`)
      timingsCache[key] = res.ok ? await res.json() : null
    } catch {
      timingsCache[key] = null
    }
  }
  // 防快速切章/换书串台：比完整 key（bookId + chapterId）
  if (key === `${bookId.value}/${currentChapter.value?.id}`) audioTimings.value = timingsCache[key]
}

function paraStart(paraId) {
  const t = audioTimings.value?.paragraphs
  return t && paraId in t ? t[paraId] : null
}

function playFromPara(paraId) {
  const s = paraStart(paraId)
  if (s !== null) audioPlayerRef.value?.playFrom(s)
}

function onAudioTime(t) {
  audioTime.value = t
}

const sortedStarts = computed(() => {
  const t = audioTimings.value?.paragraphs
  if (!t) return []
  return Object.entries(t).map(([id, s]) => ({ id, s })).sort((a, b) => a.s - b.s)
})

const playingParaId = computed(() => {
  if (audioTime.value < 0 || !sortedStarts.value.length) return null
  let cur = null
  for (const e of sortedStarts.value) {
    if (e.s <= audioTime.value) cur = e.id
    else break
  }
  return cur
})

// 高亮段落变化时滚动跟随——但只在用户"还在跟读"时（上一个高亮段落在视口内）。
// 用户手动滚到别处阅读时不打断；播放中点段落 ▶ 属于主动定位，也视为跟读。
watch(playingParaId, (id, oldId) => {
  if (!id) return
  if (oldId) {
    const oldEl = document.getElementById('para-' + oldId)
    if (oldEl) {
      const r = oldEl.getBoundingClientRect()
      const inView = r.bottom > 0 && r.top < window.innerHeight
      if (!inView) return // 用户已滚去别处，不拉回
    }
  }
  document.getElementById('para-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

function isAnnotated(word, para) {
  const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  return clean.length > 0 && (para.annotatedWords || []).includes(clean)
}

// ---- 生词本 ----

const vocab = useVocabulary()
vocab.init()

// ---- 词组词典（懒加载：只在阅读页触发，加载失败静默降级为纯绿点线）----

const phrases = usePhrases()
phrases.init()

/**
 * 段落词标记预计算（computed，一次计算覆盖 annotated/saved/phrase 三类标记）。
 * 模板不调用方法，只做 O(1) 查找 —— 确保 Vue 响应式依赖追踪可靠。
 * 依赖：currentChapter, vocab.savedSet, phrases.loaded
 */
const paraWordTags = computed(() => {
  const result = {} // paraId → Map<tokenIdx, Set<'annotated'|'saved'|'phrase'>>
  if (!currentChapter.value) return result
  const saved = vocab.savedSet.value
  const phraseLoaded = phrases.loaded.value

  for (const para of currentChapter.value.paragraphs) {
    const tokens = para.text.split(/(\s+)/)
    const tagMap = new Map()
    const annoSet = new Set(para.annotatedWords || [])

    // 先标注词组（最高优先级）
    const phraseSpans = phraseLoaded ? phrases.scanParagraph(para.text, saved) : []
    for (const s of phraseSpans) {
      for (let i = s.start; i <= s.end; i++) {
        const tags = tagMap.get(i) || new Set()
        tags.add('phrase')
        tagMap.set(i, tags)
      }
    }

    // 逐 token 标注 saved / annotated（phrase 优先，已标 phrase 不再标）
    for (let i = 0; i < tokens.length; i++) {
      const clean = tokens[i].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase()
      if (!clean) continue
      const tags = tagMap.get(i) || new Set()
      if (!tags.has('phrase')) {
        if (saved.has(clean)) tags.add('saved')
        if (annoSet.has(clean)) tags.add('annotated')
      }
      if (tags.size) tagMap.set(i, tags)
    }

    result[para.id] = tagMap
  }
  return result
})

// 当前弹窗词所在的词组（点击词组内词时，弹窗顶部显示词组信息行）
const selectedPhrase = ref(null)

// 词组 spans（供 WordPopup 显示词组信息），基于同一次扫描
const paraPhraseSpans = computed(() => {
  const result = {} // paraId → spans[]
  if (!currentChapter.value || !phrases.loaded.value) return result
  const saved = vocab.savedSet.value
  if (!saved.size) return result
  for (const para of currentChapter.value.paragraphs) {
    const spans = phrases.scanParagraph(para.text, saved)
    if (spans.length) result[para.id] = spans
  }
  return result
})

function isSavedWord(word) {
  const clean = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase()
  return clean.length > 0 && vocab.savedSet.value.has(clean)
}

// 存储 key 是 lemma（went → go），弹窗的收藏态按 点击词 或 其 lemma 任一命中判定
const isSelectedSaved = computed(() => {
  if (!selectedWord.value) return false
  return vocab.has(selectedWord.value) || (dictEntry.value?.lemma ? vocab.has(dictEntry.value.lemma) : false)
})

async function onRemoveVocab(word) {
  // 与 add 的 key 规则对称：优先按 lemma 移除
  await vocab.remove(dictEntry.value?.lemma && vocab.has(dictEntry.value.lemma) ? dictEntry.value.lemma : word)
}

async function onAddVocab(word) {
  await vocab.add({
    word,
    dictEntry: dictEntry.value ? JSON.parse(JSON.stringify(dictEntry.value)) : null,
    bookId: bookId.value,
    chapterId: currentChapter.value?.id ?? null
  })
}

// 滑动切章手势：加方向约束防斜滑误触发（横向位移须 >80px 且明显大于纵向位移，
// 否则上下滚动时拇指弧线轨迹会被误判为翻章——真机白屏问题的触发源）
let touchStartX = 0
let touchStartY = 0
function onTouchStart(e) {
  touchStartX = e.changedTouches[0].clientX
  touchStartY = e.changedTouches[0].clientY
}
function onTouchEnd(e) {
  const dx = touchStartX - e.changedTouches[0].clientX
  const dy = touchStartY - e.changedTouches[0].clientY
  if (Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(dy)) {
    if (dx > 0) nextChapter()
    else prevChapter()
  }
}

async function onWordClick(event) {
  const word = event.target.dataset.word
  if (!word || word.length < 2) return

  // 词组信息：点的词若在某个高亮词组范围内，弹窗附带词组释义
  const paraId = event.target.dataset.para
  const tokenIdx = Number(event.target.dataset.idx)
  const span = (paraPhraseSpans.value[paraId] || [])
    .find(s => tokenIdx >= s.start && tokenIdx <= s.end)
  selectedPhrase.value = span ? { phrase: span.base, defs: span.defs } : null

  selectedWord.value = word
  dictLoading.value = true

  const entry = dictionary.value[word]
  if (entry?.definitions?.length || entry?.notFound) {
    dictEntry.value = entry
    dictLoading.value = false
    return
  }

  // 本地词典无释义 → Worker 在线查词兜底（M-W 代理 + D1 边缘缓存）
  dictEntry.value = entry || null
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${DICT_WORKER}/api/dict/${encodeURIComponent(word)}`, { signal: ctrl.signal })
    if (selectedWord.value !== word) return // 用户已点了别的词
    if (res.ok || res.status === 404) {
      const online = await res.json()
      // 合并：在线释义 + 本地条目的考试标记/出现章节；notFound 也缓存避免重复请求
      const merged = { ...(entry || {}), ...online }
      dictionary.value[word] = merged
      dictEntry.value = merged
      // 空快照自愈：离线时收藏的词，联网查到释义后自动补全生词本快照
      if (merged.definitions?.length) vocab.refreshSnapshot(word, merged)
    }
  } catch { /* 离线/超时 → 保持本地条目（可能无释义） */ }
  finally {
    clearTimeout(timeoutId)
    if (selectedWord.value === word) dictLoading.value = false
  }
}

async function loadBook() {
  loading.value = true
  error.value = null

  try {
    const baseUrl = `${import.meta.env.BASE_URL}books/${bookId.value}`
    const [chaptersRes, dictRes] = await Promise.all([
      fetch(`${baseUrl}/chapters.json`),
      fetch(`${baseUrl}/dictionary.json`)
    ])

    if (!chaptersRes.ok) throw new Error(`Failed to load book: ${chaptersRes.status}`)

    const chaptersData = await chaptersRes.json()
    bookTitle.value = chaptersData.title
    chapters.value = chaptersData.chapters

    if (dictRes.ok) {
      const dictData = await dictRes.json()
      dictionary.value = dictData.words || {}
    }

    // Navigate to requested chapter or first
    const targetIndex = chapterId.value
      ? chapters.value.findIndex(c => c.id === chapterId.value)
      : 0
    setChapter(targetIndex >= 0 ? targetIndex : 0)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function setChapter(index) {
  if (index >= 0 && index < chapters.value.length) {
    currentChapterIndex.value = index
    currentChapter.value = chapters.value[index]
    audioTime.value = -1
    loadTimings(chapters.value[index].id)
    router.replace(`/reader/${bookId.value}/${chapters.value[index].id}`)
  }
}

function prevChapter() {
  setChapter(currentChapterIndex.value - 1)
}

function nextChapter() {
  setChapter(currentChapterIndex.value + 1)
}

function jumpToChapter(index) {
  setChapter(index)
}

// 换书才重新 loadBook（下载 chapters/dictionary JSON）；
// 同书换章只做本地 setChapter，零网络请求——去掉 App.vue 的 :key 后由这里接管路由变化
// ⚠️ 两个 watch 的声明顺序不可调换：同一次导航中按创建顺序执行，
// bookId watch 必须先跑并同步置 loading=true，chapterId watch 的 guard 才能挡住
// "拿旧书章节表 findIndex" 的跨书竞态
watch(bookId, () => {
  if (bookId.value) loadBook()
}, { immediate: true })

// 浏览器前进/后退或手改地址栏章节时同步视图；setChapter 里的 router.replace
// 产生的同值变更被 index 比较挡住，不会循环
watch(chapterId, (id) => {
  if (!id || loading.value || !chapters.value.length) return
  const idx = chapters.value.findIndex(c => c.id === id)
  if (idx >= 0 && idx !== currentChapterIndex.value) setChapter(idx)
})
</script>

<style scoped>
.reader-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 16px 64px;
}

.loading-state,
.error-state {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-secondary, #6e6e73);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color, #d2d2d7);
  border-top-color: var(--accent-color, #1a73e8);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  margin-top: 12px;
  padding: 8px 20px;
  background: var(--accent-color, #1a73e8);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.chapter-content {
  margin: 24px 0;
}

.chapter-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 24px;
  color: var(--text-primary, #1d1d1f);
}

.paragraph {
  font-size: 17px;
  line-height: 1.75;
  margin-bottom: 16px;
  color: var(--text-primary, #1d1d1f);
  text-align: justify;
  hyphens: auto;
}

.paragraph.playing-para {
  background: var(--highlight-bg, #fff3cd);
  box-shadow: 0 0 0 6px var(--highlight-bg, #fff3cd);
  border-radius: 4px;
  transition: background 0.3s, box-shadow 0.3s;
}

.para-play {
  border: none;
  background: none;
  color: var(--accent-color, #1a73e8);
  cursor: pointer;
  font-size: 11px;
  opacity: 0.45;
  padding: 0 2px;
  margin-right: 6px;
  vertical-align: middle;
  transition: opacity 0.15s;
}

.para-play:hover {
  opacity: 1;
}

.word {
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 3px;
  padding: 0 1px;
}

.word:hover {
  background: var(--highlight-bg, #fff3cd);
}

.word.annotated {
  border-bottom: 2px solid var(--accent-color, #e6a817);
}

.word.saved {
  border-bottom: 2px dotted var(--success-color, #34c759);
}

/* 词组高亮：收藏词所在的完整词组（连带中间空白，视觉连续）。优先级高于 saved/annotated */
.word.phrase {
  background: var(--phrase-bg, rgba(52, 199, 89, 0.10));
  border-bottom: 2px solid var(--success-color, #34c759);
  border-radius: 0;
}

/* Mobile */
@media (max-width: 480px) {
  .reader-view {
    padding: 0 12px 48px;
  }
  .paragraph {
    font-size: 16px;
    line-height: 1.7;
  }
  .chapter-title {
    font-size: 20px;
  }
}

/* Tablet */
@media (min-width: 768px) {
  .reader-view {
    padding: 0 24px 64px;
    max-width: 720px;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .reader-view {
    padding: 0 32px 64px;
    max-width: 760px;
  }
}
</style>
