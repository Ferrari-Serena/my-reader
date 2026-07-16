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
        @touchstart="onTouchStart"
        @touchend="onTouchEnd"
      >
        <h2 class="chapter-title">{{ currentChapter.title }}</h2>
        <p
          v-for="para in currentChapter.paragraphs"
          :key="para.id"
          class="paragraph"
        >
          <span
            v-for="(word, wi) in para.text.split(/(\s+)/)" :key="wi"
            :class="['word', { 'annotated': isAnnotated(word, para) }]"
            :data-word="word.replace(/[^a-zA-Z]/g, '').toLowerCase()"
            @click.stop="onWordClick($event)"
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

      <AudioPlayer :chapter-text="currentChapterText" />
    </template>

    <WordPopup
      v-if="selectedWord"
      :word="selectedWord"
      :dict-entry="dictEntry"
      :loading-dict="dictLoading"
      @close="selectedWord = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChapterNav from '../components/ChapterNav.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WordPopup from '../components/WordPopup.vue'

const route = useRoute()
const router = useRouter()

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
  return currentChapter.value.paragraphs.map(p => p.text).join(' ')
})

function isAnnotated(word, para) {
  const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  return clean.length > 0 && (para.annotatedWords || []).includes(clean)
}

let touchStartX = 0
function onTouchStart(e) {
  touchStartX = e.changedTouches[0].clientX
}
function onTouchEnd(e) {
  const diff = touchStartX - e.changedTouches[0].clientX
  if (Math.abs(diff) > 80) {
    if (diff > 0) nextChapter()
    else prevChapter()
  }
}

async function onWordClick(event) {
  const word = event.target.dataset.word
  if (!word || word.length < 2) return

  selectedWord.value = word
  dictLoading.value = true

  const entry = dictionary.value[word]
  if (entry?.definitions?.length) {
    dictEntry.value = entry
    dictLoading.value = false
    return
  }

  dictEntry.value = entry || null
  dictLoading.value = false
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

watch([bookId, chapterId], () => {
  if (bookId.value) loadBook()
}, { immediate: true })
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
