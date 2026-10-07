<template>
  <div class="reader-view" :style="settingsCssVars">
    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading book...</p>
    </div>

    <!-- 缺书（第 9 步 9.4）：正文不在本机 / 取不到，但笔记在 —— 排在 error 前，先认这一支 -->
    <div v-else-if="missingBook" class="missing-state">
      <p class="missing-title">《{{ missingTitle }}》还不在本机</p>
      <p class="missing-body">
        你有 {{ bookNotes.length }} 条划线笔记同步到了这台设备，但书的正文不出设备 ——
        导入同一本书（同一份文件）后，划线会自动接上，不用重新划。
      </p>
      <div class="missing-actions">
        <button class="missing-btn" @click="openNotesPanel">Notes {{ bookNotes.length }}</button>
        <router-link class="missing-btn" to="/import" title="导入同一份文件才能接上（靠内容指纹对齐）">去导入</router-link>
      </div>
      <p class="missing-why">{{ error }}</p>
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
        :show-settings="!isImageBook"
        :show-notes="!isImageBook"
        :notes-count="bookNotes.length"
        @settings="settingsOpen = true"
        @notes="openNotesPanel"
        @prev="prevChapter"
        @next="nextChapter"
        @jump="jumpToChapter"
      />

      <article
        class="chapter-content"
        @click="onChapterClick"
        @mouseup="onTextMouseUp"
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
            :class="['paragraph', { 'playing-para': para.id === playingParaId, 'flash-para': para.id === flashParaId, 'note-lost': !!paraLostNotes(para.id) }]"
            :title="paraLostTitle(para.id)"
          >
            <button
              v-if="paraStart(para.id) !== null"
              class="para-play"
              title="Play from here"
              @click.stop="playFromPara(para.id)"
            >&#x25b6;</button>
            <span
              v-for="(word, wi) in para.text.split(/(\s+)/)" :key="para.id + '-' + wi"
              :class="['word', noteMarkClass(para.id, wi), Object.fromEntries(
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
        :cloud-pending="cloudGenerating"
        :paragraph-starts="chapterParagraphStarts"
        @time="onAudioTime"
        @next-track="nextChapter"
        @prev-track="prevChapter"
        @ended="onChapterAudioEnded"
      />

      <!-- 第 17 步块 D：BYO 书 ＋ 已登录才挂。这里只判粗条件（免得非 BYO 的读者白拉一块懒加载
           chunk）；「已就绪 / 无 WebGPU / 够不够格」由面板里的 audioGenGate 细判，口径只一处。 -->
      <GenAudioPanel
        v-if="isByoBook && !!authUser"
        :book-id="bookId"
        :chapter="currentChapter"
        :audio-index="audioIndex"
        :is-byo="isByoBook"
        :logged-in="!!authUser"
        @ready="onCloudAudioReady"
        @browser-tts="onBrowserTts"
        @status="onPanelStatus"
      />
    </template>

    <!-- 划词浮条（第 9 步 9.1）：选中 -> 选色 -> 划到词边界 -->
    <div
      v-if="noteBar.show"
      class="note-bar"
      :style="{ left: noteBar.x + 'px', top: noteBar.y + 'px' }"
      @mousedown.prevent
    >
      <span class="note-bar-label">划线</span>
      <button
        v-for="c in NOTE_COLORS" :key="c"
        class="note-color" :class="'c-' + c" :title="c"
        @click="startNote(c)"
      ></button>
      <span class="note-bar-sep"></span>
      <button class="note-bar-btn" @click="startNote(DEFAULT_NOTE_COLOR)">＋ 笔记</button>
    </div>

    <NotesPanel
      :open="notesPanelOpen"
      :groups="notesPanelGroups"
      :total="bookNotes.length"
      :missing="missingBook"
      :missing-title="missingTitle"
      @close="closeNotesPanel"
      @jump="jumpToNote"
      @edit="onPanelEdit"
      @remove="onPanelRemove"
    />

    <NoteEditor
      :open="noteEditorOpen"
      :mode="noteDraft?.mode || 'new'"
      :quote="noteDraft?.quote || ''"
      :text="noteDraft?.text || ''"
      :color="noteDraft?.color || DEFAULT_NOTE_COLOR"
      :status="noteDraft?.status || ''"
      @save="saveNote"
      @delete="deleteNote"
      @close="closeNoteEditor"
    />

    <ReadingSettings
      :open="settingsOpen"
      :settings="readerSettings"
      @close="settingsOpen = false"
      @change="onChangeSetting"
      @reset="onResetSettings"
    />

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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChapterNav from '../components/ChapterNav.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WordPopup from '../components/WordPopup.vue'
import { useVocabulary } from '../composables/useVocabulary'
import { usePhrases } from '../composables/usePhrases'
import { buildDictAlias, resolveDictKey, addEntryForms } from '../utils/dictIndex.js'
import { autoContinueTarget, chapterHasAudio, noAudioReason, tocMissingAudio } from '../utils/audioIndex.js'
import { chapterAudioPath, chapterTimingsUrl, fetchCloudIndex, indexUsable } from '../utils/audioCloud.js'
import { loadAudioIndex, saveAudioIndex } from '../sync/audioIndexCache.js'
import { buildParagraphStarts } from '../utils/ttsChunks.js'
import { useSync } from '../composables/useSync'
import { useAuth } from '../composables/useAuth'
import { savePosition, loadPosition } from '../composables/useReadingPosition'
import { isBookId } from '../utils/bookId.js'
import { loadBook as loadByoRecord, BookStoreError } from '../storage/index.js'
import ReadingSettings from '../components/ReadingSettings.vue'
import { useReaderSettings } from '../composables/useReaderSettings'
import NoteEditor from '../components/NoteEditor.vue'
import NotesPanel from '../components/NotesPanel.vue'
import { useNotes } from '../composables/useNotes'
import { NOTE_COLORS, DEFAULT_NOTE_COLOR, resolveAnchor, snapToWords, noteMarksForChapter, groupNotesByChapter, noteStatus } from '../utils/notes.js'

// 第 17 步块 D · 生成面板：**动态** import —— 主包不许静态引 src/generate/（体积＋lamejs 的
// LGPL 边界，见 verify-generate.mjs 的卫生断言）。面板与 kokoro-js 一起落在懒加载 chunk 里。
const GenAudioPanel = defineAsyncComponent(() => import('../generate/GenAudioPanel.vue'))

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

// 阅读设置（第 8 步 8.1）：字号 / 行距 / 页宽 / 字体。
// 值 → .reader-view 的内联 CSS 变量；落盘与同步都在 useReaderSettings 里。
const settingsOpen = ref(false)
const {
  settings: readerSettings,
  cssVars: settingsCssVars,
  set: setReaderSetting,
  reset: resetReaderSettings,
} = useReaderSettings()
function onChangeSetting({ key, value }) { setReaderSetting(key, value) }
function onResetSettings() { resetReaderSettings() }

// ── 划线笔记（第 9 步 9.1 / 9.2）────────────────────────────────────
// 锚点 = {paraId, charStart, charEnd}（段内字符偏移），存进 note 记录。
// 选中先「向外扩到词边界」再存 —— 存的即所见，渲染只需判「这个词与范围相交吗」。
const notes = useNotes()
const noteBar = ref({ show: false, x: 0, y: 0 })
const pendingAnchor = ref(null)
const noteDraft = ref(null)
const noteEditorOpen = ref(false)

const chapterNotes = computed(() => notes.forChapter(bookId.value, currentChapter.value?.id || ''))

/**
 * 本章正文的标注图：能定位的 -> 词级着色（`marks`）；对不上的 -> 段落级降级标记（`lost`，9.5）。
 * 判读本身在 utils/notes.js（纯逻辑，可单独断言）。
 */
const chapterMarks = computed(() => (
  isImageBook.value
    ? { marks: {}, lost: {} }
    : noteMarksForChapter(currentChapter.value?.paragraphs, chapterNotes.value)
))

function noteMarkOf(paraId, tokenIdx) {
  const map = chapterMarks.value.marks[paraId]
  return (map && map.get(tokenIdx)) || null
}
function noteMarkClass(paraId, tokenIdx) {
  const n = noteMarkOf(paraId, tokenIdx)
  return n ? 'note-' + n.color : ''
}

/** 该段是否有锚点失效的笔记（有 -> 返回数组，无 -> null）：正文据此打段落级标记 */
function paraLostNotes(paraId) {
  const arr = chapterMarks.value.lost[paraId]
  return (arr && arr.length) ? arr : null
}
function paraLostTitle(paraId) {
  const arr = paraLostNotes(paraId)
  return arr ? arr.length + ' 条划线笔记锚点失效（已降级为段落级）—— 打开 Notes 查看' : null
}

/** 选区一端在段内的字符偏移；段落开头的 ▶ 按钮属于 DOM 但不属于 para.text，要减掉 */
function boundaryOffset(paraEl, node, offset) {
  const r = document.createRange()
  try { r.setStart(paraEl, 0); r.setEnd(node, offset) } catch { return null }
  const btn = paraEl.querySelector('.para-play')
  return Math.max(0, r.toString().length - (btn ? btn.textContent.length : 0))
}

function pickSelection() {
  if (isImageBook.value) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const r = sel.getRangeAt(0)
  const startEl = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement
  const paraEl = startEl && startEl.closest ? startEl.closest('p.paragraph') : null
  if (!paraEl || !paraEl.contains(r.endContainer)) return
  const paraId = String(paraEl.id || '').replace(/^para-/, '')
  const para = (currentChapter.value?.paragraphs || []).find(p => p.id === paraId)
  if (!para) return
  const a = boundaryOffset(paraEl, r.startContainer, r.startOffset)
  const b = boundaryOffset(paraEl, r.endContainer, r.endOffset)
  if (a === null || b === null || a >= b) return
  const snap = snapToWords(para.text, a, b)
  if (!snap) return
  pendingAnchor.value = { paraId, charStart: snap.start, charEnd: snap.end, quote: para.text.slice(snap.start, snap.end) }
  const rect = r.getBoundingClientRect()
  const barW = 232
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - barW / 2), Math.max(8, window.innerWidth - barW - 8))
  const y = rect.top > 60 ? rect.top - 46 : rect.bottom + 10
  noteBar.value = { show: true, x, y }
}

function onTextMouseUp() { setTimeout(pickSelection, 0) }
function hideNoteBar() { if (noteBar.value.show) noteBar.value = { ...noteBar.value, show: false } }

function onDocClickHideBar(ev) {
  if (!noteBar.value.show) return
  if (ev.target && ev.target.closest && ev.target.closest('.note-bar')) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) hideNoteBar()
}

function startNote(color) {
  const a = pendingAnchor.value
  if (!a) return
  noteDraft.value = {
    mode: 'new', id: null, quote: a.quote, text: '', color: color || DEFAULT_NOTE_COLOR,
    status: '新划线：第 ' + a.charStart + '–' + a.charEnd + ' 字（已对齐到词边界）'
  }
  noteEditorOpen.value = true
  hideNoteBar()
}

function paraOfNote(n) {
  const ch = chapters.value.find(c => c.id === n.chapterId)
  return ch ? (ch.paragraphs.find(p => p.id === n.paraId) || null) : null
}

function openNoteEditor(n) {
  if (!n) return
  const para = paraOfNote(n)
  const r = para ? resolveAnchor(para.text, n) : { kind: 'lost' }
  noteDraft.value = {
    mode: 'edit', id: n.id, quote: n.quote, text: n.text, color: n.color,
    status: r.kind === 'ok' ? '锚点精确' : (r.kind === 'moved' ? '锚点已跟随重解析' : '⚠ 锚点失效（降级为段落级）')
  }
  noteEditorOpen.value = true
}

function closeNoteEditor() { noteEditorOpen.value = false; noteDraft.value = null }

function saveNote({ text, color }) {
  const d = noteDraft.value
  if (!d) return
  if (d.mode === 'edit') {
    notes.update(d.id, { text, color })
  } else {
    const a = pendingAnchor.value
    if (a) {
      notes.add({
        bookId: bookId.value, bookTitle: bookTitle.value, chapterId: currentChapter.value?.id || '',
        paraId: a.paraId, charStart: a.charStart, charEnd: a.charEnd, quote: a.quote,
        text, color
      })
      pendingAnchor.value = null
    }
  }
  closeNoteEditor()
}

function deleteNote() {
  const d = noteDraft.value
  if (d && d.mode === 'edit') notes.remove(d.id)
  closeNoteEditor()
}

// ── 划线笔记列表（第 9 步 9.3）────────────────────────────────────
const notesPanelOpen = ref(false)
const flashParaId = ref(null)
let flashTimer = null

const bookNotes = computed(() => notes.forBook(bookId.value))
/** 按章序分组，并给每条附上锚点判读（跨章也能算：章表里存着每章的段） */
const notesPanelGroups = computed(() =>
  groupNotesByChapter(bookNotes.value, chapters.value).map(g => ({
    ...g,
    notes: g.notes.map(n => ({ ...n, status: noteStatus(chapters.value, n).kind }))
  }))
)

function openNotesPanel() { notesPanelOpen.value = true }
function closeNotesPanel() { notesPanelOpen.value = false }

/** 跳转：换到该笔记所属章（若不同章）再滚到那一段并闪一下 */
function jumpToNote(n) {
  closeNotesPanel()
  const idx = chapters.value.findIndex(c => c.id === n.chapterId)
  if (idx < 0) return
  if (idx !== currentChapterIndex.value) setChapter(idx)
  nextTick(() => {
    const el = document.getElementById('para-' + n.paraId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashParaId.value = n.paraId
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { flashParaId.value = null }, 1500)
  })
}

function onPanelEdit(n) { closeNotesPanel(); openNoteEditor(n) }
function onPanelRemove(n) { notes.remove(n.id) }

// ── 缺书（第 9 步 9.4）─────────────────────────────────────────────
// 正文不在本机（BYO 书不出设备 / 书目已下架 / 取不到），但笔记跟着账号同步来了。
// 这时不报「打不开」了事，给一个能看笔记的入口，并标明「本机无法解析」（绝不静默错位）。
const missingBook = ref(false)
const missingTitle = computed(() => {
  const titled = bookNotes.value.find(n => n.bookTitle)
  return titled ? titled.bookTitle : bookId.value
})

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

// 朗读文本 + 「每一段在文本里的字符起点」**同源产出**（第 17 步块 D-3）：热切要靠这张表把
// 「念到哪一段」换成「云端音频里的第几秒」，两者分开算必然漂（标题算不算、段间空格几个）。
const chapterSpeech = computed(() => {
  if (!currentChapter.value || isImageBook.value) return { text: '', starts: [] }
  // Title is read as well (matches pre-generated MP3 content, see generator/pipeline/tts.py).
  // 标题占第 0 项、id 留空 —— 它没有 timings 条目，热切时按「从章首接」处理。
  return buildParagraphStarts([
    { id: '', text: currentChapter.value.title },
    ...currentChapter.value.paragraphs.map(para => ({ id: para.id, text: para.text })),
  ])
})
const currentChapterText = computed(() => chapterSpeech.value.text)
const chapterParagraphStarts = computed(() => chapterSpeech.value.starts)

// 音频 URL 两条路（形状不同，不能共用一个前缀）：
//   · 内置书（公版／自产）→ /api/audio/<bookId>/<chapterId>.mp3（**匿名可读**，不动）
//   · BYO 书 → /api/book/<bookId>/audio/<chapterId>.mp3（**账号空间**，需会话；见 utils/audioCloud.js）
const AUDIO_BASE = '/api/audio'
const isByoBook = computed(() => isBookId(bookId.value))
// 账号会话：面板只在「BYO 书 + 已登录」时挂（生成要写账号空间，未登录服务端 401）。
// 与 App.vue 共用同一份单例（useAuth 是 module-level state），这里只取 user。
const { user: authUser } = useAuth()
// 云端音频「生成好了」的世代号：+1 让 mp3／timings 的 URL 变一下，绕开服务端的
// `immutable` 缓存（同一章重新生成过就必须拿新的）。0 时不加查询串 —— 首次加载与 D-1
// 验过的那条 URL 一字不差（服务端只认 pathname，查询串不影响取键）。
const audioVersion = ref(0)
const currentAudioUrl = computed(() => {
  const ch = currentChapter.value
  if (!ch) return ''
  if (!isByoBook.value) return `${AUDIO_BASE}/${bookId.value}/${ch.id}.mp3`
  const v = audioVersion.value
  return chapterAudioPath(bookId.value, ch.id + '.mp3') + (v ? `?v=${v}` : '')
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
      const url = isByoBook.value
        ? chapterTimingsUrl(bookId.value, chId) + (audioVersion.value ? `?v=${audioVersion.value}` : '')
        : `${AUDIO_BASE}/${bookId.value}/${chId}.timings.json`
      const res = await fetch(url)
      timingsCache[key] = res.ok ? await res.json() : null
    } catch {
      timingsCache[key] = null
    }
  }
  // 防快速切章/换书串台：比完整 key（bookId + chapterId）
  if (key === `${bookId.value}/${currentChapter.value?.id}`) audioTimings.value = timingsCache[key]
}

/**
 * 第 17 步块 D／D-3：这一章的云端音频刚就绪（面板 @ready，或它的就绪轮询命中）。
 * ① 回执里带的就是**合并后的索引** —— 直接落盘，不必再拉一次；
 * ② `audioVersion` +1：URL 变一下，绕开 immutable 缓存 ＋ 让 timings 重拉
 *    （旧那份是「还没有音频」时缓存的 null）；
 * ③ **就地热切**：此刻正用浏览器朗读这一章的话，把音源换成云端音色，位置按**段落**接
 *    （判据 2 只要求段落级；段内接位做不到，理由见 ttsChunks.js 头注）。
 * 没在朗读就不动 —— 下一次按播放走的就是云端音频。
 */
async function onCloudAudioReady({ index, chapterId: chId } = {}) {
  if (index) {
    audioIndex.value = index
    saveAudioIndex(bookId.value, index) // 块 E：本机刚生成的也写进缓存（下次开书首帧即有）
  }
  audioVersion.value += 1
  const id = chId || currentChapter.value?.id || ''
  if (!id) return
  // 就绪的是**别的章**（切章后旧答复才到）→ 只落索引，别拿它去热切当前章
  if (id !== currentChapter.value?.id) return
  // 问播放器「念到哪一段」。没在朗读 → null → 不必热切。
  const pid = audioPlayerRef.value?.ttsParagraphId?.()
  if (pid === null || pid === undefined) return
  delete timingsCache[`${bookId.value}/${id}`]
  await loadTimings(id)
  // 标题段（id 空）→ 0：从章首接；timings 里没这一段 → 不动，让朗读继续
  const sec = pid ? paraStart(pid) : 0
  if (sec === null) return
  // 等一拍，让 `?v=` 那次 URL 变更落到播放器的 prop 上再换源
  await nextTick()
  await audioPlayerRef.value?.hotSwitch?.(sec)
}

/** 面板里点「改用浏览器朗读」：交给播放器自己那套兜底（与 404 降级同一条路） */
function onBrowserTts() {
  audioPlayerRef.value?.useBrowserTTS?.()
}

// 面板状态（第 17 步块 D-3）：只用来决定播放器副标题要不要写「· Generating…」。
// 带 chapterId 一起收 —— 切章后旧状态自然失效，不用另设清空钩子。
const panelStatus = ref({ chapterId: '', running: false, pending: false })
function onPanelStatus(next) {
  panelStatus.value = next || { chapterId: '', running: false, pending: false }
}
const cloudGenerating = computed(() => {
  const st = panelStatus.value
  return !!st.running && !!st.pending && st.chapterId === (currentChapter.value?.id || '')
})

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
    return
  }
  // 手机没有 mouseup：长按选中后由这条把浮条带出来（等系统把 selection 定下来）
  setTimeout(pickSelection, 180)
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

  // 点到划过线的词 -> 开笔记（而不是弹单词框）
  const marked = noteMarkOf(paraId, tokenIdx)
  if (marked) { selectedWord.value = null; openNoteEditor(marked); return }

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
  // 云端就绪清单（第 17 步块 D）：未登录 401／还没生成过 404 一律当「没有清单」→ 播放器
  // 退回「点开试、404 再降级浏览器朗读」的旧行为（不报错、不空转、也不冒充有音频）。
  // `book` 字段对不上同样不认（宁缺勿错）。
  // 块 E「预取带 index」：先用预取时缓存下来的那份垫上（B 设备一打开就有，判据 3 的首帧），
  // 再拉一次覆盖 —— 别的设备新生成的章靠这次覆盖追平。缓存空 → 退回原来的「等这次请求」。
  const cached = loadAudioIndex(bookId.value)
  audioIndex.value = indexUsable(cached, bookId.value) ? cached : null
  const cloud = await fetchCloudIndex(bookId.value)
  if (cloud.ok && indexUsable(cloud.index, bookId.value)) {
    audioIndex.value = cloud.index
    saveAudioIndex(bookId.value, cloud.index) // 这次拿到的更真：写回缓存，下次首帧用它
  }
}

async function loadBook() {
  loading.value = true
  error.value = null
  missingBook.value = false
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
    // 这本书下有笔记 -> 给「缺书占位 + 笔记可见」，而不是一句打不开（9.4）
    if (bookNotes.value.length) missingBook.value = true
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
  window.addEventListener('scroll', hideNoteBar, true)
  document.addEventListener('click', onDocClickHideBar)
  // 用户一动就不再应用远程位置（见上面的 watch）
  for (const ev of TOUCH_EVENTS) {
    window.addEventListener(ev, markTouched, { passive: true, once: true })
  }
})

onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer)
  // 离开阅读页（切 tab、返回书架等）→ 保存当前位置
  saveCurrentPosition()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', saveCurrentPosition)
  window.removeEventListener('scroll', hideNoteBar, true)
  document.removeEventListener('click', onDocClickHideBar)
  for (const ev of TOUCH_EVENTS) window.removeEventListener(ev, markTouched)
})
</script>

<style scoped>
.reader-view {
  max-width: var(--reader-width, 760px);
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
  font-family: var(--reader-font, var(--font-sans));
}

.chapter-title {
  font-size: calc(var(--reader-font-size, 17px) + 5px);
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 24px;
  color: var(--text-primary, #1d1d1f);
}

.paragraph {
  font-size: var(--reader-font-size, 17px);
  line-height: var(--reader-line-height, 1.75);
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
    font-size: var(--reader-font-size, 16px);
    line-height: var(--reader-line-height, 1.7);
  }
  .chapter-title {
    font-size: calc(var(--reader-font-size, 16px) + 4px);
  }
}

/* Tablet */
@media (min-width: 768px) {
  .reader-view {
    padding: 0 24px 88px;
    max-width: var(--reader-width, 720px);
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .reader-view {
    padding: 0 32px 88px;
    max-width: var(--reader-width, 760px);
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

/* ---- 划线笔记（第 9 步）---- */

.paragraph.flash-para {
  background: rgba(26, 115, 232, 0.14);
  transition: background 0.25s;
}

/* 段落级降级标记（9.5）：这一段有笔记锚点失效 —— 绝不静默错位 */
.paragraph.note-lost {
  box-shadow: inset 3px 0 0 #c9821f;
  padding-left: 9px;
}

.paragraph.note-lost.playing-para {
  box-shadow: inset 3px 0 0 #c9821f, 0 0 0 6px var(--highlight-bg, #fff3cd);
}

.word.note-yellow { background: #f6d365; }
.word.note-green { background: #8fd19e; }
.word.note-blue { background: #8ec5f0; }
.word.note-pink { background: #f3a7bd; }

@media (prefers-color-scheme: dark) {
  .word.note-yellow { background: #6d5a1f; }
  .word.note-green { background: #24502f; }
  .word.note-blue { background: #1e3f5c; }
  .word.note-pink { background: #5b2b3a; }
}

.note-bar {
  position: fixed;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 6px 10px;
}

.note-bar-label {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.note-color {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.25);
  cursor: pointer;
  padding: 0;
}

.note-color.c-yellow { background: #f6d365; }
.note-color.c-green { background: #8fd19e; }
.note-color.c-blue { background: #8ec5f0; }
.note-color.c-pink { background: #f3a7bd; }

.note-bar-sep {
  width: 1px;
  height: 18px;
  background: var(--border-color, #d2d2d7);
}

.note-bar-btn {
  border: none;
  background: none;
  color: var(--accent-color, #1a73e8);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
}

/* ---- 缺书占位（第 9 步 9.4）---- */

.missing-state {
  max-width: 560px;
  margin: 48px auto;
  padding: 20px 18px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 12px;
  background: var(--bg-secondary, #f5f5f7);
  text-align: center;
}

.missing-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.missing-body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text-secondary, #6e6e73);
}

.missing-actions {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.missing-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #ffffff);
  color: var(--accent-color, #1a73e8);
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 13.5px;
  cursor: pointer;
  text-decoration: none;
}

.missing-why {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: var(--text-secondary, #6e6e73);
  word-break: break-word;
}
</style>
