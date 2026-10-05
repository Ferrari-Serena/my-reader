/**
 * 音频访问口径验证（第 6 步 6.4b，纯逻辑，不依赖 Cloudflare 运行时）：
 *   audioalias.js — 已下架书 404 / BYO 别名映射 / 其余照旧
 * 用法: node verify-audioalias.mjs
 *
 * 与 verify-worker.mjs 同一套 t(name, cond) 写法。
 */

import {
  RETIRED_BOOKS, AUDIO_ALIASES, audioRequestPlan
} from './src/audioalias.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const ART = 'bk_2b9199f77a479bf8'   // uploads/artemis-fowl.epub
const GIV = 'bk_ff5e9139dfb97b1f'   // uploads/The Giver (Lowry Lois)(z-library).epub

console.log('\n[已下架的内置 id → retired（对象留档，不再服务）]')
t('the-giver → retired', eq(audioRequestPlan('the-giver', 'ch-03.mp3'), { action: 'retired' }))
t('artemis-fowl → retired', eq(audioRequestPlan('artemis-fowl', 'ch-01.mp3'), { action: 'retired' }))
t('divergent → retired', eq(audioRequestPlan('divergent-series-ultimate-four-book-collection--veronica-rot', 'ch-10.mp3'), { action: 'retired' }))
t('下架书连 timings 也 retired', eq(audioRequestPlan('the-giver', 'ch-03.timings.json'), { action: 'retired' }))

console.log('\n[BYO 别名 → mapped（章号 +2）]')
t('artemis ch-03 → artemis-fowl/ch-01.mp3', eq(audioRequestPlan(ART, 'ch-03.mp3'), { action: 'mapped', src: 'artemis-fowl', key: 'artemis-fowl/ch-01.mp3' }))
t('artemis ch-05 → artemis-fowl/ch-03.mp3', eq(audioRequestPlan(ART, 'ch-05.mp3'), { action: 'mapped', src: 'artemis-fowl', key: 'artemis-fowl/ch-03.mp3' }))
t('artemis ch-13 → artemis-fowl/ch-11.mp3（末章）', eq(audioRequestPlan(ART, 'ch-13.mp3'), { action: 'mapped', src: 'artemis-fowl', key: 'artemis-fowl/ch-11.mp3' }))
t('the-giver ch-05 → the-giver/ch-03.mp3（Chapter 1）', eq(audioRequestPlan(GIV, 'ch-05.mp3'), { action: 'mapped', src: 'the-giver', key: 'the-giver/ch-03.mp3' }))
t('the-giver ch-27 → the-giver/ch-25.mp3（Chapter 23，末章）', eq(audioRequestPlan(GIV, 'ch-27.mp3'), { action: 'mapped', src: 'the-giver', key: 'the-giver/ch-25.mp3' }))
t('the-giver ch-04（Books by…）→ the-giver/ch-02.mp3（归档侧本就没音频，会 404 回落）',
  eq(audioRequestPlan(GIV, 'ch-04.mp3'), { action: 'mapped', src: 'the-giver', key: 'the-giver/ch-02.mp3' }))

console.log('\n[别名边界 → notfound（不给错东西）]')
t('ch-01 减 2 落到 0 以下 → notfound', eq(audioRequestPlan(GIV, 'ch-01.mp3'), { action: 'notfound' }))
t('ch-02 减 2 落到 0 → notfound', eq(audioRequestPlan(GIV, 'ch-02.mp3'), { action: 'notfound' }))
t('artemis ch-02 → notfound', eq(audioRequestPlan(ART, 'ch-02.mp3'), { action: 'notfound' }))
t('别名上的 timings 一律不给（段落切分不同，错位的高亮更糟）', eq(audioRequestPlan(ART, 'ch-03.timings.json'), { action: 'notfound' }))
t('别名上的非 ch 文件 → notfound', eq(audioRequestPlan(ART, 'audio-index.json'), { action: 'notfound' }))
t('别名上的三数字章号 → notfound（只认两位）', eq(audioRequestPlan(ART, 'ch-100.mp3'), { action: 'notfound' }))
t('别名上的路径花招 → notfound', eq(audioRequestPlan(ART, '../artemis-fowl/ch-01.mp3'), { action: 'notfound' }))

console.log('\n[其它书 → serve（功能只增不减，公版匿名照旧）]')
t('dr-jekyll → serve', eq(audioRequestPlan('dr-jekyll-and-mr-hyde', 'ch-01.mp3'), { action: 'serve' }))
t('sat-practice → serve', eq(audioRequestPlan('sat-practice', 'ch-01.mp3'), { action: 'serve' }))
t('未知 bookId → serve（交给 R2 决定有没有）', eq(audioRequestPlan('whatever', 'ch-01.mp3'), { action: 'serve' }))
t('未知 bookId + timings → serve', eq(audioRequestPlan('whatever', 'ch-01.timings.json'), { action: 'serve' }))

console.log('\n[表自身的形状自检]')
const aliasIds = Object.keys(AUDIO_ALIASES)
t('别名键全是 BYO 指纹形状 bk_ + 16 hex', aliasIds.every(id => /^bk_[0-9a-f]{16}$/.test(id)))
t('别名键一个都不在 retired 名单里（否则表形同虚设）', aliasIds.every(id => !RETIRED_BOOKS.includes(id)))
t('retired 名单是 slug 形状（不带 bk_ 前缀）', RETIRED_BOOKS.every(id => !id.startsWith('bk_')))
t('retired 名单恰为三本下架书', RETIRED_BOOKS.length === 3 && RETIRED_BOOKS.includes('the-giver') && RETIRED_BOOKS.includes('artemis-fowl'))
t('divergent 明确不在别名表里（章界对不上，宁可不给）',
  !aliasIds.some(id => AUDIO_ALIASES[id].src.startsWith('divergent')))
t('每个别名都指向一本已下架的书（映射的是归档音频）',
  Object.values(AUDIO_ALIASES).every(a => RETIRED_BOOKS.includes(a.src)))
t('偏移量都是正数', Object.values(AUDIO_ALIASES).every(a => Number.isInteger(a.offset) && a.offset > 0))

console.log('\n[覆盖范围：归档音频的每一章都接得上]')
const artKeys = []
for (let n = 3; n <= 13; n++) artKeys.push(audioRequestPlan(ART, `ch-${String(n).padStart(2, '0')}.mp3`).key)
t('artemis：BYO ch-03…ch-13 覆盖归档 ch-01…ch-11（11 章，无重复无空洞）',
  eq(artKeys, Array.from({ length: 11 }, (_, i) => `artemis-fowl/ch-${String(i + 1).padStart(2, '0')}.mp3`)))
const givKeys = []
for (let n = 5; n <= 27; n++) givKeys.push(audioRequestPlan(GIV, `ch-${String(n).padStart(2, '0')}.mp3`).key)
t('the-giver：BYO ch-05…ch-27 覆盖归档 ch-03…ch-25（23 章，无重复无空洞）',
  eq(givKeys, Array.from({ length: 23 }, (_, i) => `the-giver/ch-${String(i + 3).padStart(2, '0')}.mp3`)))

console.log('\n[注入故障：闸要能咬自己]')
const zero = audioRequestPlan(ART, 'ch-05.mp3', { aliases: { [ART]: { src: 'artemis-fowl', offset: 0 } } })
t('把 offset 改成 0 → 映射随之改变（断言真的走表，不是写死的期望）',
  zero.key === 'artemis-fowl/ch-05.mp3')
const empty = audioRequestPlan(ART, 'ch-05.mp3', { aliases: {} })
t('把表清空 → 落到 notfound/serve 之外的行为随之改变（表是承重的）',
  empty.action === 'serve')
const both = audioRequestPlan('the-giver', 'ch-05.mp3', { aliases: { 'the-giver': { src: 'artemis-fowl', offset: 2 } } })
t('retired 优先于别名（同名时先挡后映射）', eq(both, { action: 'retired' }))

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
