<template>
  <div class="vocabulary-view">
    <!-- Header: count + overflow menu -->
    <div class="vocab-header">
      <span class="vocab-count">共 {{ vocab.count.value }} 个生词 · 当前 {{ filtered.length }} 个</span>
      <div class="menu-wrap">
        <button class="menu-btn" @click.stop="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="menu-dropdown" @click.stop>
          <button class="menu-item" @click="doExportBackup">⬇ 导出备份</button>
          <button class="menu-item" @click="fileInput?.click(); menuOpen = false">⬆ 导入备份</button>
          <button class="menu-item" @click="showSyncPanel = true; menuOpen = false">↻ 同步</button>
          <button class="menu-item danger" @click="doClearAll">清空全部</button>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="doImportBackup" />
    </div>

    <!-- Sync Panel -->
    <Teleport to="body">
      <Transition name="popup">
        <div v-if="showSyncPanel" class="popup-overlay" @click.self="showSyncPanel = false">
          <div class="popup-card sync-panel">
            <div class="popup-header">
              <h3>↻ 同步</h3>
              <button class="popup-close" @click="showSyncPanel = false">✕</button>
            </div>
            <div v-if="sync.paired.value" class="sync-status">
              <p>✅ 已同步到账号</p>
              <p class="sync-hint" v-if="sync.lastSync.value">
                上次同步：{{ sync.lastSync.value.toLocaleString() }}
              </p>
              <!-- 4.4 同步可见：待上传数 / 拒收 / 冲突账本 -->
              <p class="sync-hint" v-if="sync.pending.value > 0">
                待上传：<strong>{{ sync.pending.value }}</strong>
              </p>
              <p v-else class="sync-hint">所有改动已上传 ✓</p>
              <p class="sync-hint warn" v-if="sync.rejected.value > 0">
                本机有 {{ sync.rejected.value }} 项改动比另一台设备旧，已采用较新的版本。
              </p>
              <p v-if="sync.error.value" class="sync-error">{{ sync.error.value }}</p>
              <!-- 拉 + 推都做：只 pull 的话，本机这次的改动要等下一次变异才会上去 -->
              <button class="action-btn primary" @click="sync.syncNow(); showSyncPanel = false" :disabled="sync.pulling.value || sync.pushing.value">
                {{ (sync.pulling.value || sync.pushing.value) ? '同步中…' : '立即同步' }}
              </button>
              <details v-if="sync.conflicts.value.length" class="sync-conflicts">
                <summary>最近的同步事件（{{ sync.conflicts.value.length }}）</summary>
                <ul class="sync-conflict-list">
                  <li v-for="(c, i) in sync.conflicts.value" :key="i">{{ conflictText(c) }}</li>
                </ul>
                <button class="action-btn" type="button" @click="sync.clearConflicts()">清空</button>
              </details>
            </div>
            <div v-else>
              <div class="sync-section">
                <p class="sync-label">登录后可在多台设备间同步生词、笔记和书籍。</p>
                <p class="sync-hint">到「我的」页登录即可，不需要同步码。</p>
              </div>
              <p v-if="sync.error.value" class="sync-error">{{ sync.error.value }}</p>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Search -->
    <input
      v-model="searchInput"
      class="vocab-search"
      type="search"
      placeholder="🔍 搜索生词或释义"
    />

    <!-- Filter chips + sort -->
    <div class="vocab-controls">
      <div class="filter-chips">
        <button
          v-for="f in filterOptions" :key="f.value"
          :class="['chip', { active: filter === f.value }]"
          @click="filter = f.value"
        >{{ f.label }}</button>
        <select v-if="chapterOptions.length" v-model="chapterFilter" class="chapter-select">
          <option value="">全部章节</option>
          <option v-for="ch in chapterOptions" :key="ch" :value="ch">{{ ch }}</option>
        </select>
      </div>
      <select v-model="sortBy" class="sort-select">
        <option value="recent">最近添加</option>
        <option value="alpha">A – Z</option>
        <option value="chapter">按章节排序</option>
      </select>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="vocab-toast">{{ toast }}</div>

    <!-- Empty state -->
    <div v-if="vocab.count.value === 0" class="empty-state">
      <div class="empty-icon">📝</div>
      <p>还没有收藏生词。</p>
      <p class="empty-hint">阅读时点任意单词，选择「+ 加入生词本」。</p>
      <div class="empty-actions">
        <router-link to="/books" class="action-btn primary">去书架</router-link>
        <button class="action-btn" @click="fileInput?.click()">导入备份</button>
      </div>
    </div>

    <!-- No match -->
    <div v-else-if="filtered.length === 0" class="empty-state">
      <p>没有符合当前筛选条件的生词。</p>
    </div>

    <!-- Word list -->
    <div v-else class="word-list">
      <div
        v-for="entry in filtered" :key="entry.word"
        :class="['word-card', { expanded: expanded === entry.word }]"
        @click="toggleExpand(entry.word)"
      >
        <div class="card-row">
          <div class="card-main">
            <div class="card-title">
              <span class="card-word">{{ entry.word }}</span>
              <span v-if="entry.snapshot.phonetic" class="phonetic">{{ entry.snapshot.phonetic }}</span>
              <span v-if="entry.snapshot.partOfSpeech" class="pos-tag">{{ entry.snapshot.partOfSpeech }}</span>
              <span v-if="entry.snapshot.level" class="level-tag" :class="entry.snapshot.level.toLowerCase()">
                ★ {{ entry.snapshot.level }}
              </span>
            </div>
            <div v-if="expanded !== entry.word" class="card-def-preview">
              {{ entry.snapshot.definitions[0] || '释义待补全 —— 联网打开一次这个词即可' }}
            </div>
          </div>
          <button class="speak-btn" @click.stop="speak(entry.word)">🔊</button>
        </div>

        <div v-if="expanded === entry.word" class="card-detail" @click.stop>
          <ol v-if="entry.snapshot.definitions.length" class="def-list">
            <li v-for="(def, i) in entry.snapshot.definitions" :key="i">{{ def }}</li>
          </ol>
          <p v-else class="def-pending">释义待补全 —— 联网时在阅读页点一下这个词即可补上。</p>
          <div v-if="entry.snapshot.chapters.length" class="card-chapters">
            <span class="chapters-label">出现章节：</span>
            <span v-for="ch in entry.snapshot.chapters" :key="ch" class="chapter-badge">{{ ch }}</span>
          </div>
          <div class="card-footer">
            <span class="added-at">添加于 {{ formatDate(entry.addedAt) }}</span>
            <button
              :class="['remove-btn', { confirming: removeConfirm === entry.word }]"
              @click.stop="onRemove(entry.word)"
            >{{ removeConfirm === entry.word ? '确认删除？' : '删除' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useVocabulary } from '../composables/useVocabulary'
import { useSync } from '../composables/useSync'
import { useTTS } from '../composables/useTTS.js'

const tts = useTTS()
const vocab = useVocabulary()
vocab.init()

const sync = useSync()
const showSyncPanel = ref(false)

// 4.4 同步可见：把事件账本里的一条翻成一句人话
const CONFLICT_TEXT = {
  rejected: n => `本机 ${n} 项改动比另一台设备旧，已采用较新的版本`,
  'remote-delete': n => `另一台设备删除了 ${n} 项`,
  repush: n => `本机 ${n} 项改动已与另一台设备合并并重新上传`
}
function conflictText(c) {
  const make = CONFLICT_TEXT[c && c.kind]
  const what = make ? make((c && c.n) || 0) : ((c && c.kind) || '同步事件')
  const at = c && c.at ? new Date(c.at).toLocaleString() : ''
  return at ? `${at} — ${what}` : what
}


// ---- controls state ----

const searchInput = ref('')
const search = ref('') // debounced
const filter = ref('all')
const chapterFilter = ref('')
const sortBy = ref('recent')
const expanded = ref(null)
const menuOpen = ref(false)
const fileInput = ref(null)
const toast = ref('')
const removeConfirm = ref(null)

let searchTimer = null
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { search.value = v.trim().toLowerCase() }, 200)
})

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'SAT', label: 'SAT' },
  { value: 'AP', label: 'AP' }
  // 7.2/7.3 解锁：Due today / Wrong answers
]

const chapterOptions = computed(() => {
  const set = new Set()
  for (const e of Object.values(vocab.words.value)) {
    if (e.chapterId) set.add(e.chapterId)
  }
  return [...set].sort()
})

const filtered = computed(() => {
  let list = Object.values(vocab.words.value)
  if (filter.value !== 'all') {
    list = list.filter(e => e.snapshot.level === filter.value)
  }
  if (chapterFilter.value) {
    list = list.filter(e => e.chapterId === chapterFilter.value)
  }
  if (search.value) {
    const q = search.value
    list = list.filter(e =>
      e.word.includes(q) || e.snapshot.definitions.join(' ').toLowerCase().includes(q)
    )
  }
  switch (sortBy.value) {
    case 'alpha':
      return list.sort((a, b) => a.word.localeCompare(b.word))
    case 'chapter':
      return list.sort((a, b) => (a.chapterId || 'zz').localeCompare(b.chapterId || 'zz'))
    default: // recent
      return list.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  }
})

// ---- interactions ----

function toggleExpand(word) {
  expanded.value = expanded.value === word ? null : word
  removeConfirm.value = null
}

let confirmTimer = null
async function onRemove(word) {
  if (removeConfirm.value !== word) {
    // 两步确认：首点变红，2.5s 未再点自动复原
    removeConfirm.value = word
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => { removeConfirm.value = null }, 2500)
    return
  }
  clearTimeout(confirmTimer)
  removeConfirm.value = null
  await vocab.remove(word)
  if (expanded.value === word) expanded.value = null
}

function speak(word) {
  tts.speak(word)
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString() } catch { return '' }
}

let toastTimer = null
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3000)
}

// localStorage 写失败（配额/私有模式）只提示一次
watch(vocab.persistFailed, (failed) => {
  if (failed) showToast('保存失败 —— 存储可能已满，或正处于隐私模式')
})

// ---- export / import / clear ----

async function doExportBackup() {
  menuOpen.value = false
  const envelope = await vocab.exportBackup()
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `my-reader-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  const n = Object.keys(envelope.data.vocabulary.words).length
  const p = Object.keys(envelope.data.progress).length
  showToast(`备份已导出 —— ${n} 个生词、${p} 个阅读位置`)
}

async function doImportBackup(event) {
  const file = event.target.files?.[0]
  event.target.value = '' // 允许再次选同一文件
  if (!file) return
  try {
    const r = await vocab.importBackup(file)
    showToast(`备份已恢复 —— ${r.words.applied} 个生词、${r.tombstones} 条删除、${r.progress} 个位置`)
  } catch (e) {
    showToast(`恢复备份失败：${e.message}`)
  }
}

async function doClearAll() {
  menuOpen.value = false
  const n = vocab.count.value
  if (!n) return
  // 低频毁灭性操作用原生 confirm
  if (window.confirm(`删除全部 ${n} 个生词？此操作无法撤销。`)) {
    await vocab.clearAll()
    showToast('已清空全部生词')
  }
}

function closeMenu() { menuOpen.value = false }
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  clearTimeout(searchTimer)
  clearTimeout(confirmTimer)
  clearTimeout(toastTimer)
})
</script>

<style scoped>
.vocabulary-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}

/* ---- header ---- */
.vocab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.vocab-count {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.menu-wrap { position: relative; }

.menu-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  border-radius: 8px;
  width: 36px;
  height: 32px;
  font-size: 16px;
  cursor: pointer;
}

.menu-dropdown {
  position: absolute;
  right: 0;
  top: 38px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 50;
  min-width: 150px;
  overflow: hidden;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  text-align: left;
  font-size: 14px;
  color: var(--text-primary, #1d1d1f);
  cursor: pointer;
}

.menu-item:hover { background: var(--bg-secondary, #f5f5f7); }
.menu-item.danger { color: var(--danger-color, #ff3b30); }

/* ---- search & controls ---- */
.vocab-search {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 10px;
  font-size: 15px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  margin-bottom: 12px;
  box-sizing: border-box;
}

.vocab-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-chips {
  display: flex;
  gap: 6px;
  align-items: center;
  overflow-x: auto;
}

.chip {
  padding: 5px 14px;
  border-radius: 16px;
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.chip.active {
  background: var(--accent-color, #1a73e8);
  border-color: var(--accent-color, #1a73e8);
  color: #fff;
}

.chapter-select, .sort-select {
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  font-size: 13px;
}

/* ---- toast ---- */
.vocab-toast {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-secondary, #f5f5f7);
  color: var(--text-primary, #1d1d1f);
  font-size: 14px;
  margin-bottom: 12px;
}

/* ---- empty state ---- */
.empty-state {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-secondary, #6e6e73);
}

.empty-icon { font-size: 40px; margin-bottom: 8px; }
.empty-hint { font-size: 13px; }

.empty-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #1d1d1f);
  text-decoration: none;
  display: inline-block;
}

.action-btn.primary {
  background: var(--accent-color, #1a73e8);
  color: #fff;
  border-color: var(--accent-color, #1a73e8);
}

/* ---- word cards ---- */
.word-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.word-card {
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  transition: border-color 0.15s;
}

.word-card.expanded {
  border-color: var(--accent-color, #1a73e8);
}

.card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.card-main { flex: 1; min-width: 0; }

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-word {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.phonetic {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
}

.pos-tag, .chapter-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-secondary, #f5f5f7);
  color: var(--text-secondary, #6e6e73);
  border-radius: 4px;
}

.level-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.level-tag.sat { background: #e3f2fd; color: #1565c0; }
.level-tag.ap { background: #fce4ec; color: #c62828; }

.card-def-preview {
  font-size: 14px;
  color: var(--text-secondary, #6e6e73);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.speak-btn {
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
}

/* ---- expanded detail ---- */
.card-detail {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color, #d2d2d7);
  cursor: default;
}

.def-list {
  margin: 0 0 10px;
  padding-left: 20px;
}

.def-list li {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #1d1d1f);
  margin-bottom: 4px;
}

.def-pending {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  font-style: italic;
}

.card-chapters {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.chapters-label {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.added-at {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.remove-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d2d2d7);
  background: var(--bg-primary, #fff);
  color: var(--text-secondary, #6e6e73);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.remove-btn.confirming {
  background: var(--danger-color, #ff3b30);
  border-color: var(--danger-color, #ff3b30);
  color: #fff;
}

/* ---- sync panel ---- */
.sync-panel { max-height: 80vh; }
.sync-section { margin-bottom: 16px; }
.sync-label { font-size: 14px; color: var(--text-secondary, #6e6e73); margin-bottom: 8px; }
.sync-code-big {
  font-size: 28px; font-weight: 700; letter-spacing: 6px;
  color: var(--text-primary, #1d1d1f); text-align: center;
  margin: 12px 0; font-family: monospace;
}
.sync-hint { font-size: 12px; color: var(--text-secondary, #6e6e73); margin-top: 6px; }
.sync-divider { border: none; border-top: 1px solid var(--border-color, #d2d2d7); margin: 16px 0; }
.sync-input-row { display: flex; gap: 8px; }
.sync-code-input {
  flex: 1; padding: 10px 14px; border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px; font-size: 16px; text-transform: uppercase; font-family: monospace;
  letter-spacing: 4px; text-align: center;
}
.sync-status { text-align: center; }
.sync-error { color: var(--danger-color, #ff3b30); font-size: 13px; margin-top: 8px; text-align: center; }
.sync-hint.warn { color: #9a6700; }
.sync-conflicts {
  margin-top: 14px;
  text-align: left;
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}
.sync-conflicts summary { cursor: pointer; }
.sync-conflict-list { margin: 8px 0; padding-left: 18px; line-height: 1.6; }
</style>
