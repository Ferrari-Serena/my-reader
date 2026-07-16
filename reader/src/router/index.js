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

export default router
