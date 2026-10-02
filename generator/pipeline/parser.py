"""
epub/txt/pdf 解析器
输入：epub / txt / pdf 文件路径
输出：chapters.json 数据结构
"""

import os
import re
import json
import io
import bisect
import zipfile
from ebooklib import epub
from bs4 import BeautifulSoup


# ---- encoding helpers ----

def _safe_decode(raw: bytes) -> str:
    """Decode bytes with BOM-aware fallback chain: utf-8-sig -> utf-8 -> latin-1 -> cp1252."""
    if raw is None:
        return ''
    if not isinstance(raw, bytes):
        # Already a string (shouldn't happen, but be safe)
        return str(raw)

    for encoding in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
        try:
            text = raw.decode(encoding)
            # If the result starts with BOM (which shouldn't happen with utf-8-sig
            # but could with plain utf-8), strip it
            if text and text[0] == '\ufeff':
                text = text[1:]
            return text
        except (UnicodeDecodeError, UnicodeError):
            continue
    # Absolute last resort
    return raw.decode('utf-8', errors='ignore')


def _safe_json_load(file_path: str) -> dict:
    """Read a JSON file that may have a UTF-8 BOM. Returns empty dict on any error."""
    try:
        with open(file_path, 'rb') as f:
            raw = f.read()
        # json.loads() rejects BOM; strip it ourselves
        text = raw.decode('utf-8-sig')
        return json.loads(text)
    except Exception:
        return {}


def _safe_json_dump(obj, file_path: str, **kwargs):
    """Write JSON without BOM (always UTF-8, no BOM)."""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, **kwargs)
    with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


# ---- main parser entry points ----

def parse_epub(file_path: str, book_id: str) -> dict:
    """Parse epub file, extract chapter structure and text content.

    Handles non-standard epubs with:
    - UTF-8 BOM in content files
    - Malformed OPF/NCX XML (auto-repairs by stripping BOMs before ebooklib reads)
    - Missing TOC (falls back to spine order)
    - Non-UTF-8 content (tries latin-1/cp1252 fallback)
    """
    book = _read_epub_robust(file_path)

    title = _safe_get(book.get_metadata('DC', 'title'), file_path)
    author = _safe_get(book.get_metadata('DC', 'creator'), 'Unknown')

    chapters = []
    toc = book.toc
    spine = book.spine

    # Get all document items
    all_items = {}
    for item in book.get_items_of_type(9):  # ITEM_DOCUMENT = 9
        all_items[item.get_id()] = item

    chapter_index = 0
    seen_texts = set()

    # Prefer TOC structure if available
    if toc:
        for toc_item in _flatten_toc(toc):
            href = toc_item.href.split('#')[0] if toc_item.href else ''
            title_text = toc_item.title if toc_item.title else f'Chapter {chapter_index + 1}'

            matched = False
            # Try exact file_name match first
            for item_id, item in all_items.items():
                if href and item.file_name and href in item.file_name:
                    content_raw = item.get_content()
                    content = _clean_html(_safe_decode(content_raw))
                    paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
                    if paragraphs:
                        chapter_index += 1
                        chapters.append({
                            'id': f'ch-{chapter_index:02d}',
                            'title': _clean_text(title_text),
                            'paragraphs': paragraphs
                        })
                    matched = True
                    break

            if matched:
                continue

            # Try matching by href basename against all item file_names
            href_basename = os.path.basename(href) if href else ''
            if href_basename:
                for item_id, item in all_items.items():
                    if item.file_name and href_basename in item.file_name:
                        content_raw = item.get_content()
                        content = _clean_html(_safe_decode(content_raw))
                        paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
                        if paragraphs:
                            chapter_index += 1
                            chapters.append({
                                'id': f'ch-{chapter_index:02d}',
                                'title': _clean_text(title_text),
                                'paragraphs': paragraphs
                            })
                        matched = True
                        break

            if matched:
                continue

            # Still not matched - try using the href itself as content
            content = _clean_html(href)
            paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
            if paragraphs:
                chapter_index += 1
                chapters.append({
                    'id': f'ch-{chapter_index:02d}',
                    'title': _clean_text(title_text),
                    'paragraphs': paragraphs
                })

    # Fall back to spine order if TOC yielded nothing
    if not chapters:
        chapter_index = 0
        for spine_entry in spine:
            item_id = spine_entry[0] if isinstance(spine_entry, tuple) else spine_entry
            item = all_items.get(item_id)
            if item is None:
                continue

            try:
                content_raw = item.get_content()
                content = _clean_html(_safe_decode(content_raw))
            except Exception:
                continue  # Skip items that can't be decoded

            paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
            if paragraphs:
                chapter_index += 1
                chapters.append({
                    'id': f'ch-{chapter_index:02d}',
                    'title': f'Chapter {chapter_index}',
                    'paragraphs': paragraphs
                })

    return {
        'bookId': book_id,
        'title': title,
        'author': author,
        'chapters': chapters
    }


def parse_txt(file_path: str, book_id: str) -> dict:
    """Parse txt file, split by chapter markers. Handles BOM in the file."""
    raw_bytes = None
    with open(file_path, 'rb') as f:
        raw_bytes = f.read()
    text = _safe_decode(raw_bytes)

    title = os.path.splitext(os.path.basename(file_path))[0]

    # Split by chapter markers (supports multiple formats)
    chapter_pattern = re.compile(
        r'(?:^|\n)\s*'
        r'(?:Chapter|CHAPTER|Ch\.|CH\.)\s*'
        r'(\d+|[IVXLCDM]+)'
        r'\s*[\n:.\-\u2014]?\s*',
        re.IGNORECASE
    )

    splits = list(chapter_pattern.finditer(text))

    chapters = []
    if splits:
        for i, match in enumerate(splits):
            start = match.end()
            end = splits[i + 1].start() if i + 1 < len(splits) else len(text)
            chapter_text = text[start:end].strip()

            # Try to get chapter title from first line
            lines = chapter_text.split('\n')
            chapter_title = lines[0].strip() if lines else f'Chapter {i + 1}'

            paragraphs = []
            para_texts = [p.strip() for p in chapter_text.split('\n\n') if p.strip()]
            for j, p in enumerate(para_texts):
                if len(p) > 30:
                    paragraphs.append({
                        'id': f'p-{i+1:02d}-{j+1:03d}',
                        'text': _clean_text(p),
                        'annotatedWords': []
                    })

            if paragraphs:
                chapters.append({
                    'id': f'ch-{i+1:02d}',
                    'title': _clean_text(chapter_title[:100]),
                    'paragraphs': paragraphs
                })
    else:
        # No chapter markers: entire book as one chapter
        paragraphs = []
        para_texts = [p.strip() for p in text.split('\n\n') if p.strip()]
        for j, p in enumerate(para_texts):
            if len(p) > 30:
                paragraphs.append({
                    'id': f'p-01-{j+1:03d}',
                    'text': _clean_text(p),
                    'annotatedWords': []
                })
        if paragraphs:
            chapters.append({
                'id': 'ch-01',
                'title': title,
                'paragraphs': paragraphs
            })

    return {
        'bookId': book_id,
        'title': title,
        'author': 'Unknown',
        'chapters': chapters
    }


def parse_pdf(file_path: str, book_id: str, progress_callback=None) -> dict:
    """Parse PDF file. Auto-detects PDF type:
    - Text-layer PDF (sample first 5 pages) -> text extraction with chapter/paragraph splitting
    - Image-only PDF (no text layer) -> render JPG + OCR word coordinates for image reading mode

    Returns image-mode data when image PDF detected:
    {bookId, title, author, type:'image',
     chapters: [{id, title, paragraphs:[], image:{url,width,height},
                 words:[{text,x,y,w,h}]}],
     _wordList: {bookId, words:{lemma:{lemma,chapters,totalOccurrences}}}}
    """
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)

    # Get metadata
    meta = doc.metadata or {}
    title = meta.get('title') or os.path.splitext(os.path.basename(file_path))[0]
    author = meta.get('author') or 'Unknown'

    # Detect PDF type: sample first 5 pages
    sample_pages = min(5, doc.page_count)
    sample_text = ''.join(doc[i].get_text('text') for i in range(sample_pages))

    if len(sample_text.strip()) > 200:
        # Text-layer PDF: use existing text extraction path
        result = _parse_text_pdf(doc, title, author, book_id)
        doc.close()
        return result

    # Image-only PDF: render JPG + OCR word coordinates
    result = _parse_image_pdf(doc, title, author, book_id, file_path, progress_callback)
    doc.close()
    return result


def _normalize_head_line(line: str) -> str:
    """Normalize a line for running-head comparison."""
    line = re.sub(r'[\x00-\x1f\xad]', '', line)
    return re.sub(r'\s+', ' ', line).strip().lower()


def _pdf_lines(doc) -> list:
    """Per-page body lines with layout geometry: [[(text, x0, x1), ...], ...].

    Character counts are a poor stand-in for how wide a line actually is, since
    the type is proportional. The x-coordinates let paragraph breaks be read off
    the real layout instead of guessed from text length.
    """
    pages = []
    for page in doc:
        lines = []
        for block in page.get_text('dict')['blocks']:
            if block.get('type') != 0:  # 0 = text block; skip images
                continue
            for line in block['lines']:
                text = ''.join(span['text'] for span in line['spans'])
                if text.strip():
                    x0, _, x1, _ = line['bbox']
                    lines.append((text, x0, x1))
        pages.append(lines)
    return pages


def _strip_running_heads(page_lines: list) -> list:
    """Remove running headers/footers and page numbers from each page.

    Page furniture is detected by frequency rather than by hard-coded text: a
    short line recurring in the top/bottom margin of at least 30% of pages is a
    running head (e.g. the author name on versos, the book title on rectos).
    Page numbers -- pure digits, or the stray control glyphs some PDFs emit in
    their place -- are dropped from those same margin zones.

    Body text is never touched: only the first/last two lines of a page are
    examined, so a phrase that happens to repeat mid-page survives.

    Never empties a page: if stripping would leave nothing, the page is returned
    as-is, so a book whose every page is one repeated line still parses.
    """
    if len(page_lines) < 3:
        return page_lines

    counts = {}
    for lines in page_lines:
        margin = lines[:2] + lines[-2:]
        for norm in {_normalize_head_line(t) for t, _, _ in margin}:
            if norm:
                counts[norm] = counts.get(norm, 0) + 1

    threshold = max(3, int(len(page_lines) * 0.3))
    running_heads = {n for n, c in counts.items() if c >= threshold and len(n) <= 60}

    cleaned_pages = []
    for lines in page_lines:
        kept = []
        for i, (text, x0, x1) in enumerate(lines):
            norm = _normalize_head_line(text)
            if norm and norm in running_heads:
                continue
            # Page-number zones are only the first/last two lines.
            if (i < 2 or i >= len(lines) - 2) and (not norm or norm.isdigit()):
                continue
            kept.append((text, x0, x1))
        cleaned_pages.append(kept or lines)

    return cleaned_pages


# Bullet glyphs used as section-heading furniture by some typeset PDFs.
_BULLET_CHARS = '•·●▪⁃'
# Words that begin the continuation line of a heading wrapped across two lines.
_HEADING_CONTINUATIONS = {
    'of', 'the', 'and', 'to', 'in', 'a', 'an', 'for', 'at', 'on', 'with', 'from',
}
_HEADING_LINE_RE = re.compile(
    r'^\s*[%s]\s*(.+?)\s*[%s]\s*$' % (_BULLET_CHARS, _BULLET_CHARS)
)
# A line falling this far short of the right margin (in points) ends a paragraph.
# Hyphenated continuation lines stop ~2pt short, so they are unaffected.
_PARAGRAPH_SHORTFALL_PT = 25.0


def _title_case_heading(title: str) -> str:
    """Capitalize each word's first letter, leaving apostrophes alone.

    str.title() would turn "jekyll's" into "Jekyll'S"; matching the apostrophe
    as part of the word ("lanyon's" is one word, not "lanyon" + "s") keeps it
    as "Jekyll's".
    """
    return re.sub(
        r"[A-Za-z][A-Za-z'’]*",
        lambda m: m.group(0)[0].upper() + m.group(0)[1:],
        title,
    )


def _find_heading_lines(lines: list) -> list:
    """Find ``bullet title bullet`` heading lines, as [(line_index, title)].

    A heading wrapped across two lines ("• ...full statement •" / "• of the
    case •") is merged back into one title, but only when the two heading lines
    are adjacent and the second reads as a continuation.
    """
    found = []
    for i, (text, _, _) in enumerate(lines):
        match = _HEADING_LINE_RE.match(text)
        if not match:
            continue
        title = _clean_text(match.group(1))
        if title and len(title) <= 120:
            found.append([i, title])

    if len(found) < 2:
        return []

    merged = [found[0]]
    for index, title in found[1:]:
        prev = merged[-1]
        if index == prev[0] + 1:
            first_word = title.split(' ', 1)[0].strip('.,;:').lower()
            if first_word in _HEADING_CONTINUATIONS:
                prev[1] = f'{prev[1]} {title}'
                prev[0] = index
                continue
        merged.append([index, title])

    return [tuple(m) for m in merged]


def _group_paragraphs(lines: list) -> list:
    """Group hard-wrapped lines into paragraphs using the page layout.

    A PDF of prose has no blank lines: text is hard-wrapped to a fixed column
    and paragraphs run straight on, so splitting on blank lines yields one
    paragraph per page -- or, once chapters are real, one per whole chapter.

    Two typographic signals recover the real breaks: a paragraph's last line
    falls short of the right margin, and the next paragraph's first line is
    indented past the left margin of the continuation lines.
    """
    if not lines:
        return []

    lefts = sorted(x0 for _, x0, _ in lines)
    left_margin = lefts[len(lefts) // 2]  # continuation lines are the majority
    right_margin = max(x1 for _, _, x1 in lines)

    groups, current = [], []
    for text, x0, x1 in lines:
        indented = x0 > left_margin + 3
        prev_ended_short = bool(current) and current[-1][2] < right_margin - _PARAGRAPH_SHORTFALL_PT
        if current and (indented or prev_ended_short):
            groups.append(current)
            current = []
        current.append((text, x0, x1))
    if current:
        groups.append(current)

    return [' '.join(t for t, _, _ in group) for group in groups]


def _parse_text_pdf(doc, title: str, author: str, book_id: str) -> dict:
    """Text-layer PDF extraction: split by "Chapter N" markers, by bulleted
    section headings, or -- failing both -- group every 5 pages."""
    all_pages = _strip_running_heads(_pdf_lines(doc))
    flat = [line for lines in all_pages for line in lines]
    full_text = '\n'.join(text for text, _, _ in flat)

    chapter_pattern = re.compile(
        r'(?:^|\n)\s*'
        r'(?:Chapter|CHAPTER|Ch\.|CH\.)\s*'
        r'(\d+|[IVXLCDM]+)'
        r'\s*[\n:.\-—]?\s*',
        re.IGNORECASE
    )
    splits = list(chapter_pattern.finditer(full_text))

    chapters = []
    seen_texts = set()
    sections = []  # (chapter number or None for the preamble, title, start, stop)

    if splits:
        # Map each "Chapter N" marker to the line holding it, so both chapter
        # paths can cut the line list and reflow real paragraphs the same way.
        line_starts, position = [], 0
        for text, _, _ in flat:
            line_starts.append(position)
            position += len(text) + 1  # +1 for the '\n' joining the lines
        cuts = [max(0, bisect.bisect_right(line_starts, m.start()) - 1) for m in splits]

        if cuts[0] > 0:
            sections.append((None, '前言', 0, cuts[0]))  # 前言
        for i, cut in enumerate(cuts):
            stop = cuts[i + 1] if i + 1 < len(cuts) else len(flat)
            sections.append((i + 1, _clean_text(flat[cut][0][:100]), cut, stop))
    else:
        headings = _find_heading_lines(flat)

        if headings:
            # No "Chapter N" markers, but the book does mark its sections with
            # bulleted headings -> take both the breaks and the titles from them.
            if headings[0][0] > 0:
                sections.append((None, '前言', 0, headings[0][0]))  # 前言
            for i, (index, heading) in enumerate(headings):
                stop = headings[i + 1][0] if i + 1 < len(headings) else len(flat)
                sections.append((i + 1, _title_case_heading(heading[:100]), index, stop))

    if sections:
        for number, chapter_title, start, stop in sections:
            index = number or 0
            # Reflow the hard-wrapped lines into real paragraphs first: without
            # this a whole chapter collapses into a single block, which breaks
            # the per-paragraph audio offsets and the reading progress.
            body = '\n\n'.join(_group_paragraphs(flat[start:stop]))
            paragraphs = _split_paragraphs(body, index, seen_texts)
            if paragraphs:
                chapters.append({
                    'id': f'ch-{index:02d}',
                    'title': chapter_title,
                    'paragraphs': paragraphs
                })
    else:
        # Last resort: this book has no chapter markers at all -- group by pages.
        page_chunks = []
        chunk_size = 5
        for i in range(0, len(all_pages), chunk_size):
            chunk_text = '\n'.join(
                text for page in all_pages[i:i + chunk_size] for text, _, _ in page
            ).strip()
            if chunk_text:
                page_chunks.append(chunk_text)

        if page_chunks:
            if len(page_chunks) == 1:
                paragraphs = _split_paragraphs(page_chunks[0], 0, seen_texts)
                if paragraphs:
                    chapters.append({
                        'id': 'ch-01',
                        'title': title,
                        'paragraphs': paragraphs
                    })
            else:
                for i, chunk in enumerate(page_chunks):
                    paragraphs = _split_paragraphs(chunk, i, seen_texts)
                    if paragraphs:
                        chapters.append({
                            'id': f'ch-{i+1:02d}',
                            'title': f'Pages {i * chunk_size + 1}-{min((i + 1) * chunk_size, len(all_pages))}',
                            'paragraphs': paragraphs
                        })

    # Post-process: normalize whitespace
    for ch in chapters:
        for p in ch['paragraphs']:
            p['text'] = _clean_text(p['text'])

    return {
        'bookId': book_id,
        'title': title,
        'author': author,
        'chapters': chapters
    }


def _parse_image_pdf(doc, title: str, author: str, book_id: str,
                     file_path: str, progress_callback=None) -> dict:
    """Image-only PDF: render each page as JPG + OCR English word coordinates.

    Returns image-mode data with:
    - type: 'image'
    - Each chapter = one page with image URL, dimensions, and clickable word coordinates
    - _wordList for dictionary lookup pipeline step
    """
    import os as _os

    # Tesseract environment
    tess_path = r'C:\Program Files\Tesseract-OCR'
    _os.environ['PATH'] = tess_path + ';' + _os.environ.get('PATH', '')
    _os.environ['TESSDATA_PREFIX'] = tess_path + r'\tessdata'

    DPI = 200
    scale = DPI / 72.0  # PDF points -> image pixels conversion factor

    # Image output directory: my-reader/reader/public/books/<book_id>/pages/
    pages_dir = _os.path.join(
        _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
        'reader', 'public', 'books', book_id, 'pages'
    )
    _os.makedirs(pages_dir, exist_ok=True)

    total = doc.page_count
    chapters = []
    all_words = {}  # word_lower -> set of chapter_ids

    for i in range(total):
        page = doc[i]

        # Render page as JPG at 200 DPI
        pix = page.get_pixmap(dpi=DPI)
        img_filename = f'page_{i+1:03d}.jpg'
        img_url = f'pages/{img_filename}'
        pix.save(_os.path.join(pages_dir, img_filename), 'jpeg', 85)

        img_width = pix.width
        img_height = pix.height

        # OCR English word coordinates at same DPI for alignment
        words = []
        try:
            tp = page.get_textpage_ocr(language='eng', dpi=DPI)
            raw_words = page.get_text('words', textpage=tp)

            for w in raw_words:
                x0, y0, x1, y1, text, block, line, word_no = w
                t = text.strip()
                if not _is_valid_english_word(t):
                    continue

                # Coordinate conversion: PDF points -> image pixels
                x_px = round(x0 * scale, 1)
                y_px = round(y0 * scale, 1)
                w_px = round((x1 - x0) * scale, 1)
                h_px = round((y1 - y0) * scale, 1)

                words.append({
                    'text': t,
                    'x': x_px, 'y': y_px,
                    'w': w_px, 'h': h_px
                })

                word_lower = t.lower()
                ch_id = f'ch-{i+1:03d}'
                if word_lower not in all_words:
                    all_words[word_lower] = set()
                all_words[word_lower].add(ch_id)
        except Exception:
            # Single page OCR failure doesn't abort the whole book
            pass

        chapters.append({
            'id': f'ch-{i+1:03d}',
            'title': f'Page {i+1}',
            'paragraphs': [],
            'image': {
                'url': img_url,
                'width': img_width,
                'height': img_height
            },
            'words': words
        })

        if progress_callback and (i + 1) % 10 == 0:
            pct = 10 + int(25 * (i + 1) / total)
            progress_callback(pct, f'Rendering+OCR... ({i+1}/{total} pages)')

    # Build word_list for dictionary lookup (format compatible with extractor output)
    word_list = {
        'bookId': book_id,
        'words': {
            word: {
                'lemma': word,
                'chapters': sorted(list(chs)),
                'totalOccurrences': len(chs)
            }
            for word, chs in all_words.items()
        }
    }

    return {
        'bookId': book_id,
        'title': title,
        'author': author,
        'type': 'image',
        'chapters': chapters,
        '_wordList': word_list
    }


def _is_valid_english_word(text: str) -> bool:
    """Filter OCR noise: decorative lines, watermarks, gibberish.

    Rules:
    1. Length >= 2
    2. Alpha ratio > 50% (excludes pure symbol/number OCR fragments)
    3. No character repeated 4+ times consecutively (excludes "eeeeee" decorative lines)
    4. Contains at least one vowel (excludes consonant-only OCR fragments)
    """
    t = text.strip()
    if len(t) < 2:
        return False
    # Alpha ratio > 50%
    alpha = sum(1 for c in t if c.isalpha())
    if alpha / len(t) < 0.5:
        return False
    # No character repeated 4+ times consecutively
    if re.search(r'(.)\1{3,}', t):
        return False
    # Contains at least one vowel
    if not re.search(r'[aeiouAEIOU]', t):
        return False
    return True


# ---- internal helpers ----

def _read_epub_robust(file_path: str):
    """Read an epub file, auto-repairing XML files that have BOM bytes."""
    try:
        return epub.read_epub(file_path)
    except Exception:
        pass

    # Attempt repair: strip BOMs from XML/OPF/NCX files inside the zip,
    # then let ebooklib try again
    try:
        repaired = _repair_epub_boms(file_path)
        if repaired:
            return epub.read_epub(file_path)
    except Exception:
        pass

    # Last resort: raise the original error for debugging
    return epub.read_epub(file_path)


def _repair_epub_boms(file_path: str) -> bool:
    """Strip UTF-8 BOM from internal XML/NCX/OPF files in the epub zip.
    Returns True if any file was modified."""
    modified = False
    try:
        with open(file_path, 'rb') as f:
            zip_data = bytearray(f.read())

        with zipfile.ZipFile(io.BytesIO(bytes(zip_data)), 'r') as zf:
            bom_files = []
            all_files = {}
            for name in zf.namelist():
                raw = zf.read(name)
                all_files[name] = raw
                if name.lower().endswith(('.xml', '.opf', '.ncx', '.smil')):
                    if raw.startswith(b'\xef\xbb\xbf'):
                        bom_files.append(name)

            if not bom_files:
                return False

            # Rebuild the zip without BOMs
            new_buf = io.BytesIO()
            with zipfile.ZipFile(new_buf, 'w', zipfile.ZIP_DEFLATED) as out_zf:
                for name, raw in sorted(all_files.items()):
                    if name in bom_files:
                        raw = raw[3:]  # Strip 3-byte UTF-8 BOM
                        modified = True
                    out_zf.writestr(name, raw)

            # Overwrite the original file
            with open(file_path, 'wb') as f:
                f.write(new_buf.getvalue())

    except Exception:
        return False

    return modified


def _clean_html(html_content: str) -> str:
    """Clean HTML/XHTML, extract plain text. Handles BOM, empty content, and malformed markup."""
    import warnings
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

    if not html_content or not isinstance(html_content, str):
        return ''

    # Strip any residual BOM that might have survived decoding
    if html_content and html_content[0] == '\ufeff':
        html_content = html_content[1:]

    # Try 'xml' parser first (best for XHTML epubs), fall back to 'html.parser'
    for parser in ('xml', 'lxml-xml', 'html.parser', 'lxml'):
        try:
            soup = BeautifulSoup(html_content, parser)
            # Remove script/style tags
            for tag in soup(['script', 'style', 'head', 'title']):
                tag.decompose()
            text = soup.get_text('\n')
            return text
        except Exception:
            continue

    # Last resort: strip all HTML tags with regex
    clean = re.sub(r'<[^>]+>', ' ', html_content or '')
    return clean


def _split_paragraphs(text: str, chapter_index: int, seen_texts: set) -> list:
    """Split text into paragraphs, deduplicate"""
    paragraphs = []
    raw_paras = [p.strip() for p in text.split('\n\n') if p.strip()]

    para_idx = 0
    for p in raw_paras:
        # Skip too-short text and pure number/symbol lines
        clean = _clean_text(p)
        if len(clean) < 30:
            continue
        # Deduplicate
        text_hash = clean[:100]
        if text_hash in seen_texts:
            continue
        seen_texts.add(text_hash)

        paragraphs.append({
            'id': f'p-{chapter_index+1:02d}-{para_idx+1:03d}',
            'text': clean,
            'annotatedWords': []
        })
        para_idx += 1

    return paragraphs


def _clean_text(text: str) -> str:
    """Clean text: merge excess whitespace, remove control characters"""
    # Soft hyphen marks an automatic line-break hyphen: drop it and rejoin the
    # word ("sen\xad\ntiment" -> "sentiment"). A soft hyphen never renders as a
    # visible hyphen, so removing it is correct in every case.
    text = re.sub(r'\xad\s*', '', text)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _clean_ocr_text(text: str) -> str:
    """Clean OCR noise lines (decorative lines misrecognized as characters, low-info lines)"""
    if not text:
        return ''
    lines = text.split('\n')
    kept = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Filter low-alpha-ratio lines (pure symbols/numbers/spaces, length > 10)
        alpha_count = sum(1 for c in stripped if c.isalpha())
        if len(stripped) > 10 and alpha_count / len(stripped) < 0.3:
            continue
        # Filter repeated-char lines (decorative lines recognized as "eeeeee..." or "======", length > 20)
        if len(stripped) > 20:
            top_count = max((stripped.count(c) for c in set(stripped)), default=0)
            if top_count / len(stripped) > 0.7:
                continue
        kept.append(stripped)
    return '\n'.join(kept)


def _ocr_image_pdf(doc, total_pages, progress_callback=None):
    """OCR each page of an image PDF, return list of page texts.
    Returns None if Tesseract is unavailable.

    Uses PyMuPDF's built-in get_textpage_ocr() which calls the local Tesseract CLI.
    Does not depend on pytesseract.
    """
    import os as _os
    tess_path = r'C:\Program Files\Tesseract-OCR'
    if not _os.path.exists(tess_path):
        return None

    _os.environ['PATH'] = tess_path + ';' + _os.environ.get('PATH', '')
    _os.environ['TESSDATA_PREFIX'] = tess_path + r'\tessdata'

    ocr_texts = []
    try:
        for i, page in enumerate(doc):
            try:
                tp = page.get_textpage_ocr(language='eng+chi_sim', dpi=200)
                text = page.get_text('text', textpage=tp)
                cleaned = _clean_ocr_text(text)
                ocr_texts.append(cleaned)
            except Exception:
                ocr_texts.append('')  # Single page OCR failure doesn't abort whole book

            # Report progress every 10 pages
            if progress_callback and (i + 1) % 10 == 0:
                pct = 10 + int(25 * (i + 1) / total_pages)
                progress_callback(pct, f'OCR in progress... ({i + 1}/{total_pages} pages)')
    except Exception:
        return None

    return ocr_texts


def _safe_get(metadata_list, fallback):
    """Safely get metadata"""
    if metadata_list and len(metadata_list) > 0:
        item = metadata_list[0]
        if isinstance(item, tuple) and len(item) > 0:
            return str(item[0])
        return str(item)
    return fallback


def _flatten_toc(toc, depth=0):
    """Flatten epub TOC tree"""
    items = []
    if not toc:
        return items
    for item in toc:
        if isinstance(item, tuple) and len(item) >= 2:
            section, children = item[0], item[1]
            if hasattr(section, 'href') and section.href:
                items.append(section)
            if children:
                items.extend(_flatten_toc(children, depth + 1))
        elif hasattr(item, 'href') and item.href:
            items.append(item)
    return items
