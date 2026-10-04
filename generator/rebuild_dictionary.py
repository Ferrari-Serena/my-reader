"""
rebuild_dictionary.py — 按管线口径重生成 / 增量补齐 dictionary.json（词头键 + surfaces）。

复用 app.py 生成链的两个模块，口径只有一份：
  1. chapters.json → extract_vocabulary()：NGSL 过滤 + ECDICT 词形还原 +
     连字符复合词整体纳入 + clothes / ground 例外
  2. word-list → lookup_dictionary()：ECDICT 本地释义（零网络）
  3. 与现有 dictionary.json 增量合并 —— 重跑**不丢覆盖率**：
     - 旧键一律保留（含上线前由 M-W / 人工补过释义的词条）
     - 同名键：已有非空释义优先；level / audioUrl 取旧值（旧值空才用新值）
     - surfaces / chapters 以新结果为准；旧键里已被别的键认领的表面形会摘掉，
       保住「每个 surfaces 都解析回自己」这条前端不变量（reader/verify-core.mjs）

用法：
  D:\\PythonEnv\\abogen-venv\\Scripts\\python.exe rebuild_dictionary.py <bookId> [<bookId> ...] [--dry-run]

不适用：500（292 章扫描图，走 OCR 词表，脚本会跳过）。
sat-practice 的键来自 build_sat_bank.py 的人工词表，正文分词口径对它只会**增量补键**
（旧键的释义一律保留）——要不要补先确认，别顺手跑。
"""

import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / 'pipeline'))

from pipeline.extractor import extract_vocabulary
from pipeline.dictionary import lookup_dictionary

REPO_ROOT = BASE_DIR.parent
BOOKS_DIR = REPO_ROOT / 'reader' / 'public' / 'books'
NGSL_PATH = BASE_DIR / 'pipeline' / 'ngsl.txt'

PROBES = ['well-known', 'after-dinner', 'low-roofed', 'clothes', 'ground', 'clothe', 'grind']


def read_json(path: Path) -> dict:
    return json.loads(path.read_bytes().decode('utf-8-sig'))


def prune_dangling(words: dict) -> list:
    """
    摘掉「被两个词条同时认领、且已不是自身键」的表面形
    （解析顺序与 reader/src/utils/dictIndex.js 一致）。

    表面形本身也是词条（`carving` 既是 `carve` 的表面形、自己又是一条）不算冲突——
    前端 `resolveDictKey` 直命中优先，且 2026-10-02 已裁定那是合法数据、不是错。
    """
    alias = {}
    for key, entry in words.items():
        lemma = (entry.get('lemma') or key).lower()
        if lemma:
            alias[lemma] = key
        for surface in entry.get('surfaces') or []:
            alias[(surface + '').lower()] = key

    removed = []
    for key, entry in words.items():
        keep = []
        for surface in entry.get('surfaces') or []:
            if surface in words or alias.get(surface.lower()) == key:
                keep.append(surface)
            else:
                removed.append(f'{surface}→{key}')
        entry['surfaces'] = keep
    return removed


def rebuild(book_id: str, dry_run: bool = False) -> bool:
    book_dir = BOOKS_DIR / book_id
    chapters_path = book_dir / 'chapters.json'
    dict_path = book_dir / 'dictionary.json'

    if not chapters_path.exists():
        print(f'❌ {book_id}: 找不到 {chapters_path}')
        return False

    chapters = read_json(chapters_path)
    if chapters.get('type') == 'image':
        print(f'⏭  {book_id}: 扫描书（image），不走正文分词管线')
        return True

    existing = read_json(dict_path).get('words', {}) if dict_path.exists() else {}
    size_before = dict_path.stat().st_size if dict_path.exists() else 0
    nodes_before = sum(1 for e in existing.values() if not e.get('definitions'))

    word_list = extract_vocabulary(chapters, str(NGSL_PATH))
    fresh = lookup_dictionary(word_list, chapters, api_key='')['words']

    merged = {k: dict(v) for k, v in existing.items()}
    added = updated = 0
    for key, entry in fresh.items():
        old = merged.get(key)
        if old is None:
            merged[key] = dict(entry)
            added += 1
            continue
        new = dict(entry)
        if old.get('definitions'):
            new['definitions'] = old['definitions']          # 在线补全/人工校对过的释义优先
        if old.get('level') is not None:
            new['level'] = old['level']
        new['audioUrl'] = old.get('audioUrl') or new.get('audioUrl', '')
        merged[key] = new
        updated += 1

    merged = {k: merged[k] for k in sorted(merged)}
    pruned = prune_dangling(merged)

    nodes_after = sum(1 for e in merged.values() if not e.get('definitions'))
    surfaces = sum(len(e.get('surfaces') or []) for e in merged.values())
    compounds = sorted(k for k in merged if '-' in k)

    print(f'【{book_id}】现有 {len(existing)} 键 / 新提取 {len(fresh)} 键 → 合并 {len(merged)} 键'
          f'（新增 {added}、更新 {updated}）；无释义键 {nodes_before} → {nodes_after}；表面形 {surfaces}')
    print(f'  连字符词条 {len(compounds)} 条；摘掉失效表面形 {len(pruned)} 条'
          + (f'（{", ".join(pruned[:5])}）' if pruned else ''))

    hit, miss = [], []
    for probe in PROBES:
        entry = merged.get(probe)
        if entry is None:
            miss.append(f'{probe}(无此键)')
        elif not entry.get('definitions'):
            miss.append(f'{probe}(无释义)')
        else:
            hit.append(probe)
    print(f'  抽样：命中 {len(hit)} → {", ".join(hit)}；未命中 → {", ".join(miss) or "（无）"}')

    if dry_run:
        print('  （--dry-run：未写盘）')
        return True

    text = json.dumps({'bookId': book_id, 'words': merged},
                      ensure_ascii=False, separators=(',', ':'))
    with open(dict_path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    size_after = dict_path.stat().st_size
    print(f'  写出 {dict_path} ({size_before / 1024:.0f} KB → {size_after / 1024:.0f} KB)')
    return True


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    books = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if not books:
        sys.exit('用法: python rebuild_dictionary.py <bookId> [<bookId> ...] [--dry-run]')
    ok = all(rebuild(book_id, dry_run=dry) for book_id in books)
    sys.exit(0 if ok else 1)
