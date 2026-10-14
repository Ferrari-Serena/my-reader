# -*- coding: utf-8 -*-
"""第 10 步（块 B′-2）工序 4：从**自有公版语料**抽**例句候选池**。

机器只做「抽候选」，**不分派义项** —— 分派要 `cue`（块 C 才写）或人工（同 §5.4 工序 4 的「人工: 校」）。
候选池供两条下游用：
  ① 人工层填 `examples`（本次已对 13 个 curated 词做过一轮人工分派）；
  ② 块 C 的 `cue` 写完后按 cue 自动分派 ＋ 人工改残差。

口径：切句／归一化走 `corpus_lib`（**与 `scan_corpus.py` 同一件** —— 两个产物里的「句子」必须同身份）；
命中 = 短语**基本形 ∪ 屈折形**、词边界匹配；`len <= MAX_LEN` 且词数 >= MIN_WORDS 才收。

**为什么不拿 WordNet synset 例句充数**（§17.11 阻塞 ①）：那些例句常是**别的词**的用例
（`turn out` 的 s12 是「These birds can splay out their toes」）⇒ 骨架件 `examples` 已于块 B′ 清空。
"""
import os, io, re, json, sys, argparse
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpus_lib import load_books, split_sentences
from targets import verb_particle_targets, match_keys

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
PHRASES = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
OUT = os.path.join(ROOT, "generator", "output", "phrase_examples.json")

MAX_LEN = 300
MIN_WORDS = 5


def key_re(keys):
    pat = "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))
    return re.compile(r"\b(" + pat + r")\b", re.I)


def harvest(phrase, entry, sents, cap):
    rx = key_re(match_keys(phrase, entry))
    got, seen = [], set()
    for bid, ss in sents:
        for s in ss:
            if len(s) > MAX_LEN or len(s.split()) < MIN_WORDS:
                continue
            m = rx.search(s)
            if not m:
                continue
            t = s.strip()
            k = re.sub(r"\s+", " ", t).lower()
            if k in seen:
                continue
            seen.add(k)
            got.append({"book": bid, "form": m.group(1).lower(), "text": t})
            if len(got) >= cap:
                return got
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-phrase", type=int, default=12)
    ap.add_argument("--only", default="", help="逗号分隔的词表；只抽这些（默认全部 331）")
    ap.add_argument("--show", action="store_true", help="把候选打到 stdout，不落盘")
    args = ap.parse_args()

    phrases = json.load(io.open(PHRASES, encoding="utf-8"))
    books = load_books()
    sents = [(bid, split_sentences(txt)) for bid, txt in books]

    only = [s.strip() for s in args.only.split(",") if s.strip()]
    if only:
        for p in only:
            if p not in phrases:
                raise SystemExit("词不在 phrases.json：%s" % p)
        targets = only
    else:
        targets = verb_particle_targets(phrases)

    data = OrderedDict()
    for p in targets:
        data[p] = harvest(p, phrases[p], sents, args.per_phrase)

    if args.show:
        for p in targets:
            print("== %s :: %d 句" % (p, len(data[p])))
            for r in data[p]:
                print("   [%s|%s] %s" % (r["book"], r["form"], r["text"]))
        return

    payload = {
        "meta": {"books": len(books), "targets": len(data), "per_phrase_cap": args.per_phrase,
                 "max_len": MAX_LEN, "min_words": MIN_WORDS, "scope": only or "全部（动词头＋粒子尾）"},
        "phrases": data,
    }
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=1))
    tot = sum(len(v) for v in data.values())
    hit = sum(1 for v in data.values() if v)
    ge3 = sum(1 for v in data.values() if len(v) >= 3)
    zero = [k for k, v in data.items() if not v]
    print("目标 %d 词 ｜ 有候选 %d（%.1f%%）｜ >=3 条候选 %d ｜ 0 候选 %d"
          % (len(data), hit, 100.0 * hit / len(data), ge3, len(zero)))
    print("候选总数 %d ｜ 每词上限 %d" % (tot, args.per_phrase))
    if zero:
        print("0 候选（%d）：" % len(zero) + "、".join(zero))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
