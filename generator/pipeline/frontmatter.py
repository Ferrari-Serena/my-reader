"""前置页（版权页 / 目录页等）判定口径。

tts.py 用它决定「哪一章不朗读」，audio-index.json 用它给「无音频」标原因 ——
两处必须同源，所以抽到这里，谁都不许再抄一份正则。
"""

import re

# 版权页 / 目录页这类前置页的标题开头词，配合词数阈值判断该不该朗读
FRONT_MATTER_RE = re.compile(
    r'^\s*(contents|table of contents|dedication|epigraph|praise|credits?|copyright|'
    r'title page|half title|frontispiece|colophon|about the author|about the publisher|'
    r'books by|also by|acknowledge?ments?|index|'
    r'前言|目录|版权|扉页|出版)',
    re.IGNORECASE,
)

# tts.py --min-words 的默认值：低于此词数且标题像前置页 → 判为前置页
DEFAULT_MIN_WORDS = 150


def chapter_word_count(chapter: dict) -> int:
    return sum(len(p.get('text', '').split()) for p in chapter.get('paragraphs', []))


def is_front_matter(chapter: dict, min_words: int = DEFAULT_MIN_WORDS) -> bool:
    """「短」且「标题像前置页」同时成立才算 —— 避免误伤 Divergent 里
    "Chapter Fifty-Two"（60 词）这类真·短章。"""
    if not min_words:
        return False
    return (chapter_word_count(chapter) < min_words
            and bool(FRONT_MATTER_RE.match(chapter.get('title', ''))))
