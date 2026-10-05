<template>
  <div v-if="open" class="settings-overlay" @click.self="$emit('close')">
    <div class="settings-sheet" role="dialog" aria-modal="true" aria-label="阅读设置">
      <div class="sheet-header">
        <span>阅读设置</span>
        <button class="sheet-close" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>

      <div class="setting-row">
        <div class="setting-label">字号</div>
        <div class="seg">
          <button
            v-for="o in FONT_SIZE_OPTIONS"
            :key="'fs-' + o.value"
            :class="['seg-btn', { on: settings.fontSize === o.value }]"
            @click="$emit('change', { key: 'fontSize', value: o.value })"
          >{{ o.label }}</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-label">行距</div>
        <div class="seg">
          <button
            v-for="o in LINE_HEIGHT_OPTIONS"
            :key="'lh-' + o.value"
            :class="['seg-btn', { on: settings.lineHeight === o.value }]"
            @click="$emit('change', { key: 'lineHeight', value: o.value })"
          >{{ o.label }}</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-label">页宽</div>
        <div class="seg">
          <button
            v-for="o in PAGE_WIDTH_OPTIONS"
            :key="'w-' + o.value"
            :class="['seg-btn', { on: settings.pageWidth === o.value }]"
            @click="$emit('change', { key: 'pageWidth', value: o.value })"
          >{{ o.label }}</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-label">字体</div>
        <div class="seg">
          <button
            v-for="o in FONT_FAMILY_OPTIONS"
            :key="'ff-' + o.value"
            :class="['seg-btn', { on: settings.fontFamily === o.value }]"
            @click="$emit('change', { key: 'fontFamily', value: o.value })"
          >{{ o.label }}</button>
        </div>
      </div>

      <div class="sheet-footer">
        <button class="reset-btn" @click="$emit('reset')">恢复默认</button>
        <small class="sheet-note">改完立即生效，存在本机并随账号同步。</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  FONT_SIZE_OPTIONS, LINE_HEIGHT_OPTIONS, PAGE_WIDTH_OPTIONS, FONT_FAMILY_OPTIONS,
} from '../utils/readerSettings.js'

defineProps({
  open: { type: Boolean, default: false },
  // 归一化后的四项设置；null = 该项未设置（沿用各屏默认）
  settings: { type: Object, default: () => ({}) }
})

defineEmits(['close', 'change', 'reset'])
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 300;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}

.settings-sheet {
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
  .settings-overlay { align-items: center; }
  .settings-sheet { border-radius: 16px; border-bottom: 1px solid var(--border-color, #d2d2d7); }
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 6px;
}

.sheet-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #6e6e73);
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--border-color, #d2d2d7);
}

.setting-label {
  flex: 0 0 40px;
  font-size: 12.5px;
  color: var(--text-secondary, #6e6e73);
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.seg-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: transparent;
  color: var(--text-primary, #1d1d1f);
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  min-width: 46px;
}

.seg-btn.on {
  background: var(--accent-color, #1a73e8);
  border-color: var(--accent-color, #1a73e8);
  color: #fff;
  font-weight: 600;
}

.sheet-footer {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.reset-btn {
  border: 1px solid var(--border-color, #d2d2d7);
  background: transparent;
  color: var(--text-primary, #1d1d1f);
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}

.sheet-note {
  color: var(--text-secondary, #6e6e73);
  font-size: 11.5px;
}
</style>
