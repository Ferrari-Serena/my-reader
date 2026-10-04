<template>
  <div class="account-view">
    <p v-if="auth.notice.value" class="banner notice">{{ auth.notice.value }}</p>

    <!-- 已登录 -->
    <section v-if="auth.user.value" class="card">
      <h2 class="card-title">Signed in</h2>
      <p class="email">{{ auth.user.value.email }}</p>
      <p v-if="auth.user.value.emailVerified" class="line ok">✅ Email verified</p>
      <p v-else class="line warn">
        ⚠️ Email not verified yet —
        <button class="link" :disabled="auth.busy.value" @click="doResend">resend the link</button>
      </p>
      <p class="hint">Books, words and progress on this device stay put when you sign out.</p>
      <button class="btn" :disabled="auth.busy.value" @click="doSignOut">
        {{ auth.busy.value ? 'Signing out…' : 'Sign out' }}
      </button>
    </section>

    <!-- 未登录 -->
    <template v-else>
      <section class="card">
        <h2 class="card-title">{{ heading }}</h2>
        <p class="hint">{{ subheading }}</p>

        <!-- novalidate：关掉浏览器原生校验。type="email" 的原生检查会**先**把提交挡下，
             于是我们自己那套（与后端同口径：域名必须带点）永远跑不到 —— 提示语就成了死代码，
             而且混出中英两套说法。这里让提示只有一个来源：authForm.js。
             type="email" 保留只为移动端弹对键盘。 -->
        <form novalidate @submit.prevent="submit">
          <label class="label" for="acct-email">Email</label>
          <input
            id="acct-email" v-model.trim="email" class="input" type="email"
            inputmode="email" autocapitalize="off" autocomplete="email"
            placeholder="you@example.com" :disabled="auth.busy.value"
          />

          <template v-if="mode !== 'reset'">
            <label class="label" for="acct-pw">Password</label>
            <input
              id="acct-pw" v-model="password" class="input" type="password"
              :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
              :placeholder="mode === 'signup' ? 'At least 8 characters' : ''"
              :disabled="auth.busy.value"
            />
          </template>

          <template v-if="mode === 'signup'">
            <label class="label" for="acct-pw2">Confirm password</label>
            <input
              id="acct-pw2" v-model="confirm" class="input" type="password"
              autocomplete="new-password" :disabled="auth.busy.value"
            />
          </template>

          <p v-if="formError || auth.error.value" class="error">{{ formError || auth.error.value }}</p>

          <button class="btn primary" type="submit" :disabled="auth.busy.value || !canSubmit">
            {{ busyLabel }}
          </button>
        </form>

        <p class="switch">
          <template v-if="mode === 'signin'">
            No account?
            <button class="link" type="button" @click="setMode('signup')">Create one</button>
            ·
            <button class="link" type="button" @click="setMode('reset')">Forgot password?</button>
          </template>
          <template v-else>
            <button class="link" type="button" @click="setMode('signin')">← Back to sign in</button>
          </template>
        </p>
      </section>

      <p class="foot">
        An account keeps your words and progress in sync across devices.
        You can keep reading without one.
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { emailProblem, passwordProblem, confirmProblem } from '../utils/authForm.js'

const auth = useAuth()

const mode = ref('signin') // 'signin' | 'signup' | 'reset'
const email = ref('')
const password = ref('')
const confirm = ref('')
const formError = ref('')

onMounted(() => { auth.loadMe() })

const heading = computed(() => {
  if (mode.value === 'signup') return 'Create an account'
  if (mode.value === 'reset') return 'Reset your password'
  return 'Sign in'
})

const subheading = computed(() => {
  if (mode.value === 'signup') return 'We will email you a link to verify the address.'
  if (mode.value === 'reset') return 'We will email you a link to set a new password. It works for 1 hour.'
  return 'Sign in to keep your words and progress in sync across devices.'
})

const busyLabel = computed(() => {
  if (auth.busy.value) return 'Working…'
  if (mode.value === 'signup') return 'Create account'
  if (mode.value === 'reset') return 'Send reset link'
  return 'Sign in'
})

const canSubmit = computed(() => {
  if (!email.value) return false
  if (mode.value === 'reset') return true
  if (!password.value) return false
  if (mode.value === 'signup' && !confirm.value) return false
  return true
})

function setMode(next) {
  mode.value = next
  formError.value = ''
  password.value = ''
  confirm.value = ''
  auth.clearMessages()
}

async function submit() {
  formError.value = ''
  auth.clearMessages()

  const ep = emailProblem(email.value)
  if (ep) { formError.value = ep; return }

  if (mode.value === 'reset') {
    await auth.sendReset(email.value)
    return
  }

  const pp = passwordProblem(password.value)
  if (pp) { formError.value = pp; return }

  if (mode.value === 'signup') {
    const cp = confirmProblem(password.value, confirm.value)
    if (cp) { formError.value = cp; return }

    const created = await auth.signUp(email.value, password.value)
    if (!created.ok) return

    // 注册成功不自动给会话（服务端口径），所以顺手登进去 —— 少一步「请再去登录」
    const signed = await auth.signIn(email.value, password.value)
    if (signed.ok) {
      auth.note(created.data.mailSent
        ? 'Account created. We sent a verification link to your inbox.'
        : 'Account created — but the verification email could not be sent. You can resend it from this page.')
      password.value = ''
      confirm.value = ''
    } else {
      setMode('signin')
      auth.note('Account created. Please sign in.')
    }
    return
  }

  await auth.signIn(email.value, password.value)
}

function doResend() { auth.resendVerify() }
function doSignOut() { auth.signOut() }
</script>

<style scoped>
.account-view {
  padding: 16px;
  max-width: 520px;
  margin: 0 auto;
}

.banner {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.banner.notice {
  background: #eef6ff;
  color: #14538f;
  border: 1px solid #cfe3fb;
}

.card {
  background: var(--bg-secondary, #f7f7f9);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 12px;
  padding: 16px;
}

.card-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.email {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  word-break: break-all;
  color: var(--text-primary, #1d1d1f);
}

.line {
  margin: 0 0 10px;
  font-size: 13px;
}

.line.ok { color: #1a7f37; }
.line.warn { color: #9a6700; }

.hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
}

.label {
  display: block;
  margin: 12px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #6e6e73);
}

.input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 16px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
}

.error {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #c0392b;
}

.btn {
  margin-top: 16px;
  width: 100%;
  padding: 11px 16px;
  font-size: 15px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  cursor: pointer;
}

.btn.primary {
  background: var(--accent-color, #1a73e8);
  border-color: var(--accent-color, #1a73e8);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--accent-color, #1a73e8);
  cursor: pointer;
  text-decoration: underline;
}

.link:disabled { opacity: 0.55; cursor: default; }

.switch {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.foot {
  margin: 14px 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
}
</style>
