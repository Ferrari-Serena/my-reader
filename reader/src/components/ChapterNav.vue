<template>
  <div class="chapter-nav top-nav">
    <div class="nav-row">
      <button
        class="nav-btn"
        :disabled="currentIndex <= 0"
        @click="$emit('prev')"
      >
        ← Previous
      </button>

      <button
        class="nav-btn toc-btn"
        @click="showToc = !showToc"
      >
        ☰ {{ currentIndex + 1 }} / {{ total }}
      </button>

      <button
        class="nav-btn"
        :disabled="currentIndex >= total - 1"
        @click="$emit('next')"
      >
        Next →
      </button>
    </div>

    <!-- Current chapter indicator（右侧 Aa：阅读设置入口，只有顶部那个 nav 显示） -->
    <div class="label-row">
      <div class="current-chapter-label">
        {{ chapterTitle }}
      </div>
      <button
        v-if="showNotes"
        class="nav-btn notes-btn"
        title="划线笔记"
        aria-haspopup="dialog"
        @click="$emit('notes')"
      >Notes <span class="notes-count">{{ notesCount }}</span></button>
      <button
        v-if="showSettings"
        class="nav-btn aa-btn"
        title="阅读设置"
        aria-haspopup="dialog"
        @click="$emit('settings')"
      >Aa</button>
    </div>

    <!-- TOC Dropdown -->
    <div v-if="showToc" class="toc-overlay" @click.self="showToc = false">
      <div class="toc-dropdown">
        <div class="toc-header">
          <span>{{ bookTitle }}</span>
          <button class="toc-close" @click="showToc = false">✕</button>
        </div>
        <div class="toc-list">
          <button
            v-for="(ch, i) in tocItems"
            :key="ch.id"
            :class="['toc-item', { active: i === currentIndex }]"
            @click="selectChapter(i)"
          >
            <span class="toc-num">{{ i + 1 }}</span>
            <span class="toc-title">{{ ch.title }}</span>
            <span
              v-if="missingAudio[ch.id]"
              class="toc-noaudio"
              :title="noAudioTooltip(missingAudio[ch.id])"
            >🔇 {{ noAudioLabel(missingAudio[ch.id]) }}</span>
            <span class="toc-check" v-if="i === currentIndex">●</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { noAudioLabel, noAudioTooltip } from '../utils/audioIndex.js'

const props = defineProps({
  currentIndex: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  chapterTitle: { type: String, default: '' },
  bookTitle: { type: String, default: '' },
  tocItems: { type: Array, default: () => [] },
  // 章 id → 无音频原因（生成端 audio-index.json）；空对象 = 不标
  missingAudio: { type: Object, default: () => ({}) },
  // 是否显示「Aa」阅读设置入口（只顶部 nav 传 true；底部那个不传）
  showSettings: { type: Boolean, default: false },
  // 是否显示「Notes」划线笔记入口（同上，只顶部 nav）
  showNotes: { type: Boolean, default: false },
  notesCount: { type: Number, default: 0 }
})

const emit = defineEmits(['prev', 'next', 'jump', 'settings', 'notes'])

const showToc = ref(false)

function selectChapter(index) {
  emit('jump', index)
  showToc.value = false
}
</script>

<style scoped>
.chapter-nav {
  padding: 12px 0;
}

.nav-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.nav-btn {
  padding: 8px 16px;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary, #1d1d1f);
  cursor: pointer;
  transition: opacity 0.2s;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.nav-btn:not(:disabled):hover {
  background: var(--accent-color, #1a73e8);
  color: white;
  border-color: var(--accent-color, #1a73e8);
}

.toc-btn {
  min-width: 80px;
}

.label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.current-chapter-label {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aa-btn {
  flex: 0 0 auto;
  padding: 4px 10px;
  font-weight: 700;
  line-height: 1;
}

.notes-btn {
  flex: 0 0 auto;
  padding: 4px 10px;
  font-size: 12.5px;
  line-height: 1;
}

.notes-count {
  color: var(--text-secondary, #6e6e73);
  margin-left: 2px;
}

.toc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}

.toc-dropdown {
  background: var(--bg-primary, #fff);
  border-radius: 16px 16px 0 0;
  max-height: 70vh;
  width: 100%;
  max-width: 500px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.toc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #d2d2d7);
  font-weight: 600;
}

.toc-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary, #6e6e73);
}

.toc-list {
  overflow-y: auto;
  padding: 8px 0;
}

.toc-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 15px;
  color: var(--text-primary, #1d1d1f);
  text-align: left;
  transition: background 0.15s;
}

.toc-item:hover {
  background: var(--bg-secondary, #f5f5f7);
}

.toc-item.active {
  background: var(--highlight-bg, #fff8e1);
  font-weight: 600;
}

.toc-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-secondary, #f5f5f7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.toc-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-check {
  color: var(--accent-color, #1a73e8);
  font-size: 10px;
}

.toc-noaudio {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary, #6e6e73);
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}
</style>
