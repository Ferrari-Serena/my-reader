"""
backfill_dictionary.py — 用 ECDICT 回填现有书的 dictionary.json 释义。

流程：
  1. 读 chapters.json，重新提取全部唯一词（不做 NGSL 过滤——
     用户在阅读页点击任何词都应本地命中释义）
  2. 全部查 ECDICT（本地 SQLite，零网络）
  3. 与现有 dictionary.json 增量合并：
     - 已有非空 definitions 的词条不覆盖（保护 M-W 在线补全过的词）
     - level / chapters 字段保留
  4. 重写 dictionary.json

用法：
  D:\\PythonEnv\\abogen-venv\\Scripts\\python.exe backfill_dictionary.py the-giver
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline.ecdict import get_ecdict

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / 'reader' / 'public' / 'books'

WORD_RE = re.compile(r"\b[a-zA-Z][a-zA-Z'-]{1,30}\b")


def extract_all_words(chapters_data):
    """全部唯一词 + 出现章节。含 NGSL 常见词（阅读页任何词都可点击）。"""
    words = {}  # word → set(chapterIds)
    for ch in chapters_data.get('chapters', []):
        texts = [ch.get('title', '')] + [p.get('text', '') for p in ch.get('paragraphs', [])]
        for text in texts:
            for m in WORD_RE.finditer(text):
                w = m.group(0).lower().strip("'-")
                if len(w) < 2:
                    continue
                words.setdefault(w, set()).add(ch['id'])
    return words


def backfill(book_id, force=False):
    """force=True 时忽略已有释义，全部重查 ECDICT（修复 ecdict.py 后刷新用）"""
    book_dir = BOOKS_DIR / book_id
    chapters_path = book_dir / 'chapters.json'
    dict_path = book_dir / 'dictionary.json'

    if not chapters_path.exists():
        sys.exit(f'❌ 找不到 {chapters_path}')

    chapters_data = json.loads(chapters_path.read_bytes().decode('utf-8-sig'))
    existing = {}
    if dict_path.exists():
        existing = json.loads(dict_path.read_bytes().decode('utf-8-sig')).get('words', {})

    all_words = extract_all_words(chapters_data)
    print(f'{book_id}: 全书唯一词 {len(all_words)}，现有词条 {len(existing)}')

    ecdict = get_ecdict()
    result = {}
    filled = kept = missing = 0

    for word in sorted(all_words):
        old = existing.get(word)

        # 已有非空释义的词条保留（M-W 在线补全过的优先）；--force 时跳过保留
        if not force and old and old.get('definitions'):
            result[word] = old
            kept += 1
            continue

        entry = ecdict.lookup(word)
        if entry is None:
            # ECDICT 无此词：保留旧空壳（若有），否则跳过（Worker 兜底）
            if old:
                result[word] = old
            missing += 1
            continue

        result[word] = {
            'lemma': entry['lemma'],
            'phonetic': entry['phonetic'],
            'partOfSpeech': entry['partOfSpeech'],
            'definitions': entry['definitions'][:6],  # 控制体积
            'audioUrl': (old or {}).get('audioUrl', ''),
            'level': (old or {}).get('level'),  # 保留原 SAT/AP 标记
            'chapters': (old or {}).get('chapters') or sorted(all_words[word]),
        }
        filled += 1

    out = {'bookId': book_id, 'words': result}
    dict_path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')),
                         encoding='utf-8')
    size_kb = dict_path.stat().st_size / 1024
    print(f'完成: ECDICT 填充 {filled}，保留已有 {kept}，未命中 {missing}')
    print(f'输出: {dict_path} ({size_kb:.0f} KB)')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    if not args:
        sys.exit('用法: python backfill_dictionary.py <bookId> [--force]')
    backfill(args[0], force=force)
