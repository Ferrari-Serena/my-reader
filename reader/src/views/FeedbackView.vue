<template>
  <div class="feedback-view">
    <p v-if="result" class="banner" :class="result.ok ? 'banner-ok' : 'banner-bad'">{{ result.text }}</p>

    <section class="card">
      <h2 class="card-title">发送反馈</h2>
      <p class="hint">
        遇到故障，或有想法？告诉我们发生了什么。
        <template v-if="auth.user.value">这条反馈会关联到你的账号。</template>
        <template v-else>无需账号 —— 想收到回复可在下方留下联系方式。</template>
      </p>

      <label class="label" for="fb-cat">反馈类型</label>
      <select id="fb-cat" v-model="category" class="input" :disabled="busy">
        <option v-for="c in CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</option>
      </select>

      <label class="label" for="fb-msg">发生了什么？</label>
      <textarea
        id="fb-msg" v-model="message" class="input textarea" rows="6"
        placeholder="你当时在做什么？哪里出了问题？"
        :disabled="busy" @blur="touched = true"
      ></textarea>
      <p class="counter" :class="{ over: tooLong }">{{ message.length }} / {{ MAX_MESSAGE }}</p>

      <label class="label" for="fb-contact">联系方式（可选）</label>
      <input
        id="fb-contact" v-model="contact" class="input" type="text"
        placeholder="邮箱或其他联系方式 —— 只在你想收到回复时填写"
        :disabled="busy" @blur="touched = true"
      />

      <p v-if="problem" class="error">{{ problem }}</p>

      <button class="btn primary" :disabled="busy" @click="submit">
        {{ busy ? '发送中…' : '发送反馈' }}
      </button>
    </section>

    <!-- 提交前**先看到**要发什么：这一页不是免责声明，是「预览 ＋ 同意」的那一步 -->
    <section class="card">
      <h2 class="card-title">会发送什么</h2>
      <p class="hint">
        除你的正文外，只附带下面的诊断信息。不包含书籍正文、生词、笔记和邮箱地址。
      </p>
      <dl class="diag">
        <div v-for="row in diagRows" :key="row.k" class="diag-row">
          <dt>{{ row.k }}</dt>
          <dd>{{ row.v }}</dd>
        </div>
      </dl>
      <p class="hint diag-sub">
        <template v-if="errors.length">
          本机最近的错误（发送最新 {{ MAX_ERROR_LINES }} 条）：
        </template>
        <template v-else>本机没有捕获到错误。</template>
      </p>
      <ul v-if="errors.length" class="errs">
        <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
      </ul>
      <p class="hint diag-sub">
        浏览器类型由服务端从请求本身识别，前端不发送；我们也不保存 IP 地址。
      </p>
    </section>

    <section class="card">
      <h2 class="card-title">我的反馈</h2>
      <p v-if="mineError" class="error">{{ mineError }}</p>
      <p v-else-if="!items.length" class="hint">
        这台设备还没有提交过反馈。
        <template v-if="!auth.user.value">登录后，反馈会跟着账号走。</template>
      </p>
      <ul v-else class="mine">
        <li v-for="it in items" :key="it.id" class="mine-row">
          <p class="mine-head">
            <span class="pill">{{ statusLabel(it.status) }}</span>
            <span class="mine-cat">{{ categoryLabel(it.category) }}</span>
            <span class="mine-when">{{ when(it.createdAt) }}</span>
          </p>
          <p class="mine-msg">{{ it.message }}</p>
        </li>
      </ul>
      <button class="btn" :disabled="loadingMine" @click="loadMine">
        {{ loadingMine ? '加载中…' : '刷新' }}
      </button>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import {
  CATEGORIES, MAX_MESSAGE, MAX_ERROR_LINES,
  categoryLabel, statusLabel, draftProblem,
  buildContext, ensureAnonKey, submitFeedback, submitResultLine, fetchMyFeedback,
  appErrorBuffer,
} from '../utils/feedback.js'

const auth = useAuth()

const category = ref('bug')
const message = ref('')
const contact = ref('')
const touched = ref(false)
const busy = ref(false)
const result = ref(null)

const items = ref([])
const loadingMine = ref(false)
const mineError = ref('')
const keyNow = ref('')

// 诊断快照：进页面取一次、**提交前再取一次** —— 用户看到的「将发送什么」必须与
// 点下按钮时真发出去的是同一份（不然预览就是装饰）。错误环同理。
const diag = ref(buildContext())
const errors = ref(appErrorBuffer.list())

// 校验提示只在「碰过输入框」之后出现：一进页面就报「太短了」是噪音
const problem = computed(() => (touched.value
  ? (draftProblem({ message: message.value, contact: contact.value }) || '')
  : ''))
const tooLong = computed(() => message.value.length > MAX_MESSAGE)

const diagRows = computed(() => {
  const c = diag.value
  const dash = '—'
  const rows = [
    { k: 'version', v: c.version || dash },
    { k: 'viewport', v: c.viewport || dash },
    { k: 'lang', v: c.lang || dash },
    { k: 'route', v: c.route || dash },
  ]
  if (c.bookId) rows.push({ k: 'bookId', v: c.bookId })
  if (c.chapterId) rows.push({ k: 'chapterId', v: c.chapterId })
  return rows
})

onMounted(() => {
  keyNow.value = ensureAnonKey()
  refreshDiag()
  loadMine()
})

function refreshDiag() {
  diag.value = buildContext()
  errors.value = appErrorBuffer.list()
}

async function submit() {
  touched.value = true
  result.value = null
  if (draftProblem({ message: message.value, contact: contact.value })) return

  busy.value = true
  keyNow.value = ensureAnonKey()
  refreshDiag()
  const r = await submitFeedback({
    category: category.value,
    message: message.value,
    contact: contact.value,
    key: keyNow.value,
    context: diag.value,
  })
  busy.value = false
  result.value = submitResultLine(r)
  if (r.ok) {
    message.value = ''
    contact.value = ''
    touched.value = false
    // 这批错误已经随这一条发出去了 → 清空，免得下一条反馈把同一批再带一遍
    appErrorBuffer.clear()
    refreshDiag()
    loadMine()
  }
}

async function loadMine() {
  loadingMine.value = true
  mineError.value = ''
  const r = await fetchMyFeedback({ key: keyNow.value })
  loadingMine.value = false
  if (r.ok) { items.value = r.items; return }
  // 401 ＝ 未登录又没带键：不是错误，只是「这台上还没提过」
  if (r.status === 401) { items.value = []; return }
  items.value = []
  mineError.value = '暂时无法加载你的反馈 —— 请点「刷新」重试。'
}

function when(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? new Date(t).toLocaleString() : ''
}
</script>

<style scoped>
.feedback-view {
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

.banner-ok {
  background: #eef8f0;
  color: #1a7f37;
  border: 1px solid #cde9d5;
}

.banner-bad {
  background: #fdf3f2;
  color: #8a2b1d;
  border: 1px solid #f0c2bb;
}

.card {
  background: var(--bg-secondary, #f7f7f9);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.card:last-child {
  margin-bottom: 0;
}

.card-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

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

.textarea {
  font: inherit;
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
}

.counter {
  margin: 4px 0 0;
  font-size: 12px;
  text-align: right;
  color: var(--text-secondary, #6e6e73);
}

.counter.over {
  color: #c0392b;
  font-weight: 600;
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

.diag {
  margin: 0 0 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  padding: 8px 10px;
}

.diag-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.diag-row dt {
  flex: 0 0 84px;
  color: var(--text-secondary, #6e6e73);
}

.diag-row dd {
  margin: 0;
  word-break: break-all;
  color: var(--text-primary, #1d1d1f);
}

.diag-sub {
  margin-bottom: 8px;
}

.errs {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
  color: #8a2b1d;
  word-break: break-word;
}

.mine {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}

.mine-row {
  border-top: 1px solid var(--border-color, #d2d2d7);
  padding: 10px 0;
}

.mine-row:first-child {
  border-top: none;
  padding-top: 0;
}

.mine-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.pill {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #d2d2d7);
  font-weight: 600;
}

.mine-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary, #1d1d1f);
}
</style>
