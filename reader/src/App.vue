<template>
  <div id="app-shell">
    <header class="app-header" v-if="showHeader">
      <button class="back-btn" v-if="showBack" @click="goBack">
        ← {{ backLabel }}
      </button>
      <h1 class="app-title">{{ currentTitle }}</h1>
    </header>

    <main class="app-main">
      <!-- 不给 router-view 加 :key="$route.fullPath"：Reader 内换章只改路由参数，
           加 key 会导致整个 ReaderView 销毁重建（重新下载书数据 + 重排全部单词），
           移动端表现为滑动后正文白屏。换书/换章由 ReaderView 内部 watch 处理。 -->
      <router-view />
    </main>

    <nav class="app-tabbar" v-if="showTabbar">
      <router-link to="/books" class="tab-item">
        <span class="tab-icon">📚</span>
        <span class="tab-label">Library</span>
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
      <router-link to="/account" class="tab-item">
        <span class="tab-icon">👤</span>
        <span class="tab-label">Account</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSync } from './composables/useSync'
import { useAuth } from './composables/useAuth'
import { reconcileTenant } from './sync/tenant.js'
import { migrateAudioPositions } from './sync/progressMigrate.js'

const router = useRouter()
const route = useRoute()

// 一次性迁移必须跑在 useSync() 之前：同步一启动就会采集进度载荷，
// 而旧格式的续播位置（裸秒数、无 updatedAt）在采集时是直接被跳过的。
migrateAudioPositions()

// 启动即触发一次自动拉取（未配对时是空操作）。
// 以前只有 VocabularyView mount 时才拉，等于「不打开生词本页就永不同步」——
// 阅读进度和生词都得等用户想起来点那个 tab 才会跨设备更新。
useSync()

// 启动就问一次「我是谁」：账号页（第 5 个 tab）打开就是热的，不必等一次往返。
// 失败一律吞（见 useAuth.js）：没登录 / 离线都不该影响读书。
const auth = useAuth()

// 登录 ↔ 数据（第 3 步）：账号一出现就把本机租户键对到账号上
// （首次＝认领本机游客码；之后＝接管账号主码）。
// 放在这里而不是 useAuth / useSync 里：这是「身份」与「同步」两个模块的接缝，谁都不该 import 对方。
watch(() => auth.user.value, (u) => { if (u) reconcileTenant(auth) })

const showHeader = computed(() => true)
const showTabbar = computed(() => {
  return ['BookList', 'Vocabulary', 'Flashcards', 'Quiz', 'Account'].includes(route.name)
})
const showBack = computed(() => {
  // 账号页也要一条退路：那里唯一的按钮是「登出」，手快很容易误点；
  // 导入页不在 tabbar 白名单里（故意：导入是个要收心的流程），所以也要自己带返回
  return route.name === 'Reader' || route.name === 'Account' || route.name === 'Import'
})
const backLabel = computed(() => 'Home')

const currentTitle = computed(() => {
  const titles = {
    BookList: 'Library',
    Import: 'Add a book',
    Reader: '',
    Vocabulary: 'Vocabulary',
    Flashcards: 'Flashcards',
    Quiz: 'Quiz',
    Account: 'Account'
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
