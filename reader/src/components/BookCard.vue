<template>
  <!-- 外包一层是为了放「删书」按钮与「生成音频」入口：button / a 不能嵌在 a 里（iOS Safari 上会
       连导航一起触发）。卡片本身仍是那棵 router-link，其余书的样式与栅格高度都不变。 -->
  <div class="book-card-wrap">
    <router-link :to="`/reader/${book.id}`" class="book-card">
      <div class="book-cover" v-if="coverSrc">
        <img :src="coverSrc" :alt="book.title" loading="lazy" />
      </div>
      <div class="book-cover placeholder" v-else>
        <span>📖</span>
      </div>
      <div class="book-info">
        <h3 class="book-title">{{ book.title }}</h3>
        <p class="book-author" v-if="book.author">{{ book.author }}</p>
        <!-- 「我的书架」栏里自带书不给来源提示时，用户会以为它上了云 -->
        <p class="book-kind" v-if="book.kind === 'byo'">Your book</p>
      </div>
    </router-link>
    <!-- 书级生成入口（第 17 步块 D-3 ／ D21-b・f）：只对自带书、且三态由父级算好传进来
         —— 判定与文案都在 `utils/genApi.js`（genEntryState），本组件只负责画。
         未登录那一态也走这里：`to` 由父级指到账号页（D21-j 引导登录）。 -->
    <router-link
      v-if="gen"
      class="book-gen"
      :class="'book-gen-' + gen.kind"
      :to="gen.to"
    >{{ gen.label }}</router-link>
    <!-- 只对自带书出删除（公开书库那栏删不了） -->
    <button
      v-if="removable && book.kind === 'byo'"
      type="button"
      class="book-remove"
      :title="`Remove ${book.title}`"
      :aria-label="`Remove ${book.title}`"
      @click="$emit('remove', book)"
    >✕</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  book: { type: Object, required: true },
  /** 要不要出「删书」按钮（第 16 步块 4）—— 公开书库那栏传 false（默认） */
  removable: { type: Boolean, default: false },
  /**
   * 生成入口（第 17 步块 D-3）：`{ kind, label, to }`（`genEntryState` 的结果 ＋ 父级补的 `to`）。
   * `null` ＝ 不给入口（公开书、或这本书没资格）。本组件**不判定**，只画。
   */
  gen: { type: Object, default: null }
})

defineEmits(['remove'])

// book-index.json 里的 coverUrl 是站点相对路径（books/<id>/cover.svg）。
// 将来 BASE_URL 若从 '/' 挪回子路径，这里跟着走，不会指到域名根上。
const coverSrc = computed(() => {
  const url = String(props.book?.coverUrl || '').trim()
  if (!url) return ''
  if (/^(https?:|data:|blob:|\/)/.test(url)) return url
  return `${import.meta.env.BASE_URL}${url}`
})
</script>

<style scoped>
.book-card-wrap {
  position: relative;
  display: flex;
  /* 竖排：卡片在上、生成入口在下；卡片仍**撑满整格高度**（`flex: 1 1 auto`），
     于是同一行里的入口底边对齐 —— 与改版前「卡片填满一格」的观感一致。 */
  flex-direction: column;
}

.book-card-wrap .book-card {
  flex: 1 1 auto;
}

/* 生成入口：贴在卡片下方，与卡片同宽（栅格里一格宽）；三态用左侧那道色条区分 */
.book-gen {
  display: block;
  margin-top: 6px;
  padding: 5px 8px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-left: 3px solid var(--accent-color, #1a73e8);
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--accent-color, #1a73e8);
  font-size: 12px;
  line-height: 1.35;
  text-decoration: none;
}

.book-gen:hover {
  border-color: var(--accent-color, #1a73e8);
}

/* 有章在排队／跑：左边色条换成暖色，一眼能看出「这台正在干活」 */
.book-gen-busy {
  border-left-color: #c9821f;
  color: #8a5a12;
}

/* 未登录：引导登录那一格不抢视觉，但句子要读得清 */
.book-gen-login {
  border-left-color: var(--border-color, #e5e5e5);
  color: var(--text-secondary, #6e6e73);
}

.book-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.book-remove:hover {
  background: var(--danger-color, #d92d20);
}

.book-card {
  text-decoration: none;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary, #f5f5f5);
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.book-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.book-cover {
  aspect-ratio: 2 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8e0d5;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover.placeholder span {
  font-size: 40px;
}

.book-info {
  padding: 12px;
}

.book-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text-primary, #1d1d1f);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-author {
  font-size: 13px;
  color: var(--text-secondary, #6e6e73);
  margin: 0;
}

.book-kind {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}
</style>
