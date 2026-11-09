<template>
  <div class="legal-view">
    <!-- 占位页：UI-35 的「/legal」先给位，条款待法律审阅后再落 —— 这里不写任何具体承诺 -->
    <section class="card">
      <h2 class="card-title">法律与隐私</h2>
      <p class="hint">
        本页为占位页；隐私政策与服务条款待法律审阅后补全。在此之前，本页不构成任何条款承诺。
      </p>
      <button class="btn" @click="goBack">返回</button>
    </section>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

function goBack() {
  router.push('/account')
}
</script>

<style scoped>
.legal-view {
  padding: 16px;
  max-width: 520px;
  margin: 0 auto;
}

.card {
  background: var(--bg-secondary, #f7f7f9);
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 12px;
  padding: 16px;
}

.card-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
}

.btn {
  margin-top: 16px;
  width: 100%;
  padding: 11px 16px;
  font-size: 15px;
  border: 1px solid var(--border-color, #d2d2d7);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1d1d1f);
  cursor: pointer;
}
</style>
