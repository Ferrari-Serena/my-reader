<template>
  <div class="book-list-view">
    <div v-if="books.length === 0" class="empty-state">
      <div class="empty-icon">📚</div>
      <h2>No books yet</h2>
      <p>Run the generator to add your first book.</p>
    </div>

    <div v-else class="book-grid">
      <router-link
        v-for="book in books"
        :key="book.id"
        :to="`/reader/${book.id}`"
        class="book-card"
      >
        <div class="book-cover" v-if="book.coverUrl">
          <img :src="book.coverUrl" :alt="book.title" />
        </div>
        <div class="book-cover placeholder" v-else>
          <span>📖</span>
        </div>
        <div class="book-info">
          <h3 class="book-title">{{ book.title }}</h3>
          <p class="book-author" v-if="book.author">{{ book.author }}</p>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const books = ref([])

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}books/book-index.json`)
    if (res.ok) {
      const data = await res.json()
      books.value = data.books || []
    }
  } catch {
    // No books yet — show empty state
  }
})
</script>

<style scoped>
.book-list-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
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

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.book-card {
  text-decoration: none;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary, #f5f5f5);
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.book-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.book-cover {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8e0d5;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover.placeholder span {
  font-size: 40px;
}

.book-info {
  padding: 12px;
}

.book-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text-primary, #1d1d1f);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-author {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  margin: 0;
}
</style>
