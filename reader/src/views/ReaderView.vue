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
        :missing-audio="tocNoAudio"
        @prev="prevChapter"
        @next="nextChapter"
        @jump="jumpToChapter"
      />

      <article
        class="chapter-content"
        @click="onChapterClick"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <!-- Image mode -->
        <template v-if="isImageBook">
          <div class="image-page" ref="imageContainerRef">
            <img
              :src="imageUrl"
              :width="imageWidth"
              :height="imageHeight"
              class="page-image"
              @load="onImageLoad"
              alt="Page image"
            />
            <!-- Image word tooltip -->
            <div
              v-if="imageWord"
              class="image-word-tooltip"
              :style="tooltipStyle"
            >
              <span class="tooltip-word">{{ imageWord }}</span>
              <button class="tooltip-btn" @click.stop="speakImageWord" title="发音">&#x1f50a;</button>
              <button class="tooltip-btn" @click.stop="addImageWordToVocab" title="加入生词本">+ 生词本</button>
            </div>
          </div>
          <!-- Page jumper -->
          <div class="page-jumper">
            <button @click="prevChapter" :disabled="currentChapterIndex <= 0" class="jumper-btn">&larr;</button>
            <span class="jumper-label">Page</span>
            <input
              type="number"
              :value="currentPageNumber"
              @keydown.enter="jumpToPage($event)"
              :min="1"
              :max="totalPages"
              class="page-input"
            />
            <span class="jumper-label">/ {{ totalPages }}</span>
            <button @click="nextChapter" :disabled="currentChapterIndex >= chapters.length - 1" class="jumper-btn">&rarr;</button>
          </div>
        </template>

        <!-- Text mode (existing, unchanged) -->
        <template v-else>
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
            >&#x25b6;</button>
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
        </template>
      </article>

      <ChapterNav
        :current-index="currentChapterIndex"
        :total="chapters.length"
        :chapter-title="currentChapter.title"
        :book-title="bookTitle"
        :toc-items="chapters"
        :missing-audio="tocNoAudio"
        @prev="prevChapter"
        @next="nextChapter"
        @jump="jumpToChapter"
      />

      <AudioPlayer
        ref="audioPlayerRef"
        :chapter-text="currentChapterText"
        :audio-url="currentAudioUrl"
        :has-audio="currentChapterHasAudio"
        :no-audio-reason="chapterNoAudioReason"
        :book-id="bookId"
        :chapter-id="currentChapter?.id || ''"
        :book-title="bookTitle"
        :chapter-title="currentChapter?.title || ''"
        @time="onAudioTime"
        @next-track="nextChapter"
        @prev-track="prevChapter"
        @ended="onChapterAudioEnded"
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChapterNav from '../components/ChapterNav.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WordPopup from '../components/WordPopup.vue'
import { useVocabulary } from '../composables/useVocabulary'
import { usePhrases } from '../composables/usePhrases'
import { buildDictAlias, resolveDictKey, addEntryForms } from '../utils/dictIndex.js'
import { autoContinueTarget, chapterHasAudio, noAudioReason, tocMissingAudio } from '../utils/audioIndex.js'
import { useSync } from '../composables/useSync'
import { savePosition, loadPosition } from '../composables/useReadingPosition'
import { isBookId } from '../utils/bookId.js'
import { loadBook as loadByoRecord, BookStoreError } from '../storage/index.js'

const route = useRoute()
const router = useRouter()

// M-W 词典代理 Worker（同源相对路径 /api/*，国内不污染）
const DICT_WORKER = ''

const bookId = computed(() => route.params.bookId)
const chapterId = computed(() => route.params.chapterId)

const loading = ref(true)
const error = ref(null)
const bookTitle = ref('')
const chapters = ref([])
const currentChapter = ref(null)
const currentChapterIndex = ref(0)
const dictionary = ref({})
const audioIndex = ref(null) // audio-index.json；null = 清单未知（按「有音频」兜底）

// Word popup state
const selectedWord = ref(null)
const dictEntry = ref(null)
const dictLoading = ref(false)

// ---- Image mode ----

const isImageBook = computed(() => {
  return chapters.value.length > 0 && chapters.value[0].image != null
})

const imageContainerRef = ref(null)
const imageWord = ref(null)
const tooltipStyle = ref({})
const imageNaturalWidth = ref(0)
const imageNaturalHeight = ref(0)

const imageUrl = computed(() => {
  if (!isImageBook.value || !currentChapter.value?.image) return ''
  const base = `${import.meta.env.BASE_URL}books/${bookId.value}`
  return `${base}/${currentChapter.value.image.url}`
})

const imageWidth = computed(() => currentChapter.value?.image?.width || 0)
const imageHeight = computed(() => currentChapter.value?.image?.height || 0)

const currentPageNumber = computed(() => {
  const ch = currentChapter.value
  if (!ch?.id) return 1
  const match = ch.id.match(/ch-(\d+)/)
  return match ? parseInt(match[1], 10) : 1
})

const totalPages = computed(() => chapters.value.length)

const currentChapterText = computed(() => {
  if (!currentChapter.value) return ''
  // Image books have no text to speak; AudioPlayer won't render
  if (isImageBook.value) return ''
  // Title is read as well (matches pre-generated MP3 content, see generator/pipeline/tts.py)
  return [currentChapter.value.title, ...currentChapter.value.paragraphs.map(p => p.text)].join(' ')
})

// R2 音频经 Worker 代理：/api/audio/<bookId>/<chapterId>.mp3
const AUDIO_BASE = '/api/audio'
const currentAudioUrl = computed(() => {
  if (!currentChapter.value) return ''
  return `${AUDIO_BASE}/${bookId.value}/${currentChapter.value.id}.mp3`
})

// ---- 缺音频降级（0.2b · 口径 i）----
// 清单里没该章 = 有音频；清单整个缺失 = 不妄断，按「有音频」处理（退回旧行为）。
const chapterNoAudioReason = computed(() =>
  noAudioReason(audioIndex.value, currentChapter.value?.id))
const currentChapterHasAudio = computed(() =>
  chapterHasAudio(audioIndex.value, currentChapter.value?.id))
const tocNoAudio = computed(() => tocMissingAudio(audioIndex.value))

// ---- 段落定位播放（时间表 + 高亮跟随）----

const audioPlayerRef = ref(null)
const pendingAutoPlay = ref(false) // 断章续播：切完章后要自动开播
const audioTimings = ref(null) // { duration, paragraphs: { 段落id: 起始秒 } }
const audioTime = ref(-1)      // AudioPlayer 回报的当前播放秒数；-1 = 未在播
const timingsCache = {}

async function loadTimings(chId) {
  audioTimings.value = null
  const key = `${bookId.value}/${chId}`
  if (!(key in timingsCache)) {
    try {
      const res = await fetch(`${AUDIO_BASE}/${bookId.value}/${chId}.timings.json`)
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

// ---- 阅读进度持久化 ----

/** 当前视口内第一个可见段落的 index（用于保存阅读位置）。图片模式返回 0。 */
function getCurrentParagraphIndex() {
  if (isImageBook.value) return 0
  const paras = document.querySelectorAll('.paragraph')
  for (let i = 0; i < paras.length; i++) {
    const rect = paras[i].getBoundingClientRect()
    if (rect.bottom > 0) return i  // 第一个尚未滚出视口的段落
  }
  // 所有段落都在视口上方（已滚过章末）→ 返回最后一段
  return Math.max(0, paras.length - 1)
}

function saveCurrentPosition() {
  if (!currentChapter.value) return
  savePosition(bookId.value, currentChapter.value.id, getCurrentParagraphIndex())
}

/** 等这一章渲染完，滚到第 n 段 */
function scrollToParagraph(chapterIndex, paragraphIndex) {
  if (isImageBook.value || paragraphIndex <= 0) return
  nextTick(() => {
    requestAnimationFrame(() => {
      const paraId = chapters.value[chapterIndex]?.paragraphs?.[paragraphIndex]?.id
      if (paraId) document.getElementById('para-' + paraId)?.scrollIntoView({ block: 'nearest' })
    })
  })
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') saveCurrentPosition()
}

// ---- 远程阅读位置（别的设备读到哪了）----
// 首屏不等同步：同步超时是 8 秒，等内容到了再渲染等于每次冷启动都可能卡满 8 秒。
// 所以先用本地位置渲染，远程位置随后到达时——且用户还没动过——才跟随过去。

let userTouched = false // 普通变量即可：只在 watch 回调里读，不需要响应式
function markTouched() { userTouched = true }

const sync = useSync()

// 进来时 URL 里就带着章节 → 用户是特意来的，远程位置不该抢。
// 必须记在 loadBook 里而不是当场读 chapterId：setChapter 自己会 router.replace 回填章节参数，
// 加载完之后那个值永远是真的，拿它当判据等于这段逻辑永远不执行。
let explicitChapterOnLoad = false

watch(() => sync.progressRevision.value, () => {
  if (userTouched || loading.value || !currentChapter.value) return
  if (explicitChapterOnLoad) return
  const saved = loadPosition(bookId.value)
  if (!saved || saved.chapterId === currentChapter.value.id) return
  const idx = chapters.value.findIndex(c => c.id === saved.chapterId)
  if (idx < 0 || idx === currentChapterIndex.value) return
  // record:false —— 这次跳转是远程位置驱动的。照常记录会拿本地旧位置打上「现在」
  // 的时间戳，等于把刚落地的远程位置立刻盖掉再回推，两边都跟着错。
  setChapter(idx, { record: false })
  scrollToParagraph(idx, saved.paragraphIndex)
})

// ---- 生词本 ----

const vocab = useVocabulary()
vocab.init()

// ---- 词组词典（懒加载：只在阅读页触发，加载失败静默降级为纯绿点线）----

const phrases = usePhrases()
phrases.init()

// ---- 词典表面形别名表（实现在 utils/dictIndex.js，纯函数、可单测）----

let dictAlias = new Map() // 表面形 → 词条 key
const resolveKey = (word) => resolveDictKey(word, dictionary.value, dictAlias)

/**
 * 段落词标记预计算（computed，一次计算覆盖 annotated/saved/phrase 三类标记）。
 * 模板不调用方法，只做 O(1) 查找 —— 确保 Vue 响应式依赖追踪可靠。
 * 依赖：currentChapter, vocab.savedSet, phrases.loaded
 */
const paraWordTags = computed(() => {
  const result = {} // paraId → Map<tokenIdx, Set<'annotated'|'saved'|'phrase'>>
  if (!currentChapter.value || isImageBook.value) return result
  const saved = vocab.savedSet.value
  // 反向索引：把词头 + 正文里出现过的表面形都加进来 ——
  // 收藏 abandon 之后，正文里的 abandoned / abandoning 也要亮绿点线
  const lookupSet = new Set(saved)
  if (saved.size) {
    for (const e of Object.values(vocab.words.value)) addEntryForms(lookupSet, e)
  }
  const phraseLoaded = phrases.loaded.value

  for (const para of currentChapter.value.paragraphs) {
    const tokens = para.text.split(/(\s+)/)
    const tagMap = new Map()
    const annoSet = new Set(para.annotatedWords || [])

    // 先标注词组（最高优先级）
    const phraseSpans = phraseLoaded ? phrases.scanParagraph(para.text, lookupSet) : []
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
        if (lookupSet.has(clean)) tags.add('saved')
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
  if (!currentChapter.value || isImageBook.value || !phrases.loaded.value) return result
  const lookupSet2 = new Set(vocab.savedSet.value)
  if (lookupSet2.size) {
    for (const e of Object.values(vocab.words.value)) addEntryForms(lookupSet2, e)
  }
  if (!lookupSet2.size) return result
  for (const para of currentChapter.value.paragraphs) {
    const spans = phrases.scanParagraph(para.text, lookupSet2)
    if (spans.length) result[para.id] = spans
  }
  return result
})

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

async function onChapterClick(event) {
  if (isImageBook.value) {
    handleImageClick(event)
  } else {
    onWordClick(event)
  }
}

function handleImageClick(event) {
  const img = event.target.closest('img')
  if (!img) return

  // Calculate click position on the natural-resolution image
  const rect = img.getBoundingClientRect()
  const scaleX = imageWidth.value / rect.width
  const scaleY = imageHeight.value / rect.height
  const x = (event.clientX - rect.left) * scaleX
  const y = (event.clientY - rect.top) * scaleY

  const hit = findWordAt(currentChapter.value.words || [], x, y)
  if (!hit) {
    imageWord.value = null
    return
  }

  // Pronounce
  import('../composables/useTTS').then(({ useTTS }) => {
    useTTS().speak(hit.text)
  })

  // Show tooltip near click position
  imageWord.value = hit.text
  tooltipStyle.value = {
    left: (event.clientX - rect.left) + 'px',
    top: (event.clientY - rect.top - 10) + 'px'
  }
}

function findWordAt(words, x, y, tolerance = 5) {
  for (const w of words) {
    if (x >= w.x - tolerance && x <= w.x + w.w + tolerance &&
        y >= w.y - tolerance && y <= w.y + w.h + tolerance) {
      return w
    }
  }
  return null
}

function speakImageWord() {
  if (!imageWord.value) return
  import('../composables/useTTS').then(({ useTTS }) => {
    useTTS().speak(imageWord.value)
  })
}

async function addImageWordToVocab() {
  const word = imageWord.value
  if (!word) return
  const imgKey = resolveKey(word)
  const entry = (imgKey && dictionary.value[imgKey]) || {}
  await vocab.add({
    word: word,
    dictEntry: {
      lemma: word,
      phonetic: entry.phonetic || '',
      definitions: entry.definitions || ['见图片释义'],
      partOfSpeech: entry.partOfSpeech || '',
      chapters: [currentChapter.value?.id]
    },
    bookId: bookId.value,
    chapterId: currentChapter.value?.id ?? null
  })
  imageWord.value = null
}

function jumpToPage(event) {
  const page = parseInt(event.target.value, 10)
  if (page >= 1 && page <= chapters.value.length) {
    const targetId = `ch-${String(page).padStart(3, '0')}`
    const idx = chapters.value.findIndex(c => c.id === targetId)
    if (idx >= 0) setChapter(idx)
  }
}

function onImageLoad() {
  // Track natural dimensions for coordinate scaling
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

  // 词典以词头为键，点上来的可能是屈折形 → 先过别名表（离线也能命中）
  const dictKey = resolveKey(word)
  const entry = dictKey ? dictionary.value[dictKey] : undefined
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
      // 写回别名的目标 key：下次点它的其它形态也能直接命中，不重复联网
      dictionary.value[dictKey || word] = merged
      dictEntry.value = merged
      // 空快照自愈：离线时收藏的词，联网查到释义后自动补全生词本快照
      if (merged.definitions?.length) vocab.refreshSnapshot(word, merged)
    }
  } catch (e) {
    // 离线/超时/网络错误 → 保持本地条目（可能无释义）
    // 注意：不在此处改 dictLoading=false，由 finally 统一处理
    console.warn(`Dict lookup failed for "${word}":`, e.name || 'Error', e.message || '')
  } finally {
    clearTimeout(timeoutId)
    if (selectedWord.value === word) dictLoading.value = false
  }
}

/**
 * 内置书：三份静态 JSON（chapters / dictionary / audio-index）。
 */
async function loadBuiltinBook() {
  const baseUrl = `${import.meta.env.BASE_URL}books/${bookId.value}`
  const [chaptersRes, dictRes, audioIndexRes] = await Promise.all([
    fetch(`${baseUrl}/chapters.json`),
    fetch(`${baseUrl}/dictionary.json`),
    fetch(`${baseUrl}/audio-index.json`).catch(() => null)
  ])

  if (!chaptersRes.ok) throw new Error(`Failed to load book: ${chaptersRes.status}`)

  const chaptersData = await chaptersRes.json()
  bookTitle.value = chaptersData.title
  chapters.value = chaptersData.chapters

  // 音频清单（可选）：取不到就按「有音频」兜底，不影响阅读
  audioIndex.value = audioIndexRes && audioIndexRes.ok
    ? await audioIndexRes.json().catch(() => null)
    : null

  if (dictRes.ok) {
    const dictData = await dictRes.json()
    dictionary.value = dictData.words || {}
    dictAlias = buildDictAlias(dictionary.value)
  }
}

/**
 * 自带书（BYO）：正文取自本机 IndexedDB（第 5 步 5B）。
 * 没有 dictionary.json（5.3：不给用户书跑词典管线）-> 点词走联网兜底；
 * 也没有 audio-index.json（没预生成音频）-> AudioPlayer 在 404 处降级浏览器朗读。
 * 书体不出设备：别的设备导入的书在这台机器上说不出正文 ——
 * 这种情形要给可读的原因（而不是白屏 / 报 404）。
 */
async function loadByoBook() {
  const notHere = 'This imported book is not on this device \u2014 imported books stay on the device you added them from.'
  let record = null
  try {
    record = await loadByoRecord(bookId.value)
  } catch (e) {
    if (e instanceof BookStoreError && e.code === 'UNAVAILABLE') {
      throw new Error('This browser is blocking local storage, so imported books cannot be opened.')
    }
    throw new Error(notHere)
  }
  if (!record) throw new Error(notHere)
  bookTitle.value = record.title || 'Untitled'
  chapters.value = record.chapters
  audioIndex.value = null
}

async function loadBook() {
  loading.value = true
  error.value = null
  explicitChapterOnLoad = !!chapterId.value

  try {
    // 释义层是每本书自己的：不在这里清，换到一本没有词典的书时会残留上一本的表
    dictionary.value = {}
    dictAlias = buildDictAlias({})

    if (isBookId(bookId.value)) await loadByoBook()
    else await loadBuiltinBook()

    // Navigate: URL chapter param > saved position > first chapter
    let targetIndex = -1
    if (chapterId.value) {
      // 显式 URL 章节：优先使用
      targetIndex = chapters.value.findIndex(c => c.id === chapterId.value)
    } else {
      // 无显式章节：尝试恢复上次阅读位置
      const saved = loadPosition(bookId.value)
      if (saved) {
        targetIndex = chapters.value.findIndex(c => c.id === saved.chapterId)
      }
    }
    // fallback 必须在 if/else 外部：无效章节 / 无存档 / 存档章节已删除 → 第一章
    if (targetIndex < 0) targetIndex = 0
    setChapter(targetIndex)

    // 从存档恢复 → 等 DOM 渲染完成后滚动到目标段落（图片模式跳过）
    if (!chapterId.value) {
      const saved = loadPosition(bookId.value)
      if (saved) scrollToParagraph(targetIndex, saved.paragraphIndex)
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.record] 是否记下「离开旧章时读到哪」。
 *   同步层应用远程位置时传 false：那次跳转不是用户读出来的位置，
 *   记下来会覆盖掉刚拉到的远程进度，并把它当作本地新值回推。
 */
function setChapter(index, { record = true } = {}) {
  if (index >= 0 && index < chapters.value.length) {
    // 切章前保存旧章位置（首次加载时 currentChapter 为 null，跳过避免写垃圾数据）
    if (record && currentChapter.value) {
      savePosition(bookId.value, currentChapter.value.id, getCurrentParagraphIndex())
    }
    currentChapterIndex.value = index
    currentChapter.value = chapters.value[index]
    audioTime.value = -1
    loadTimings(chapters.value[index].id)
    router.replace(`/reader/${bookId.value}/${chapters.value[index].id}`)
  }
}

function prevChapter() {
  if (currentChapterIndex.value <= 0) {
    audioPlayerRef.value?.stop() // 第一章 → 停止播放，给用户明确反馈
    return
  }
  setChapter(currentChapterIndex.value - 1)
}

function nextChapter() {
  if (currentChapterIndex.value >= chapters.value.length - 1) {
    audioPlayerRef.value?.stop() // 最后一章 → 停止播放
    return
  }
  setChapter(currentChapterIndex.value + 1)
}

/**
 * 本章音频放完了（断章续播）。要不要接下一章由纯函数判：
 * 最后一章、或下一章没有音频 → 停住不跳（与「手动点无音频章不自动跳」同一口径）。
 */
function onChapterAudioEnded() {
  const target = autoContinueTarget(audioIndex.value, chapters.value, currentChapterIndex.value)
  if (target < 0) return
  pendingAutoPlay.value = true
  setChapter(target)
}

// 续播不能紧接在 setChapter 后面直接调 —— 那一刻 AudioPlayer 手上的 props
// 还是旧章，会把旧章的 audioUrl 又播一遍。等这一轮刷新走完（新 props 到位、
// 它自己的切章 watcher 也已 stopAll 清干净），再让它从 0 秒开播。
watch(currentChapterIndex, async () => {
  if (!pendingAutoPlay.value) return
  pendingAutoPlay.value = false
  await nextTick()
  audioPlayerRef.value?.playFrom(0)
})

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
  if (loading.value || !chapters.value.length) return
  if (!id) {
    // 回退到 /reader/<bookId>（无章节参数）：恢复存档阅读位置
    const saved = loadPosition(bookId.value)
    const idx = saved ? chapters.value.findIndex(c => c.id === saved.chapterId) : -1
    if (idx >= 0 && idx !== currentChapterIndex.value) setChapter(idx)
    return
  }
  const idx = chapters.value.findIndex(c => c.id === id)
  if (idx >= 0 && idx !== currentChapterIndex.value) setChapter(idx)
})

// ---- 阅读进度：页面隐藏 / 离开时保存位置 ----
const TOUCH_EVENTS = ['pointerdown', 'keydown', 'wheel']

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', saveCurrentPosition)
  // 用户一动就不再应用远程位置（见上面的 watch）
  for (const ev of TOUCH_EVENTS) {
    window.addEventListener(ev, markTouched, { passive: true, once: true })
  }
})

onBeforeUnmount(() => {
  // 离开阅读页（切 tab、返回书架等）→ 保存当前位置
  saveCurrentPosition()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', saveCurrentPosition)
  for (const ev of TOUCH_EVENTS) window.removeEventListener(ev, markTouched)
})
</script>

<style scoped>
.reader-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 16px 88px;
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
    padding: 0 12px 72px;
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
    padding: 0 24px 88px;
    max-width: 720px;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .reader-view {
    padding: 0 32px 88px;
    max-width: 760px;
  }
}

/* ---- Image mode styles ---- */

.image-page {
  position: relative;
  display: inline-block;
  margin-bottom: 16px;
}

.page-image {
  display: block;
  max-width: 100%;
  height: auto;
  cursor: crosshair;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.image-word-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 100;
  white-space: nowrap;
  font-size: 15px;
}

.tooltip-word {
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.tooltip-btn {
  border: none;
  background: var(--accent-color, #1a73e8);
  color: white;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}

.tooltip-btn:hover {
  opacity: 0.85;
}

/* Page jumper */
.page-jumper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 20px 0 32px;
  font-size: 15px;
  color: var(--text-secondary, #6e6e73);
}

.jumper-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #ffffff);
  color: var(--text-primary, #1d1d1f);
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.15s;
}

.jumper-btn:hover:not(:disabled) {
  background: var(--highlight-bg, #fff3cd);
}

.jumper-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.jumper-label {
  color: var(--text-secondary, #6e6e73);
}

.page-input {
  width: 56px;
  padding: 4px 8px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 6px;
  text-align: center;
  font-size: 15px;
  color: var(--text-primary, #1d1d1f);
  background: var(--bg-primary, #ffffff);
}

.page-input:focus {
  outline: none;
  border-color: var(--accent-color, #1a73e8);
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.15);
}

/* Image mode: wider container for full-page images */
@media (min-width: 768px) {
  .reader-view:has(.image-page) {
    max-width: 900px;
  }
}
</style>
