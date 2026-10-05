<template>
  <div v-if="open" class="notes-overlay" @click.self="$emit('close')">
    <div class="notes-sheet" role="dialog" aria-modal="true" aria-label="划线笔记">
      <div class="np-head">
        <span>划线笔记 <small class="np-count">共 {{ total }} 条</small></span>
        <button class="np-close" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- 缺书占位（9.4）：书不在本机，笔记跟着账号来了 -->
      <p v-if="missing" class="np-missing">
        <span class="np-missing-tag">书不在本机</span>
        《{{ missingTitle }}》需要先导入该书 —— 笔记已经同步过来了，导入同一本书后划线会自动接上（不用重新划）。
      </p>

      <p v-if="!total" class="np-empty">
        还没有划线。选中正文任意一段文字试试 —— 桌面拖选 / 手机长按选中，松手后选颜色即可。
      </p>

      <div v-else class="np-list">
        <section v-for="g in groups" :key="g.chapterId" class="np-group">
          <div class="np-chapter">{{ g.title }}</div>
          <article v-for="n in g.notes" :key="n.id" class="np-item">
            <div class="np-line">
              <span class="np-chip" :class="chipClass(n)">{{ chipText(n) }}</span>
              <span class="np-quote" :class="'q-' + n.color">&ldquo;{{ n.quote }}&rdquo;</span>
            </div>
            <div v-if="n.text" class="np-note">{{ n.text }}</div>
            <div v-else class="np-note np-mut">（只划线，没写字）</div>
            <div class="np-meta">{{ metaText(n, g.title) }}</div>
            <div class="np-actions">
              <button v-if="!missing" class="np-btn" @click="$emit('jump', n)">跳转</button>
              <button class="np-btn" @click="$emit('edit', n)">编辑</button>
              <button class="np-btn" @click="$emit('remove', n)">删除</button>
            </div>
          </article>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
  /** [{chapterId, title, notes: [{...note, status}]}]，由 groupNotesByChapter 产出 */
  groups: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  /** 缺书（9.4）：正文不在本机，锚点无从判读 —— 全部标「本机无法解析」，且不给跳转 */
  missing: { type: Boolean, default: false },
  /** missing 时占位行里显示的书名（取笔记里的 bookTitle 快照） */
  missingTitle: { type: String, default: '' }
})

defineEmits(['close', 'jump', 'edit', 'remove'])

function statusText(kind) {
  if (kind === 'ok') return '锚点精确'
  if (kind === 'moved') return '已跟随重解析'
  return '锚点失效 · 段落级'
}

/** 状态 chip：缺书时一律「本机无法解析」（书的正文都不在，谈不上锚点准不准） */
function chipText(n) { return props.missing ? '本机无法解析' : statusText(n.status) }
function chipClass(n) { return props.missing ? 'st-missing' : 'st-' + n.status }

/** 缺书时章表没读上来，章标题不可信 —— 退回 chapterId + paraId + 段内区间 */
function metaText(n, title) {
  return props.missing
    ? title + ' · ' + n.paraId + ' · ' + n.charStart + '–' + n.charEnd
    : title + ' · 第 ' + n.charStart + '–' + n.charEnd + ' 字'
}
</script>

<style scoped>
.notes-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 300;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.notes-sheet {
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  width: 100%;
  max-width: 560px;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--border-color, #d2d2d7);
  border-bottom: none;
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
  padding: 14px 16px calc(12px + env(safe-area-inset-bottom));
}

@media (min-width: 520px) {
  .notes-overlay { align-items: center; }
  .notes-sheet { border-radius: 16px; border-bottom: 1px solid var(--border-color, #d2d2d7); max-height: 72vh; }
}

.np-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 15px;
  flex: 0 0 auto;
}

.np-count { color: var(--text-secondary, #6e6e73); font-weight: 400; font-size: 12px; }

.np-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #6e6e73);
}

.np-empty {
  margin: 12px 0 4px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-secondary, #6e6e73);
}

.np-list { overflow: auto; margin-top: 8px; }

.np-chapter {
  position: sticky;
  top: 0;
  background: var(--bg-primary, #fff);
  padding: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary, #6e6e73);
  border-bottom: 1px solid var(--border-color, #d2d2d7);
}

.np-item {
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--border-color, #d2d2d7);
}

.np-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }

.np-chip {
  flex: 0 0 auto;
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
  background: var(--bg-secondary, #f5f5f7);
  color: var(--text-secondary, #6e6e73);
  border: 1px solid var(--border-color, #d2d2d7);
}

.np-chip.st-ok { background: rgba(52, 199, 89, 0.14); color: #1f7a3a; border-color: rgba(52, 199, 89, 0.4); }
.np-chip.st-moved { background: rgba(26, 115, 232, 0.14); color: #14509e; border-color: rgba(26, 115, 232, 0.4); }
.np-chip.st-lost { background: rgba(255, 149, 0, 0.16); color: #9a5b00; border-color: rgba(255, 149, 0, 0.45); }

.np-quote { font-size: 14px; line-height: 1.5; }
.np-quote.q-yellow { box-shadow: inset 0 -0.7em 0 #f6d365; }
.np-quote.q-green { box-shadow: inset 0 -0.7em 0 #8fd19e; }
.np-quote.q-blue { box-shadow: inset 0 -0.7em 0 #8ec5f0; }
.np-quote.q-pink { box-shadow: inset 0 -0.7em 0 #f3a7bd; }

.np-note { margin-top: 4px; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
.np-mut { color: var(--text-secondary, #6e6e73); }
.np-meta { margin-top: 4px; font-size: 11.5px; color: var(--text-secondary, #6e6e73); }

.np-actions { margin-top: 8px; display: flex; gap: 8px; }

.np-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: transparent;
  color: var(--text-primary, #1d1d1f);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12.5px;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .np-quote.q-yellow { box-shadow: inset 0 -0.7em 0 #6d5a1f; }
  .np-quote.q-green { box-shadow: inset 0 -0.7em 0 #24502f; }
  .np-quote.q-blue { box-shadow: inset 0 -0.7em 0 #1e3f5c; }
  .np-quote.q-pink { box-shadow: inset 0 -0.7em 0 #5b2b3a; }
}

.np-missing {
  margin: 10px 0 2px;
  padding: 9px 11px;
  border-radius: 8px;
  background: rgba(255, 149, 0, 0.12);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-primary, #1d1d1f);
}

.np-missing-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #c9821f;
  color: #fff;
  font-size: 11px;
}

.np-chip.st-missing {
  background: rgba(120, 120, 128, 0.16);
  color: #4a4a4f;
  border-color: rgba(120, 120, 128, 0.4);
}
</style>
