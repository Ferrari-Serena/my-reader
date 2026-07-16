<template>
  <div id="app-shell">
    <header class="app-header" v-if="showHeader">
      <button class="back-btn" v-if="showBack" @click="goBack">
        ← {{ backLabel }}
      </button>
      <h1 class="app-title">{{ currentTitle }}</h1>
    </header>

    <main class="app-main">
      <router-view :key="$route.fullPath" />
    </main>

    <nav class="app-tabbar" v-if="showTabbar">
      <router-link to="/books" class="tab-item">
        <span class="tab-icon">📚</span>
        <span class="tab-label">Books</span>
      </router-link>
      <router-link to="/vocabulary" class="tab-item">
        <span class="tab-icon">📝</span>
        <span class="tab-label">Words</span>
      </router-link>
      <router-link to="/flashcards" class="tab-item">
        <span class="tab-icon">🔄</span>
        <span class="tab-label">Review</span>
      </router-link>
      <router-link to="/quiz" class="tab-item">
        <span class="tab-icon">✅</span>
        <span class="tab-label">Quiz</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const showHeader = computed(() => true)
const showTabbar = computed(() => {
  return ['BookList', 'Vocabulary', 'Flashcards', 'Quiz'].includes(route.name)
})
const showBack = computed(() => {
  return route.name === 'Reader'
})
const backLabel = computed(() => 'Books')

const currentTitle = computed(() => {
  const titles = {
    BookList: 'My Books',
    Reader: '',
    Vocabulary: 'Vocabulary',
    Flashcards: 'Flashcards',
    Quiz: 'Quiz'
  }
  return titles[route.name] || 'my-reader'
})

function goBack() {
  router.push('/books')
}
</script>

<style scoped>
#app-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #fff);
}

.app-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-primary, #fff);
  border-bottom: 1px solid var(--border-color, #d2d2d7);
  position: sticky;
  top: 0;
  z-index: 100;
  min-height: 48px;
}

.back-btn {
  background: none;
  border: none;
  color: var(--accent-color, #1a73e8);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  margin-right: 8px;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #1d1d1f);
}

.app-main {
  flex: 1;
  overflow-y: auto;
}

.app-tabbar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 8px 0;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: var(--bg-primary, #fff);
  border-top: 1px solid var(--border-color, #d2d2d7);
  position: sticky;
  bottom: 0;
  z-index: 100;
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-decoration: none;
  color: var(--text-secondary, #6e6e73);
  font-size: 11px;
  gap: 2px;
  padding: 4px 12px;
  transition: color 0.2s;
}

.tab-item.router-link-active {
  color: var(--accent-color, #1a73e8);
}

.tab-icon {
  font-size: 20px;
}

.tab-label {
  font-size: 11px;
}
</style>
