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
    path: '/reader/:bookId/:chapterId?',
    name: 'Reader',
    component: ReaderView
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
