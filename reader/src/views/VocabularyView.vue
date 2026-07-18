<template>
  <div class="vocabulary-view">
    <!-- Header: count + overflow menu -->
    <div class="vocab-header">
      <span class="vocab-count">{{ filtered.length }} of {{ vocab.count.value }} words</span>
      <div class="menu-wrap">
        <button class="menu-btn" @click.stop="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="menu-dropdown" @click.stop>
          <button class="menu-item" @click="doExport">Export JSON</button>
          <button class="menu-item" @click="fileInput?.click(); menuOpen = false">Import JSON</button>
          <button class="menu-item" @click="showSyncPanel = true; menuOpen = false">↻ Sync Devices</button>
          <button class="menu-item danger" @click="doClearAll">Clear all</button>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="doImport" />
    </div>

    <!-- Sync Panel -->
    <Teleport to="body">
      <Transition name="popup">
        <div v-if="showSyncPanel" class="popup-overlay" @click.self="showSyncPanel = false">
          <div class="popup-card sync-panel">
            <div class="popup-header">
              <h3>↻ Sync Devices</h3>
              <button class="popup-close" @click="showSyncPanel = false">✕</button>
            </div>
            <div v-if="sync.paired.value" class="sync-status">
              <p>✅ Paired · code: <strong>{{ sync.code.value }}</strong></p>
              <p class="sync-hint" v-if="sync.lastSync.value">
                Last sync: {{ sync.lastSync.value.toLocaleTimeString() }}
              </p>
              <button class="action-btn primary" @click="sync.pull(); showSyncPanel = false" :disabled="sync.pulling.value">
                {{ sync.pulling.value ? 'Syncing...' : 'Sync Now' }}
              </button>
              <button class="action-btn" @click="sync.unpair()">Unpair</button>
            </div>
            <div v-else>
              <div class="sync-section">
                <p class="sync-label">Create a sync code on this device:</p>
                <button class="action-btn primary" @click="doCreateSync">Create Code</button>
                <p v-if="sync.code.value" class="sync-code-big">{{ sync.code.value }}</p>
                <p class="sync-hint" v-if="sync.code.value">Enter this code on your other device to pair.</p>
              </div>
              <hr class="sync-divider">
              <div class="sync-section">
                <p class="sync-label">Or enter a code from another device:</p>
                <div class="sync-input-row">
                  <input v-model="pairInput" class="sync-code-input" maxlength="8" placeholder="ABCD1234" autocapitalize="characters" />
                  <button class="action-btn primary" @click="doPair" :disabled="pairInput.length < 8">Pair</button>
                </div>
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
      placeholder="🔍 Search words or definitions"
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
          <option value="">All chapters</option>
          <option v-for="ch in chapterOptions" :key="ch" :value="ch">{{ ch }}</option>
        </select>
      </div>
      <select v-model="sortBy" class="sort-select">
        <option value="recent">Recently added</option>
        <option value="alpha">A – Z</option>
        <option value="chapter">Chapter order</option>
      </select>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="vocab-toast">{{ toast }}</div>

    <!-- Empty state -->
    <div v-if="vocab.count.value === 0" class="empty-state">
      <div class="empty-icon">📝</div>
      <p>No words saved yet.</p>
      <p class="empty-hint">While reading, tap any word and choose “+ Add to Words”.</p>
      <div class="empty-actions">
        <router-link to="/books" class="action-btn primary">Go to Books</router-link>
        <button class="action-btn" @click="fileInput?.click()">Import JSON</button>
      </div>
    </div>

    <!-- No match -->
    <div v-else-if="filtered.length === 0" class="empty-state">
      <p>No words match the current filter.</p>
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
              {{ entry.snapshot.definitions[0] || 'Definition pending — open this word online once' }}
            </div>
          </div>
          <button class="speak-btn" @click.stop="speak(entry.word)">🔊</button>
        </div>

        <div v-if="expanded === entry.word" class="card-detail" @click.stop>
          <ol v-if="entry.snapshot.definitions.length" class="def-list">
            <li v-for="(def, i) in entry.snapshot.definitions" :key="i">{{ def }}</li>
          </ol>
          <p v-else class="def-pending">Definition pending — tap this word in the reader while online to fill it in.</p>
          <div v-if="entry.snapshot.chapters.length" class="card-chapters">
            <span class="chapters-label">Appears in:</span>
            <span v-for="ch in entry.snapshot.chapters" :key="ch" class="chapter-badge">{{ ch }}</span>
          </div>
          <div class="card-footer">
            <span class="added-at">Added {{ formatDate(entry.addedAt) }}</span>
            <button
              :class="['remove-btn', { confirming: removeConfirm === entry.word }]"
              @click.stop="onRemove(entry.word)"
            >{{ removeConfirm === entry.word ? 'Remove?' : 'Remove' }}</button>
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

const vocab = useVocabulary()
vocab.init()

const sync = useSync()
const showSyncPanel = ref(false)
const pairInput = ref('')

async function doCreateSync() {
  await sync.createCode()
}
async function doPair() {
  const ok = await sync.pairCode(pairInput.value)
  if (ok) { pairInput.value = ''; showSyncPanel.value = false }
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
  { value: 'all', label: 'All' },
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
  if (!('speechSynthesis' in window)) return
  const utt = new SpeechSynthesisUtterance(word)
  utt.lang = 'en-US'
  utt.rate = 0.9
  speechSynthesis.speak(utt)
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
  if (failed) showToast('Saving failed — storage may be full or in private mode')
})

// ---- export / import / clear ----

async function doExport() {
  menuOpen.value = false
  const envelope = await vocab.exportJSON()
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `my-reader-vocab-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function doImport(event) {
  const file = event.target.files?.[0]
  event.target.value = '' // 允许再次选同一文件
  if (!file) return
  try {
    const { added, skipped } = await vocab.importJSON(file)
    showToast(`Imported ${added} new words, skipped ${skipped} existing`)
  } catch (e) {
    showToast(`Import failed: ${e.message}`)
  }
}

async function doClearAll() {
  menuOpen.value = false
  const n = vocab.count.value
  if (!n) return
  // 低频毁灭性操作用原生 confirm
  if (window.confirm(`Delete all ${n} saved words? This cannot be undone.`)) {
    await vocab.clearAll()
    showToast('All words cleared')
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
</style>
