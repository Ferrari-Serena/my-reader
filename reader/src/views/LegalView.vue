<template>
  <div class="legal-view">
    <button v-if="view !== 'home'" class="back" type="button" @click="view = 'home'">← 法律与帮助</button>

    <!-- A · 三入口 -->
    <template v-if="view === 'home'">
      <p class="lead">用户协议、隐私说明与侵权投诉入口集中在本页。</p>

      <button class="entry" type="button" @click="openDoc('terms')">
        <span class="ic" aria-hidden="true"></span>
        <span class="main"><span class="t">用户协议</span><span class="s">使用本产品前请阅读</span></span>
        <span class="arrow">›</span>
      </button>

      <button class="entry" type="button" @click="openDoc('privacy')">
        <span class="ic" aria-hidden="true"></span>
        <span class="main"><span class="t">隐私说明</span><span class="s">我们收集什么、为什么、留多久</span></span>
        <span class="arrow">›</span>
      </button>

      <button class="entry" type="button" @click="openComplaint">
        <span class="ic" aria-hidden="true"></span>
        <span class="main"><span class="t">侵权投诉</span><span class="s">权利人提交投诉与处理进度</span></span>
        <span class="arrow">›</span>
      </button>

      <p class="note">正文为静态占位，法务定稿后随版本更新；投诉提交需联网。</p>
      <p class="ver">
        版本与生效日期：上线前由法务定稿，正文标「草稿 v0」<br>
        投诉受理时限与服务承诺：待 LG 定
      </p>
    </template>

    <!-- B · 协议／隐私正文（占位，不写条款） -->
    <template v-else-if="view === 'doc'">
      <div class="segs">
        <button type="button" :class="['seg', { on: doc === 'terms' }]" @click="doc = 'terms'">用户协议</button>
        <button type="button" :class="['seg', { on: doc === 'privacy' }]" @click="doc = 'privacy'">隐私说明</button>
      </div>
      <p class="draft">草稿 v0 · 未经法务定稿</p>
      <h2 class="dh2">{{ doc === 'terms' ? '用户协议' : '隐私说明' }}</h2>
      <p class="meta2">版本 v0 · 生效日期待定 · 正文为静态占位</p>
      <div class="pline"></div>
      <div class="pline m"></div>
      <div class="pline s"></div>
      <div class="pline"></div>
      <div class="pline m"></div>
      <div class="pline s"></div>
      <div class="pline"></div>
      <p class="sub2">正文待法务定稿。本页仅占位，不构成任何条款承诺。</p>
    </template>

    <!-- C · 侵权投诉表单 -->
    <template v-else-if="view === 'complaint'">
      <p class="lead">权利人可在此提交投诉；提交后生成回执。</p>

      <label class="fl2">分类</label>
      <select class="fld" disabled>
        <option>{{ COMPLAINT_CATEGORY }}</option>
      </select>

      <label class="fl2" for="cp-body">投诉正文</label>
      <textarea id="cp-body" v-model="body" class="fld area" placeholder="请写明作品、侵权链接与具体情况"></textarea>

      <label class="fl2" for="cp-contact">联系方式</label>
      <input id="cp-contact" v-model.trim="contact" class="fld" placeholder="邮箱或电话，用于回复" />

      <label class="cbox">
        <input v-model="agreed" type="checkbox" />
        <span>我确认所述情况属实，并同意按此联系方式接收回复</span>
      </label>

      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn p" type="button" :disabled="busy" @click="submit">{{ busy ? '提交中…' : '提交投诉' }}</button>
      <p class="sub2">本版按「其他」登记；分类口径、受理时限与服务承诺待 LG 定。</p>
    </template>

    <!-- D · 回执 -->
    <template v-else>
      <div class="cent">
        <div class="okart" aria-hidden="true">✓</div>
        <h2 class="dh2">投诉已提交</h2>
        <p class="meta2">
          <template v-if="receipt">回执编号：{{ receipt }}<br>请保留回执号，便于后续查询</template>
          <template v-else>已提交，但回执编号暂未取得；可稍后在「反馈」里查看记录。</template>
        </p>
        <button class="btn" type="button" @click="view = 'home'">返回法律与帮助</button>
        <p class="sub2">回执只表示已收到，不代表受理结论。回复时限：待 LG 定。</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { submitFeedback, ensureAnonKey, fetchMyFeedback, buildContext } from '../utils/feedback.js'
import {
  COMPLAINT_CATEGORY, composeComplaintMessage, complaintProblem, receiptNumber, receiptFromItems,
} from '../utils/legalView.js'

const view = ref('home') // home | doc | complaint | receipt
const doc = ref('terms')
const body = ref('')
const contact = ref('')
const agreed = ref(false)
const busy = ref(false)
const error = ref('')
const receipt = ref('')

function openDoc(kind) {
  doc.value = kind
  view.value = 'doc'
}

function openComplaint() {
  error.value = ''
  view.value = 'complaint'
}

async function submit() {
  error.value = ''
  const p = complaintProblem({ body: body.value, contact: contact.value, agreed: agreed.value })
  if (p) { error.value = p; return }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    error.value = '离线不可提交，请联网后重试。'
    return
  }

  busy.value = true
  try {
    const key = ensureAnonKey()
    const r = await submitFeedback({
      category: 'other',
      message: composeComplaintMessage({ body: body.value, category: COMPLAINT_CATEGORY }),
      contact: contact.value,
      key,
      context: buildContext({ route: '/legal' }),
    })
    if (!r.ok) {
      error.value = r.reason === 'bad-draft'
        ? '内容未通过校验，请检查后再试。'
        : (r.status === 429 ? '提交太频繁，请稍后再试。' : '提交失败，请稍后再试。')
      return
    }
    let id = 0
    try {
      const mine = await fetchMyFeedback({ key })
      id = receiptFromItems(mine.items)
    } catch { /* 取不到回执号也不谎报 */ }
    receipt.value = receiptNumber(id, Date.now())
    body.value = ''
    contact.value = ''
    agreed.value = false
    view.value = 'receipt'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.legal-view {
  max-width: 390px;
  margin: 0 auto;
  padding: 12px 14px 32px;
  background: #fff;
  color: #333;
  font-size: 13px;
  line-height: 1.55;
}
.back {
  padding: 0;
  margin: 0 0 10px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 11px;
  color: #333;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.lead { margin: 2px 0 12px; font-size: 12px; color: #666; }

.entry {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  margin-bottom: 2px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid #e5e5e5;
  background: #fff;
  text-align: left;
  font: inherit;
  color: #333;
  cursor: pointer;
}
.ic {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: 1px solid #999;
  border-radius: 2px;
  background: #f5f5f5;
}
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.main .t { font-size: 12px; color: #000; font-weight: 600; }
.main .s { font-size: 10px; color: #666; }
.arrow { font-size: 16px; color: #666; }

.note {
  margin: 14px 0 0;
  padding: 8px 10px;
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  font-size: 10px;
  color: #666;
}
.ver { margin: 10px 0 0; font-size: 10px; color: #666; line-height: 1.7; }

.segs { display: flex; border: 1px solid #333; border-radius: 3px; overflow: hidden; }
.seg {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-right: 1px solid #333;
  background: #fff;
  color: #333;
  font: inherit;
  font-size: 12px;
}
.seg:last-child { border-right: 0; }
.seg.on { background: #000; color: #fff; }
.draft {
  margin: 12px 0 6px;
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid #999;
  border-radius: 3px;
  font-size: 10px;
  color: #333;
  background: #f5f5f5;
}
.dh2 { margin: 4px 0 2px; font-size: 16px; color: #000; font-weight: 600; }
.meta2 { margin: 0 0 12px; font-size: 10px; color: #666; line-height: 1.7; }
.pline { height: 10px; background: #e5e5e5; border-radius: 2px; margin-bottom: 8px; }
.pline.m { width: 92%; }
.pline.s { width: 68%; }
.sub2 { margin: 10px 0 0; font-size: 10px; color: #666; line-height: 1.7; }

.fl2 { display: block; margin: 12px 0 5px; font-size: 11px; color: #000; font-weight: 600; }
.fld {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid #999;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font: inherit;
  font-size: 12px;
}
.fld:disabled { background: #f5f5f5; color: #666; }
.area { min-height: 96px; padding: 10px; line-height: 1.6; resize: vertical; }
.cbox { display: flex; gap: 8px; margin: 12px 0 0; font-size: 10px; color: #333; line-height: 1.6; }
.cbox input { width: 16px; height: 16px; margin-top: 1px; }
.err { margin: 10px 0 0; font-size: 11px; color: #000; font-weight: 600; }

.btn {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  border: 1px solid #999;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font: inherit;
  font-size: 12px;
}
.btn.p { background: #000; border-color: #000; color: #fff; }
.btn:disabled { opacity: 0.55; }

.cent { text-align: center; padding-top: 10px; }
.okart {
  width: 48px;
  height: 48px;
  margin: 16px auto 12px;
  border: 1px solid #000;
  border-radius: 3px;
  font-size: 24px;
  line-height: 46px;
  color: #000;
}
</style>
