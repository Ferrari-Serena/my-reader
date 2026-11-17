/**
 * BYO 导入解析层验证（第 5 步 5A；不依赖浏览器 / 网络）。
 *   import/errors.js — 错误口径（code/message/hint）
 *   import/book.js   — 格式识别 / 编号 / 出口净化
 *   utils/bookCover.js — 封面 data URL（大小上限 / 白名单；book.js 与存储层共用）
 *   import/html.js   — XHTML -> 段落（实体、script/style、块级边界）
 *   import/txt.js    — 编码识别（BOM/UTF-8/GBK/UTF-16）+ 切段切章
 *   import/epub.js   — 解包 / container+OPF / spine 顺序 / DRM 拦截
 *   import/pdf.js    — 纯函数（groupLines/linesToParagraphs/pagesToChapters）+ 真 PDF 取字
 *   import/ocrMerge.js — 可见码点 / 三态 verdict / 三分支 merge（b2，含 legacy 反例负测）
 *   import/index.js  — importBook 端到端（含 bookId 与 node:crypto 交叉核对）
 * 用法: node verify-import.mjs
 *
 * 与 verify-core.mjs 同一套 t(name, cond) 写法。
 * 夹具在 test-fixtures/（PyMuPDF 生成 PDF、stdlib zipfile 生成 EPUB）。
 * pdfjs 在 Node 里必须用 legacy 构建（非 legacy 在 Node 里 import 就炸），故注入。
 */

import fs from 'node:fs'
import { createHash } from 'node:crypto'

const { ImportError, IMPORT_ERRORS, IMPORT_LIMITS, toImportError } = await import('./src/import/errors.js')
const { chapterId, paragraphId, formatOf, makeBook, MAX_FILE_BYTES } = await import('./src/import/book.js')
const { htmlToParagraphs, decodeEntities, stripTags } = await import('./src/import/html.js')
const { decodeBytes, splitTextToParagraphs, isChapterHeading, paragraphsToChapters, parseTxt } = await import('./src/import/txt.js')
const { resolvePath, findOpfPath, parseOpf, findCoverItem, parseEpub, isEncryptedEpub, readEpubEntries } = await import('./src/import/epub.js')
const { groupLines, linesToParagraphs, pagesToChapters, parsePdf } = await import('./src/import/pdf.js')
const { visOf, DEFAULT_RULES, verdictOf, mergePage, ocrParagraphsOf, auditDropped } = await import('./src/import/ocrMerge.js')
const { bytesToBase64, coverDataUrl, isCoverDataUrl, COVER_MAX_BYTES, COVER_MAX_DATA_URL } = await import('./src/utils/bookCover.js')
const { importBook } = await import('./src/import/index.js')

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
function tEq(name, got, want) {
  t(name + `  [got ${JSON.stringify(got)}]`, JSON.stringify(got) === JSON.stringify(want))
}
const read = name => new Uint8Array(fs.readFileSync(new URL('./test-fixtures/' + name, import.meta.url)))
async function codeOf(fn) {
  try { await fn(); return null } catch (e) { return (e && e.code) ? e.code : ('threw:' + (e && e.message)) }
}

console.log('\n[errors.js — 错误口径]')
{
  const codes = Object.keys(IMPORT_ERRORS)
  t('错误码表非空且互不重复', codes.length >= 9 && new Set(codes).size === codes.length)
  t('每条都有 message 与 hint', codes.every(c => {
    const e = new ImportError(c)
    return e.code === c && e.message.length > 0 && e.hint.length > 0
  }))
  const big = new ImportError('FILE_TOO_BIG')
  t('FILE_TOO_BIG 的 {max} 被替换成真实上限', big.message.includes(String(IMPORT_LIMITS.MAX_FILE_MB)) && !big.message.includes('{'))
  t('ImportError 是 Error 的子类', new ImportError('PDF_NO_TEXT') instanceof Error)
  const wrapped = toImportError(new Error('boom'))
  t('toImportError 包住裸异常', wrapped instanceof ImportError && wrapped.code === 'PDF_INVALID')
  const already = new ImportError('EPUB_ENCRYPTED')
  t('toImportError 不重复包裹', toImportError(already) === already)
}

console.log('\n[book.js — 编号 / 格式识别 / 出口]')
{
  tEq('chapterId(1)', chapterId(1), 'ch-01')
  tEq('chapterId(9)', chapterId(9), 'ch-09')
  tEq('chapterId(100) 自然加宽', chapterId(100), 'ch-100')
  tEq('paragraphId(1,1)', paragraphId(1, 1), 'p-01-001')
  tEq('paragraphId(12,345)', paragraphId(12, 345), 'p-12-345')
  tEq('paragraphId 超 999 段不重号', paragraphId(1, 1000), 'p-01-1000')

  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) // %PDF-1
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
  tEq('扩展名 .epub', formatOf({ name: 'A.EPUB', bytes: zipBytes }), 'epub')
  tEq('扩展名 .pdf + %PDF magic', formatOf({ name: 'a.pdf', bytes: pdfBytes }), 'pdf')
  tEq('.pdf 里装 zip -> 不认（不拿错解析器去啃）', formatOf({ name: 'a.pdf', bytes: zipBytes }), null)
  tEq('.epub 里装 pdf -> 不认', formatOf({ name: 'a.epub', bytes: pdfBytes }), null)
  tEq('无扩展名靠 magic 认 pdf', formatOf({ name: 'noext', bytes: pdfBytes }), 'pdf')
  tEq('.txt（无 magic）', formatOf({ name: 'a.txt', bytes: new Uint8Array([0x41]) }), 'txt')
  tEq('不认识的格式', formatOf({ name: 'a.mobi', bytes: new Uint8Array([0x41, 0x42, 0x43, 0x44]) }), null)
  tEq('空输入不炸', formatOf({}), null)

  const book = makeBook({
    bookId: 'bk_x', title: 'T', author: 'A',
    chapters: [
      { title: '', paragraphs: ['  one   two ', '', '   '] },
      { title: 'Empty', paragraphs: ['', '  '] },
      { title: 'Keep', paragraphs: ['ok'] },
    ],
  })
  tEq('空段落被丢 + 空白折叠', book.chapters[0].paragraphs.map(p => p.text), ['one two'])
  tEq('空章被丢（不进编号）', book.chapters.map(c => c.id), ['ch-01', 'ch-02'])
  tEq('无题章回退 Chapter N', book.chapters[0].title, 'Chapter 1')
  tEq('有题章保留原题', book.chapters[1].title, 'Keep')
  tEq('段落 id 与章号对齐', book.chapters[0].paragraphs[0].id, 'p-01-001')
  tEq('章/段/字计数', [book.chapterCount, book.paragraphCount, book.charCount], [2, 2, 9])
  tEq('全空 -> EMPTY_CONTENT', await codeOf(() => makeBook({ chapters: [{ paragraphs: [] }] })), 'EMPTY_CONTENT')
}

console.log('\n[html.js — XHTML -> 段落]')
{
  tEq('块级标签切段', htmlToParagraphs('<div><h1>T</h1><p>a</p><p>b</p></div>'), ['T', 'a', 'b'])
  tEq('<br> 断行', htmlToParagraphs('<div>x<br/>y</div>'), ['x', 'y'])
  tEq('script/style/head 整块丢掉', htmlToParagraphs('<p>x</p><script>bad()</script><style>p{}</style><head><title>t</title></head><p>y</p>'), ['x', 'y'])
  tEq('连着的空白折叠成一个空格', htmlToParagraphs('<p>Tail   with    collapsed     spaces.</p>'), ['Tail with collapsed spaces.'])
  tEq('行内标签不切段', htmlToParagraphs('<p>a <b>bold</b> c</p>'), ['a bold c'])
  tEq('空标签/纯空白不产出段落', htmlToParagraphs('<p></p><p>   </p><p>x</p>'), ['x'])

  t('命名实体', decodeEntities('&amp;&lt;&gt;&quot;&apos;') === '&<>"\'')
  t('nbsp 变普通空格', decodeEntities('a&nbsp;b') === 'a b')
  t('十进制数字实体', decodeEntities('&#8212;') === '\u2014')
  t('十六进制数字实体', decodeEntities('&#x2014;') === '\u2014')
  t('认不出的实体原样保留', decodeEntities('&unknown;') === '&unknown;')
  tEq('stripTags 抹标签留文本', stripTags('<p>a &amp; b</p>'), ' a & b ')
}

console.log('\n[txt.js — 编码 / 切段 / 切章]')
{
  const utf8 = read('sample.txt')
  const dec = decodeBytes(utf8)
  tEq('UTF-8（无 BOM）', dec.encoding, 'utf-8')
  t('UTF-8 正文正确', dec.text.includes('CHAPTER 1') && dec.text.includes('striking thirteen'))
  t('中文段落完好地落到文本里', dec.text.includes('中文正文'))

  const gbk = decodeBytes(read('sample-gbk.txt'))
  tEq('GBK 被认出来', gbk.encoding, 'gbk')
  t('GBK 与 UTF-8 解出同一份文本', gbk.text === dec.text)

  const u16 = decodeBytes(read('sample-utf16.txt'))
  tEq('UTF-16LE（BOM）被认出来', u16.encoding, 'utf-16le')
  t('UTF-16 解出的正文正确', u16.text.includes('CHAPTER 1'))

  tEq('两边都解不出 -> ENCODING_UNKNOWN', await codeOf(() => decodeBytes(new Uint8Array([0xff]))), 'ENCODING_UNKNOWN')

  tEq('有空行 -> 按空行切段', splitTextToParagraphs('a\n\nb\n\n\nc'), ['a', 'b', 'c'])
  tEq('没空行 -> 退化成一行一段', splitTextToParagraphs('a\nb\nc'), ['a', 'b', 'c'])
  tEq('段内硬换行在有空行时并回一段', splitTextToParagraphs('a\nb\n\nc'), ['a b', 'c'])

  t('裸数字算标题', isChapterHeading('12'))
  t('罗马数字算标题', isChapterHeading('IV'))
  t('CHAPTER 12 算标题', isChapterHeading('CHAPTER 12'))
  t('PROLOGUE 算标题', isChapterHeading('PROLOGUE'))
  t('全大写短行算标题', isChapterHeading('THE GIVER'))
  t('带编号标题不算（"Chapter one was long indeed."）', !isChapterHeading('Chapter one was long indeed.'))
  t('长句不算标题', !isChapterHeading('It was a bright cold day in April, and the clocks were striking thirteen.'))
  t('短小写句不算标题', !isChapterHeading('he said.'))

  const chapters = paragraphsToChapters(['PREFACE', 'pre text', 'CHAPTER 1', 'body one', 'CHAPTER 2', 'body two'])
  tEq('标题行当章名、不进正文', chapters.map(c => c.title), ['PREFACE', 'CHAPTER 1', 'CHAPTER 2'])
  tEq('章名下的正文归到对的章', chapters[2].paragraphs, ['body two'])
  const loose = paragraphsToChapters(['loose intro', 'CHAPTER 1', 'body'], { fallbackTitle: 'Front' })
  tEq('标题前的散段归到 fallback', loose[0].title, 'Front')
  tEq('fallback 的正文保留', loose[0].paragraphs, ['loose intro'])
  t('中文标题：第X章', isChapterHeading('第一章 启程') && isChapterHeading('第二章'))
  t('中文标题：序/前言/后记', isChapterHeading('前言') && isChapterHeading('后记'))
  t('中文正文不算标题', !isChapterHeading('这是一段中文正文，用来把编码从 UTF-8 里逼出来。'))
  const cn = paragraphsToChapters(['第一章 启程', '他走了。'])
  tEq('中文标题切章正确', cn, [{ title: '第一章 启程', paragraphs: ['他走了。'] }])

  const book = parseTxt(utf8, { title: 'Sample' })
  tEq('parseTxt 切出两章', book.chapters.map(c => c.title), ['CHAPTER 1', 'CHAPTER 2'])
  tEq('parseTxt 每章正文段数', book.chapters.map(c => c.paragraphs.length), [3, 2])
}

console.log('\n[utils/bookCover.js — 封面 data URL（第 7 步 7.4）]')
{
  const enc = (x) => new TextEncoder().encode(x)
  tEq('base64 空字节 -> 空串', bytesToBase64(new Uint8Array(0)), '')
  tEq('base64 整 3 字节（Man）', bytesToBase64(enc('Man')), 'TWFu')
  tEq('base64 余 2 字节（Ma）', bytesToBase64(enc('Ma')), 'TWE=')
  tEq('base64 余 1 字节（M）', bytesToBase64(enc('M')), 'TQ==')
  tEq('base64 认视图（subarray 也按自己的长度算）', bytesToBase64(enc('Man').subarray(0, 2)), 'TWE=')
  tEq('base64 非字节输入不炸', bytesToBase64(null), '')

  tEq('coverDataUrl 前缀', coverDataUrl({ bytes: enc('abc'), mediaType: 'image/png' }), 'data:image/png;base64,YWJj')
  tEq('coverDataUrl media-type 归一（大写能认）', coverDataUrl({ bytes: enc('a'), mediaType: 'IMAGE/JPEG' }), 'data:image/jpeg;base64,YQ==')
  tEq('coverDataUrl 非图片 -> 空串', coverDataUrl({ bytes: enc('a'), mediaType: 'text/html' }), '')
  tEq('coverDataUrl 空字节 -> 空串', coverDataUrl({ bytes: new Uint8Array(0), mediaType: 'image/png' }), '')
  tEq('coverDataUrl 没给对象 -> 空串', coverDataUrl(null), '')
  t('coverDataUrl 恰好上限（512 KB）-> 有内容', coverDataUrl({ bytes: new Uint8Array(COVER_MAX_BYTES), mediaType: 'image/png' }).length > 0)
  tEq('coverDataUrl 超 1 字节 -> 空串', coverDataUrl({ bytes: new Uint8Array(COVER_MAX_BYTES + 1), mediaType: 'image/png' }), '')

  const good = coverDataUrl({ bytes: enc('abc'), mediaType: 'image/png' })
  t('isCoverDataUrl 认自己产的', isCoverDataUrl(good))
  tEq('isCoverDataUrl 拒外链', isCoverDataUrl('https://cdn.example/x.png'), false)
  tEq('isCoverDataUrl 拒非图片 data URL', isCoverDataUrl('data:text/html;base64,YQ=='), false)
  tEq('isCoverDataUrl 拒缺 base64 标记', isCoverDataUrl('data:image/png,YQ=='), false)
  tEq('isCoverDataUrl 拒前后空白（strict，不 trim）', isCoverDataUrl(' ' + good + ' '), false)
  tEq('isCoverDataUrl 拒空 / null / 非串', [isCoverDataUrl(''), isCoverDataUrl(null), isCoverDataUrl(42)], [false, false, false])
  tEq('isCoverDataUrl 拒超长', isCoverDataUrl('data:image/png;base64,' + 'A'.repeat(COVER_MAX_DATA_URL)), false)
  t('上限口径：data URL 上限放得下满一张上限图', COVER_MAX_DATA_URL > 4 * Math.ceil(COVER_MAX_BYTES / 3))
}

console.log('\n[epub.js — 解包 / OPF / 正文]')
{
  tEq('resolvePath 拼相对路径', resolvePath('OEBPS/', 'text/ch2.xhtml'), 'OEBPS/text/ch2.xhtml')
  tEq('resolvePath 处理 ../', resolvePath('OEBPS/text/', '../ch1.xhtml'), 'OEBPS/ch1.xhtml')
  tEq('resolvePath 去掉 #fragment / ?query', resolvePath('OEBPS/', 'a.xhtml#p1?x=1'), 'OEBPS/a.xhtml')
  tEq('resolvePath 解 %20', resolvePath('OEBPS/', 'my%20chapter.xhtml'), 'OEBPS/my chapter.xhtml')

  const entries = readEpubEntries(read('sample.epub'))
  t('解包出 mimetype/container/opf', !!entries['mimetype'] && !!entries['META-INF/container.xml'] && !!entries['OEBPS/content.opf'])
  t('mimetype 是 EPUB 的', new TextDecoder().decode(entries['mimetype']).trim() === 'application/epub+zip')
  t('未加密的样本不算加密', !isEncryptedEpub(entries))
  t('加密样本被认出（有 encryption.xml）', isEncryptedEpub(readEpubEntries(read('encrypted.epub'))))
  tEq('container.xml 找到 OPF 路径', findOpfPath(new TextDecoder().decode(entries['META-INF/container.xml'])), 'OEBPS/content.opf')

  const opf = parseOpf(new TextDecoder().decode(entries['OEBPS/content.opf']))
  tEq('OPF 读到书名', opf.title, 'Import Sample Book')
  tEq('OPF 读到作者', opf.author, 'A. Tester')
  tEq('OPF manifest 条目数（含 nav）', opf.items.length, 3)
  tEq('OPF spine 顺序', opf.spine.map(s => s.idref), ['ch1', 'ch2'])

  const book = parseEpub(read('sample.epub'))
  tEq('书名来自 OPF', book.title, 'Import Sample Book')
  tEq('作者来自 OPF', book.author, 'A. Tester')
  tEq('按 spine 切出两章', book.chapters.map(c => c.title), ['One', 'Two'])
  tEq('第一章正文（h1 标题已去重）', book.chapters[0].paragraphs, [
    'Alpha & beta \u2014 a first paragraph.',
    'Second paragraph with a nbsp.',
    'bullet one',
    'bullet two',
    'Tail with collapsed spaces.',
  ])
  tEq('第二章正文（嵌套目录 text/ 也认得）', book.chapters[1].paragraphs, ['Block div text.', 'After a break.'])
  t('正文里没有 script/style 残留', !JSON.stringify(book.chapters).includes('var x') && !JSON.stringify(book.chapters).includes('color: red'))

  // 封面（第 7 步 7.4）：本模块只负责「找到并取字节」；转 data URL 与限大小在 utils/bookCover.js
  tEq('sample.epub 没有封面 -> null', book.cover, null)
  const opfXmlOf = (f) => new TextDecoder().decode(readEpubEntries(read(f))['OEBPS/content.opf'])
  const itemsOfXml = (xml) => parseOpf(xml).items
  const coverOpf = opfXmlOf('cover.epub')
  tEq('线索②：EPUB2 <meta name="cover"> 指向图片项', findCoverItem(coverOpf, itemsOfXml(coverOpf)).href, 'images/cover.png')
  const propOpf = opfXmlOf('cover3.epub')
  tEq('线索①：EPUB3 properties="cover-image"', findCoverItem(propOpf, itemsOfXml(propOpf)).href, 'images/cover.jpg')
  tEq('兜底③：href 里带 cover 的图片', findCoverItem('<package/>', [{ id: 'a', href: 'OEBPS/Cover.jpg', mediaType: 'image/jpeg' }]).href, 'OEBPS/Cover.jpg')
  tEq('兜底只认图片：cover.xhtml 不算', findCoverItem('<package/>', [{ id: 'cover', href: 'cover.xhtml', mediaType: 'application/xhtml+xml' }]), null)
  tEq('meta 指向不存在的 id -> 不硬猜', findCoverItem('<meta name="cover" content="nope"/>', [{ id: 'x', href: 'img.png', mediaType: 'image/png' }]), null)
  tEq('items 不是数组 -> null', findCoverItem('<package/>', null), null)

  const covered = parseEpub(read('cover.epub'))
  tEq('cover.epub 取到封面 media-type', covered.cover.mediaType, 'image/png')
  t('cover.epub 取到的是真 PNG 字节', covered.cover.bytes[0] === 0x89 && covered.cover.bytes[1] === 0x50)
  tEq('cover3.epub 取到 jpeg 封面', parseEpub(read('cover3.epub')).cover.mediaType, 'image/jpeg')
  tEq('封面只在 manifest、不占正文', covered.chapters.length, 1)
  t('取封面不影响正文文本', covered.chapters[0].paragraphs[0].startsWith('Alpha paragraph'))

  tEq('加密 EPUB -> EPUB_ENCRYPTED', await codeOf(() => parseEpub(read('encrypted.epub'))), 'EPUB_ENCRYPTED')
  tEq('不是 zip -> EPUB_INVALID', await codeOf(() => parseEpub(read('sample.txt'))), 'EPUB_INVALID')
  tEq('zip 但缺 mimetype -> EPUB_INVALID', await codeOf(() => parseEpub(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))), 'EPUB_INVALID')
}

console.log('\n[pdf.js — 纯函数]')
{
  const item = (str, x, y, w, h = 11) => ({ str, transform: [1, 0, 0, h, x, y], width: w, height: h })
  const lines = groupLines([
    item('Hello', 72, 700, 30),
    item('world', 106, 700, 28),
    item('', 72, 700, 0),
    item('Second line', 72, 680, 60),
  ])
  tEq('同一行合并 + 词间按间距补空格', lines.map(l => l.text), ['Hello world', 'Second line'])
  tEq('行按上->下排序', lines.map(l => l.y), [700, 680])
  tEq('间距很小就不补空格', groupLines([item('Hel', 72, 700, 30), item('lo', 103, 700, 10)]).map(l => l.text), ['Hello'])
  tEq('空 str 被跳过', groupLines([item('', 72, 700, 0), item('x', 72, 690, 5)]).map(l => l.text), ['x'])

  const row = (text, y, right, h = 11) => ({ text, y, right, h })
  tEq('行距大 -> 断段', linesToParagraphs([row('A', 700, 100), row('B', 680, 100)]), ['A', 'B'])
  tEq('普通行距 -> 并成一段', linesToParagraphs([row('A', 700, 100), row('B', 692, 100)]), ['A B'])
  tEq('上一行没排满 -> 断段', linesToParagraphs([row('A', 700, 20), row('B', 694, 100)]), ['A', 'B'])
  tEq('空输入 -> 空数组', linesToParagraphs([]), [])

  const pages = [
    { paragraphs: ['Front'] },
    { paragraphs: ['Chapter One', 'Body1'] },
    { paragraphs: ['Chapter Two', 'Body2'] },
  ]
  const withOutline = pagesToChapters(pages, [{ title: 'Chapter One', page: 2 }, { title: 'Chapter Two', page: 3 }])
  tEq('有目录：首条之前归 Front matter', withOutline.map(c => c.title), ['Front matter', 'Chapter One', 'Chapter Two'])
  tEq('有目录：章名与首段相同 -> 去重', withOutline[1].paragraphs, ['Body1'])
  const noOutline = pagesToChapters([{ paragraphs: ['a'] }, { paragraphs: [] }], null)
  tEq('无目录：一页一章、空页丢掉', noOutline, [{ title: 'Page 1', paragraphs: ['a'] }])
}

console.log('\n[ocrMerge.js — 可见码点]')
{
  // §11.1.3 表：vis 与 ocrVis 用同一个函数，标点计入、U+FFFD 不计、按码点计数
  tEq('visOf ASCII', visOf('abc'), 3)
  tEq('visOf 全角（NFKC 全角->半角）', visOf('ＡＢＣ'), 3)
  tEq('visOf 空白不计', visOf(' a\tb\nc '), 3)
  tEq('visOf CJK 按码点', visOf('中文'), 2)
  tEq('visOf emoji 代理对算一个码点', visOf('😀'), 1)
  tEq('visOf 扩展 B（U+20000）', visOf('𠀀'), 1)
  tEq('visOf 组合符（e + U+0301 -> é）', visOf('é'), 1)
  tEq('visOf 软连字符不计', visOf('a­b'), 2)
  tEq('visOf 零宽空格不计', visOf('a​b'), 2)
  tEq('visOf U+FFFD 不计', visOf('a�b'), 2)
  tEq('visOf 标点计入', visOf('，。！？'), 4)
  tEq('visOf 空 / null / undefined -> 0', [visOf(''), visOf(null), visOf(undefined)], [0, 0, 0])
  tEq('visOf 纯空白 -> 0', visOf('  　 '), 0)
  t('visOf 是纯函数（同输入同输出）', visOf('中文 abc') === visOf('中文 abc') && visOf('中文 abc') === 5)

  // §11.1.4 三态判定（text 只作防御）
  tEq('verdictOf vis=0 -> empty', verdictOf({ vis: 0, cov: 0.9 }), { state: 'empty', needsOcr: true })
  tEq('verdictOf vis=49 -> sparse（cov 大也仍 sparse）', verdictOf({ vis: 49, cov: 0.9 }), { state: 'sparse', needsOcr: true })
  tEq('verdictOf vis=50 且 cov=0.11 -> image_body', verdictOf({ vis: 50, cov: 0.11 }), { state: 'image_body', needsOcr: true })
  tEq('verdictOf vis=50 且 cov=0.12 -> text（边界含在内）', verdictOf({ vis: 50, cov: 0.12 }), { state: 'text', needsOcr: false })
  tEq('DEFAULT_RULES 常量', [
    DEFAULT_RULES.MIN_NOVEL_BLOCK_VIS, DEFAULT_RULES.MIN_NOVEL_BLOCK_VIS_CJK,
    DEFAULT_RULES.COVER_SIM, DEFAULT_RULES.T_SPARSE, DEFAULT_RULES.C_BODY,
  ], [4, 2, 0.8, 50, 0.12])
}

console.log('\n[ocrMerge.js — 三分支与反例（§11.6.2）]')
{
  const w = s => String(s).repeat(10)
  const HEADER = Array.from({ length: 20 }, (_, i) => w(String.fromCharCode(97 + i))).join(' ')
  const BODY = Array.from({ length: 15 }, () => 'bodywordzz').join(' ')
  t('夹具：页眉恰 200 可见字符', visOf(HEADER) === 200)
  t('夹具：图片正文恰 150 可见字符', visOf(BODY) === 150)

  // 200 字页眉 ＋ 150 字图片正文：夹具页按 §11.1.4 判 image_body（vis=200 ≥ 50 且 cov≈0.03 < 0.12）
  const HDR = { text: HEADER, bbox: [72, 760, 500, 780] }
  const BODY_BLOCK = { text: BODY, bbox: [72, 400, 500, 620] }
  const fixture = { verdict: 'image_body', paragraphs: [HEADER], ocrBlocks: [HDR, BODY_BLOCK], pageNo: 1 }
  const sparseFixture = { ...fixture, verdict: 'sparse' }
  const countOf = (hay, needle) => hay.split(needle).length - 1

  // M1：sparse，OCR 块＝页眉＋正文 -> merge，原文保留＋正文追加
  const m1 = mergePage(sparseFixture)
  tEq('M1 action', m1.action, 'merge')
  tEq('M1 reason', m1.reason, 'ocr_adds_novel_text')
  tEq('M1 首段仍是页眉', m1.paragraphs[0], HEADER)
  t('M1 最终含 150 字正文', m1.paragraphs.join(' ').includes(BODY))
  t('M1 discarded 记 covered_by_text_layer（页眉块）', m1.discarded.some(d => d.reason === 'covered_by_text_layer' && d.blocks === 1))
  t('M1 审计 droppedBlocks', auditDropped(m1))

  // M1b：OCR 把页眉＋正文合成一个块 -> 长度上限先判未覆盖，整块走 merge
  const m1b = mergePage({ ...sparseFixture, ocrBlocks: [{ text: HEADER + ' ' + BODY, bbox: [72, 400, 500, 780] }] })
  tEq('M1b 合成块 action', m1b.action, 'merge')
  t('M1b 结果含正文（页眉允许重复）', m1b.paragraphs.join(' ').includes(BODY))
  t('M1b 审计 droppedBlocks', auditDropped(m1b))

  // M1c：image_body 与 sparse 同路径（夹具页实际 verdict 是 image_body）
  const m1c = mergePage(fixture)
  tEq('M1c image_body 与 sparse 同结果', [m1c.action, m1c.reason, m1c.paragraphs], [m1.action, m1.reason, m1.paragraphs])

  // M2：只读正文
  const m2 = mergePage({ ...sparseFixture, ocrBlocks: [BODY_BLOCK] })
  tEq('M2 action', m2.action, 'merge')
  tEq('M2 novelVis=150', m2.stats.novelVis, 150)
  t('M2 含正文', m2.paragraphs.join(' ').includes(BODY))

  // M3：没有 OCR 块
  const m3 = mergePage({ ...sparseFixture, ocrBlocks: [] })
  tEq('M3 action', m3.action, 'keep')
  tEq('M3 reason', m3.reason, 'ocr_empty')
  tEq('M3 原文不动', m3.paragraphs, [HEADER])
  tEq('M3 discarded 为空', m3.discarded, [])
  tEq('M3 droppedBlocks=0', m3.stats.droppedBlocks, 0)

  // M4 / M4b / M4c：非 CJK 脚本下限 4（>= 含边界）
  const m4 = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: 'abcde', bbox: [72, 300, 200, 320] }] })
  tEq('M4 5 字符新块被接受', m4.action, 'merge')
  t('M4 结果含 abcde', m4.paragraphs.includes('abcde'))
  const m4b = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: 'x', bbox: [72, 300, 80, 320] }] })
  tEq('M4b 1 字符 -> novel_below_block_min', [m4b.action, m4b.reason], ['keep', 'novel_below_block_min'])
  t('M4b 审计', auditDropped(m4b))
  const m4c = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: 'abcd', bbox: [72, 300, 200, 320] }] })
  tEq('M4c 恰好 4 字符被接受（>= 边界）', m4c.action, 'merge')
  t('M4c 结果含 abcd', m4c.paragraphs.includes('abcd'))

  // M5：OCR 只有页眉
  const m5 = mergePage({ ...sparseFixture, ocrBlocks: [HDR] })
  tEq('M5 无新块 -> keep ocr_no_novel_text', [m5.action, m5.reason], ['keep', 'ocr_no_novel_text'])
  t('M5 审计', auditDropped(m5))

  // M6 / M6b / M6c / M6d：replace 只留给 empty 且 vis===0
  const m6 = mergePage({ verdict: 'empty', paragraphs: [], ocrBlocks: [BODY_BLOCK] })
  tEq('M6 empty+vis0 -> replace', [m6.action, m6.reason], ['replace', 'empty_page'])
  tEq('M6 droppedBlocks=0', m6.stats.droppedBlocks, 0)
  const m6b = mergePage({ verdict: 'empty', paragraphs: [HEADER], ocrBlocks: [BODY_BLOCK] })
  tEq('M6b empty 但 vis>0 -> 不 replace，走 merge', [m6b.action, m6b.reason], ['merge', 'ocr_adds_novel_text'])
  tEq('M6b verdictMismatch=true', m6b.stats.verdictMismatch, true)
  tEq('M6b 原文保留', m6b.paragraphs[0], HEADER)
  t('M6b 含正文', m6b.paragraphs.join(' ').includes(BODY))
  t('M6b 审计', auditDropped(m6b))
  const m6c = mergePage({ verdict: 'empty', paragraphs: [HEADER], ocrBlocks: [HDR] })
  tEq('M6c empty+vis>0 且无新块 -> keep ocr_no_novel_text', [m6c.action, m6c.reason], ['keep', 'ocr_no_novel_text'])
  tEq('M6c verdictMismatch=true', m6c.stats.verdictMismatch, true)
  tEq('M6c 原文不动', m6c.paragraphs, [HEADER])
  const m6d = mergePage({ verdict: 'empty', paragraphs: ['  ​'], ocrBlocks: [BODY_BLOCK] })
  tEq('M6d 零可见原文也过 replace 门', [m6d.action, m6d.reason], ['replace', 'empty_page'])
  t('M6d discarded 含 text_layer_replaced{blocks:1,vis:0}',
    m6d.discarded.some(d => d.reason === 'text_layer_replaced' && d.blocks === 1 && d.vis === 0))
  tEq('M6d text_layer_replaced 不计入 droppedBlocks', m6d.stats.droppedBlocks, 0)

  // M7：重复 OCR 块
  const m7 = mergePage({ ...sparseFixture, ocrBlocks: [HDR, BODY_BLOCK, BODY_BLOCK] })
  tEq('M7 action=merge', m7.action, 'merge')
  t('M7 页眉只出现一次', countOf(m7.paragraphs.join(' '), HEADER) === 1)
  t('M7 正文只出现一次', countOf(m7.paragraphs.join(' '), BODY) === 1)
  t('M7 discarded 含 duplicate_block', m7.discarded.some(d => d.reason === 'duplicate_block' && d.blocks === 1))
  t('M7 审计 droppedBlocks', auditDropped(m7))

  // M8：text 页误调用（防御分支）
  const m8 = mergePage({ verdict: 'text', paragraphs: [HEADER], ocrBlocks: [BODY_BLOCK] })
  tEq('M8 text -> keep page_has_text_layer', [m8.action, m8.reason], ['keep', 'page_has_text_layer'])
  tEq('M8 discarded 为空', m8.discarded, [])

  // M9 / M9b / M9c：ocr_empty（页级零可见字符）
  const m9 = mergePage({ verdict: 'empty', paragraphs: [], ocrBlocks: [] })
  tEq('M9 无块 -> keep ocr_empty', [m9.action, m9.reason], ['keep', 'ocr_empty'])
  tEq('M9 discarded 为空', m9.discarded, [])
  tEq('M9 droppedBlocks=0', m9.stats.droppedBlocks, 0)
  const m9b = mergePage({ ...sparseFixture, ocrBlocks: [{ text: '  \n' }] })
  tEq('M9b 零可见字符块 -> keep ocr_empty', [m9b.action, m9b.reason], ['keep', 'ocr_empty'])
  t('M9b discarded 记一条汇总 ocr_empty{blocks:1,vis:0}',
    m9b.discarded.length === 1 && m9b.discarded[0].reason === 'ocr_empty' && m9b.discarded[0].blocks === 1 && m9b.discarded[0].vis === 0)
  tEq('M9b ocr_empty 不计入 droppedBlocks', m9b.stats.droppedBlocks, 0)
  tEq('M9b 早退不做段落化 -> degraded=false', m9b.stats.degraded, false)
  const m9c = mergePage({ verdict: 'empty', paragraphs: ['orig'], ocrBlocks: [] })
  tEq('M9c 早退也带 verdictMismatch', [m9c.action, m9c.reason, m9c.stats.verdictMismatch], ['keep', 'ocr_empty', true])
  tEq('M9c droppedBlocks=0', m9c.stats.droppedBlocks, 0)

  // M10：覆盖块＋过短块一起丢弃，审计式计数（F1）
  const m10 = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: 'abcde' }, { text: 'xy' }] })
  tEq('M10 only abcde 被追加', m10.action === 'merge' && m10.paragraphs.includes('abcde') && !m10.paragraphs.includes('xy'), true)
  t('M10 discarded 含 covered_by_text_layer＋below_min_block',
    m10.discarded.some(d => d.reason === 'covered_by_text_layer' && d.blocks === 1) &&
    m10.discarded.some(d => d.reason === 'below_min_block' && d.blocks === 1))
  tEq('M10 droppedBlocks=2', m10.stats.droppedBlocks, 2)
  t('M10 审计 droppedBlocks', auditDropped(m10))

  // M11：无 bbox 退化「一块一段」
  const m11 = mergePage({
    ...sparseFixture,
    ocrBlocks: [{ text: HEADER }, { text: BODY }],
  })
  tEq('M11 action=merge', m11.action, 'merge')
  tEq('M11 degraded=true', m11.stats.degraded, true)
  t('M11 正文仍进入段落', m11.paragraphs.includes(BODY))
  t('M11 有 bbox 时 degraded=false', m1.stats.degraded === false && fixture.ocrBlocks.every(b => Array.isArray(b.bbox)))

  // M12 / M12b / M12c：CJK 下限 2（>= 含边界）
  const m12 = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: '第一章', bbox: [72, 300, 200, 320] }] })
  tEq('M12 3 个 CJK 字被接受', m12.action, 'merge')
  t('M12 结果含第一章', m12.paragraphs.includes('第一章'))
  const m12b = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: '序', bbox: [72, 300, 200, 320] }] })
  tEq('M12b 1 个 CJK 字 -> novel_below_block_min', [m12b.action, m12b.reason], ['keep', 'novel_below_block_min'])
  const m12c = mergePage({ ...sparseFixture, ocrBlocks: [HDR, { text: '图书', bbox: [72, 300, 200, 320] }] })
  tEq('M12c 2 个 CJK 字恰好等于下限 -> 接受', m12c.action, 'merge')
  t('M12c 结果含图书', m12c.paragraphs.includes('图书'))
  t('M12c 审计', auditDropped(m12c))

  // M13：replace 分支里也去重
  const m13 = mergePage({ verdict: 'empty', paragraphs: [], ocrBlocks: [BODY_BLOCK, BODY_BLOCK] })
  tEq('M13 action=replace', m13.action, 'replace')
  t('M13 正文只出现一次', countOf(m13.paragraphs.join(' '), BODY) === 1)
  t('M13 discarded 含 duplicate_block', m13.discarded.some(d => d.reason === 'duplicate_block' && d.blocks === 1))
  tEq('M13 droppedBlocks=1', m13.stats.droppedBlocks, 1)

  // 审计不变量：每个用例 droppedBlocks === Σ 三类 OCR 丢弃（§11.2.3）
  for (const [name, r] of [['M1', m1], ['M1b', m1b], ['M1c', m1c], ['M2', m2], ['M3', m3],
    ['M4', m4], ['M4b', m4b], ['M4c', m4c], ['M5', m5], ['M6', m6], ['M6b', m6b], ['M6c', m6c],
    ['M6d', m6d], ['M7', m7], ['M8', m8], ['M9', m9], ['M9b', m9b], ['M9c', m9c], ['M10', m10],
    ['M11', m11], ['M12', m12], ['M12b', m12b], ['M12c', m12c], ['M13', m13]]) {
    t(`审计不变量（droppedBlocks 口径）${name}`, auditDropped(r))
  }

  // 反例：旧式 ocrVis >= max(100, 2×vis) 会丢掉 150 字正文；新规则必须不丢（§11.6.3）
  function legacyMergePage(input) {
    const paras = input.paragraphs || []
    const blocks = input.ocrBlocks || []
    const vis = paras.reduce((n, s) => n + visOf(s), 0)
    const ocrVis = blocks.reduce((n, b) => n + visOf(b && b.text), 0)
    if (input.verdict === 'text') return { action: 'keep', reason: 'page_has_text_layer', paragraphs: paras }
    if (ocrVis >= Math.max(100, 2 * vis)) {
      return { action: 'replace', reason: 'empty_page', paragraphs: ocrParagraphsOf(blocks) }
    }
    return { action: 'keep', reason: 'legacy_threshold_discard', paragraphs: paras }
  }
  const legacyBoth = legacyMergePage({ ...fixture, ocrBlocks: [HDR, BODY_BLOCK] }) // ocrVis 350
  const legacyBody = legacyMergePage({ ...fixture, ocrBlocks: [BODY_BLOCK] })     // ocrVis 150
  tEq('反例：旧规则在 350/150 两种 OCR 字数下都判 keep', [legacyBoth.action, legacyBody.action], ['keep', 'keep'])
  tEq('反例：旧规则 reason=legacy_threshold_discard', [legacyBoth.reason, legacyBody.reason], ['legacy_threshold_discard', 'legacy_threshold_discard'])
  t('反例：旧规则最终只剩页眉（正文丢失）', !legacyBoth.paragraphs.join(' ').includes(BODY) && !legacyBody.paragraphs.join(' ').includes(BODY))
  t('反例：新 mergePage 不丢正文', m1.paragraphs.join(' ').includes(BODY) && m1.action === 'merge')

  // 生产代码里不得留 legacy 分支或旧阈值（legacy 仅存在于本测试）
  const mergeSrc = fs.readFileSync(new URL('./src/import/ocrMerge.js', import.meta.url), 'utf8')
  t('生产 ocrMerge.js 不含 legacy_threshold_discard', !mergeSrc.includes('legacy_threshold_discard'))
  t('生产 ocrMerge.js 不含旧阈值 max(100, 2*vis)', !/max\(\s*100\s*,\s*2\s*\*/.test(mergeSrc))
}

console.log('\n[pdf.js — 真 PDF（legacy pdfjs）]')
{
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

  const book = await parsePdf(read('text-layer.pdf'), { pdfjs })
  tEq('按目录切两章', book.chapters.map(c => c.title), ['Chapter One', 'Chapter Two'])
  tEq('第一章正文（标题行去重）', book.chapters[0].paragraphs, [
    'The first paragraph of chapter one. It has two sentences.',
    'A second paragraph follows here after a short gap.',
  ])
  tEq('第二章正文', book.chapters[1].paragraphs, ['Chapter two body text only.'])
  t('parsePdf 返回 pages / verdicts / textChars', Array.isArray(book.pages) && Array.isArray(book.verdicts) && book.textChars > 0)
  // 这个夹具每页只有两三行短文本，按 §11.1.4 会判 sparse／image_body —— 不假设一定 text，
  // 只钉「每页 verdict 与 vis/cov 走同一个 verdictOf」这层接线。
  tEq('每页 verdict 与 verdictOf({vis,cov}) 一致', book.pages.every(p => p.verdict === verdictOf(p).state), true)
  tEq('pages 与 verdicts 一一对应', book.pages.length, book.verdicts.length)
  t('每页带 vis / cov（cov 在 0..1）', book.pages.every(p => p.vis > 0 && p.cov >= 0 && p.cov <= 1))
  tEq('text-layer.pdf 的可读字符数与 textChars 一致',
    book.textChars, book.pages.reduce((n, p) => n + p.paragraphs.reduce((m, s) => m + visOf(s), 0), 0))

  // §10.1 前置：无文字层不再抛 PDF_NO_TEXT，改由 UI 判态 2
  const scanned = await parsePdf(read('no-text-layer.pdf'), { pdfjs })
  tEq('没有文本层 -> 不抛错，textChars=0', scanned.textChars, 0)
  t('没有文本层的页 verdict 是 empty', scanned.verdicts.length > 0 && scanned.verdicts.every(v => v === 'empty'))
  tEq('没有文本层 -> 零章节（不落库的判断交给 UI）', scanned.chapters.length, 0)

  // merge 入口：有 ocrByPage 时在 pagesToChapters 之前逐页走 mergePage
  const ocrText = 'Recognized scanned body text.'
  const withOcr = await parsePdf(read('no-text-layer.pdf'), {
    pdfjs,
    ocrByPage: new Map([[1, [{ text: ocrText }]]]),
  })
  t('ocrByPage：识别文本进了章节', JSON.stringify(withOcr.chapters).includes(ocrText))
  t('ocrByPage：textChars 按合并结果算', withOcr.textChars > 0)

  tEq('不是 PDF -> PDF_INVALID', await codeOf(() => parsePdf(read('sample.txt'), { pdfjs })), 'PDF_INVALID')
  tEq('中途取消 -> CANCELLED', await codeOf(() => parsePdf(read('text-layer.pdf'), { pdfjs, signal: { aborted: true } })), 'CANCELLED')
}

console.log('\n[index.js — importBook 端到端]')
{
  const txtBytes = read('sample.txt')
  const book = await importBook({ name: 'sample.txt', bytes: txtBytes })
  const wantId = 'bk_' + createHash('sha256').update(Buffer.from(txtBytes)).digest('hex').slice(0, 16)
  tEq('bookId = 真 SHA-256 前 16 位（与 node:crypto 交叉核对）', book.bookId, wantId)
  tEq('bookId 形状', /^bk_[0-9a-f]{16}$/.test(book.bookId), true)
  tEq('txt -> 两章', book.chapters.length, 2)
  tEq('题目缺省取文件名', book.title, 'sample')

  const again = await importBook({ name: 'renamed-anywhere/sample.txt', bytes: txtBytes })
  t('同一内容给同一 id（跨文件名去重）', again.bookId === book.bookId)
  const other = await importBook({ name: 'sample.epub', bytes: read('sample.epub') })
  t('不同内容给不同 id', other.bookId !== book.bookId)
  tEq('epub 的书名来自 OPF', other.title, 'Import Sample Book')
  tEq('epub -> 两章', other.chapters.length, 2)
  tEq('没有封面的书 coverUrl 是空串', book.coverUrl, '')
  const cov = await importBook({ name: 'cover.epub', bytes: read('cover.epub') })
  tEq('importBook 把内嵌封面带成 data URL', cov.coverUrl.startsWith('data:image/png;base64,'), true)
  t('importBook 产出的封面过白名单', isCoverDataUrl(cov.coverUrl))

  tEq('.mobi -> UNSUPPORTED_FORMAT', await codeOf(() => importBook({ name: 'a.mobi', bytes: new Uint8Array([1, 2, 3, 4]) })), 'UNSUPPORTED_FORMAT')
  tEq('空文件 -> EMPTY_CONTENT', await codeOf(() => importBook({ name: 'a.txt', bytes: new Uint8Array(0) })), 'EMPTY_CONTENT')
  const oversize = new Uint8Array(MAX_FILE_BYTES + 1)
  tEq('超限 -> FILE_TOO_BIG', await codeOf(() => importBook({ name: 'big.txt', bytes: oversize })), 'FILE_TOO_BIG')
  tEq('没有字节 -> UNSUPPORTED_FORMAT', await codeOf(() => importBook({ name: 'x.pdf' })), 'UNSUPPORTED_FORMAT')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
