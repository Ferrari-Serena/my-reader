<template>
  <div class="register-view">
    <div v-if="!online" class="banner">
      当前离线：可以先读本机书，联网后再注册。
      <router-link to="/books">去书架</router-link>
    </div>
    <div v-else-if="auth.authUnknown.value" class="banner">
      账号服务暂时不可用：可以先读本机书，稍后再试。
      <router-link to="/books">去书架</router-link>
    </div>

    <h2 class="brand">my-reader</h2>
    <p class="lead">{{ subheading }}</p>

    <form novalidate @submit.prevent="submit">
      <label class="label" for="reg-email">邮箱</label>
      <input
        id="reg-email" v-model.trim="email" class="input" type="email"
        inputmode="email" autocapitalize="off" autocomplete="email"
        placeholder="you@example.com" :disabled="auth.busy.value"
      />

      <template v-if="mode !== 'reset'">
        <label class="label" for="reg-pw">密码</label>
        <div class="pw-row">
          <input
            id="reg-pw" v-model="password" class="input" :type="showPw ? 'text' : 'password'"
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            :placeholder="mode === 'signup' ? '至少 8 个字符' : ''"
            :disabled="auth.busy.value"
          />
          <button class="eye" type="button" @click="showPw = !showPw">
            {{ showPw ? '隐藏' : '显示' }}
          </button>
        </div>

        <div v-if="mode === 'signup'" class="meter" aria-hidden="true">
          <span class="bar" :class="{ on: strength >= 1 }"></span>
          <span class="bar" :class="{ on: strength >= 2 }"></span>
          <span class="bar" :class="{ on: strength >= 3 }"></span>
          <span class="meter-label">{{ strengthLabel }}</span>
        </div>
      </template>

      <p v-if="error || auth.error.value" class="error">{{ error || auth.error.value }}</p>
      <p v-if="auth.notice.value" class="notice">{{ auth.notice.value }}</p>

      <label v-if="mode === 'signup'" class="agree">
        <input v-model="agree" type="checkbox" />
        <span>
          我已阅读并同意
          <router-link to="/legal">用户协议</router-link>
          与
          <router-link to="/legal">隐私说明</router-link>
        </span>
      </label>

      <button class="btn" type="submit" :disabled="auth.busy.value || !canSubmit">
        {{ busyLabel }}
      </button>
    </form>

    <p class="switch">
      <template v-if="mode === 'signin'">
        还没有账号？
        <button class="link" type="button" @click="setMode('signup')">注册</button>
        ·
        <button class="link" type="button" @click="setMode('reset')">忘记密码？</button>
      </template>
      <template v-else>
        <button class="link" type="button" @click="setMode('signin')">← 返回登录</button>
      </template>
    </p>

    <p class="foot">注册后可在多台设备间同步生词、笔记和进度；离线也可以先读本机书。</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { emailProblem, passwordProblem } from '../utils/authForm.js'
import { passwordStrength, commonPasswordProblem, sameAsEmailProblem } from '../utils/authPolicy.js'
import { markAuthSeen } from '../utils/authGate.js'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const mode = ref('signup') // 'signup' | 'signin' | 'reset'
const email = ref('')
const password = ref('')
const agree = ref(false)
const showPw = ref(false)
const error = ref('')
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine !== false)

const nextPath = computed(() => {
  const raw = String(route.query.next || '')
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/register')) return '/books'
  return raw
})

const strength = computed(() => passwordStrength(password.value))
const strengthLabel = computed(() => {
  if (strength.value >= 3) return '强'
  if (strength.value === 2) return '中'
  if (strength.value === 1) return '弱'
  return '至少 8 位'
})

const heading = computed(() => {
  if (mode.value === 'signup') return '创建账号'
  if (mode.value === 'reset') return '重置密码'
  return '登录'
})
const subheading = computed(() => {
  if (mode.value === 'signup') return '我们会发一封验证邮件到你的邮箱。'
  if (mode.value === 'reset') return '我们会发一封重置密码的邮件，链接 1 小时内有效。'
  return '登录后可在多台设备间同步生词和进度。'
})
const busyLabel = computed(() => {
  if (auth.busy.value) return '处理中…'
  if (mode.value === 'signup') return '创建账号'
  if (mode.value === 'reset') return '发送重置链接'
  return '登录'
})
const canSubmit = computed(() => {
  if (!email.value) return false
  if (mode.value === 'reset') return true
  if (!password.value) return false
  if (mode.value === 'signup' && !agree.value) return false
  return true
})

function setMode(next) {
  mode.value = next
  error.value = ''
  password.value = ''
  auth.clearMessages()
}

function onOnline() { online.value = navigator.onLine !== false }

async function submit() {
  error.value = ''
  auth.clearMessages()

  const ep = emailProblem(email.value)
  if (ep) { error.value = ep; return }

  if (mode.value === 'reset') {
    const r = await auth.sendReset(email.value)
    if (!r.ok && auth.error.value) error.value = auth.error.value
    return
  }

  const pp = passwordProblem(password.value)
  if (pp) { error.value = pp; return }

  if (mode.value === 'signup') {
    const cp = commonPasswordProblem(password.value) || sameAsEmailProblem(email.value, password.value)
    if (cp) { error.value = cp; return }

    const created = await auth.signUp(email.value, password.value)
    if (!created.ok) { error.value = auth.error.value || '创建失败，请稍后再试。'; return }

    const signed = await auth.signIn(email.value, password.value)
    if (signed.ok) { markAuthSeen(); router.replace(nextPath.value); return }
    setMode('signin')
    error.value = '账号已创建，请登录。'
    return
  }

  const signed = await auth.signIn(email.value, password.value)
  if (signed.ok) { markAuthSeen(); router.replace(nextPath.value); return }
  if (auth.error.value) error.value = auth.error.value
}

onMounted(() => {
  auth.loadMe()
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
  if (typeof window !== 'undefined') window.addEventListener('offline', onOnline)
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  if (typeof window !== 'undefined') window.removeEventListener('offline', onOnline)
})
</script>

<style scoped>
.register-view {
  max-width: 390px;
  margin: 0 auto;
  padding: 18px 18px 32px;
  background: #fff;
  color: #333;
  min-height: 100%;
  font-size: 13px;
  line-height: 1.6;
}
.banner {
  border: 1px solid #999;
  background: #f5f5f5;
  border-radius: 3px;
  padding: 8px 10px;
  font-size: 12px;
  margin-bottom: 14px;
}
.banner a { color: #333; text-decoration: underline; }
.brand { font-size: 22px; color: #000; font-weight: 600; margin: 8px 0 4px; }
.lead { font-size: 12px; color: #666; margin-bottom: 8px; }
.label { display: block; font-size: 12px; color: #000; font-weight: 600; margin: 14px 0 6px; }
.input {
  width: 100%;
  min-height: 44px;
  border: 1px solid #999;
  border-radius: 3px;
  padding: 0 12px;
  font-size: 13px;
  color: #333;
  background: #fff;
}
.input:focus { outline: 2px solid #000; outline-offset: -1px; }
.pw-row { display: flex; gap: 8px; align-items: stretch; }
.pw-row .input { flex: 1; }
.eye {
  min-width: 52px;
  border: 1px solid #999;
  background: #fff;
  color: #333;
  border-radius: 3px;
  font-size: 12px;
}
.meter { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.bar { height: 6px; flex: 1; border: 1px solid #999; background: #fff; }
.bar.on { background: #333; }
.meter-label { font-size: 11px; color: #333; min-width: 56px; text-align: right; }
.error { color: #000; font-weight: 600; font-size: 12px; margin-top: 10px; }
.notice { color: #333; font-size: 12px; margin-top: 10px; }
.agree {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 0 6px;
  font-size: 12px;
  color: #333;
}
.agree input { width: 18px; height: 18px; margin-top: 1px; }
.agree a { color: #333; text-decoration: underline; }
.btn {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
  border: 1px solid #000;
  background: #000;
  color: #fff;
  border-radius: 3px;
  font-size: 13px;
}
.btn:disabled { background: #999; border-color: #999; }
.switch { margin-top: 12px; font-size: 12px; color: #666; text-align: center; }
.link {
  border: 0;
  background: transparent;
  color: #333;
  text-decoration: underline;
  font-size: 12px;
  padding: 0 2px;
}
.foot { margin-top: 24px; font-size: 11px; color: #666; text-align: center; }
</style>
