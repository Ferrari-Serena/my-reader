"""
epub/txt 解析器
输入：epub 或 txt 文件路径
输出：chapters.json 数据结构
"""

import os
import re
import json
from ebooklib import epub
from bs4 import BeautifulSoup


def parse_epub(file_path: str, book_id: str) -> dict:
    """解析 epub 文件，提取章节结构和文本内容"""
    book = epub.read_epub(file_path)

    title = _safe_get(book.get_metadata('DC', 'title'), file_path)
    author = _safe_get(book.get_metadata('DC', 'creator'), 'Unknown')

    chapters = []
    toc = book.toc
    spine = book.spine

    # 获取所有文档项
    all_items = {item.get_id(): item for item in book.get_items_of_type(9)}  # ITEM_DOCUMENT = 9

    chapter_index = 0
    seen_texts = set()

    # 如果有目录，优先使用目录结构
    if toc:
        for toc_item in _flatten_toc(toc):
            href = toc_item.href.split('#')[0] if toc_item.href else ''
            title_text = toc_item.title if toc_item.title else f'Chapter {chapter_index + 1}'

            for item_id, item in all_items.items():
                if href and item.file_name and href in item.file_name:
                    content = _clean_html(item.get_content().decode('utf-8', errors='ignore'))
                    paragraphs = _split_paragraphs(content, chapter_index, seen_texts)
                    if paragraphs:
                        chapter_index += 1
                        chapters.append({
                            'id': f'ch-{chapter_index:02d}',
                            'title': _clean_text(title_text),
                            'paragraphs': paragraphs
                        })
                    break
            else:
                # href 没匹配到，尝试正文内容匹配
                content = _clean_html(toc_item.href or '')
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
        for item_id, _ in spine:
            item = all_items.get(item_id[0] if isinstance(item_id, tuple) else item_id)
            if item:
                content = _clean_html(item.get_content().decode('utf-8', errors='ignore'))
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
    """解析 txt 文件，按章节标记分割"""
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

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


def _clean_html(html_content: str) -> str:
    """清理 HTML/XHTML，提取纯文本"""
    import warnings
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
    soup = BeautifulSoup(html_content, 'xml')
    # 移除 script/style 标签
    for tag in soup(['script', 'style', 'head', 'title']):
        tag.decompose()
    text = soup.get_text('\n')
    return text


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
