<template>
  <div class="import-view">
    <!-- 选文件 ＋ 版权勾选。完成/失败后这一块也留着，方便接着再来一本 -->
    <section class="card" v-if="step !== IMPORT_STEP.DONE">
      <h2>Add your own book</h2>
      <p class="lead">
        EPUB, PDF (with a text layer), or TXT. The file is read on this device and is never uploaded.
      </p>

      <label class="consent">
        <input type="checkbox" v-model="consent" :disabled="busy" />
        <span>This is my own copy — I will read it here for personal use only and will not redistribute it.</span>
      </label>

      <input ref="fileInput" class="sr-only" type="file" :accept="ACCEPT_ATTR" @change="onPicked" />

      <div class="row">
        <button class="btn primary" :disabled="!consent || busy" @click="pickFile">
          {{ file ? 'Choose a different file' : 'Choose a file' }}
        </button>
      </div>

      <p class="hint" v-if="!consent">
        Tick the box above to continue. Imported books stay on this device.
      </p>

      <div class="picked" v-if="file">
        <p class="picked-name">{{ file.name }}</p>
        <p class="picked-meta">{{ sizeText }} &middot; will be titled &ldquo;{{ titleGuess }}&rdquo;</p>
        <p class="warn" v-if="heavy">Large file &mdash; this can take a while and use a lot of memory.</p>

        <p class="error" v-if="preflightError">{{ preflightError.message }}</p>
        <p class="hint" v-if="preflightError">{{ preflightError.hint }}</p>

        <div class="row" v-if="!preflightError && !busy">
          <button class="btn primary" :disabled="!startable" @click="start">Import</button>
        </div>
      </div>

      <div class="progress" v-if="busy">
        <p class="stage">{{ stageLabel }}</p>
        <div class="bar" :class="{ indeterminate: percent === null }">
          <div class="fill" :style="fillStyle"></div>
        </div>
        <p class="pct" v-if="percent !== null">{{ Math.round(percent) }}%</p>
        <div class="row">
          <button class="btn ghost" @click="cancel">Cancel</button>
        </div>
      </div>
    </section>

    <!-- 成功 -->
    <section class="card outcome" v-if="step === IMPORT_STEP.DONE">
      <h2>{{ result.existed ? 'Already on your shelf' : 'Added to your shelf' }}</h2>
      <p class="outcome-title">{{ result.title }}</p>
      <p class="outcome-meta">{{ result.chapterCount }} chapters</p>
      <div class="row">
        <router-link class="btn primary" :to="`/reader/${result.id}`">Read it</router-link>
        <button class="btn ghost" @click="resetAll">Add another</button>
      </div>
      <p class="hint">
        This book lives on this device only. There is no recorded audio &mdash; the player falls back to
        your browser&rsquo;s voice.
      </p>
    </section>

    <!-- 失败 -->
    <section class="card outcome error-state" v-if="step === IMPORT_STEP.ERROR">
      <h2>Could not import this file</h2>
      <p class="outcome-title">{{ error.message }}</p>
      <p class="hint">{{ error.hint }}</p>
      <p class="code" v-if="error.code">{{ error.code }}</p>
      <div class="row">
        <button class="btn primary" @click="resetOutcome">Try another file</button>
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
  recordFromBook,
  stepText,
  stripExt
} from '../utils/importFlow.js'

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

function pickFile() {
  if (!consent.value) return
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
      return
    }

    const meta = await saveBook(recordFromBook(book))
    result.value = { ...meta, existed: false }
    step.value = IMPORT_STEP.DONE
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
</style>
