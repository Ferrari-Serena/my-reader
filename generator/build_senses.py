# -*- coding: utf-8 -*-
"""第 10 步 块 B′：义项骨架抽取（WordNet）——**生成件，不进产品**。

形状落 §5.3：删 `primary`、删 WordNet synset 自带例句（它们是**别的词的**用例、不是本短语的）、
id 换全局键 `<phrase>#<synset>`。

2026-10-10 修一处轴错（§17.11 阻塞 ②）：`wn_count` 原来取 synset **全体词条**的最大频次 ——
那是别词的频次（`turn out` 排第一的落在 `prove.v.01`，数出来的 58 是 `prove` 的）。
现改为**本词元在该 synset 的 count()**。它仍**不是**权威排序轴（权威轴 = 自有语料计数，见 §17.14），
所以本件的 `rank_basis` 写死 `wn-count`，产品件里不许出现这个值。
"""
import os, io, json, sys

DN = r"D:\Temp\nltk_data"
os.environ.setdefault("NLTK_DATA", DN)
import nltk
nltk.data.path.insert(0, DN)
from nltk.corpus import wordnet as wn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from senses_schema import check_entry, check_selftest, CORE_CAP

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
PHRASES = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
OUT = os.path.join(ROOT, "generator", "output", "phrases_senses.json")
from targets import PARTICLE  # noqa: E402  （粒子表唯一权威在 targets.py）


def is_verb(w):
    w = (w or "").strip().lower()
    return bool(w) and (bool(wn.synsets(w, pos=wn.VERB)) or wn.morphy(w, wn.VERB) is not None)


def wn_key(p):
    return p.strip().lower().replace(" ", "_")


def lemma_count(synset, key):
    """本词元在该 synset 的频次（不是 synset 全体词条的最大值 —— 那个轴是错的）。"""
    for l in synset.lemmas():
        if l.name().lower() == key:
            return int(l.count())
    return 0


def build(phrase):
    key = wn_key(phrase)
    items = []
    for s in wn.synsets(key, pos=wn.VERB):
        items.append({"wn": s.name(), "en": s.definition(), "wn_count": lemma_count(s, key)})
    items.sort(key=lambda x: (-x["wn_count"], x["wn"]))
    out = []
    for i, it in enumerate(items, 1):
        out.append({
            "id": "%s#%s" % (phrase, it["wn"]),
            "rank": i,
            "zh": "",
            "en": it["en"],
            "pattern": "",
            "cue": "",
            "tier": "core" if i <= CORE_CAP else "extended",
            "wn": it["wn"],
            "rank_basis": "wn-count",
            "src": "wn",
            "reviewed": False,
            "examples": [],
            "wn_count": it["wn_count"],
        })
    return out


def main():
    n_fault = check_selftest()
    print("自咬闸：%d 个注入故障全部被抓，正常件不报红" % n_fault)

    data = json.load(io.open(PHRASES, encoding="utf-8"))
    wv = {k: v for k, v in data.items() if v.get("verb")}
    targets = sorted(k for k, v in wv.items()
                     if len(k.split()) > 1 and is_verb(v.get("verb"))
                     and k.split()[-1].lower() in PARTICLE and wn.synsets(wn_key(k), pos=wn.VERB))
    out = {k: {"literal": "", "senses": build(k)} for k in targets}

    errs = []
    for k in targets:
        errs += check_entry(k, out[k], False, extra_fields=("wn_count",))
    if errs:
        for e in errs[:20]:
            print("  !!", e)
        raise SystemExit("形状闸不过：%d 条" % len(errs))

    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
    ns = sum(len(v["senses"]) for v in out.values())
    over5 = sum(1 for v in out.values() if len(v["senses"]) > CORE_CAP)
    zero_cnt = sum(1 for v in out.values() for s in v["senses"] if s["wn_count"] == 0)
    print("targets: %d | senses: %d | avg: %.2f | >%d senses: %d | wn_count=0 的义项: %d"
          % (len(out), ns, ns / max(1, len(out)), CORE_CAP, over5, zero_cnt))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
