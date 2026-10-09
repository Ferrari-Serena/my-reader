import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import { installErrorCapture, noteRoute } from './utils/feedback.js'
import { startServiceWorker } from './utils/swUpdate.js'
import { startOfflineWatch } from './utils/offline.js'

// 反馈通道（第 13 步块 B）：启动就把「最近错误环」挂上（反馈页读的是同一个环，
// 这样用户在反馈页看到的就是刚才那次出事的现场），并记住「出事时在哪」。
// noteRoute 故意**跳过反馈页自己** —— 站在反馈页提交时，有用的线索是上一条路由。
installErrorCapture(window)
router.afterEach((to) => noteRoute(to.fullPath))

// 第 14 步 块 A：注册 Service Worker（离线壳）。dev 下 `/sw.js` 是构建产物、不存在，
// 这里靠 `import.meta.env.PROD` 自己挡掉 —— 不挡就是每次 dev 白记一条 404。
startServiceWorker()

// 第 14 步 块 C：断网提示（`navigator.onLine`）。启动就读一次 —— 页面本来就可能是断网打开的，
// 那一刻没有 online/offline 事件可等。补推那一半在第 4 步（useSync 的 online 监听 ＋ 有界退避）。
startOfflineWatch()

const app = createApp(App)
app.use(router)
app.mount('#app')
