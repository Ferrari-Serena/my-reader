<template>
  <router-link :to="`/reader/${book.id}`" class="book-card">
    <div class="book-cover" v-if="coverSrc">
      <img :src="coverSrc" :alt="book.title" loading="lazy" />
    </div>
    <div class="book-cover placeholder" v-else>
      <span>📖</span>
    </div>
    <div class="book-info">
      <h3 class="book-title">{{ book.title }}</h3>
      <p class="book-author" v-if="book.author">{{ book.author }}</p>
      <!-- 「我的书架」栏里自带书不给来源提示时，用户会以为它上了云 -->
      <p class="book-kind" v-if="book.kind === 'byo'">Your book</p>
    </div>
  </router-link>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  book: { type: Object, required: true }
})

// book-index.json 里的 coverUrl 是站点相对路径（books/<id>/cover.svg）。
// 将来 BASE_URL 若从 '/' 挪回子路径，这里跟着走，不会指到域名根上。
const coverSrc = computed(() => {
  const url = String(props.book?.coverUrl || '').trim()
  if (!url) return ''
  if (/^(https?:|data:|blob:|\/)/.test(url)) return url
  return `${import.meta.env.BASE_URL}${url}`
})
</script>

<style scoped>
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
  aspect-ratio: 2 / 3;
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

.book-kind {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}
</style>
