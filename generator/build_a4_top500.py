#!/usr/bin/env python3
"""build_a4_top500.py — G5-A4 top500 高频词候选生成器。

口径（G5-A4）：
  * top_n = 500：按 ECDICT 的 COCA 词频（stardict.frq）升序，取前 500 个高频词候选；
  * 候选词池来自 reader/public/data/phrases.json 中出现的全部合法词形；
  * 每条记录至少包含 word / defs / senses / coverage 四个字段。

可重复运行（确定性）：
  * 不写时间戳、不依赖随机数；
  * 候选按 (frq 升序, phrase_hits 降序, word 升序) 全序排序，无并列歧义；
  * JSON 以 sort_keys=True + 固定缩进落盘，同一输入多次运行结果字节一致；
  * ECDICT 不可用时自动降级为纯 phrases 词频排序（仍确定性）。

本脚本只在运行期写出 generator/output/a4_top500.json（生成物不入库），
不写 D1、不改词库、不 deploy。
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PHRASES_PATH = REPO / 'reader' / 'public' / 'data' / 'phrases.json'
OUT_DIR = HERE / 'output'
OUT_PATH = OUT_DIR / 'a4_top500.json'

TOP_N = 500            # top_n=500（G5-A4 口径）
DATASET = 'a4_top500'  # a4_top500 数据集标识
WORD_RE = re.compile(r"^[a-z][a-z'\-]{1,}$")


def iter_strings(node):
    """确定性遍历 phrases.json，产出全部字符串节点。"""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key in sorted(node, key=str):
            yield from iter_strings(node[key])
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from iter_strings(item)


def load_phrase_words(path=PHRASES_PATH):
    """统计 phrases.json 中每个词形出现的次数，返回 (hits, total_units)。"""
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    hits = {}
    total = 0
    for text in iter_strings(data):
        total += 1
        for raw in re.split(r"[^A-Za-z'\-]+", text.lower()):
            word = raw.strip("'--")
            if WORD_RE.match(word):
                hits[word] = hits.get(word, 0) + 1
    return hits, total


def make_dict():
    """加载 ECDICT；不可用时返回 None（降级但不失败）。"""
    try:
        if str(HERE) not in sys.path:
            sys.path.insert(0, str(HERE))
        from pipeline.ecdict import Ecdict  # 延迟导入，避免测试环境缺库即崩
        return Ecdict()
    except Exception as exc:  # noqa: BLE001 - 缺库/缺文件都走降级路径
        print(f'[warn] ECDICT 不可用，降级为 phrases 词频排序: {exc}', file=sys.stderr)
        return None


def split_lines(value):
    if not value:
        return []
    return [line.strip() for line in str(value).split('\n') if line.strip()]


def build_senses(entry):
    """把 ECDICT 的 pos/translation 拼成 senses 列表。"""
    if not entry:
        return []
    translations = split_lines(entry.get('translation'))
    pos_raw = entry.get('pos') or ''
    poses = [p.split(':')[0].strip() for p in pos_raw.split('/') if p.split(':')[0].strip()]
    senses = []
    for idx, zh in enumerate(translations):
        pos = poses[idx] if idx < len(poses) else ''
        senses.append({'pos': pos, 'zh': zh})
    return senses


def build_entry(word, phrase_hits, phrase_units, dic):
    entry = dic.lookup(word) if dic is not None else None
    entry = entry or {}
    frq = entry.get('frq')
    try:
        frq = int(frq) if frq not in (None, '', 0, '0') else None
    except (TypeError, ValueError):
        frq = None
    defs = split_lines(entry.get('definition'))[:6]
    senses = build_senses(entry)
    tag = entry.get('tag') or ''
    completeness = sum(1 for ok in (bool(frq), bool(tag), bool(defs), bool(senses)) if ok) / 4.0
    return {
        'word': word,
        'frq': frq,
        'tag': tag,
        'phonetic': entry.get('phonetic') or '',
        'defs': defs,
        'senses': senses,
        'coverage': {
            'phrase_hits': phrase_hits,
            'phrase_units': phrase_units,
            'in_ecdict': bool(entry),
            'has_frq': bool(frq),
            'completeness': round(completeness, 4),
        },
    }


def rank_key(item):
    """全序排序键：有 frq 的按 frq 升序（更常用在前），同频看 phrases 命中数，最后按词形。"""
    frq = item['frq']
    has_frq = 0 if isinstance(frq, int) and frq > 0 else 1
    frq_key = frq if has_frq == 0 else 10 ** 9
    return (has_frq, frq_key, -item['coverage']['phrase_hits'], item['word'])


def build_payload(top_n=TOP_N):
    hits, phrase_units = load_phrase_words()
    dic = make_dict()
    rows = [build_entry(word, count, phrase_units, dic) for word, count in sorted(hits.items())]
    rows.sort(key=rank_key)
    top = rows[:top_n]
    return {
        'dataset': DATASET,
        'top_n': top_n,
        'source': 'reader/public/data/phrases.json',
        'freq_source': 'ECDICT stardict.frq (COCA)',
        'phrase_units': phrase_units,
        'candidate_pool': len(rows),
        'count': len(top),
        'words': top,
    }


def main():
    payload = build_payload(TOP_N)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    OUT_PATH.write_text(text, encoding='utf-8')
    print(f"[ok] {DATASET}: {payload['count']} / {payload['candidate_pool']} 候选 → {OUT_PATH}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
