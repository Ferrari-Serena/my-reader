# -*- coding: utf-8 -*-
"""第 10 步 · 块 B″ 工序 4 半自动：按 `cue` 在 44 本语料里**给义项分派例句**（块 C 写完 cue 之后的路线）。

口径：句子含本短语（含屈折、词边界）＋ 该义项的 `cue` 命中 ⇒ 候选；
选**最短的**（≥5 词、≤300 字符）；一条都没有 ⇒ 报「抽不到」（进 `GAP`）。
只读产物 / 语料；只写 `generator/output/batch_example_picks.json`。**人工核过才冻进源码**。
用法：python pick_examples.py "go on" "come in" ...
"""
import io, json, re, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpus_lib import load_books, split_sentences
from targets import match_keys
from build_senses_curated import RAW
from cues import CUE

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
PH = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
CUR = os.path.join(ROOT, "generator", "output", "phrases_senses_curated.json")
OUT = os.path.join(ROOT, "generator", "output", "batch_example_picks.json")


def main(words):
    ph = json.load(io.open(PH, encoding="utf-8"))
    src = {p: rows for p, _lit, rows in RAW}
    sents = []
    for bid, txt in load_books():
        for s in split_sentences(txt):
            sents.append((bid, s))
    print("语料句 %d" % len(sents), flush=True)
    out = {}
    for w in words:
        forms = match_keys(w, ph[w])
        fr = re.compile(r"\b(?:" + "|".join(re.escape(f) for f in forms) + r")\b", re.I)
        pool = [(bid, s) for bid, s in sents if fr.search(s)]
        rows = []
        for rank, zh, en, pat, wn, slug in src[w]:
            c = CUE.get((w, rank))
            rx = re.compile(c, re.I) if c else None
            cand = [(bid, t) for bid, t in pool if rx and rx.search(t) and 5 <= len(t.split()) and len(t) <= 300]
            cand.sort(key=lambda x: len(x[1]))
            rows.append({"rank": rank, "zh": zh, "n_pool": len(pool), "n_cue": len(cand),
                         "pick": ({"src": "gutenberg:" + cand[0][0], "text": cand[0][1]} if cand else None)})
        n_ok = sum(1 for r in rows if r["pick"])
        print("### %-12s 池 %d 句 | 义项 %d | 有例句 %d" % (w, len(pool), len(rows), n_ok))
        for r in rows:
            if r["pick"]:
                print("   r%s cue命中%-4d %s" % (r["rank"], r["n_cue"], r["pick"]["text"][:120]))
            else:
                print("   r%s **抽不到**（池 %d，cue 命中 0）" % (r["rank"], r["n_pool"]))
        out[w] = rows
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main(sys.argv[1:])