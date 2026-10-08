<template>
  <div class="gen-view">
    <header class="gen-head">
      <h1 class="gen-h1">生成音频</h1>
      <p class="gen-sub">
        《{{ bookTitle }}》<span v-if="chapters.length"> · {{ chapters.length }} 章</span>
      </p>
    </header>

    <!-- 常规说明三句（D21-l）。文案只在 utils/genApi.js，这一页只负责画。 -->
    <ul class="gen-notes">
      <li v-for="n in GEN_PAGE_NOTES" :key="n">{{ n }}</li>
    </ul>

    <p v-if="loading" class="gen-note">正在读取这本书…</p>

    <div v-else-if="loadError" class="gen-note gen-note-bad">
      <p>{{ loadError }}</p>
      <router-link class="gen-link" to="/books">← 回到书架</router-link>
    </div>

    <div v-else-if="needLogin" class="gen-note gen-note-bad">
      <p>要生成真人朗读，先登录账号 —— 生成的音频只存在你自己的账号空间里。</p>
      <router-link class="gen-link" to="/account">去登录／注册 →</router-link>
    </div>

    <template v-else>
      <p v-if="!indexKnown" class="gen-note">
        暂时读不到已生成的清单 —— 已经生成过的章这会儿可能显示成「未生成」。重复提交不会白扣额度。
      </p>

      <!-- 进度：只复读服务端任务表（D21-g）。没有前端自算秒数的假进度条 —— 服务端耗时一波动，条就卡住或回跳。 -->
      <section v-if="progressVisible" class="gen-card gen-progress">
        <p class="gen-progress-head">
          <strong>已完成 {{ doneCount }}/{{ activeTotal }} 章</strong>
          <span v-if="runningIds.length" class="gen-pill gen-pill-run">正在合成</span>
          <span v-else-if="queuedIds.length" class="gen-pill">排队中</span>
        </p>
        <p class="gen-line">{{ queueText }}</p>
        <p v-if="runningIds.length" class="gen-line">正在合成：{{ runningIds.join('、') }}</p>
        <p v-if="queuedIds.length" class="gen-line">排队中：{{ queuedIds.join('、') }}</p>
        <p class="gen-line gen-line-dim">关掉页面也会继续生成，回来时进度照旧。</p>
      </section>

      <!-- 章节多选（D21-c）：单章／多章／连续区间／全选未生成 -->
      <section class="gen-card">
        <div class="gen-tools">
          <button type="button" class="gen-btn gen-btn-ghost" @click="selectAllTodo">
            全选未生成（{{ selectableIds.length }} 章）
          </button>
          <button
            type="button"
            class="gen-btn gen-btn-ghost"
            :disabled="!selectedIds.length"
            @click="clearSelection"
          >清空勾选</button>
          <span class="gen-range">
            第
            <select v-model="rangeFrom" class="gen-select">
              <option v-for="ch in chapters" :key="ch.id" :value="ch.id">{{ ch.id }}</option>
            </select>
            到第
            <select v-model="rangeTo" class="gen-select">
              <option v-for="ch in chapters" :key="ch.id" :value="ch.id">{{ ch.id }}</option>
            </select>
            <button type="button" class="gen-btn gen-btn-ghost" @click="applyRange">选这一段</button>
          </span>
        </div>
        <p v-if="pickNotice" class="gen-line">{{ pickNotice }}</p>

        <ul class="gen-list">
          <li
            v-for="row in rows"
            :key="row.id"
            class="gen-row"
            :class="{ 'gen-row-on': row.selected, 'gen-row-off': !row.selectable }"
          >
            <label class="gen-row-label">
              <input
                type="checkbox"
                class="gen-check"
                :checked="row.selected"
                :disabled="!row.selectable"
                @change="toggle(row.id)"
              />
              <span class="gen-row-no">{{ row.id }}</span>
              <span class="gen-row-title">{{ row.title || '（无标题）' }}</span>
              <span class="gen-row-chars">{{ row.chars }} 字</span>
              <span class="gen-badge" :class="'gen-badge-' + row.state">{{ row.stateLabel }}</span>
            </label>
          </li>
        </ul>
      </section>

      <!-- 底部：本次将生成 N 章（今天剩余 M 章） -->
      <footer class="gen-foot">
        <span class="gen-count">本次将生成 {{ selectedIds.length }} 章（{{ quotaText }}）</span>
        <button type="button" class="gen-btn" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '提交中…' : '开始生成' }}
        </button>
      </footer>
      <p v-if="blockedByQuota" class="gen-msg gen-msg-bad">{{ blockedText }}</p>
      <p v-if="submitError" class="gen-msg gen-msg-bad">{{ submitError }}</p>
      <p v-if="submitLine" class="gen-msg">{{ submitLine }}</p>
      <ul v-if="skipLines.length" class="gen-msg gen-msg-bad">
        <li v-for="s in skipLines" :key="s.chapterId">{{ s.chapterId }} —— {{ s.text }}</li>
      </ul>
    </template>
  </div>
</template>

<script setup>
/**
 * 第 17 步块 D · D-2 —— **生成页**（`/generate/:bookId`，2026-10-08）。
 *
 * 为什么单开一页（D21-b／c／g／l）：生成入口从「阅读器章内」收进 My Books，剩下的三件事
 * 需要一块能久留的地方 —— ① 章节多选（单章／多章／连续区间／全选未生成）；② 服务端复读的
 * 真进度（章级已完成数 ＋ 当前章状态 ＋ 排队位次）；③ 剩余额度。阅读器那边只留「云端音色
 * 就绪 → 就地热切」（§13.1 判据 1）。
 *
 * 硬约束（都要守）：
 *   · **只引 `utils/genApi.js` ＋ `utils/`／`storage/`／`composables/`** —— `src/views/` 下不许
 *     静态引 `src/generate/`（`verify-generate.mjs` 的卫生断言，构建级会咬 chunk）；
 *   · **不画假进度**（D21-g）：所有数字都是服务端 `GET /api/gen/book/<id>` 复读的，前端不算秒；
 *   · **不提供「重新生成」**（D21-l）：已就绪的章不可勾；要换就清空该书音频再来（D4）。
 *
 * 口径只在两处：服务端契约（`worker/src/audiogen.js`）与 `utils/genApi.js`。这里只负责画。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { loadBook as loadByoRecord, BookStoreError } from '../storage/index.js'
import { fetchCloudIndex, indexUsable } from '../utils/audioCloud.js'
import { isBookId } from '../utils/bookId.js'
import { useAuth } from '../composables/useAuth.js'
import {
  CH_STATE, CH_STATE_LABEL, GEN_PAGE_NOTES, GEN_POLL_MS, MAX_CHAPTERS_PER_SUBMIT,
  chapterRowState, chapterSelectable, fetchGenStatus, normalizeQuota, quotaLeftText,
  queueLine, rangeSelection, skipReasonText, submitGenChapters, submitResultLine
} from '../utils/genApi.js'

const route = useRoute()
const auth = useAuth()

const bookId = computed(() => String(route.params.bookId || ''))
const bookTitle = ref('')
/** 本机正文数出来的章表：`{ id, title, chars }`。服务端那份行要提交后才有，所以字数是本机算的。 */
const chapters = ref([])
const genStatus = ref(null)     // fetchGenStatus 的归一答复；null ＝ 还没问过
const readySet = ref(new Set()) // 索引里「已经有音频」的章
const indexKnown = ref(false)   // 索引问过没有：404（还没生成过）也算问过 —— 那是「确知为空」
const loading = ref(true)
const loadError = ref('')
const blocked401 = ref(false)   // 服务端说过未登录（会话过期那种，与「没登录」合并成一个门）

const selectedIds = ref([])
const rangeFrom = ref('')
const rangeTo = ref('')
const pickNotice = ref('')
const submitting = ref(false)
const submitLine = ref('')
const skipLines = ref([])
const submitError = ref('')

let pollTimer = null
let pollBusy = false

const needLogin = computed(() => !auth.user.value || blocked401.value)

// ── 章表（本机正文 ＋ 服务端台账 ＋ 就绪索引 三份合一）────────────────────────

const rows = computed(() => chapters.value.map((ch) => {
  const row = genStatus.value && genStatus.value.chapters ? genStatus.value.chapters[ch.id] : null
  const state = chapterRowState(row, readySet.value.has(ch.id), ch.chars)
  return {
    id: ch.id,
    title: ch.title,
    chars: ch.chars,
    state,
    stateLabel: CH_STATE_LABEL[state] || state,
    selectable: chapterSelectable(state),
    selected: selectedIds.value.includes(ch.id),
  }
}))

const selectableIds = computed(() => rows.value.filter((r) => r.selectable).map((r) => r.id))
const runningIds = computed(() => rows.value.filter((r) => r.state === CH_STATE.running).map((r) => r.id))
const queuedIds = computed(() => rows.value.filter((r) => r.state === CH_STATE.queued).map((r) => r.id))

// ── 进度（服务端任务表：done／pending／running／failed 的行）──────────────────

const summary = computed(() => (genStatus.value && genStatus.value.summary) || {
  total: 0, pending: 0, running: 0, done: 0, failed: 0,
})
/** 分母 ＝ **这本书提交过、且没被清空作废**的章（`purged` 行不算：音频已经没了、额度也放回了） */
const activeTotal = computed(() =>
  summary.value.done + summary.value.pending + summary.value.running + summary.value.failed)
const doneCount = computed(() => summary.value.done)
const progressVisible = computed(() => !!genStatus.value && activeTotal.value > 0)
const queueText = computed(() => queueLine(genStatus.value ? genStatus.value.queue : null))
const inFlight = computed(() => (summary.value.pending + summary.value.running) > 0)

// ── 额度（D21-e：只有数，不写死 5 章）────────────────────────────────────────

const quotaText = computed(() => quotaLeftText(genStatus.value ? genStatus.value.quota : null))
const chaptersLeft = computed(() => normalizeQuota(genStatus.value ? genStatus.value.quota : null).chaptersLeft)
const blockedByQuota = computed(() => (
  !!selectedIds.value.length && chaptersLeft.value !== null && selectedIds.value.length > chaptersLeft.value))
const blockedText = computed(() => `今天只剩 ${chaptersLeft.value} 章可生成 —— 少勾几章，或明天再来。`)
const canSubmit = computed(() => (
  !submitting.value && !!selectedIds.value.length && !blockedByQuota.value && !needLogin.value))

// ── 勾选（单章／多章／区间／全选未生成；一次最多 MAX_CHAPTERS_PER_SUBMIT 章）───

/** 勾／取消一章。**一次最多 5 章**在这里就拦住（服务端回 400 之前先不让用户白等） */
function toggle(id) {
  const cur = selectedIds.value
  if (cur.includes(id)) {
    selectedIds.value = cur.filter((x) => x !== id)
    pickNotice.value = ''
    return
  }
  if (cur.length >= MAX_CHAPTERS_PER_SUBMIT) {
    pickNotice.value = `一次最多提交 ${MAX_CHAPTERS_PER_SUBMIT} 章 —— 想去掉某章，先把它取消勾选。`
    return
  }
  selectedIds.value = [...cur, id]
  pickNotice.value = ''
}

function clearSelection() {
  selectedIds.value = []
  pickNotice.value = ''
}

/** 全选未生成：勾**前 MAX 章**可生成的（多的不静默吞掉，说清「已勾前 N 章」） */
function selectAllTodo() {
  const all = selectableIds.value
  const picks = all.slice(0, MAX_CHAPTERS_PER_SUBMIT)
  selectedIds.value = picks
  pickNotice.value = all.length > picks.length
    ? `一次最多提交 ${MAX_CHAPTERS_PER_SUBMIT} 章 —— 已勾选前 ${picks.length} 章未生成的。`
    : ''
}

/** 「第 X 到第 Y 章」：区间里的章若已生成／在排队／太长，跳过它们并如实说明 */
function applyRange() {
  const span = rangeSelection(chapters.value, rangeFrom.value, rangeTo.value)
  if (!span.length) { pickNotice.value = '这两个章号认不出来。'; return }
  const allowed = span.filter((id) => selectableIds.value.includes(id))
  if (!allowed.length) {
    selectedIds.value = []
    pickNotice.value = '这一段里的章都已经生成过或在排队了。'
    return
  }
  const picks = allowed.slice(0, MAX_CHAPTERS_PER_SUBMIT)
  selectedIds.value = picks
  const notes = []
  if (allowed.length < span.length) notes.push(`其中 ${span.length - allowed.length} 章已生成／在排队／太长，已跳过`)
  if (allowed.length > picks.length) notes.push(`一次最多提交 ${MAX_CHAPTERS_PER_SUBMIT} 章，已勾前 ${picks.length} 章`)
  pickNotice.value = notes.join('；')
}

// ── 网络（恒不抛：拿不到就退回「没有在跑」，与 utils/genApi.js 同姿态）──────

/** 拉就绪索引。`404` ＝ 这本书**还没生成过**音频（正常态）→ 确知为空；别的错 → 仍然是「不知道」 */
async function pullIndex() {
  const id = bookId.value
  const res = await fetchCloudIndex(id)
  if (id !== bookId.value) return
  if (res.ok && indexUsable(res.index, id)) {
    readySet.value = new Set(((res.index && res.index.withAudio) || []).map(String))
    indexKnown.value = true
  } else if (res.status === 404) {
    readySet.value = new Set()
    indexKnown.value = true
  }
}

/**
 * 问一次服务端台账。过期答复（换了书）一律丢弃。
 * 顺带做「台账说 done、手上索引还没跟上」的追平：done 数比手上的就绪章多 → 拉一次真索引
 * （别的设备刚生成完／本机这份旧了）。这条与阅读器章内那条同姿态，都靠服务端复读。
 */
async function refreshStatus() {
  const id = bookId.value
  if (!id || !auth.user.value) return null
  const r = await fetchGenStatus(id)
  if (id !== bookId.value) return null
  if (!r.ok) {
    if (r.status === 401) blocked401.value = true
    return null
  }
  blocked401.value = false
  genStatus.value = r.data
  if (r.data.summary.done > readySet.value.size) await pullIndex()
  return r.data
}

async function pollOnce() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return // 后台不空转
  if (pollBusy) return
  pollBusy = true
  try {
    const d = await refreshStatus()
    if (d && (d.summary.pending + d.summary.running) === 0) stopPoll() // 没有在跑的了 → 停表
  } catch { /* 恒不抛：下个 tick 再来 */ } finally { pollBusy = false }
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

/** 有在排队／在跑的才起表 —— 空闲时不空转（阅读器那条只在开书时问一次，同一个取向） */
function startPoll() {
  stopPoll()
  pollOnce()
  pollTimer = setInterval(pollOnce, GEN_POLL_MS)
}
onBeforeUnmount(stopPoll)

async function submit() {
  if (!canSubmit.value) return
  const id = bookId.value
  submitting.value = true
  submitLine.value = ''
  skipLines.value = []
  submitError.value = ''
  const r = await submitGenChapters(id, selectedIds.value)
  submitting.value = false
  if (id !== bookId.value) return
  if (!r.ok) {
    submitError.value = r.status === 401
      ? '登录状态过期了，请重新登录再试。'
      : r.status === 403
        ? '今天的额度不够 —— 少勾几章，或明天再来。'
        : '没提交成功（网络或服务端抖动），稍后再试。'
    return
  }
  submitLine.value = submitResultLine(r.data)
  skipLines.value = r.data.skipped.map((s) => ({ chapterId: s.chapterId, text: skipReasonText(s.reason) }))
  selectedIds.value = []
  pickNotice.value = ''
  await refreshStatus()
  if (inFlight.value) startPoll()
}

// ── 装载 ─────────────────────────────────────────────────────────────────────

const NOT_HERE = '这本书不在本机 —— 自带书只存在导入它的那台设备上。要生成音频，先在导入它的设备上打开，或在另一台设备导入同一本书。'

onMounted(async () => {
  loading.value = true
  loadError.value = ''
  const id = bookId.value
  if (!isBookId(id)) { loadError.value = '这本书的地址不对。'; loading.value = false; return }

  let record = null
  try {
    record = await loadByoRecord(id)
  } catch (e) {
    loadError.value = (e instanceof BookStoreError && e.code === 'UNAVAILABLE')
      ? '这台浏览器挡住了本机存储，打不开自带书。'
      : NOT_HERE
  }
  if (!loadError.value && !record) loadError.value = NOT_HERE
  if (loadError.value) { loading.value = false; return }

  bookTitle.value = record.title || 'Untitled'
  chapters.value = (Array.isArray(record.chapters) ? record.chapters : [])
    .map((ch) => ({
      id: String((ch && ch.id) || ''),
      title: String((ch && ch.title) || ''),
      chars: (Array.isArray(ch && ch.paragraphs) ? ch.paragraphs : [])
        .reduce((n, p) => n + String((p && p.text) || '').length, 0),
    }))
    .filter((ch) => ch.id)
  if (!chapters.value.length) { loadError.value = '这本书没有可读的章节。'; loading.value = false; return }
  rangeFrom.value = chapters.value[0].id
  rangeTo.value = chapters.value[chapters.value.length - 1].id

  if (auth.user.value) {
    await pullIndex()
    const d = await refreshStatus()
    if (d && inFlight.value) startPoll()
  }
  loading.value = false
})

// 登录态一变就重问（这一页最容易「停在未登录的界面上」）：上了登录 → 拉索引 ＋ 问台账。
watch(() => auth.user.value, async (u) => {
  if (!u || !chapters.value.length || loadError.value) return
  await pullIndex()
  const d = await refreshStatus()
  if (d && inFlight.value) startPoll()
})
</script>

<style scoped>
.gen-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 16px 40px;
}

.gen-head { margin-bottom: 12px; }
.gen-h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: var(--text-primary, #1d1d1f); }
.gen-sub { margin: 0; font-size: 13px; color: var(--text-secondary, #6e6e73); }

.gen-notes {
  margin: 0 0 12px;
  padding: 10px 12px 10px 28px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
  font-size: 12.5px;
  line-height: 1.6;
}

.gen-note {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
  font-size: 13px;
  line-height: 1.6;
}
.gen-note p { margin: 0 0 6px; }
.gen-note-bad { border-left: 3px solid #c9821f; color: var(--text-primary, #1d1d1f); }
.gen-link { color: var(--accent-color, #1a73e8); font-size: 13px; text-decoration: none; }

.gen-card {
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-primary, #fff);
}

.gen-progress-head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 6px; font-size: 14px; color: var(--text-primary, #1d1d1f); }
.gen-pill {
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
}
.gen-pill-run { background: #e8f0fe; color: var(--accent-color, #1a73e8); }

.gen-line { margin: 0 0 4px; font-size: 13px; color: var(--text-secondary, #6e6e73); line-height: 1.5; }
.gen-line-dim { font-size: 12.5px; }

.gen-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.gen-range { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text-secondary, #6e6e73); }
.gen-select {
  font: inherit;
  font-size: 13px;
  padding: 3px 6px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
}

.gen-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--accent-color, #1a73e8);
  background: var(--accent-color, #1a73e8);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gen-btn-ghost { background: transparent; color: var(--accent-color, #1a73e8); }

/* 章节表：行多了自己滚（27 章的书不该把提交条推出去） */
.gen-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
  border-top: 1px solid var(--border-color, #e5e5e5);
}
.gen-row { border-bottom: 1px solid var(--border-color, #f0f0f2); }
.gen-row-label { display: flex; align-items: baseline; gap: 8px; padding: 7px 2px; cursor: pointer; font-size: 13.5px; }
.gen-row-off > .gen-row-label { cursor: default; }
.gen-row-on { background: #eef3fd; }
.gen-check { flex: none; align-self: center; }
.gen-row-no { flex: none; font-variant-numeric: tabular-nums; color: var(--text-secondary, #6e6e73); }
.gen-row-title {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #1d1d1f);
}
.gen-row-off .gen-row-title { color: var(--text-secondary, #6e6e73); }
.gen-row-chars { flex: none; font-size: 12px; color: var(--text-secondary, #6e6e73); }
.gen-badge {
  flex: none;
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #6e6e73);
}
.gen-badge-ready { background: #e6f4ea; color: #137333; }
.gen-badge-running, .gen-badge-queued { background: #e8f0fe; color: var(--accent-color, #1a73e8); }
.gen-badge-failed, .gen-badge-tooLong { background: #fce8e6; color: #b3261e; }

.gen-foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 10px;
  background: var(--bg-secondary, #f5f5f5);
}
.gen-count { font-size: 13px; color: var(--text-primary, #1d1d1f); }

.gen-msg { margin: 8px 0 0; font-size: 13px; color: var(--text-secondary, #6e6e73); line-height: 1.5; }
.gen-msg-bad { color: #b3261e; }
.gen-msg ul { margin: 0; padding-left: 18px; }
</style>
