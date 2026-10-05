<template>
  <div v-if="open" class="note-editor-overlay" @click.self="$emit('close')">
    <div class="note-editor" role="dialog" aria-modal="true" aria-label="这条划线">
      <div class="ne-head">
        <span>这条划线</span>
        <button class="ne-close" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>

      <div class="ne-quote">{{ quote }}</div>

      <div class="ne-row">
        <div class="ne-label">颜色</div>
        <div class="ne-colors">
          <button
            v-for="c in NOTE_COLORS" :key="c"
            class="ne-color" :class="['c-' + c, { on: draftColor === c }]"
            :title="c" @click="draftColor = c"
          ></button>
        </div>
      </div>

      <textarea
        v-model="draftText"
        class="ne-text"
        rows="3"
        placeholder="写点什么（可留空，只做划线）"
      ></textarea>

      <div class="ne-foot">
        <button v-if="mode === 'edit'" class="ne-btn" @click="$emit('delete')">删除</button>
        <button class="ne-btn primary" @click="save">{{ mode === 'edit' ? '保存' : '添加' }}</button>
        <small class="ne-status">{{ status }}</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { NOTE_COLORS, DEFAULT_NOTE_COLOR, isNoteColor } from '../utils/notes.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'new' },
  quote: { type: String, default: '' },
  text: { type: String, default: '' },
  color: { type: String, default: DEFAULT_NOTE_COLOR },
  status: { type: String, default: '' }
})

const emit = defineEmits(['save', 'delete', 'close'])

const draftText = ref('')
const draftColor = ref(DEFAULT_NOTE_COLOR)

// 每次「打开」才从 props 重置草稿：开着的时候用户在打字，
// 不能因为父组件刷新（比如别的笔记同步进来）把输入抹掉。
watch(() => props.open, (open) => {
  if (!open) return
  draftText.value = props.text || ''
  draftColor.value = isNoteColor(props.color) ? props.color : DEFAULT_NOTE_COLOR
}, { immediate: true })

function save() { emit('save', { text: draftText.value, color: draftColor.value }) }
</script>

<style scoped>
.note-editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 310;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.note-editor {
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  width: 100%;
  max-width: 460px;
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--border-color, #d2d2d7);
  border-bottom: none;
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
  padding: 14px 16px calc(16px + env(safe-area-inset-bottom));
}

@media (min-width: 520px) {
  .note-editor-overlay { align-items: center; }
  .note-editor { border-radius: 16px; border-bottom: 1px solid var(--border-color, #d2d2d7); }
}

.ne-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 15px;
}

.ne-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #6e6e73);
}

.ne-quote {
  background: var(--bg-secondary, #f5f5f7);
  border-left: 3px solid var(--accent-color, #1a73e8);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13.5px;
  line-height: 1.6;
  margin: 6px 0 2px;
}

.ne-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.ne-label {
  flex: 0 0 40px;
  font-size: 12.5px;
  color: var(--text-secondary, #6e6e73);
}

.ne-colors { display: flex; gap: 8px; }

.ne-color {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.25);
  cursor: pointer;
  padding: 0;
}

.ne-color.on { outline: 2px solid var(--accent-color, #1a73e8); outline-offset: 1px; }

.ne-color.c-yellow { background: #f6d365; }
.ne-color.c-green { background: #8fd19e; }
.ne-color.c-blue { background: #8ec5f0; }
.ne-color.c-pink { background: #f3a7bd; }

.ne-text {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #1d1d1f);
  padding: 8px 10px;
  font-size: 13.5px;
  font-family: inherit;
}

.ne-foot {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ne-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: transparent;
  color: var(--text-primary, #1d1d1f);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.ne-btn.primary {
  background: var(--accent-color, #1a73e8);
  border-color: var(--accent-color, #1a73e8);
  color: #fff;
}

.ne-status {
  color: var(--text-secondary, #6e6e73);
  font-size: 11.5px;
}
</style>
