/**
 * 导入界面层的**纯逻辑**验证（不碰 vue、不碰浏览器存储）：
 *   utils/importFlow.js — 先验检查、进度换算、按钮门、错误码文案
 * 用法: node verify-importui.mjs
 *
 * 为什么测这些「一句话」：解析真伪在 verify-import.mjs（119 条）与书库在
 * verify-books.mjs（101 条）各有断言，前端真正会错的是「这个码该说什么」
 * 「按钮什么时候该禁用」「百分比能不能信」这类**埋在组件里就测不到**的判断。
 * 组件渲染与真机点击不在这一层（那要靠 Playwright 实测）。
 */

import * as F from './src/utils/importFlow.js'
import { ImportError, IMPORT_LIMITS } from './src/import/errors.js'
import { BookStoreError } from './src/storage/bookDb.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
function tEq(name, got, want) {
  t(name + `  [got ${JSON.stringify(got)}]`, JSON.stringify(got) === JSON.stringify(want))
}
const MB = 1024 * 1024

console.log('\n[importFlow — 先验检查（只看文件名与大小，不读内容）]')
{
  t('accept 覆盖三种格式', ['.epub', '.pdf', '.txt'].every(x => F.ACCEPT_ATTR.includes(x)))
  t('epub 过', F.preflightFile({ name: 'book.epub', size: 1000 }) === true)
  t('PDF 大写扩展名也过', F.preflightFile({ name: 'BOOK.PDF', size: 1000 }) === true)
  t('txt / text 都过', F.preflightFile({ name: 'a.txt', size: 1 }) && F.preflightFile({ name: 'a.text', size: 1 }))

  const code = (fn) => { try { fn(); return null } catch (e) { return e.code } }
  tEq('空文件 -> EMPTY_CONTENT', code(() => F.preflightFile({ name: 'a.txt', size: 0 })), 'EMPTY_CONTENT')
  tEq('超上限 -> FILE_TOO_BIG ', code(() => F.preflightFile({ name: 'a.pdf', size: IMPORT_LIMITS.MAX_FILE_BYTES + 1 })), 'FILE_TOO_BIG')
  t('恰好等于上限 -> 放行（上限是「大于才算超」）',
    F.preflightFile({ name: 'a.pdf', size: IMPORT_LIMITS.MAX_FILE_BYTES }) === true)
  tEq('.mobi -> UNSUPPORTED_FORMAT', code(() => F.preflightFile({ name: 'a.mobi', size: 10 })), 'UNSUPPORTED_FORMAT')
  tEq('无扩展名 -> UNSUPPORTED_FORMAT', code(() => F.preflightFile({ name: 'noext', size: 10 })), 'UNSUPPORTED_FORMAT')
  tEq('.pdf 装了别的东西也不管（格式真伪由 magic 判）-> 先验放行',
    F.preflightFile({ name: 'a.pdf', size: 10 }), true)
}

console.log('\n[importFlow — 名字与体积显示]')
{
  tEq("stripExt('a.epub')", F.stripExt('a.epub'), 'a')
  tEq("stripExt('My Book.TXT')", F.stripExt('My Book.TXT'), 'My Book')
  tEq("stripExt('a.b.pdf')", F.stripExt('a.b.pdf'), 'a.b')
  tEq("stripExt('noext')", F.stripExt('noext'), 'noext')
  tEq('stripExt(null)', F.stripExt(null), '')
  tEq('0 B', F.formatBytes(0), '0 B')
  tEq('512 B', F.formatBytes(512), '512 B')
  tEq('2048 -> 2 KB', F.formatBytes(2048), '2 KB')
  tEq('1.5 MB', F.formatBytes(1.5 * MB), '1.5 MB')
  tEq('2 GB', F.formatBytes(2 * 1024 * MB), '2.00 GB')
  tEq('负数当 0（不显示 -1 B）', F.formatBytes(-5), '0 B')
}

console.log('\n[importFlow — 大文件提醒线]')
{
  tEq('49 MB 不提醒', F.isHeavy(49 * MB), false)
  tEq('50 MB 起提醒', F.isHeavy(50 * MB), true)
  tEq('没有大小不提醒', F.isHeavy(undefined), false)
}

console.log('\n[importFlow — 进度换算]')
{
  tEq('没进度 -> null（走不定式）', F.progressPercent(null), null)
  tEq('空对象 -> null', F.progressPercent({}), null)
  tEq('只有 stage -> null', F.progressPercent({ stage: 'pdf' }), null)
  tEq('1/10 -> 10', F.progressPercent({ loaded: 1, total: 10 }), 10)
  tEq('10/10 -> 100', F.progressPercent({ loaded: 10, total: 10 }), 100)
  tEq('total=0 -> null（不除零）', F.progressPercent({ loaded: 0, total: 0 }), null)
  tEq('loaded>0 但 total=0 -> null', F.progressPercent({ loaded: 5, total: 0 }), null)
  tEq('负 loaded 夹到 0', F.progressPercent({ loaded: -1, total: 10 }), 0)
  tEq('越界 loaded 夹到 100', F.progressPercent({ loaded: 99, total: 10 }), 100)
  tEq('数字串也认', F.progressPercent({ loaded: '2', total: '4' }), 50)
  const third = F.progressPercent({ loaded: 1, total: 3 })
  t('1/3 是约 33.3 且落在 0..100', third > 33 && third < 34)
}

console.log('\n[importFlow — 步骤文案与取消判定]')
{
  tEq('reading', F.stepText(F.IMPORT_STEP.READING), 'Reading the file...')
  tEq('parsing', F.stepText(F.IMPORT_STEP.PARSING), 'Reading the text...')
  tEq('saving', F.stepText(F.IMPORT_STEP.SAVING), 'Saving to this device...')
  tEq('认不出的步骤也有话说', F.stepText('nonsense'), 'Working...')
  t('取消算取消', F.isCancelled(new ImportError('CANCELLED')) === true)
  t('别的错误不算取消', F.isCancelled(new ImportError('EPUB_INVALID')) === false)
  t('null 不算取消', F.isCancelled(null) === false)
}

console.log('\n[importFlow — 错误码文案]')
{
  const enc = F.errorText(new ImportError('EPUB_ENCRYPTED'))
  tEq('加密 EPUB：码保住', enc.code, 'EPUB_ENCRYPTED')
  t('加密 EPUB：说 DRM、给退路', /DRM/.test(enc.message) && /DRM-free/.test(enc.hint))
  t('文案里不留占位符', !enc.message.includes('{') && !enc.hint.includes('{'))

  const big = F.errorText(new ImportError('FILE_TOO_BIG'))
  t('超限：把 {max} 换成真上限', big.message.includes(String(IMPORT_LIMITS.MAX_FILE_MB)))

  const noText = F.errorText(new ImportError('PDF_NO_TEXT'))
  t('无文本层：说扫描件、说 OCR', /scan/i.test(noText.message) && /OCR/.test(noText.hint))

  const unavail = F.errorText(new BookStoreError('UNAVAILABLE'))
  t('书库不可用：说隐私模式', /Private browsing/i.test(unavail.hint))
  const tx = F.errorText(new BookStoreError('TX_FAILED'))
  t('落库失败：说空间', /space/i.test(tx.hint))
  const blocked = F.errorText(new BookStoreError('BLOCKED'))
  t('被别的标签页挡住：说关标签页', /tab/i.test(blocked.message + blocked.hint))

  const raw = F.errorText(new Error('boom: internal stack detail'))
  tEq('裸异常 -> UNKNOWN', raw.code, 'UNKNOWN')
  t('裸异常不把技术消息漏给用户', !raw.message.includes('boom') && !raw.hint.includes('boom'))

  const duck = F.errorText({ code: 'X_CODE', message: 'm', hint: 'h' })
  tEq('鸭子类型的 {code,message,hint} 原样透传', [duck.code, duck.message, duck.hint], ['X_CODE', 'm', 'h'])

  const shaped = ['EPUB_ENCRYPTED', 'PDF_INVALID', 'CANCELLED', 'EMPTY_CONTENT']
    .every((c) => { const r = F.errorText(new ImportError(c)); return typeof r.code === 'string' && typeof r.message === 'string' && r.message && typeof r.hint === 'string' && r.hint })
  t('常见码的返回形状都齐（code / message / hint 非空）', shaped)
}

console.log('\n[importFlow — 解析产物 -> 入库记录]')
{
  const book = {
    bookId: 'bk_0123456789abcdef', title: 'T', author: 'A',
    chapters: [{ id: 'ch-01', paragraphs: [{ id: 'p-01-001', text: 'x' }] }],
    coverUrl: 'data:image/png;base64,YQ==', paragraphCount: 1, charCount: 1
  }
  const rec = F.recordFromBook(book)
  tEq('字段表不多不少（少一个就是静默丢数据）', Object.keys(rec).sort(),
    ['author', 'bookId', 'chapters', 'coverUrl', 'title'])
  tEq('内嵌封面带过去', rec.coverUrl, 'data:image/png;base64,YQ==')
  tEq('没有封面时是空串（不是 undefined）', F.recordFromBook({ ...book, coverUrl: undefined }).coverUrl, '')
  t('计数不落库（存储层自己重算）', !('paragraphCount' in rec) && !('charCount' in rec))
}

console.log('\n[importFlow — 门与提示]')
{
  const file = { name: 'a.epub', size: 10 }
  t('勾了 ＋ 选了文件 ＋ 不忙 -> 能开', F.canStart({ consent: true, file, busy: false }) === true)
  t('没勾版权 -> 不能开', F.canStart({ consent: false, file, busy: false }) === false)
  t('没选文件 -> 不能开', F.canStart({ consent: true, file: null, busy: false }) === false)
  t('正在忙 -> 不能开', F.canStart({ consent: true, file, busy: true }) === false)
  t('空参 -> 不能开', F.canStart() === false)

  const already = F.alreadyOnShelfText()
  tEq('已在本机：码固定', already.code, 'ALREADY_ON_SHELF')
  t('已在本机：说清「再导一次没用」', /already on your shelf/i.test(already.message) && /nothing/i.test(already.hint))
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
