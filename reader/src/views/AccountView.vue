<template>
  <div class="account-view">
    <p v-if="auth.notice.value" class="banner notice">{{ auth.notice.value }}</p>
    <p v-if="auth.claimNotice.value" class="banner notice">{{ auth.claimNotice.value }}</p>

    <!-- 身份行：头像／邮箱／状态／退出（未登录 → 去 /register） -->
    <section class="idrow">
      <div class="av" aria-hidden="true">{{ initial }}</div>
      <div class="idmain">
        <div class="nm">{{ auth.user.value ? auth.user.value.email : '未登录' }}</div>
        <div class="st">
          <template v-if="auth.user.value">
            已登录 · 首版免费<span v-if="!auth.user.value.emailVerified"> · 邮箱待验证</span>
          </template>
          <template v-else>登录后可跨设备同步生词、笔记和进度</template>
        </div>
      </div>
      <button v-if="auth.user.value" class="lnk" type="button" @click="confirmingOut = true">退出</button>
      <router-link v-else class="lnk" to="/register">登录 / 注册</router-link>
    </section>

    <!-- 同步（原有功能，压成一行；不与线框的四块抢位） -->
    <div v-if="auth.user.value" class="sync-line">
      <span class="sync-text">{{ syncText }}</span>
      <button class="lnk" type="button" :disabled="syncing" @click="sync.syncNow()">
        {{ syncing ? '同步中…' : '立即同步' }}
      </button>
    </div>
    <p v-if="auth.user.value && sync.error.value" class="error">{{ sync.error.value }}</p>

    <template v-if="auth.user.value">
      <!-- 额度 -->
      <div class="sec">
        <b>额度</b>
        <router-link class="lnk" :to="genLink">去生成音频</router-link>
      </div>
      <div class="blk">
        <template v-if="quota.known">
          <div class="krow"><span>今日逐章生成</span><b>{{ quota.used }}／{{ quota.max }} 章</b></div>
          <div class="bar"><i :style="{ width: quota.pct + '%' }"></i></div>
        </template>
        <div v-else class="krow"><span>今日逐章生成</span><span>{{ quotaUnknownText }}</span></div>
        <div class="krow"><span>整本音频</span>
          <router-link v-if="firstBookId" class="lnk" :to="'/generate/' + firstBookId">{{ campaignLine }}</router-link>
          <span v-else>{{ campaignLine }}</span>
        </div>
        <div class="sub">按 UTC 天重置；配额内音频保留。清空音频不退额度。</div>
      </div>

      <!-- 存储 -->
      <div class="sec"><b>存储</b><span></span></div>
      <div class="blk">
        <template v-if="storage.known">
          <div class="krow"><span>音频存储</span><b>{{ storage.usedText }}／{{ storage.limitText }}</b></div>
          <div class="bar"><i :style="{ width: storage.pct + '%' }"></i></div>
          <div v-if="storage.full" class="sub warn">空间已满：清空某本书的音频后可继续生成。</div>
        </template>
        <div v-else class="krow"><span>音频存储</span><span>{{ storageUnknownText }}</span></div>
        <div class="sub">分母读服务端上限；清空该书音频只释放空间，不返还额度。</div>
      </div>

      <!-- 阅读统计（UI-23 · 18.1 零成本层；全部从本机已有数据算） -->
      <div class="sec"><b>阅读统计（本机）</b><span></span></div>
      <div class="blk" v-if="readStats">
        <div class="krow"><span>生词总量</span><b>{{ readStats.total }} 词</b></div>
        <div class="krow"><span>本周新增</span><b>{{ readStats.weekNew }} 词</b></div>
        <div class="krow"><span>连续学习</span><b>{{ readStats.streak }} 天</b></div>
        <div class="krow"><span>未来 7 天到期</span><b>{{ readStats.due7 }} 张</b></div>
        <div class="krow"><span>掌握度</span><span>新学 {{ readStats.mastery.new }} · 学习中 {{ readStats.mastery.learning }} · 复习中 {{ readStats.mastery.review }}</span></div>
        <div class="krow"><span>测验正确率</span><b>{{ readStats.quiz.accuracy }}%（{{ readStats.quiz.attempts }} 题）</b></div>
        <div class="krow"><span>笔记</span><b>{{ readStats.notes }} 条</b></div>
        <div class="sub">全部从本机已有数据计算，不上传；每本读到哪里见书架。</div>
      </div>

      <!-- 最近任务 -->
      <div class="sec">
        <b>最近任务</b>
        <router-link v-if="firstBookId" class="lnk" :to="'/generate/' + firstBookId">打开生成页</router-link>
      </div>
      <div class="blk">
        <div v-if="!taskRows.length" class="sub">{{ tasksEmptyText }}</div>
        <template v-for="row in taskRows" :key="row.bookId + ':' + row.chapterId">
          <div class="task">
            <div class="task-main">
              <div class="tl">{{ taskTitle(row) }}</div>
              <div class="ts">
                {{ row.atText }}<template v-if="row.status === 'failed' && row.error"> · {{ row.error }}</template>
              </div>
            </div>
            <div class="tr" :class="{ bad: row.status === 'failed' }">{{ row.label }}</div>
          </div>
          <div v-if="row.canRetry" class="retry">
            <span class="rd">{{ RETRY_NOTE }}</span>
            <button class="rbtn" type="button" :disabled="retrying === row.chapterId" @click="retryTask(row)">
              {{ retrying === row.chapterId ? '重试中…' : '重试' }}
            </button>
          </div>
        </template>
        <p v-if="retryError" class="error">{{ retryError }}</p>
        <div class="sub" style="margin-top: 8px">{{ REGEN_NOTE }}</div>
      </div>

      <!-- 数据导出（UI-22）：本机生成，不上传 -->
      <div class="sec"><b>数据导出</b><span></span></div>
      <div class="blk">
        <div class="krow">
          <span>笔记与卡片</span>
          <button class="lnk" type="button" :disabled="exportEmpty || exporting" @click="doExport">
            {{ exporting ? '导出中…' : '导出 JSON' }}
          </button>
        </div>
        <div class="sub">
          {{ exportEmpty ? '暂无可导出的笔记或卡片。' : exportCountsText({ counts: exportCounts }) }}
        </div>
        <div class="sub">
          {{ lastExport ? '上次导出：' + formatWhen(lastExport) : '尚未导出过。文件含笔记与卡片，不含音频。' }}
        </div>
        <p v-if="exportError" class="error">{{ exportError }}</p>
      </div>

      <!-- 邮箱验证 -->
      <div class="sec"><b>账号</b><span></span></div>
      <div class="blk">
        <div class="krow">
          <span>{{ auth.user.value.email }}</span>
          <span v-if="auth.user.value.emailVerified">已验证</span>
          <button v-else class="lnk" type="button" :disabled="auth.busy.value" @click="doResend">
            重新发送验证
          </button>
        </div>
        <div class="sub">退出登录后，本机的书籍、生词和进度会保留。</div>
      </div>
    </template>

    <!-- 冷静期中：撤销注销 -->
    <template v-else-if="auth.pendingDeletion.value">
      <section class="blk">
        <h2 class="blk-title">账号已安排删除</h2>
        <p class="sub">
          {{ auth.pendingDeletion.value.email }} 已安排删除，约 {{ auth.pendingDeletion.value.daysLeft }} 天后永久清除。
          输入密码可撤销，生词和进度会恢复。
        </p>
        <form novalidate @submit.prevent="doCancelDeletion">
          <label class="label" for="restore-pw">密码</label>
          <input
            id="restore-pw" v-model="restorePassword" class="input" type="password"
            autocomplete="current-password" :disabled="auth.busy.value"
          />
          <p v-if="auth.error.value" class="error">{{ auth.error.value }}</p>
          <button class="btn" type="submit" :disabled="auth.busy.value || !restorePassword">
            {{ auth.busy.value ? '处理中…' : '撤销注销' }}
          </button>
        </form>
        <p class="switch">
          <button class="lnk" type="button" @click="forgetPending">换一个账号</button>
        </p>
      </section>
    </template>

    <!-- 未登录：只给入口，不再重复一套登录表单（表单在 /register） -->
    <template v-else>
      <section class="blk login-prompt">
        <h2 class="blk-title">登录或创建账号</h2>
        <p class="sub">登录后可在多台设备间同步生词、笔记和进度；不登录也能继续阅读本机书。</p>
        <router-link class="btn primary" to="/register">登录 / 注册</router-link>
      </section>
    </template>

    <div class="more">
      <router-link to="/legal">法律与隐私</router-link>
      <span>·</span>
      <router-link to="/feedback">发送反馈</router-link>
      <template v-if="auth.user.value">
        <span>·</span>
        <button class="lnk" type="button" @click="openDelete">删除账号</button>
      </template>
    </div>

    <!-- 退出确认 -->
    <div v-if="confirmingOut" class="confirm">
      <p class="confirm-text">退出这台设备？</p>
      <div class="actions">
        <button class="btn" type="button" :disabled="auth.busy.value" @click="confirmingOut = false">取消</button>
        <button class="btn strong" type="button" :disabled="auth.busy.value" @click="doSignOut">
          {{ auth.busy.value ? '退出中…' : '确认退出' }}
        </button>
      </div>
    </div>

    <!-- 注销确认（重输密码 + 30 天冷静期） -->
    <div v-if="confirmingDelete" class="confirm">
      <p class="confirm-text">
        要注销这个账号吗？账号会先进入 30 天删除期，期间重新登录即可撤销。30 天后，账号以及同步到账号的生词和进度将被永久删除。本机的书籍和生词不受影响。
      </p>
      <label class="label" for="del-pw">输入密码确认</label>
      <input
        id="del-pw" v-model="deletePassword" class="input" type="password"
        autocomplete="current-password" :disabled="auth.busy.value"
      />
      <p v-if="auth.error.value" class="error">{{ auth.error.value }}</p>
      <div class="actions">
        <button class="btn" type="button" :disabled="auth.busy.value" @click="closeDelete">取消</button>
        <button class="btn danger" type="button" :disabled="auth.busy.value || !deletePassword" @click="doDelete">
          {{ auth.busy.value ? '注销中…' : '确认注销账号' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useSync } from '../composables/useSync.js'
import { useBookShelf } from '../composables/useBookShelf.js'
import { useNotes } from '../composables/useNotes.js'
import { loadVocabulary } from '../storage/index.js'
import { bookSyncState } from '../sync/bookSync.js'
import {
  fetchGenStatus, submitGenChapters, submitErrorText, campaignStatusLabel,
} from '../utils/genApi.js'
import {
  RECENT_BOOK_LIMIT, RETRY_NOTE, REGEN_NOTE,
  quotaSummary, storageSummary, recentTasks, taskTitle, formatWhen,
} from '../utils/accountData.js'
import {
  buildExport, exportFileName, exportCountsText, isEmptyExport, downloadJson, LAST_EXPORT_KEY,
} from '../utils/exportData.js'

const auth = useAuth()
const sync = useSync()
const shelf = useBookShelf()
const notes = useNotes()

const confirmingOut = ref(false)
const confirmingDelete = ref(false)
const deletePassword = ref('')
const restorePassword = ref('')
const retrying = ref('')
const retryError = ref('')
const exportCounts = ref({ notes: 0, cards: 0 })
const readStats = ref(null)
const exporting = ref(false)
const exportError = ref('')
const lastExport = ref('')

const statuses = ref([])     // 每本书的归一 status（最多 RECENT_BOOK_LIMIT 本）
const quotaRaw = ref(null)
const storageRaw = ref(null)
const dataState = ref('idle') // idle | no-books | ready | error

const syncing = computed(() => sync.pulling.value || sync.pushing.value || bookSyncState.prefetching)
const initial = computed(() => {
  const email = auth.user.value ? String(auth.user.value.email || '') : ''
  return email ? email.slice(0, 1).toUpperCase() : '?'
})
const syncText = computed(() => {
  const last = sync.lastSync.value
  const pending = sync.pending.value
  if (pending > 0) return '待上传 ' + pending + ' 条'
  if (last) return '已同步 · ' + last.toLocaleString()
  return '同步已就绪'
})

const quota = computed(() => quotaSummary(quotaRaw.value))
const storage = computed(() => storageSummary(storageRaw.value))
const taskRows = computed(() => recentTasks(statuses.value))
const firstBookId = computed(() => (statuses.value[0] ? statuses.value[0].bookId : ''))
const genLink = computed(() => (firstBookId.value ? '/generate/' + firstBookId.value : '/books'))

const campaignLine = computed(() => {
  for (const s of statuses.value) {
    const c = s.data && s.data.campaign
    if (c) return campaignStatusLabel(c)
  }
  return '整本生成时显示额度'
})
const quotaUnknownText = computed(() => {
  if (dataState.value === 'no-books') return '导入一本书后可查看'
  if (dataState.value === 'error') return '暂时读不到'
  return '读取中…'
})
const storageUnknownText = computed(() => quotaUnknownText.value)
const tasksEmptyText = computed(() => {
  if (dataState.value === 'no-books') return '还没有本机书；导入后可在这里看到生成任务。'
  if (dataState.value === 'error') return '暂时读不到任务状态。'
  return '最近没有生成任务。'
})

async function loadAccountData() {
  retryError.value = ''
  if (!auth.user.value) {
    statuses.value = []
    quotaRaw.value = null
    storageRaw.value = null
    dataState.value = 'idle'
    return
  }
  try { await shelf.refresh() } catch { /* 书库打不开也继续：下面按空处理 */ }
  const books = (shelf.myBooks.value || []).slice(0, RECENT_BOOK_LIMIT)
  if (!books.length) {
    statuses.value = []
    quotaRaw.value = null
    storageRaw.value = null
    dataState.value = 'no-books'
    return
  }
  const rows = await Promise.all(books.map(async (b) => {
    try {
      const r = await fetchGenStatus(b.id)
      return r.ok ? { bookId: b.id, bookTitle: b.title, chapterIds: b.chapterIds, data: r.data } : null
    } catch { return null }
  }))
  const ok = rows.filter(Boolean)
  statuses.value = ok
  quotaRaw.value = ok[0] ? ok[0].data.quota : null
  storageRaw.value = ok[0] ? ok[0].data.storage : null
  dataState.value = ok.length ? 'ready' : 'error'
}

const exportEmpty = computed(() => exportCounts.value.notes + exportCounts.value.cards === 0)

function dayKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 18.1 零成本统计：只读本机 vocab + notes，不新增埋点、不上传。 */
function buildReadStats(vocab, noteRows) {
  const words = vocab && vocab.words && typeof vocab.words === 'object' ? Object.values(vocab.words) : []
  const now = Date.now()
  const weekCutoff = now - 7 * 864e5
  const dueHorizon = now + 7 * 864e5
  let weekNew = 0
  let due7 = 0
  let attempts = 0
  let correct = 0
  const mastery = { new: 0, learning: 0, review: 0 }
  const days = new Set()
  for (const e of words) {
    if (e.addedAt && Date.parse(e.addedAt) >= weekCutoff) weekNew++
    if (e.srs && e.srs.due && Date.parse(e.srs.due) <= dueHorizon) due7++
    const st = e.srs ? e.srs.state : undefined
    if (st === 1) mastery.learning++
    else if (st === 2 || st === 3) mastery.review++
    else mastery.new++
    attempts += (e.quiz && e.quiz.totalAttempts) || 0
    correct += (e.quiz && e.quiz.totalCorrect) || 0
    const last = (e.srs && e.srs.last_review) || e.addedAt
    const k = last ? dayKey(last) : ''
    if (k) days.add(k)
  }
  let streak = 0
  const cursor = new Date()
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  for (;;) {
    if (!days.has(dayKey(cursor))) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return {
    total: words.length,
    weekNew,
    streak,
    due7,
    mastery,
    quiz: { attempts, accuracy: attempts ? Math.round(correct / attempts * 100) : 0 },
    notes: Array.isArray(noteRows) ? noteRows.length : 0,
  }
}

async function refreshExportMeta() {
  let vocab = null
  try { vocab = await loadVocabulary() } catch { /* 读不到就按空处理，导出时再报错 */ }
  const noteRows = notes.all()
  try {
    exportCounts.value = buildExport({ notes: noteRows, vocab }).counts
  } catch {
    exportCounts.value = { notes: 0, cards: 0 }
  }
  readStats.value = buildReadStats(vocab, noteRows)
  try { lastExport.value = localStorage.getItem(LAST_EXPORT_KEY) || '' } catch { lastExport.value = '' }
}

async function doExport() {
  exportError.value = ''
  exporting.value = true
  try {
    const vocab = await loadVocabulary()
    const data = buildExport({ notes: notes.all(), vocab, exportedAt: new Date().toISOString() })
    if (isEmptyExport(data)) {
      exportError.value = '暂无可导出的笔记或卡片。'
      return
    }
    if (!downloadJson(exportFileName(data.exportedAt), data)) throw new Error('download-unavailable')
    exportCounts.value = data.counts
    try { localStorage.setItem(LAST_EXPORT_KEY, data.exportedAt) } catch { /* 私密模式：不记时间也不影响文件 */ }
    lastExport.value = data.exportedAt
  } catch {
    exportError.value = '导出失败，请稍后再试。'
  } finally {
    exporting.value = false
  }
}

watch(() => auth.user.value, loadAccountData, { immediate: true })
watch(() => auth.user.value, refreshExportMeta, { immediate: true })

async function retryTask(row) {
  retrying.value = row.chapterId
  retryError.value = ''
  const r = await submitGenChapters(row.bookId, [row.chapterId])
  retrying.value = ''
  if (!r.ok) { retryError.value = submitErrorText(r); return }
  await loadAccountData()
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
    const days = (r.data && r.data.daysLeft) || 30
    auth.note('账号已安排删除。若未在期限内登录撤销，约 ' + days + ' 天后将永久清除。')
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
  max-width: 390px;
  margin: 0 auto;
  padding: 12px 14px 32px;
  background: #fff;
  color: #333;
  font-size: 13px;
  line-height: 1.55;
}
.banner {
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid #999;
  border-radius: 3px;
  font-size: 12px;
}
.banner.notice { background: #f5f5f5; color: #333; }

.idrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0 10px;
  border-bottom: 1px solid #999;
}
.av {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #999;
  background: #f5f5f5;
  color: #333;
  font-size: 15px;
  font-weight: 600;
}
.idmain { flex: 1; min-width: 0; }
.idmain .nm {
  font-size: 12px;
  font-weight: 600;
  color: #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.idmain .st { font-size: 10px; color: #666; }

.sync-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 11px;
  color: #666;
}
.sync-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sec {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 16px 0 6px;
  font-size: 11px;
  color: #666;
}
.sec b { font-size: 12px; color: #000; font-weight: 600; }

.blk {
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  padding: 9px 10px;
}
.blk-title { margin: 0 0 6px; font-size: 15px; color: #000; font-weight: 600; }

.krow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-size: 11px;
  color: #333;
}
.krow b { font-size: 12px; color: #000; font-weight: 600; }
.krow .muted { color: #999; }

.bar {
  height: 4px;
  background: #e5e5e5;
  border-radius: 2px;
  overflow: hidden;
  margin: 6px 0 8px;
}
.bar i { display: block; height: 100%; background: #333; }

.sub { margin: 4px 0 0; font-size: 10px; color: #666; line-height: 1.6; }
.sub.warn { color: #333; }

.task {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #999;
}
.task:last-of-type { border-bottom: 0; padding-bottom: 0; }
.task-main { min-width: 0; }
.task .tl { font-size: 11px; color: #000; }
.task .ts { margin-top: 1px; font-size: 10px; color: #666; }
.task .tr { flex: 0 0 auto; font-size: 10px; color: #333; text-align: right; white-space: nowrap; }
.task .tr.bad { color: #000; font-weight: 600; }

.retry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #999;
}
.retry .rd { font-size: 10px; color: #333; line-height: 1.6; }
.rbtn {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid #333;
  background: #fff;
  color: #333;
  border-radius: 3px;
  font-size: 10px;
  font-family: inherit;
}
.rbtn:disabled { opacity: 0.55; }

.more {
  margin-top: 16px;
  text-align: center;
  font-size: 10px;
  color: #666;
  line-height: 1.9;
}
.more a { color: #333; text-decoration: underline; text-underline-offset: 2px; }
.more span { margin: 0 4px; }

.lnk {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 11px;
  color: #333;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.lnk:disabled { opacity: 0.55; cursor: default; }

.login-prompt .btn { margin-top: 10px; }

.label { display: block; margin: 10px 0 4px; font-size: 11px; color: #000; font-weight: 600; }
.input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #999;
  border-radius: 3px;
  font-size: 13px;
  color: #333;
  background: #fff;
}
.error { margin: 8px 0 0; font-size: 11px; color: #000; font-weight: 600; }

.btn {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 10px;
  border: 1px solid #999;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
  box-sizing: border-box;
  text-decoration: none;
}
.btn.primary { background: #000; border-color: #000; color: #fff; }
.btn.strong { background: #000; border-color: #000; color: #fff; }
.btn.danger { background: #000; border-color: #000; color: #fff; }
.btn:disabled { opacity: 0.55; }

.confirm {
  margin-top: 14px;
  border: 1px solid #999;
  background: #f5f5f5;
  border-radius: 3px;
  padding: 10px;
}
.confirm-text { margin: 0 0 8px; font-size: 12px; color: #000; line-height: 1.6; }
.actions { display: flex; gap: 8px; }
.actions .btn { margin-top: 0; }
.switch { margin: 10px 0 0; font-size: 11px; color: #666; }
.lnk { color: var(--accent, #2f6fed); text-decoration: none; }
.lnk:hover { text-decoration: underline; }
</style>
