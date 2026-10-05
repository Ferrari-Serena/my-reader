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
          <BookCard v-for="book in myBooks" :key="book.id" :book="book" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useBookShelf } from '../composables/useBookShelf'
import { groupByCategory, categoryKeyOf, categoryLabelOf } from '../utils/bookShelf.js'
import BookCard from '../components/BookCard.vue'

// 数据源在组合式里：静态 book-index.json（公开书库）＋ IndexedDB 书库（我的书架），
// 合成与排序口径全在 utils/bookShelf.js，这里只负责画。
const { publicBooks, myBooks, loading, error, byoError, refresh } = useBookShelf()

const activeCategory = ref('')  // '' = 不筛

const isEmpty = computed(() => publicBooks.value.length === 0 && myBooks.value.length === 0)

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
</style>
