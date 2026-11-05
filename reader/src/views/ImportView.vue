<template>
  <div class="import-view">
    <div class="steps">
      <span class="step" :class="{ on: stepIndex === 1, done: stepIndex > 1 }">1 选文件</span>
      <span class="step" :class="{ on: stepIndex === 2, done: stepIndex > 2 }">2 解析</span>
      <span class="step" :class="{ on: stepIndex === 3, done: stepIndex > 3 }">3 完成</span>
    </div>
    <!-- 选文件 ＋ 版权勾选。完成/失败后这一块也留着，方便接着再来一本 -->
    <!-- 选文件（空闲／预检） -->
    <section class="card" v-if="step === IMPORT_STEP.IDLE">
      <div class="drop" v-if="!file">
        <div class="drop-big">选择文件</div>
        <div class="drop-sub">EPUB／PDF／TXT，一次一本</div>
        <button class="btn primary" @click="pickFile">选择文件</button>
      </div>

      <input ref="fileInput" class="sr-only" type="file" :accept="ACCEPT_ATTR" @change="onPicked" />

      <p class="lead" v-if="!file">{{ copy.lead }}</p>

      <div class="frow" v-if="file">
        <span class="fname">{{ file.name }} · {{ sizeText }}</span>
        <button class="link" @click="removeFile">移除</button>
      </div>

      <div class="checks" v-if="file && !preflightError">
        <div class="check-row"><span>格式</span><span>{{ formatLabel }} ✓</span></div>
        <div class="check-row"><span>大小</span><span>{{ sizeText }} ✓</span></div>
        <div class="check-row"><span>DRM</span><span>导入时校验</span></div>
      </div>

      <p class="error" v-if="preflightError">{{ preflightError.message }}</p>
      <p class="hint" v-if="preflightError">{{ preflightError.hint }}</p>

      <label class="consent" v-if="file && !preflightError">
        <input type="checkbox" v-model="consent" :disabled="busy" />
        <span>我确认有权使用此文件</span>
      </label>

      <button class="btn primary wide" v-if="file && !preflightError" :disabled="!startable" @click="start">开始导入</button>
      <p class="hint" v-if="!file">{{ copy.deviceHint }}</p>
    </section>

    <!-- 解析中 -->
    <section class="card" v-if="busy">
      <div class="frow">
        <span class="fname">{{ file && file.name }} · {{ sizeText }}</span>
      </div>
      <div class="stage-list">
        <div class="stage-row" v-for="s in stageRows" :key="s.key">
          <span class="mark" :class="s.state"></span>
          <span>{{ s.label }}</span>
          <span class="stage-s">{{ s.text }}</span>
        </div>
      </div>
      <div class="bar" :class="{ indeterminate: percent === null }">
        <div class="fill" :style="fillStyle"></div>
      </div>
      <div class="pct" v-if="percent !== null"><span>{{ stageLabel }}</span><span>{{ Math.round(percent) }}%</span></div>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost wide" @click="cancel">取消导入</button>
      </div>
      <p class="hint">取消后本次导入作废，需重新选择文件。</p>
    </section>

    <!-- 完成 -->
    <section class="card outcome" v-if="step === IMPORT_STEP.DONE">
      <div class="cent">
        <div class="done-art">✓</div>
        <h2>{{ result.existed ? '已在书架里' : '已加入书架' }}</h2>
        <p class="outcome-title">{{ result.title }}</p>
        <p class="outcome-meta">{{ result.chapterCount }} 章</p>
        <router-link class="btn primary wide" :to="`/reader/${result.id}`">去阅读</router-link>
        <button class="btn ghost wide" @click="resetAll">再导一本</button>
        <p class="hint"><router-link to="/books">回书架</router-link></p>
      </div>
    </section>

    <!-- 失败 -->
    <section class="card outcome error-state" v-if="step === IMPORT_STEP.ERROR">
      <div class="cent">
        <div class="fail-art">!</div>
        <h2>{{ isNoText ? '这些页是扫描图，本版本无法识别' : '这个文件没能导入' }}</h2>
        <p class="outcome-title" v-if="!isNoText">{{ error.message }}</p>
        <p class="hint" v-if="isNoText">本版本扫描页不能识别，M2 提供扫描件识别。<br>有文字层的页可以照常导入。</p>
        <p class="hint" v-else>{{ error.hint }}</p>
        <button class="btn primary wide" v-if="!isNoText" @click="resetOutcome">换个文件试试</button>
        <button class="btn ghost wide" v-if="isNoText" @click="resetOutcome">取消导入</button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { importBook } from '../import/index.js'
import { loadBook, saveBook } from '../storage/index.js'
import { metaOf } from '../utils/bookShelf.js'
import {
  ACCEPT_ATTR,
  IMPORT_STEP,
  canStart,
  errorText,
  formatBytes,
  isCancelled,
  isHeavy,
  preflightFile,
  progressPercent,
  importCopy,
  recordFromBook,
  stepText,
  stripExt
} from '../utils/importFlow.js'
import { publishByoBookInBackground } from '../sync/bookSync.js'
import { useAuth } from '../composables/useAuth.js'

// 文案按登录态分叉（第 16 步块 2）：登录 → 会上云；未登录 → 只在本机（行为与承诺一致）
const auth = useAuth()
const copy = computed(() => importCopy(!!auth.user.value))

const fileInput = ref(null)
const consent = ref(false)
const file = ref(null)
const preflightError = ref(null)
const step = ref(IMPORT_STEP.IDLE)
const progress = ref(null)
const result = ref(null)
const error = ref(null)

// 只有一次在飞的导入：取消就是 abort 它
let controller = null

const busy = computed(() => [IMPORT_STEP.READING, IMPORT_STEP.PARSING, IMPORT_STEP.SAVING].includes(step.value))
const percent = computed(() => progressPercent(progress.value))
const fillStyle = computed(() => (percent.value === null ? {} : { width: `${percent.value}%` }))
const stageLabel = computed(() => stepText(step.value))
const sizeText = computed(() => formatBytes(file.value && file.value.size))
const heavy = computed(() => isHeavy(file.value && file.value.size))
const titleGuess = computed(() => stripExt(file.value && file.value.name))
const startable = computed(() =>
  canStart({ consent: consent.value, file: file.value, busy: busy.value }) && !preflightError.value)

const stepIndex = computed(() => {
  if (step.value === IMPORT_STEP.DONE) return 3
  if ([IMPORT_STEP.READING, IMPORT_STEP.PARSING, IMPORT_STEP.SAVING, IMPORT_STEP.ERROR].includes(step.value)) return 2
  return 1
})

const stageRows = computed(() => {
  const cur = step.value === IMPORT_STEP.READING ? 1 : step.value === IMPORT_STEP.PARSING ? 2 : step.value === IMPORT_STEP.SAVING ? 3 : 0
  return ['读取文件', '解析文字', '保存到书架'].map((label, i) => {
    const n = i + 1
    return {
      key: label,
      label,
      state: n < cur ? 'done' : n === cur ? 'cur' : '',
      text: n < cur ? '完成' : n === cur ? '进行中' : '等待'
    }
  })
})

const formatLabel = computed(() => {
  const name = String((file.value && file.value.name) || '')
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]
  return ext ? ext.toUpperCase() : '文件'
})

const isNoText = computed(() => !!(error.value && error.value.code === 'PDF_NO_TEXT'))

function pickFile() {
  fileInput.value?.click()
}

function resetOutcome() {
  step.value = IMPORT_STEP.IDLE
  progress.value = null
  result.value = null
  error.value = null
}

function resetAll() {
  resetOutcome()
  file.value = null
  preflightError.value = null
  consent.value = false
}

function removeFile() {
  file.value = null
  preflightError.value = null
  consent.value = false
  resetOutcome()
}

function onPicked(event) {
  const picked = event.target.files && event.target.files[0]
  // 清空 value：否则连着选同一个文件不会再触发 change
  event.target.value = ''
  if (!picked) return
  resetOutcome()
  file.value = picked
  try {
    preflightFile(picked)
    preflightError.value = null
  } catch (e) {
    preflightError.value = errorText(e)
  }
}

async function start() {
  if (!startable.value) return
  const picked = file.value
  controller = new AbortController()
  const signal = controller.signal
  error.value = null
  result.value = null
  progress.value = null
  step.value = IMPORT_STEP.READING
  try {
    // 先把「正在处理」画出来再干活：TXT / EPUB 的解析是一次同步解码，一进去主线程就被占住，
    // 之前没画出来的东西就再也画不出来了（PDF 走 pdfjs，逐页 await，中途能真更新进度）。
    await new Promise((resolve) => setTimeout(resolve, 0))
    step.value = IMPORT_STEP.PARSING

    const book = await importBook(picked, {
      title: titleGuess.value,
      signal,
      onProgress: (p) => { progress.value = p }
    })

    step.value = IMPORT_STEP.SAVING
    // 解析期间按的取消：此刻 abort 已经不会被解析层看到了，落库前再拦一次
    if (signal.aborted) { resetOutcome(); return }

    // bookId 是内容指纹：这台设备上已经有同一份内容就别覆盖，直接告诉他
    const existing = await loadBook(book.bookId)
    if (existing) {
      result.value = { ...metaOf(book), existed: true }
      step.value = IMPORT_STEP.DONE
      // 第 16 步块 2：本机已有也补一次上云（当初导入时可能还没登录）——幂等，后台做
      publishByoBookInBackground(existing.bookId)
      return
    }

    const meta = await saveBook(recordFromBook(book))
    result.value = { ...meta, existed: false }
    step.value = IMPORT_STEP.DONE
    // 第 16 步块 2：导入即后台上云。不 await、失败不报错（§12.6）—— 书已经在本机了，
    // 上云只是让它能被同账号的别的设备看见
    publishByoBookInBackground(book.bookId)
  } catch (e) {
    // 取消不是失败：安静回到「选好了等着导」的状态
    if (isCancelled(e)) { resetOutcome(); return }
    error.value = errorText(e)
    step.value = IMPORT_STEP.ERROR
  } finally {
    controller = null
  }
}

function cancel() {
  if (controller) controller.abort()
}
</script>

<style scoped>
.import-view {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 16px 88px;
}

.card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.card h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.lead {
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

.consent {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.45;
  cursor: pointer;
}

.consent input {
  margin-top: 3px;
  flex: 0 0 auto;
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 14px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}

.btn.primary {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #fff;
  font-weight: 600;
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.ghost {
  background: transparent;
}

.picked {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.picked-name {
  margin: 0 0 4px;
  font-weight: 600;
  word-break: break-all;
}

.picked-meta {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.warn {
  margin: 8px 0 0;
  color: var(--rating-hard, #ff9500);
  font-size: 13px;
}

.error {
  margin: 8px 0 0;
  color: var(--danger-color);
  font-size: 14px;
}

.progress {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.stage {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--border-color);
  overflow: hidden;
}

.bar.indeterminate .fill {
  width: 35%;
  animation: slide 1.1s ease-in-out infinite;
}

.fill {
  height: 100%;
  background: var(--accent-color);
  transition: width 0.15s linear;
}

@keyframes slide {
  0% { margin-left: -35%; }
  100% { margin-left: 100%; }
}

.pct {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
}

.outcome-title {
  margin: 0 0 4px;
  font-weight: 600;
  word-break: break-word;
}

.outcome-meta {
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

.error-state .outcome-title {
  color: var(--danger-color);
}

.code {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.steps { display: flex; gap: 4px; margin-bottom: 14px; }
.step { flex: 1; font-size: 11px; text-align: center; padding: 4px 0; border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-secondary); }
.step.on { border-color: var(--accent-color); color: var(--accent-color); font-weight: 600; }
.step.done { border-color: var(--text-secondary); color: var(--text-primary); }
.drop { border: 1px dashed var(--border-color); border-radius: 8px; padding: 18px 12px; text-align: center; background: var(--bg-primary); }
.drop-big { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.drop-sub { font-size: 12px; color: var(--text-secondary); margin: 4px 0 10px; }
.frow { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; margin-top: 10px; font-size: 13px; }
.fname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link { border: none; background: none; padding: 0; color: var(--text-secondary); text-decoration: underline; font: inherit; cursor: pointer; }
.checks { margin-top: 12px; }
.check-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; padding: 5px 0; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); }
.check-row span:last-child { color: var(--text-primary); }
.stage-list { margin-top: 12px; }
.stage-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 0; border-bottom: 1px solid var(--border-color); }
.mark { width: 11px; height: 11px; border: 1px solid var(--text-secondary); flex: 0 0 auto; }
.mark.done { background: var(--accent-color); border-color: var(--accent-color); }
.mark.cur { border-width: 2px; border-color: var(--accent-color); }
.stage-s { margin-left: auto; font-size: 11px; color: var(--text-secondary); }
.pct { display: flex; justify-content: space-between; }
.wide { display: flex; width: 100%; margin-top: 10px; }
.cent { text-align: center; }
.done-art, .fail-art { width: 56px; height: 56px; margin: 10px auto 14px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 28px; line-height: 54px; color: var(--accent-color); }
.fail-art { color: var(--danger-color); }
.cent .outcome-title { font-size: 15px; }
</style>
