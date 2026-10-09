import { createRouter, createWebHashHistory } from 'vue-router'
import ReaderView from '../views/ReaderView.vue'

const routes = [
  {
    path: '/',
    redirect: '/books'
  },
  {
    path: '/books',
    name: 'BookList',
    component: () => import('../views/BookListView.vue')
  },
  {
    path: '/import',
    name: 'Import',
    component: () => import('../views/ImportView.vue')
  },
  {
    path: '/reader/:bookId/:chapterId?',
    name: 'Reader',
    component: ReaderView
  },
  {
    // 第 17 步块 D · D-2：生成页（章节多选／进度／排队位次／剩余额度）。
    // 懒加载 ＋ **只引 `utils/genApi.js`**：主包不许静态引 `src/generate/`
    // （体积 ＋ lamejs 的 LGPL 边界，见 verify-generate.mjs 的卫生断言）。
    path: '/generate/:bookId',
    name: 'GenerateAudio',
    component: () => import('../views/GenerateAudioView.vue')
  },
  {
    path: '/vocabulary',
    name: 'Vocabulary',
    component: () => import('../views/VocabularyView.vue')
  },
  {
    path: '/flashcards',
    name: 'Flashcards',
    component: () => import('../views/FlashcardsView.vue')
  },
  {
    path: '/quiz',
    name: 'Quiz',
    component: () => import('../views/QuizView.vue')
  },
  {
    // 第 13 步块 B：反馈页。入口在账号页（这一页也能直接开）。
    // 懒加载 —— 它是「出事了才去」的一页，没理由进主包。
    path: '/feedback',
    name: 'Feedback',
    component: () => import('../views/FeedbackView.vue')
  },
  {
    path: '/account',
    name: 'Account',
    component: () => import('../views/AccountView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

/**
 * 部署更新后旧 hash chunk 已被删除，浏览器缓存中的旧 index.html
 * 引用的懒加载 chunk 会 404 → Vue Router 静默中止导航。
 * 此处检测该错误并强制全页刷新加载新版本，避免"点标签无反应"。
 */
router.onError((error, to) => {
  const isStaleChunk = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(error.message)
  if (isStaleChunk && !sessionStorage.getItem('chunk-reload')) {
    sessionStorage.setItem('chunk-reload', '1')
    location.assign(to.fullPath)
  } else {
    sessionStorage.removeItem('chunk-reload')
  }
})

export default router
