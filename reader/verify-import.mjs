/**
 * BYO 导入解析层验证（第 5 步 5A；不依赖浏览器 / 网络）。
 *   import/errors.js — 错误口径（code/message/hint）
 *   import/book.js   — 格式识别 / 编号 / 出口净化
 *   utils/bookCover.js — 封面 data URL（大小上限 / 白名单；book.js 与存储层共用）
 *   import/html.js   — XHTML -> 段落（实体、script/style、块级边界）
 *   import/txt.js    — 编码识别（BOM/UTF-8/GBK/UTF-16）+ 切段切章
 *   import/epub.js   — 解包 / container+OPF / spine 顺序 / DRM 拦截
 *   import/pdf.js    — 纯函数（groupLines/linesToParagraphs/pagesToChapters）+ 真 PDF 取字
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

  tEq('没有文本层 -> PDF_NO_TEXT', await codeOf(() => parsePdf(read('no-text-layer.pdf'), { pdfjs })), 'PDF_NO_TEXT')
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
