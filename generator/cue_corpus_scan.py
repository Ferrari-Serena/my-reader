# -*- coding: utf-8 -*-
"""第 10 步 · 块 C 第二步（续）：`cue` × 44 本语料 —— L1 在**非目标语料**上的三态分布。

目的：补 §17.21 盲区 ①（ch.01 的 cue 是看着那 16 句写的 = 定向样本）。本件**不碰任何义项数据**，
只把已写的 39 条 `cue` 拿到 `generator/corpus/` 上跑，看：
  - 含某在册词的句子里，L1 给出 unique / multi / zero 各多少（**zero 高 ⇒ 语料里有库外用法**，如 ch.01 的 stick out）；
  - 同词内 cue 的**混淆**（一句里 ≥2 义项命中 = multi）有多常见 ⇒ 这是筛②（pattern 可区分）的机器辅助。
  - **分层（2026-10-10 三十四续；CC `#2026-10-10T2110-cc` 判①「仪表盘没接上」）**：`unique` 再按 `cue_tier`（单点取自 `l1_probe`）分
    **`high`**（显式 marker ⇒ 可断言）／**`fallback`**（`^` 开头＝排除法 ⇒ 只排序、不打 ★）。
    **本件保留 u/m/z 三列**（§17.41–§17.45 的历史读数都是这个口径，删列则前后不可比）**并列 high／fallback**。
    `zero` 的语义在此钉死：**它是「库外用法」报警器**（zero 高 ⇒ 语料里有库里没有的义），**不是残渣** ⇒ 仪表盘三列 ＝ **high／fallback／zero**。
- **口径（2026-10-10 三十四续 · CC `#2140-cc` 的方法判）**：**闭合形状（可枚举）⇒ 精确计数（全量、不抽样）**；**开类语义（买到／搭乘…）⇒ 抽样必须随机** —— `等距抽`（`fb.sort()` 后 `[::k]`）会与 `bid` 排序**共振** ⇒ 系统偏高（实测把 `pick up` 的 5.4% 抽成 40%）。**报警面不从 `cue_tier` 派生**（词级读法会退化成「关掉报警器」、句级又过宽）：报警 ＝ **形状台账逐条记名 ＋ 精确计数**（如 `be found out` 14/251）。
产物 `generator/output/cue_corpus_scan.json`。**不是精度检验**（语料没有 gold 标注），是分布体检。
"""
import io, json, re, os, sys
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpus_lib import load_books, split_sentences
from targets import match_keys
from l1_probe import cue_tier   # 分层口径**单点**：`^` 前缀 ⇒ low（与 ch.01 门同一函数；不许各自实现一份）

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
PH = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
CUR = os.path.join(ROOT, "generator", "output", "phrases_senses_curated.json")
OUT = os.path.join(ROOT, "generator", "output", "cue_corpus_scan.json")


LEDGER = [
    {
        "name": "come up with",
        "word": "come up",
        "official": 21,
        "category": "库外/别的词组",
        "pattern": r"\b(?:come|comes|came|coming)\s+up\s+with\b",
        "note": "不是 cue 漏召；`come up with` 是独立词组",
    },
    {
        "name": "be found out",
        "word": "find out",
        "official": 14,
        "category": "库外/θ反被动",
        "pattern": r"\b(?:is|are|was|were|be|been|being|am)\s+found\s+out\b(?!\s+of\b)",
        "note": "败露/识破，与 find out（得知/查明）θ 反；排除 `be found out of`",
    },
    {
        "name": "find out that,",
        "word": "find out",
        "official": 2,
        "category": "真漏召",
        "pattern": r"\b(?:find|finds|finding|found)\s+out\b(?:(?!\b(?:that|what)\b)[^.?!;,]){0,12}?\bthat\s*,\s*",
        "note": "that 前逗号插入；乙已加 `,?`",
    },
    {
        "name": "go into matter/subject(s)",
        "word": "go into",
        "official": 7,
        "category": "真漏召",
        "pattern": r"\b(?:go|goes|going|went|gone)\s+into\s+(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]?s?)\s+)?(?:\w+\s+){0,2}?\b(?:matter|subjects?)\b",
        "note": "乙已补 matter|subjects?；按实扫 7 入账",
    },
    {
        "name": "pick up buy",
        "word": "pick up",
        "official": 3,
        "category": "库外缺义",
        "pattern": r"\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,45}?\b(?:stall|sale)\b",
        "note": "买到；只收 stall/sale 证据，排除 `bargains`",
    },
    {
        "name": "pick up ride",
        "word": "pick up",
        "official": 4,
        "category": "库外缺义",
        "pattern": r"\b(?:pick|picks|picking|picked)\s+up\s+(?:a|the|my|his|her|our|your|their)?\s*(?:(?:public|Broadway|railway|railroad|street)\s+)?(?:car|conveyance|train)\b",
        "note": "搭乘；按实扫 4 入账（含 pick up my train for the Junction）",
    },
    {
        "name": "pick up acquaintance",
        "word": "pick up",
        "official": 4,
        "category": "库外缺义",
        "pattern": r"\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,30}?\bacquaintance\w*\b|\b(?:pick|picks|picking|picked)\s+up\s+with\s+(?:her|him|them)\b",
        "note": "结识/招募；排除 `an old stumpy-tailed albatross`",
    },
    {
        "name": "pick up rescue",
        "word": "pick up",
        "official": 1,
        "category": "库外缺义",
        "pattern": r"\b(?:pick|picks|picking|picked)\s+up\s+the\s+floating\s+mariners\b",
        "note": "海上救起；只收明确救人的 floating mariners；oars/creatures 待裁",
    },
]


def main():
    ph = json.load(io.open(PH, encoding="utf-8"))
    cur = json.load(io.open(CUR, encoding="utf-8"))
    words = [w for w, e in cur.items() if any(s.get("cue") for s in e["senses"])]
    forms = {w: (match_keys(w, ph.get(w, {})) if w in ph else [w]) for w in words}
    formre = {w: re.compile(r"\b(?:" + "|".join(re.escape(f) for f in forms[w]) + r")\b", re.I) for w in words}
    cuere = {w: [(s["rank"], re.compile(s["cue"], re.I), cue_tier(s["cue"])) for s in cur[w]["senses"] if s.get("cue")] for w in words}
    ledger_re = [(e, re.compile(e["pattern"], re.I)) for e in LEDGER]
    ledger_trigger = None
    ledger_words = ["come up", "find out", "go into", "pick up"]
    if all(w in forms for w in ledger_words):
        ledger_trigger = re.compile(
            r"\b(?:" + "|".join(re.escape(f) for w in ledger_words for f in forms[w]) + r")\b",
            re.I,
        )
    ledger_hits = {e["name"]: [] for e in LEDGER}

    stat = {w: Counter() for w in words}          # 句级三态
    pair = {w: Counter() for w in words}          # 命中的 rank 组合（混淆）
    sent_n = 0
    for bid, txt in load_books():
        for s in split_sentences(txt):
            sent_n += 1
            if ledger_trigger is not None and ledger_trigger.search(s):
                for e, rx in ledger_re:
                    if rx.search(s):
                        ledger_hits[e["name"]].append({"book": bid, "sentence": s})
            for w in words:
                if not formre[w].search(s):
                    continue
                hs = [(r, t) for r, rx, t in cuere[w] if rx.search(s)]
                hit = tuple(r for r, _ in hs)
                st = "unique" if len(hit) == 1 else ("multi" if len(hit) > 1 else "zero")
                stat[w][st] += 1
                stat[w]["sent"] += 1
                if len(hs) == 1:
                    stat[w]["high" if hs[0][1] == "high" else "fallback"] += 1
                pair[w][hit] += 1
    print("语料句数 %d | 在册且有 cue 的词 %d" % (sent_n, len(words)))
    tot = Counter()
    rows = []
    for w in words:
        c = stat[w]
        n = c["sent"]
        tot.update({k: c[k] for k in ("unique", "multi", "zero", "high", "fallback")})
        rows.append({"word": w, "sent": n, "unique": c["unique"], "multi": c["multi"], "zero": c["zero"],
                     "high": c["high"], "fallback": c["fallback"],
                     "zero_rate": round(c["zero"] / n, 3) if n else None,
                     "top_hits": [[list(k), v] for k, v in pair[w].most_common(6)]})
    rows.sort(key=lambda r: -(r["zero_rate"] or 0))
    print("合计（句级）: unique=%d multi=%d zero=%d ｜ 分层 high=%d fallback=%d" % (
        tot["unique"], tot["multi"], tot["zero"], tot["high"], tot["fallback"]))
    tt = sum(tot.values())
    print("占比: unique %.1f%% / multi %.1f%% / zero %.1f%%" % (100*tot["unique"]/tt, 100*tot["multi"]/tt, 100*tot["zero"]/tt))
    print("%-14s %6s %7s %7s %7s %8s %7s %8s" % ("word", "sent", "uniq", "multi", "zero", "zero%", "high", "fallb"))
    for r in rows:
        print("%-14s %6d %7d %7d %7d %7.1f%% %7d %8d" % (r["word"], r["sent"], r["unique"], r["multi"], r["zero"],
                                                        100*(r["zero_rate"] or 0), r["high"], r["fallback"]))
    ledger_rows = []
    for e in LEDGER:
        hits = ledger_hits[e["name"]]
        ledger_rows.append({
            "name": e["name"], "word": e["word"], "category": e["category"],
            "pattern": e["pattern"], "note": e["note"],
            "official": e["official"], "actual": len(hits), "delta": len(hits) - e["official"],
            "evidence": hits,
        })
    print("\n== 形状台账 ==")
    print("%-24s %8s %8s %7s %s" % ("name", "official", "actual", "delta", "category"))
    for r in ledger_rows:
        print("%-24s %8d %8d %+7d %s" % (r["name"], r["official"], r["actual"], r["delta"], r["category"]))
    print("台账合计 official=%d actual=%d" % (
        sum(r["official"] for r in ledger_rows), sum(r["actual"] for r in ledger_rows)))
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(
        {"meta": {"books": len(os.listdir(os.path.join(ROOT, 'generator', 'corpus'))), "sentences": sent_n,
                  "words": len(words), "total": dict(tot),
                  "note": "cue × 44 本语料；句级三态（保留以保历史可比）＋ 分层 high/fallback（`^` 前缀 ⇒ fallback）；无 gold ⇒ 只作分布体检；"
                          "zero＝库外用法报警器（高 ⇒ 语料里有库里没有的义）；multi＝同词 cue 混淆；"
                          "ledger＝形状台账（逐条记名＋精确计数，不从 cue_tier 派生）"},
         "rows": rows,
         "ledger": {
             "meta": {
                 "note": "甲′：库外/真漏召形状逐条记名＋全量精确计数；official 为已入账口径，actual 为本次实扫",
                 "official": sum(r["official"] for r in ledger_rows),
                 "actual": sum(r["actual"] for r in ledger_rows),
             },
             "rows": ledger_rows,
         }}, ensure_ascii=False, indent=1))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
