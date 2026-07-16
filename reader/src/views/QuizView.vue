<template>
  <div class="quiz-view">
    <div class="placeholder-view">
      <div class="placeholder-icon">✅</div>
      <h2>Quiz</h2>
      <p>Multiple choice & fill-in-the-blank — coming in Phase 7.</p>
    </div>
  </div>
</template>

<style scoped>
.quiz-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}

.placeholder-view {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-secondary, #6e6e73);
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.placeholder-view h2 {
  margin: 0 0 8px;
  color: var(--text-primary, #1d1d1f);
}
</style>
