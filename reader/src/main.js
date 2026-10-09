import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import { installErrorCapture, noteRoute } from './utils/feedback.js'

// 反馈通道（第 13 步块 B）：启动就把「最近错误环」挂上（反馈页读的是同一个环，
// 这样用户在反馈页看到的就是刚才那次出事的现场），并记住「出事时在哪」。
// noteRoute 故意**跳过反馈页自己** —— 站在反馈页提交时，有用的线索是上一条路由。
installErrorCapture(window)
router.afterEach((to) => noteRoute(to.fullPath))

const app = createApp(App)
app.use(router)
app.mount('#app')
