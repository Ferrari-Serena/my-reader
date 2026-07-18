"""
epub/txt 解析器
输入：epub 或 txt 文件路径
输出：chapters.json 数据结构
"""

import os
import re
import json
import io
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
            if text and text[0] == '﻿':
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
    """解析 epub 文件，提取章节结构和文本内容。

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

    # 获取所有文档项
    all_items = {}
    for item in book.get_items_of_type(9):  # ITEM_DOCUMENT = 9
        all_items[item.get_id()] = item

    chapter_index = 0
    seen_texts = set()

    # 如果有目录，优先使用目录结构
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

            # Still not matched — try using the href itself as content (unlikely but safe fallback)
            content = _clean_html(href)
            paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
            if paragraphs:
                chapter_index += 1
                chapters.append({
                    'id': f'ch-{chapter_index:02d}',
                    'title': _clean_text(title_text),
                    'paragraphs': paragraphs
                })

    # 如果目录解析没有产出章节，按 spine 顺序解析全部文档
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
    """解析 txt 文件，按章节标记分割。Handles BOM in the file."""
    raw_bytes = None
    with open(file_path, 'rb') as f:
        raw_bytes = f.read()
    text = _safe_decode(raw_bytes)

    title = os.path.splitext(os.path.basename(file_path))[0]

    # 按章节标记分割（支持多种格式）
    chapter_pattern = re.compile(
        r'(?:^|\n)\s*'
        r'(?:Chapter|CHAPTER|Ch\.|CH\.)\s*'
        r'(\d+|[IVXLCDM]+)'
        r'\s*[\n:.\-—]?\s*',
        re.IGNORECASE
    )

    splits = list(chapter_pattern.finditer(text))

    chapters = []
    if splits:
        for i, match in enumerate(splits):
            start = match.end()
            end = splits[i + 1].start() if i + 1 < len(splits) else len(text)
            chapter_text = text[start:end].strip()

            # 尝试获取章节标题（第一行）
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
        # 没有章节标记，整本书作为一个章节
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

        # We can't easily modify a zip in-place, but we can create a temp copy
        # Actually, let's just read the zip and check if any internal XML has BOM.
        # If it does, we strip and re-zip.
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
    """清理 HTML/XHTML，提取纯文本。Handles BOM, empty content, and malformed markup."""
    import warnings
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

    if not html_content or not isinstance(html_content, str):
        return ''

    # Strip any residual BOM that might have survived decoding
    if html_content and html_content[0] == '﻿':
        html_content = html_content[1:]

    # Try 'xml' parser first (best for XHTML epubs), fall back to 'html.parser'
    for parser in ('xml', 'lxml-xml', 'html.parser', 'lxml'):
        try:
            soup = BeautifulSoup(html_content, parser)
            # 移除 script/style 标签
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
    """将文本分割为段落，去重"""
    paragraphs = []
    raw_paras = [p.strip() for p in text.split('\n\n') if p.strip()]

    para_idx = 0
    for p in raw_paras:
        # 跳过太短的文本和纯数字/符号行
        clean = _clean_text(p)
        if len(clean) < 30:
            continue
        # 去重
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
    """清理文本：合并多余空白、移除控制字符"""
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _safe_get(metadata_list, fallback):
    """安全获取元数据"""
    if metadata_list and len(metadata_list) > 0:
        item = metadata_list[0]
        if isinstance(item, tuple) and len(item) > 0:
            return str(item[0])
        return str(item)
    return fallback


def _flatten_toc(toc, depth=0):
    """展平 epub 目录树"""
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
