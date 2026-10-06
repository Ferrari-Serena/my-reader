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
