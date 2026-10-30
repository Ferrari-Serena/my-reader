<template>
  <div class="account-view">
    <p v-if="auth.notice.value" class="banner notice">{{ auth.notice.value }}</p>
    <!-- 认领提示走独立横幅：它是后台异步发生的，不该被表单流程的 notice 盖掉 -->
    <p v-if="auth.claimNotice.value" class="banner notice">{{ auth.claimNotice.value }}</p>

    <!-- 4.4 同步可见：跨设备同步状态。D16 起同步**跟着登录走** —— 同一个账号＝同一份数据，本机不再有同步码这回事；未登录就不同步。 -->
    <section class="card sync-card">
      <h2 class="card-title">同步</h2>
      <p v-if="auth.user.value" class="line ok">
        ✅ 已同步到 <strong>{{ auth.user.value.email }}</strong>
      </p>
      <p v-else class="line">
        在下方登录后，可在多台设备间同步生词、笔记、书籍和进度。
      </p>
      <p v-if="sync.lastSync.value" class="hint">上次同步：{{ sync.lastSync.value.toLocaleString() }}</p>
      <p v-if="sync.pending.value > 0" class="hint">
        待上传：<strong>{{ sync.pending.value }}</strong>
      </p>
      <p v-else-if="auth.user.value" class="hint">所有改动已上传 ✓</p>
      <!-- 另一个方向：账号里有、这台设备还没有的书（第 16.6 步）。上传侧数不到它们，
           「All changes uploaded ✓」也不代表书架已经齐了 —— 这一行补的就是这个歧义。 -->
      <p v-if="bookSyncState.prefetching" class="hint">
        正在从账号载入书籍：<strong>{{ bookSyncState.queued }}</strong>
      </p>
      <p v-if="sync.error.value" class="error">{{ sync.error.value }}</p>
      <button
        v-if="auth.user.value" class="btn" :disabled="syncing"
        @click="sync.syncNow()"
      >{{ syncing ? '同步中…' : '立即同步' }}</button>
    </section>

    <!-- 反馈入口（第 13 步块 B）：登录与否都能发；放在 Sync 卡下面 ——
         它是「出事了才去」的一页，不进 tabbar，也就不抢主路径。 -->
    <section class="card feedback-entry">
      <h2 class="card-title">反馈</h2>
      <p class="hint">
        遇到故障，或有想法？告诉我们发生了什么 —— 页面会自动附上一段简短诊断，无需账号。
      </p>
      <router-link class="btn entry-link" to="/feedback">发送反馈</router-link>
    </section>

    <!-- 已登录 -->
    <template v-if="auth.user.value">
      <section class="card">
        <h2 class="card-title">已登录</h2>
        <p class="email">{{ auth.user.value.email }}</p>
        <p v-if="auth.user.value.emailVerified" class="line ok">✅ 邮箱已验证</p>
        <p v-else class="line warn">
          ⚠️ 邮箱尚未验证 ——
          <button class="link" :disabled="auth.busy.value" @click="doResend">重新发送验证链接</button>
        </p>
        <p class="hint">退出登录后，本机的书籍、生词和进度会保留。</p>
      </section>

      <!-- 登出：**单独放到页面最下面 + 二次确认**。它是这一页唯一的破坏性动作，
           贴着上面的信息放，手快一点就退出去了。 -->
      <div class="danger-zone">
        <button v-if="!confirmingOut" class="btn" @click="confirmingOut = true">退出登录</button>
        <div v-else class="confirm">
          <p class="confirm-text">退出这台设备？</p>
          <div class="confirm-actions">
            <button class="btn" :disabled="auth.busy.value" @click="confirmingOut = false">取消</button>
            <button class="btn danger" :disabled="auth.busy.value" @click="doSignOut">
              {{ auth.busy.value ? '退出中…' : '确认退出' }}
            </button>
          </div>
        </div>
      </div>
      <!-- 注销：二次确认（重输密码）+ 30 天冷静期。放在登出下面，是这一页最重的破坏性动作。 -->
      <div class="danger-zone">
        <button v-if="!confirmingDelete" class="btn danger-outline" @click="openDelete">注销账号…</button>
        <div v-else class="confirm">
          <p class="confirm-text">
            要注销这个账号吗？账号会先进入 30 天删除期，期间重新登录即可撤销。30 天后，账号以及同步到账号的生词和进度将被永久删除。本机的书籍和生词不受影响。
          </p>
          <label class="label" for="del-pw">输入密码确认</label>
          <input
            id="del-pw" v-model="deletePassword" class="input" type="password"
            autocomplete="current-password" :disabled="auth.busy.value"
          />
          <p v-if="auth.error.value" class="error">{{ auth.error.value }}</p>
          <div class="confirm-actions">
            <button class="btn" :disabled="auth.busy.value" @click="closeDelete">取消</button>
            <button class="btn danger" :disabled="auth.busy.value || !deletePassword" @click="doDelete">
              {{ auth.busy.value ? '注销中…' : '确认注销账号' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 冷静期中：撤销注销（密码确认；注销已把会话都踢了，所以这里只认密码） -->
    <template v-else-if="auth.pendingDeletion.value">
      <section class="card">
        <h2 class="card-title">账号已安排删除</h2>
        <p class="hint">
          {{ auth.pendingDeletion.value.email }} 已安排删除，约 {{ auth.pendingDeletion.value.daysLeft }} 天后将永久清除。
          输入密码可撤销，生词和进度会恢复。
        </p>
        <form novalidate @submit.prevent="doCancelDeletion">
          <label class="label" for="restore-pw">密码</label>
          <input
            id="restore-pw" v-model="restorePassword" class="input" type="password"
            autocomplete="current-password" :disabled="auth.busy.value"
          />
          <p v-if="auth.error.value" class="error">{{ auth.error.value }}</p>
          <button class="btn primary" type="submit" :disabled="auth.busy.value || !restorePassword">
            {{ auth.busy.value ? '处理中…' : '撤销注销' }}
          </button>
        </form>
        <p class="switch">
          <button class="link" type="button" @click="forgetPending">换一个账号</button>
        </p>
      </section>
    </template>

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
          <label class="label" for="acct-email">邮箱</label>
          <input
            id="acct-email" v-model.trim="email" class="input" type="email"
            inputmode="email" autocapitalize="off" autocomplete="email"
            placeholder="you@example.com" :disabled="auth.busy.value"
          />

          <template v-if="mode !== 'reset'">
            <label class="label" for="acct-pw">密码</label>
            <input
              id="acct-pw" v-model="password" class="input" type="password"
              :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
              :placeholder="mode === 'signup' ? '至少 8 个字符' : ''"
              :disabled="auth.busy.value"
            />
          </template>

          <template v-if="mode === 'signup'">
            <label class="label" for="acct-pw2">确认密码</label>
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
            还没有账号？
            <button class="link" type="button" @click="setMode('signup')">注册</button>
            ·
            <button class="link" type="button" @click="setMode('reset')">忘记密码？</button>
          </template>
          <template v-else>
            <button class="link" type="button" @click="setMode('signin')">← 返回登录</button>
          </template>
        </p>
      </section>

      <p class="foot">
        账号可在多台设备间同步生词和进度；不登录也能继续阅读。
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useSync } from '../composables/useSync.js'
import { bookSyncState } from '../sync/bookSync.js'
import { emailProblem, passwordProblem, confirmProblem } from '../utils/authForm.js'

const auth = useAuth()
const sync = useSync()
// 「Sync now」这一趟包含书体对账（useSync.syncNow 里 await 了它），所以按钮的忙态要把
// bookSyncState.prefetching 一起算 —— 否则正文还在拉、按钮已经变回「Sync now」了。
const syncing = computed(() => sync.pulling.value || sync.pushing.value || bookSyncState.prefetching)

const mode = ref('signin') // 'signin' | 'signup' | 'reset'
const email = ref('')
const password = ref('')
const confirm = ref('')
const formError = ref('')
const confirmingOut = ref(false)
const confirmingDelete = ref(false)
const deletePassword = ref('')
const restorePassword = ref('')

onMounted(() => { auth.loadMe() })

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
  if (mode.value === 'signup' && !confirm.value) return false
  return true
})

function setMode(next) {
  confirmingOut.value = false
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
        ? '账号已创建，验证链接已发到你的邮箱。'
        : '账号已创建，但验证邮件发送失败。你可以在这页重新发送。')
      password.value = ''
      confirm.value = ''
    } else {
      setMode('signin')
      auth.note('账号已创建，请登录。')
    }
    return
  }

  await auth.signIn(email.value, password.value)
}

function doResend() { auth.resendVerify() }

function doSignOut() {
  confirmingOut.value = false
  auth.signOut()
}

function openDelete() {
  confirmingDelete.value = true
  deletePassword.value = ''
  auth.clearMessages()
}

function closeDelete() {
  confirmingDelete.value = false
  deletePassword.value = ''
  auth.clearMessages()
}

async function doDelete() {
  if (!deletePassword.value) return
  const r = await auth.deleteAccount(deletePassword.value)
  if (r.ok) {
    confirmingDelete.value = false
    deletePassword.value = ''
    // 注销成功后默认落到「登录」态（而不是留在注册态）：我们刚告诉用户「再登录一次就能撤销」
    mode.value = 'signin'
    const days = (r.data && r.data.daysLeft) || 30
    auth.note('账号已安排删除。若未在期限内登录撤销，约 ' + days
      + ' 天后将永久清除。')
  }
}

async function doCancelDeletion() {
  if (!restorePassword.value) return
  const pending = auth.pendingDeletion.value
  const r = await auth.cancelDeletion(pending ? pending.email : '', restorePassword.value)
  if (r.ok) {
    restorePassword.value = ''
    auth.note('欢迎回来 —— 账号已恢复。')
  }
}

function forgetPending() {
  auth.clearPendingDeletion()
  restorePassword.value = ''
  auth.clearMessages()
}
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

.sync-card {
  margin-bottom: 16px;
}

.feedback-entry {
  margin-bottom: 16px;
}

/* .btn 本来是给 <button> 写的；router-link 要自己补上这两条，
   否则文字贴在左边、还带一条下划线 */
.entry-link {
  display: block;
  box-sizing: border-box;
  text-align: center;
  text-decoration: none;
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

.danger-zone {
  margin: 28px 0 8px;
}

.confirm {
  border: 1px solid #f0c2bb;
  background: #fdf3f2;
  border-radius: 10px;
  padding: 12px;
}

.confirm-text {
  margin: 0 0 10px;
  font-size: 14px;
  color: #8a2b1d;
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.confirm-actions .btn {
  margin-top: 0;
}

.btn.danger {
  border-color: #c0392b;
  background: #c0392b;
  color: #fff;
}

.btn.danger-outline {
  border-color: #d98c81;
  color: #c0392b;
}
</style>
