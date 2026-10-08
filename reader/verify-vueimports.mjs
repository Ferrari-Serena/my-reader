/**
 * 组件卫生闸 —— `src/**` 里调用的 Vue API，必须在本文件从 'vue' import 过（不依赖浏览器、不触网）。
 *
 * 为什么单开一条：`vite build` 不做类型检查，单测也不挂载视图组件 ——
 * 「用了 `onBeforeUnmount`／`watch` 却没 import」能一路过关、到线上才现形：
 * setup 抛 ReferenceError → 整页空白，且路由被这个错卡死、切别的 tab 也不动，看起来就是「网页打不开」。
 * （2026-10-09 实案：0823b05 把落地页 `#/books` 打白，热修 6440895。）
 *
 * 判据只有三条，别的不管：
 *   1. 被调用（`name(`）、不是成员调用（`o.name(`）、不在注释里；
 *   2. 该名字不在本文件的 `import { … } from 'vue'` 里；
 *   3. 该名字在 VUE_API 名单里 —— **编译器宏不在名单里**（defineProps／defineEmits／
 *      defineExpose／defineOptions／defineSlots／defineModel／withDefaults 由编译器注入，不用 import）。
 *
 * 已知边界：`import * as vue from 'vue'` 那种 `vue.watch(...)` 的写法不在判定内（本项目没有这种写法）；
 * `import { ref as rv }` 改名后只按本地名 rv 用得对就行（名单按原名找，不会误报）。
 * 用法: node verify-vueimports.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}

// ═══ 名单：需要 import 的 Vue 3 API ═══
// 只收「写成裸调用就必须有 import」的名字。编译器宏**不收**（收了会逼人去加假 import）。
const VUE_API = [
  // 响应式
  'ref', 'shallowRef', 'reactive', 'shallowReactive', 'readonly', 'shallowReadonly',
  'computed', 'customRef', 'toRef', 'toRefs', 'toValue', 'unref', 'triggerRef',
  'isRef', 'isReactive', 'isReadonly', 'isProxy', 'markRaw', 'toRaw',
  // 侦听 / 副作用域
  'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect',
  'effectScope', 'getCurrentScope', 'onScopeDispose', 'nextTick',
  // 生命周期
  'onBeforeMount', 'onMounted', 'onBeforeUpdate', 'onUpdated',
  'onBeforeUnmount', 'onUnmounted', 'onActivated', 'onDeactivated',
  'onErrorCaptured', 'onRenderTracked', 'onRenderTriggered', 'onServerPrefetch',
  // 依赖注入 / 上下文
  'provide', 'inject', 'hasInjectionContext', 'getCurrentInstance',
  'useAttrs', 'useSlots', 'useTemplateRef', 'useId',
  // 组件 / 渲染
  'defineComponent', 'defineAsyncComponent', 'createApp',
  'h', 'mergeProps', 'cloneVNode', 'isVNode',
  'resolveComponent', 'resolveDirective', 'withDirectives',
]

// 名单自证用：编译器宏（必须**不在**名单里）
const COMPILER_MACROS = [
  'defineProps', 'defineEmits', 'defineExpose', 'defineOptions',
  'defineSlots', 'defineModel', 'withDefaults',
]

// ── 去注释：块注释 ＋ 行注释。行注释只在「行首」或「前面是空白／分隔符」时才算，
//    这样 `'https://a.com'` 里的 `//` 不会被当成注释（那是本闸最容易假红的地方）。
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\s;{}()])\/\/[^\n]*/gm, '$1')
}

// ── 本文件从 'vue' 引了哪些名字（`as` 改名取本地名）
function vueLocalNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/g)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim()
      if (!part) continue
      const asM = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(part)
      names.add(asM ? asM[2] : part.replace(/\s+/g, ''))
    }
  }
  return names
}

// ── 判定主体（纯函数：好拿合成样本喂它，闸才咬得动自己）
function findMissingVueApis(code) {
  const src = stripComments(code)
  const imported = vueLocalNames(src)
  const missing = []
  for (const api of VUE_API) {
    // 前面不能是 `\w`（别的标识符的尾巴）或 `.`（成员调用 `o.watch(`）
    if (!new RegExp(String.raw`(?<![\w.$])${api}\s*\(`).test(src)) continue
    if (imported.has(api)) continue
    missing.push(api)
  }
  return missing
}

// ═══ 1. 闸咬自己：注入故障这一向 ═══
console.log('\n[组件卫生 — 闸咬自己（故意注入故障：三种写法都要抓得住，四种不该报的都不许红）]')

// ① 真实 bug 形状：0823b05 的 BookListView —— 只引了 computed／onMounted／ref，却用了 watch 与 onBeforeUnmount
const BUG_SHAPE = [
  "import { computed, onMounted, ref } from 'vue'",
  'const noteOpen = ref(true)',
  'function stopPoll() {}',
  'onBeforeUnmount(stopPoll)',
  'watch(noteOpen, () => {})',
  'onMounted(() => {})',
].join('\n')
t('闸咬自己 — 0823b05 的真实形状（只引 3 个、用了 5 个）两个漏网名都点名',
  findMissingVueApis(BUG_SHAPE).join(',') === 'watch,onBeforeUnmount',
  '实得 ' + findMissingVueApis(BUG_SHAPE).join(','))
t('闸咬自己 — 同一段代码把 import 补全就转绿（不是「一律报红」的假闸）',
  findMissingVueApis(BUG_SHAPE.replace(
    "import { computed, onMounted, ref } from 'vue'",
    "import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'")).length === 0)

// ② 注释里的不算用法（否则一切含文档注释的件都会假红）
t('闸咬自己 — 注释里的 `defineAsyncComponent((` 不算用法（块注释与行注释都要吃掉）',
  findMissingVueApis([
    "import { ref } from 'vue'",
    '/** 真正的异步件是 defineAsyncComponent(() => import(...)) 动态取它 */',
    'const el = ref(null) // 这里提一句 watch(',
  ].join('\n')).length === 0)

// ③ 字符串里的 `//` 不许被当注释（否则会把后半行当注释吃掉 → 漏报）
t('闸咬自己 — `//` 在字符串（URL）里不吃掉后面的代码',
  findMissingVueApis([
    "import { ref } from 'vue'",
    "const u = 'https://a.com/x'",
    'watch(u, () => {})',
  ].join('\n')).join(',') === 'watch')

// ④ 不该报：编译器宏／成员调用／改名 import／名字是别的标识符的尾巴
t('不该报 — 编译器宏（defineProps／defineExpose 本来就无 import）',
  findMissingVueApis('const p = defineProps({ a: String })\ndefineExpose({})').length === 0)
t('不该报 — 成员调用 `o.watch(`／`n.ref(` 不是 vue 的 watch／ref',
  findMissingVueApis('const o = {}\no.watch(x)\nn.ref(1)').length === 0)
t('不该报 — 别名 import（`ref as rv` 用 rv）与「另一个标识符的尾巴」（`href(`）',
  findMissingVueApis([
    "import { ref as rv } from 'vue'",
    'const el = rv(null)',
    'href(x)',
  ].join('\n')).length === 0)

// ═══ 2. 真跑一遍 src ═══
console.log('\n[组件卫生 — src 下逐文件核：用到的 Vue API 必须 import 过]')

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = join(dir, d.name)
  if (d.isDirectory()) return walk(p)
  return /\.(vue|js)$/.test(d.name) ? [p] : []
})

const files = walk(join(__dirname, 'src')).sort()
const bad = []
for (const f of files) {
  const missing = findMissingVueApis(readFileSync(f, 'utf8'))
  if (missing.length) bad.push(`${relative(__dirname, f)} → 用了 ${missing.join('／')} 却没 import`)
}
t(`src 下 ${files.length} 个 .vue／.js 逐文件核过：用到的 Vue API 全在 import 里`,
  bad.length === 0, bad.join('；'))

// 扫描面自证：walk 坏掉（扫到 0 个文件）时上一条会「空跑绿」，这里按住
const rels = files.map((f) => relative(__dirname, f).replace(/\\/g, '/'))
const broke = 'src/views/BookListView.vue'
t('扫描面自证 — 覆盖到 views/ 与 components/ 下的组件，且含 2026-10-09 出事的那个件（不是空跑）',
  rels.length >= 30
  && rels.includes(broke)
  && rels.some((r) => r.startsWith('src/views/'))
  && rels.some((r) => r.startsWith('src/components/')),
  `扫到 ${rels.length} 个；含 BookListView=${rels.includes(broke)}`)

// 名单自证：名单被误删成空／混进编译器宏，都会让上一条变成装饰
t('名单自证 — 含生命周期与响应式 API，且不含编译器宏（混进宏会逼人加假 import）',
  VUE_API.includes('onBeforeUnmount') && VUE_API.includes('watch') && VUE_API.includes('ref')
  && COMPILER_MACROS.every((m) => !VUE_API.includes(m)))
t('名单自证 — 名单不重复（重复项说明有人叠着改过）',
  new Set(VUE_API).size === VUE_API.length)

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
