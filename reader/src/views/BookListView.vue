<template>
  <div class="book-list-view">
    <div class="shelf-actions">
      <router-link to="/import" class="add-book">Add a book</router-link>
    </div>

    <!-- 两个来源各自降级：一个坏掉，另一个照常显示，但要说清楚缺了什么 -->
    <p v-if="byoError" class="shelf-note">
      Your imported books could not be listed on this device (local storage is unavailable).
    </p>
    <p v-else-if="error" class="shelf-note">
      Could not load the public catalogue ({{ error }}).
    </p>

    <div v-if="loading" class="shelf-loading">Loading...</div>

    <div v-else-if="isEmpty" class="empty-state">
      <div class="empty-icon">📚</div>
      <h2>No books yet</h2>
      <p>Books you import will appear here.</p>
    </div>

    <!-- 两个**平级**的切换标签（第 7 步 7.2 的两栏 → 2026-10-06 Ferrari 裁 A）：
         Public Books ｜ My Books。同一行、同一套按钮样式，一次只显示一栏 —— 窄屏不用长滚动。
         分类筛选（第 7 步 7.3）跟着 Public Books 那一栏走；顺序按现状，Public 在左。 -->
    <div v-else class="shelf-tabs">
      <div class="shelf-tabbar" role="tablist">
        <button
          role="tab"
          class="shelf-tab"
          :class="{ active: activeShelf === 'public' }"
          :aria-selected="activeShelf === 'public'"
          @click="activeShelf = 'public'"
        >Public Books <span class="shelf-count">{{ publicBooks.length }}</span></button>
        <button
          role="tab"
          class="shelf-tab"
          :class="{ active: activeShelf === 'mine' }"
          :aria-selected="activeShelf === 'mine'"
          @click="activeShelf = 'mine'"
        >My Books <span class="shelf-count">{{ myBooks.length }}</span></button>
      </div>

      <section v-if="activeShelf === 'public'" class="shelf-pane" role="tabpanel">
        <!-- 分类筛选（第 7 步 7.3）：只有一类时不摆一排只有一个的按钮 -->
        <div v-if="categories.length > 1" class="category-filters">
          <button
            class="chip"
            :class="{ active: activeCategory === '' }"
            @click="activeCategory = ''"
          >All</button>
          <button
            v-for="c in categories"
            :key="c"
            class="chip"
            :class="{ active: activeCategory === c }"
            @click="activeCategory = c"
          >{{ categoryLabelOf(c) }}</button>
        </div>

        <p v-if="publicBooks.length === 0" class="shelf-note">
          The public catalogue is empty.
        </p>

        <div v-for="group in visibleGroups" :key="group.key" class="category-group">
          <h3 class="category-title">{{ group.label }}</h3>
          <div class="book-grid">
            <BookCard v-for="book in group.books" :key="book.id" :book="book" />
          </div>
        </div>
      </section>

      <section v-else class="shelf-pane" role="tabpanel">
        <!-- 页面级常驻条（第 17 步块 D-3 ／ D21-b・m）：**可折叠** —— 首次展开，之后收成一行小字。
             文案只有一份（utils/genApi.js 的 SHELF_NOTE_LINES／SHELF_NOTE_COLLAPSED），这里只画。
             **不写死「5 章」**：额度一律写「单账号每日限额，剩余额度在生成页」（D21-e）。 -->
        <div v-if="myBooks.length" class="gen-note">
          <button
            type="button"
            class="gen-note-toggle"
            :aria-expanded="noteOpen ? 'true' : 'false'"
            @click="toggleNote"
          >{{ noteOpen ? '收起' : '展开' }}</button>
          <ul v-if="noteOpen" class="gen-note-list">
            <li v-for="n in SHELF_NOTE_LINES" :key="n">{{ n }}</li>
          </ul>
          <p v-else class="gen-note-line">{{ SHELF_NOTE_COLLAPSED }}</p>
        </div>

        <p v-if="myBooks.length === 0" class="shelf-note">
          Books you import stay on this device and appear here.
        </p>
        <div v-else class="book-grid">
          <BookCard
            v-for="book in myBooks"
            :key="book.id"
            :book="book"
            removable
            :gen="genOf(book)"
            :clear="clearOf(book)"
            :clear-note="clearNoteOf(book)"
            @remove="removeBook"
            @clear="clearAudio"
          />
        </div>
      </section>
    </div>

    <!-- 缺书区（第 9 步 9.4 ＋ 第 16 步块 3 ＋ 第 16.6 步）：正文不在本机的书 —— 不给空白，给一条能走的行。
         正常路径是**同步后自动加载**（对账里的预取）；这一区是不自动下来时的兜底，手点一下即可。
         账号里只有笔记、没有正文的，还得自己导入那一本。 -->
    <section v-if="missingRows.length" class="missing-column">
      <h2 class="shelf-heading">
        待加载
        <span class="shelf-count">{{ missingRows.length }}</span>
      </h2>
      <p class="shelf-note">
        账号里有、这台设备还没有的书。同步（Sync）后会自动加载到本机；万一没自动下来，点右边的按钮手动加载 —— 划过线的笔记会自动接上。只有笔记、账号里没有正文的，需要在这台机器上导入同一本书。
      </p>
      <div v-for="row in missingRows" :key="row.bookId" class="missing-row">
        <span class="missing-row-title">《{{ row.title || row.bookId }}》</span>
        <span class="missing-row-meta">{{ rowMeta(row) }}</span>
        <button
          v-if="row.cloud"
          class="missing-row-go as-button"
          :disabled="row.downloading"
          @click="download(row.bookId)"
        >{{ row.downloading ? '加载中…' : (row.failed ? '重试 →' : '加载 →') }}</button>
        <router-link v-else class="missing-row-go" :to="'/reader/' + row.bookId">查看 →</router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBookShelf } from '../composables/useBookShelf'
import { groupByCategory, categoryKeyOf, categoryLabelOf, notOnDeviceRows } from '../utils/bookShelf.js'
import { useNotes } from '../composables/useNotes'
import { missingBookGroups } from '../utils/notes.js'
import BookCard from '../components/BookCard.vue'
import { useAuth } from '../composables/useAuth.js'
import { clearAudioIndex, loadAudioIndex, saveAudioIndex } from '../sync/audioIndexCache.js'
import { fetchCloudIndex, indexUsable } from '../utils/audioCloud.js'
import {
  GEN_POLL_MS, SHELF_NOTE_COLLAPSED, SHELF_NOTE_LINES,
  clearAudioConfirm, clearBookAudioRemote, clearEntryState, clearResultText,
  fetchGenStatus, genEntryState, genEntryTo, loadShelfNoteOpen, markShelfNoteSeen,
  saveShelfNoteOpen, shelfIndexStale, withAudioCount
} from '../utils/genApi.js'

// 数据源在组合式里：静态 book-index.json（公开书库）＋ IndexedDB 书库（我的书架），
// 合成与排序口径全在 utils/bookShelf.js，这里只负责画。
const {
  publicBooks, myBooks, cloudBooks, loading, error, byoError,
  downloading, downloadFailed, prefetching, failedIds, refresh, fetchCloudBook, removeByoBook
} = useBookShelf()

const activeCategory = ref('')  // '' = 不筛
// 两栏改成两个平级的标签（2026-10-06 Ferrari 裁 A）：'public' | 'mine'，默认按现状 Public 在左
const activeShelf = ref('public')

// 「空」要连账号里的书一起算：本机没有、但账号里有 —— 那不是空书架，是一条能点的「加载」
const isEmpty = computed(() =>
  publicBooks.value.length === 0 && myBooks.value.length === 0 && cloudBooks.value.length === 0)

// 缺书占位（第 9 步 9.4）：有笔记、但本机没有这本书（别的设备划的线同步过来了）。
// 任一来源没读上来（error / byoError）就分不清「缺书」和「读不到」→ 不摆这行，别误导。
const notes = useNotes()
const knownBookIds = computed(() => [
  ...publicBooks.value.map(b => b.id),
  ...myBooks.value.map(b => b.id)
])
// 整批预取在飞时，云书那几行也算「加载中」（后台正在拉，按钮别催）
const busyIds = computed(() => (
  prefetching.value ? [...downloading.value, ...cloudBooks.value.map((b) => b.bookId)] : downloading.value
))

const missingRows = computed(() => (
  (error.value || byoError.value)
    ? []
    : notOnDeviceRows(
      missingBookGroups(notes.all(), knownBookIds.value),
      cloudBooks.value,
      busyIds.value,
      // 手动重试失败的 ∪ 上一趟对账没拉下来的：两种都画成「重试 →」
      [...downloadFailed.value, ...failedIds.value]
    )
))

/** 一行说清「为什么它不在本机，以及下一步该干什么」 */
function rowMeta(row) {
  const notes = row.noteCount ? `${row.noteCount} 条笔记 · ` : ''
  if (row.failed) return `${notes}上次没加载成功，点「重试 →」`
  return notes + (row.cloud ? '在你的账号里 · 本机没有' : '书不在本机')
}

function download(bookId) { fetchCloudBook(bookId) }

/**
 * 删一本自带书（第 16 步块 4 / D14-c）：本机 ＋ 账号一起删。**不可逆** —— 删完这台机器与
 * 账号里都没了（别的设备是各自那份的主人，不跟着删），所以先问一句再动手，与词表页「全清」
 * 同一姿态；用户点了取消就什么都不做。
 */
function removeBook(book) {
  const name = (book && (book.title || book.id)) || ''
  const ok = window.confirm(
    `Remove "${name}" from your shelf?\n\nThe copy in your account is deleted too. This cannot be undone.`
  )
  if (ok) removeByoBook(book.id)
}

// 有书才出现的分类（按枚举顺序），筛 chips 用
const categories = computed(() => {
  const seen = new Set()
  for (const book of publicBooks.value) seen.add(categoryKeyOf(book.category))
  return [...seen]
})

const groups = computed(() => groupByCategory(publicBooks.value))

const visibleGroups = computed(() => (
  activeCategory.value === ''
    ? groups.value
    : groups.value.filter((g) => g.key === activeCategory.value)
))

// ── 书级生成入口（第 17 步块 D-3 ／ D21-b・e・f・g・i・j・m）──────────────────
// 判定与文案都在 `utils/genApi.js`（`genEntryState` 三态 ＋ `genEntryTo`），这里只负责取数与画。
// 取数顺序：**本机缓存先垫**（一帧就有数）→ 登录后逐本问一次服务端台账（「生成中」的唯一来源）
// → 台账的 `done` 与本机缓存对不上时，才补拉一次真索引。空闲不请求、未登录不请求。

const auth = useAuth()
const genInfo = ref({})        // bookId → { summary, withAudioCount }
const cachedCounts = ref({})   // bookId → 本机缓存里的已就绪章数（null ＝ 没缓存）
const noteOpen = ref(true)

/** 本机缓存里的已就绪章数；没缓存 → null（与 0 不是一回事：只有 null 才可能要去拉真索引） */
function cachedAudioCount(bookId) {
  const idx = loadAudioIndex(bookId)
  return indexUsable(idx, bookId) ? withAudioCount(idx) : null
}

function refreshCachedCounts() {
  const m = {}
  for (const b of myBooks.value) m[b.id] = cachedAudioCount(b.id)
  cachedCounts.value = m
}

/** 一本书的入口三态（未登录时 `genEntryState` 直接给 login 那一格，不看去数） */
function genOf(book) {
  const info = genInfo.value[book.id] || null
  const e = genEntryState({
    isByo: true,
    loggedIn: !!auth.user.value,
    chapterCount: book.chapterCount,
    withAudioCount: info ? info.withAudioCount : cachedCounts.value[book.id],
    summary: info ? info.summary : null
  })
  if (e.kind === 'none') return null
  return { ...e, to: genEntryTo(e.kind, book.id) }
}

// ── 书级「清空该书音频」（第 17 步块 D 的 D4）────────────────────────────────
// 判定与文案都在 genApi（`clearEntryState`／`clearAudioConfirm`／`clearResultText`），这里只负责
// 「先问一句 → 发一次 DELETE → 把结果原样说出来 → 成了就重取这本书的数」。

const clearingIds = ref(new Set())   // 正在清的书（按钮转「清空中…」并禁用；一次只清一本）
const clearNotes = ref({})           // bookId → { ok, text }：就地那一行结果

/** 书卡上要不要出「清空该书音频」（判定在 genApi；这里只把三个输入凑齐） */
function clearOf(book) {
  const info = genInfo.value[book.id] || null
  return clearEntryState({
    loggedIn: !!auth.user.value,
    withAudioCount: info ? info.withAudioCount : cachedCounts.value[book.id],
    clearing: clearingIds.value.has(book.id)
  })
}

/** 结果那一行 —— 与按钮各自独立：清完按钮就没了，这句话要留住 */
function clearNoteOf(book) { return clearNotes.value[book.id] || null }

function setClearing(bookId, on) {
  const s = new Set(clearingIds.value)
  if (on) s.add(bookId)
  else s.delete(bookId)
  clearingIds.value = s
}

/**
 * 清空一本书的音频（D4）。**只删音频**：正文与笔记不动。
 *
 * 先问一句（不可逆的那类动作都先问，与「删书」／词表页「全清」同一姿态；点取消就什么都不做）。
 * 服务端两道闸原样读回来：还有章在跑 → **409**（说「还有 N 章正在生成」）；任务行作废没跑成
 * → **503**（一个字没动）。成没成、动了什么都没动什么，全交给 `clearResultText` 说 —— 不自己编话。
 */
async function clearAudio(book) {
  const name = (book && (book.title || book.id)) || ''
  if (!window.confirm(clearAudioConfirm(name))) return
  setClearing(book.id, true)
  clearNotes.value = { ...clearNotes.value, [book.id]: null }
  try {
    const r = await clearBookAudioRemote(book.id)
    clearNotes.value = { ...clearNotes.value, [book.id]: clearResultText(book, r) }
    if (r.ok) {
      // 本机那份「有音频」当场过期：删掉缓存再重问一次台账，入口才会退回「去生成音频」
      clearAudioIndex(book.id)
      refreshCachedCounts()
      await loadGenInfo(book.id)
    }
  } catch {
    // `clearBookAudioRemote` 恒不抛；这里只兜「之后那几句」自己的意外
    clearNotes.value = { ...clearNotes.value, [book.id]: { ok: false, text: '清空没走完（音频可能没动）—— 稍后重试。' } }
  } finally {
    setClearing(book.id, false)
  }
}

// 只有「有章在排队／在跑」的书才值得再问（空闲不空转；后台标签页不发）
// 注意名字：本文件上面另有一个 `busyIds`（缺书区那条「正在下载」的行），这两个不能同名。
const genBusyIds = computed(() => Object.entries(genInfo.value)
  .filter(([, v]) => v.summary && (v.summary.pending + v.summary.running) > 0)
  .map(([id]) => id))
let genPollTimer = null
let genPollBusy = false

async function genPollOnce() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (genPollBusy) return
  const ids = genBusyIds.value
  if (!ids.length) { stopGenPoll(); return }
  genPollBusy = true
  try { for (const id of ids) await loadGenInfo(id) }
  catch { /* 恒不抛：下个 tick 再来 */ }
  finally { genPollBusy = false }
  if (!genBusyIds.value.length) stopGenPoll()
}

function stopGenPoll() { if (genPollTimer) { clearInterval(genPollTimer); genPollTimer = null } }
function startGenPoll() { stopGenPoll(); genPollTimer = setInterval(genPollOnce, GEN_POLL_MS) }
onBeforeUnmount(stopGenPoll)

/** 问一本书：台账（进度／排队）＋ 必要时补一次真索引。恒不抛（拿不到就保持原样、不编状态） */
async function loadGenInfo(bookId) {
  const r = await fetchGenStatus(bookId)
  if (!r.ok) return               // 401（没登录）／网络抖动：入口退回「看不到在跑」，不报错
  const summary = r.data.summary
  let count = cachedCounts.value[bookId]
  if (shelfIndexStale(summary, count)) {
    const ci = await fetchCloudIndex(bookId)
    if (ci.ok && indexUsable(ci.index, bookId)) {
      saveAudioIndex(bookId, ci.index)   // 这次拿到的更真：写回缓存，下次首帧用它
      count = withAudioCount(ci.index)
    } else if (ci.status === 404) {
      count = 0                          // 404 ＝ 这本书**确知**没有音频（不是「不知道」）
    }
  }
  genInfo.value = { ...genInfo.value, [bookId]: { summary, withAudioCount: count } }
  cachedCounts.value = { ...cachedCounts.value, [bookId]: count }
}

/** 逐本问，限并发 4（书架最多 20 本自带书，别一次把连接占满；串行又太慢） */
async function loadGenForShelf() {
  if (activeShelf.value !== 'mine') return
  refreshCachedCounts()
  if (!auth.user.value || !myBooks.value.length) { genInfo.value = {}; stopGenPoll(); return }
  const queue = myBooks.value.map((b) => b.id)
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()
      try { await loadGenInfo(id) } catch { /* 单本失败不影响别的 */ }
    }
  })
  await Promise.all(workers)
  if (genBusyIds.value.length) startGenPoll()
  else stopGenPoll()
}

/** 常驻条开合（D21-m）：首次展开，点过之后按用户自己的选择记住 */
function toggleNote() {
  noteOpen.value = !noteOpen.value
  saveShelfNoteOpen(noteOpen.value)
}
noteOpen.value = loadShelfNoteOpen()   // 首次展开、之后收成一行小字
markShelfNoteSeen()

// 切到 My Books 栏 ／ 书架重列（预取落盘）／ 登录态一变 → 重取一次
watch(
  [activeShelf, () => myBooks.value, () => auth.user.value],
  () => { loadGenForShelf() }
)

onMounted(refresh)
</script>

<style scoped>
.book-list-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px;
}

.shelf-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.add-book {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.add-book:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.shelf-note {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
  font-size: 13px;
}

/* 页面级常驻条（第 17 步块 D-3）：首次展开、之后收成一行小字（D21-m） */
.gen-note {
  position: relative;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-left: 3px solid var(--accent-color, #1a73e8);
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
  font-size: 12.5px;
  line-height: 1.6;
}

.gen-note-list { margin: 0; padding-left: 18px; }
.gen-note-list li + li { margin-top: 2px; }
.gen-note-line { margin: 0; padding-right: 52px; }

.gen-note-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  background: none;
  padding: 2px 4px;
  font: inherit;
  font-size: 12px;
  color: var(--accent-color, #1a73e8);
  cursor: pointer;
}

.shelf-loading {
  padding: 48px 0;
  text-align: center;
  color: var(--text-secondary, #6e6e73);
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-secondary, #6e6e73);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state h2 {
  margin: 0 0 8px;
  color: var(--text-primary, #1d1d1f);
}

/* 两个平级的切换标签（原来这里是 1fr/1fr 两栏网格）：按钮同一套样式、同一行，
   选中态用下划线 ＋ 强调色，跟分类 chips 不抢视觉。 */
.shelf-tabbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.shelf-tab {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 14px;
  margin-bottom: -1px;
  border: 1px solid transparent;
  border-bottom: 2px solid transparent;
  border-radius: 8px 8px 0 0;
  background: transparent;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary, #6e6e73);
  cursor: pointer;
}

.shelf-tab:hover { color: var(--text-primary, #1d1d1f); }

.shelf-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
  background: var(--bg-secondary, #f5f5f5);
}

.shelf-pane { min-height: 1px; }

.shelf-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--text-primary, #1d1d1f);
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  padding-bottom: 8px;
}

.shelf-count {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary, #6e6e73);
}

.category-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.chip {
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
  cursor: pointer;
}

.chip.active {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.category-group + .category-group {
  margin-top: 16px;
}

.category-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary, #6e6e73);
  margin: 0 0 8px;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}

.missing-column {
  margin-top: 28px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color, #e5e5e5);
}

.missing-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-left: 3px solid #c9821f;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #1d1d1f);
  text-decoration: none;
}

.missing-row:hover {
  border-color: var(--accent-color);
}

.missing-row-title { font-size: 14px; font-weight: 600; }
.missing-row-meta { font-size: 12.5px; color: var(--text-secondary, #6e6e73); }
.missing-row-go { margin-left: auto; font-size: 12.5px; color: var(--accent-color); }

/* 同一个位置有时是「查看」链接、有时是「下载」按钮（账号里有正文）——按钮要清掉默认外观 */
.missing-row-go.as-button {
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  padding: 4px 10px;
  font: inherit;
  font-size: 12.5px;
  color: var(--accent-color);
  cursor: pointer;
}

.missing-row-go.as-button:disabled { opacity: 0.6; cursor: default; }
</style>
