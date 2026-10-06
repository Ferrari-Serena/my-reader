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

    <!-- 两栏（第 7 步 7.2）：公开书库 / 我的书架。窄屏上下堆叠，宽屏并排。 -->
    <div v-else class="shelf-columns">
      <section class="shelf-column">
        <h2 class="shelf-heading">
          Public Library
          <span class="shelf-count">{{ publicBooks.length }}</span>
        </h2>

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

      <section class="shelf-column">
        <h2 class="shelf-heading">
          My Books
          <span class="shelf-count">{{ myBooks.length }}</span>
        </h2>
        <p v-if="myBooks.length === 0" class="shelf-note">
          Books you import stay on this device and appear here.
        </p>
        <div v-else class="book-grid">
          <BookCard
            v-for="book in myBooks"
            :key="book.id"
            :book="book"
            removable
            @remove="removeBook"
          />
        </div>
      </section>
    </div>

    <!-- 缺书区（第 9 步 9.4 ＋ 第 16 步块 3）：正文不在本机的书 —— 不给空白，给一条能走的行。
         账号里有正文的可以直接下载（下载完划线自动接上）；只有笔记的，还得自己导入那一本。 -->
    <section v-if="missingRows.length" class="missing-column">
      <h2 class="shelf-heading">
        待接入
        <span class="shelf-count">{{ missingRows.length }}</span>
      </h2>
      <p class="shelf-note">
        这些书的正文不在本机。账号里有正文的直接下载即可（划线会自动接上）；只有笔记的，在这台机器上导入同一本书就能接上。
      </p>
      <div v-for="row in missingRows" :key="row.bookId" class="missing-row">
        <span class="missing-row-title">《{{ row.title || row.bookId }}》</span>
        <span class="missing-row-meta">{{ rowMeta(row) }}</span>
        <button
          v-if="row.cloud"
          class="missing-row-go as-button"
          :disabled="row.downloading"
          @click="download(row.bookId)"
        >{{ row.downloading ? '下载中…' : (row.failed ? '重试 →' : '下载 →') }}</button>
        <router-link v-else class="missing-row-go" :to="'/reader/' + row.bookId">查看 →</router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useBookShelf } from '../composables/useBookShelf'
import { groupByCategory, categoryKeyOf, categoryLabelOf, notOnDeviceRows } from '../utils/bookShelf.js'
import { useNotes } from '../composables/useNotes'
import { missingBookGroups } from '../utils/notes.js'
import BookCard from '../components/BookCard.vue'

// 数据源在组合式里：静态 book-index.json（公开书库）＋ IndexedDB 书库（我的书架），
// 合成与排序口径全在 utils/bookShelf.js，这里只负责画。
const {
  publicBooks, myBooks, cloudBooks, loading, error, byoError,
  downloading, downloadFailed, prefetching, refresh, fetchCloudBook, removeByoBook
} = useBookShelf()

const activeCategory = ref('')  // '' = 不筛

// 「空」要连账号里的书一起算：本机没有、但账号里有 —— 那不是空书架，是一条能点的「下载」
const isEmpty = computed(() =>
  publicBooks.value.length === 0 && myBooks.value.length === 0 && cloudBooks.value.length === 0)

// 缺书占位（第 9 步 9.4）：有笔记、但本机没有这本书（别的设备划的线同步过来了）。
// 任一来源没读上来（error / byoError）就分不清「缺书」和「读不到」→ 不摆这行，别误导。
const notes = useNotes()
const knownBookIds = computed(() => [
  ...publicBooks.value.map(b => b.id),
  ...myBooks.value.map(b => b.id)
])
// 整批预取在飞时，云书那几行也算「下载中」（后端正在拉，按钮别催）
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
      downloadFailed.value
    )
))

/** 一行说清「为什么它不在本机，以及下一步该干什么」 */
function rowMeta(row) {
  const notes = row.noteCount ? `${row.noteCount} 条笔记 · ` : ''
  if (row.failed) return `${notes}下载没成功，稍后再试`
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

.shelf-columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 28px;
}

@media (min-width: 720px) {
  .shelf-columns {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    align-items: start;
  }
}

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
