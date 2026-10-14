# -*- coding: utf-8 -*-
"""第 10 步 · 块 C 第二步：L1（`cue`）**实跑** —— ch.01 三态 ＋ precision/recall。

引擎语义（＝ `cues.py` 头注）：对「命中句」原文做 `re.search(cue, 大小写不敏感)`；
恰 1 命中 → `unique`／≥2 → `multi`／0 → `zero`。空 cue 不命中。
判据（§5.6／§17.11 Q4）：ch.01 16 处 **unique ≥12 且 zero ≤2**，且 unique 必须等于人工标注的 `truth_rank`；
`unique` 但 ≠ truth ⇒ **误判**（单列，penalty 比 multi/zero 更重）。
只读产物、不写产品件。附带 ch.02–03 的**未标注三态分布**（在册词），看 L1 在非定向样本上的样子。
"""
import io, json, re, os, sys, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_ch01 import (ROOT, CUR, BOOK, PH, load_chapters, build_index,
                        find_occurrences, truth_of)

OUT = os.path.join(ROOT, "generator", "output", "ch01_l1.json")


def cue_tier(cue):
    """置信度层，**由 cue 形状派生**（§5.7 ＋ 2026-10-10 CC 判；**不动 `senses_schema` 字段集**）：
    ① 空 ⇒ `none`（不判）；② 开头是 `^` ⇒ `low`（负向预查＝排除法、不是证据；**只许排序**）；
    ③ 其余 ⇒ `high`（显式 marker，**可断言**）。"""
    if not cue:
        return "none"
    return "low" if cue.startswith("^") else "high"


def cue_tier_selftest():
    """自咬闸：兜底型 cue **必须**落 `low`，不许被算成 `high`。返回用例数。"""
    cases = [("", "none"),
             (r"\b(?:go|goes|going|went|gone) through\b", "high"),
             (r"^(?!.*(?:x)).*\bwent through\b", "low"),
             (r"^(?!.*(?:a))(?!.*(?:b)).*\bwent through\b", "low")]
    for cue, want in cases:
        got = cue_tier(cue)
        assert got == want, "cue_tier 自咬失败：%r → %s（应 %s）" % (cue, got, want)
    return len(cases)


def l1_state(senses, sentence):
    """返回 (state, 命中 rank, 全部命中的 rank 列表)。
    `unique`（唯一命中**显式 marker**＝高置信，可断言）／
    `fallback`（唯一命中**兜底 cue**＝低置信，只作排序、不当「本句义」）／
    `multi`（≥2 命中）／`zero`（0 命中）。"""
    hit, tiers = [], []
    for s in senses:
        if s.get("cue") and re.search(s["cue"], sentence or "", re.I):
            hit.append(s["rank"]); tiers.append(cue_tier(s["cue"]))
    if len(hit) == 1:
        return ("unique" if tiers[0] == "high" else "fallback"), hit[0], hit
    if len(hit) >= 2:
        return "multi", None, hit
    return "zero", None, hit


def main():
    raw, doc = load_chapters()
    cur = json.load(io.open(CUR, encoding="utf-8"))
    idx, maxw = build_index()

    ch1 = doc["chapters"][0]
    hits = find_occurrences(ch1, idx, maxw)
    rows = []
    for h in hits:
        senses = cur.get(h["base"], {}).get("senses", [])
        st, rk, hit = l1_state(senses, h["sentence"])
        ts, tr, note = truth_of(h["span"])
        rank_ok = isinstance(tr, int) and rk is not None and rk == tr
        rows.append({"para": h["para"], "base": h["base"], "span": h["span"],
                     "state": st, "rank": rk, "hit_ranks": hit,
                     "tier": {"unique": "high", "fallback": "low"}.get(st, "none"),
                     "truth_state": ts, "truth_rank": tr, "truth": note,
                     "rank_ok": rank_ok, "ok": (st == "unique" and rank_ok)})

    n = len(rows)
    uniq = [r for r in rows if r["state"] == "unique"]        # 高置信（显式 marker）
    fbk = [r for r in rows if r["state"] == "fallback"]       # 低置信（兜底，只作排序）
    correct = [r for r in uniq if r["rank_ok"]]
    wrong = [r for r in uniq if not r["rank_ok"]]
    fbk_ok = [r for r in fbk if r["rank_ok"]]
    multi = [r for r in rows if r["state"] == "multi"]
    zero = [r for r in rows if r["state"] == "zero"]
    # 正解在册处（truth_rank 非空）里，L1 能不能给对
    inbook = [r for r in rows if isinstance(r["truth_rank"], int)]
    recall = len(correct) / len(inbook) if inbook else 0.0
    precision = len(correct) / len(uniq) if uniq else 0.0
    # 分层后的门：**高置信** unique ≥12 ＋ **高置信误标 0** ＋ zero ≤2（旧意：判不出的上限）
    verdict = (len(uniq) >= 12) and (len(wrong) == 0) and (len(zero) <= 2)
    legacy_uniq = uniq + fbk
    legacy_correct = correct + fbk_ok
    legacy_pass = (len(legacy_uniq) >= 12) and (len(zero) <= 2)

    # ch.02–03：未标注（无 truth），只看在册词的三态分布
    held = []
    for ci in (1, 2):
        if ci < len(doc["chapters"]):
            for h in find_occurrences(doc["chapters"][ci], idx, maxw):
                if h["base"] not in cur:
                    continue
                st, rk, hit = l1_state(cur[h["base"]]["senses"], h["sentence"])
                held.append({"chapter": doc["chapters"][ci]["id"], "base": h["base"],
                             "span": h["span"], "state": st, "rank": rk, "hit_ranks": hit})
    hs = {"unique": 0, "fallback": 0, "multi": 0, "zero": 0}
    for r in held:
        hs[r["state"]] += 1

    payload = {
        "meta": {
            "book": "dr-jekyll-and-mr-hyde",
            "chapter": ch1["id"], "chapter_title": ch1["title"],
            "chapters_sha256": hashlib.sha256(raw).hexdigest(),
            "curated_sha256": hashlib.sha256(io.open(CUR, "rb").read()).hexdigest(),
            "engine": "re.search(cue, sentence, re.I)；1 命中=unique（显式 marker）或 fallback（兜底）/ ≥2=multi / 0=zero；空 cue 不命中",
            "gate": "高置信 unique>=12/16 且 高置信误标=0 且 zero<=2/16（兜底命中记 fallback、不计 unique；2026-10-10 Ferrari 批分层）",
            "n": n, "unique": len(uniq), "unique_correct": len(correct), "unique_wrong": len(wrong),
            "fallback": len(fbk), "fallback_correct": len(fbk_ok),
            "fallback_wrong": len([r for r in fbk if not r["rank_ok"]]),
            "multi": len(multi), "zero": len(zero),
            "legacy_unique": len(legacy_uniq), "legacy_unique_correct": len(legacy_correct),
            "legacy_recall_inbook": round(len(legacy_correct) / len(inbook), 4) if inbook else 0.0,
            "legacy_gate_pass": legacy_pass,
            "cue_tier_cases": cue_tier_selftest(),
            "precision_unique": round(precision, 4), "recall_inbook": round(recall, 4),
            "gate_pass": verdict,
            "held_ch02_03": {"n": len(held), **hs},
        },
        "rows": rows,
        "held_ch02_03": held,
    }
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=1))

    print("== ch.01 L1（分层）==")
    print("cue_tier 自咬：%d 例全过（兜底型不许算 high）" % cue_tier_selftest())
    print("n=%d | 高置信 unique=%d（对 %d / 错 %d）| 兜底 fallback=%d（判对 %d）| multi=%d | zero=%d" %
          (n, len(uniq), len(correct), len(wrong), len(fbk), len(fbk_ok), len(multi), len(zero)))
    print("旧口径（不分层）unique=%d（对 %d）⇒ 旧门 %s ／ 新门 %s" %
          (len(legacy_uniq), len(legacy_correct),
           "PASS" if legacy_pass else "FAIL", "PASS" if verdict else "FAIL"))
    print("precision(高置信 unique 里对的占比)=%.3f | recall(在册 %d 处里判对)=%.3f" %
          (precision, len(inbook), recall))
    print("判据 高置信 unique>=12 且 高置信误标=0 且 zero<=2 ⇒ **%s**" % ("PASS" if verdict else "FAIL"))
    for r in rows:
        mark = "OK " if r["ok"] else ("低 " if r["state"] == "fallback" else "!! ")
        print("  %s%-12s %-14s state=%-8s tier=%-4s rank=%s truth=r%s  hits=%s" %
              (mark, r["base"], repr(r["span"]), r["state"], r["tier"], r["rank"], r["truth_rank"], r["hit_ranks"]))
    print("== ch.02–03（未标注，在册词 %d 处）==" % len(held))
    print("  unique=%d fallback=%d multi=%d zero=%d" % (hs["unique"], hs["fallback"], hs["multi"], hs["zero"]))
    for r in held[:20]:
        print("   %s %-22s %-14s -> %s r%s %s" % (r["chapter"], r["base"], repr(r["span"]), r["state"], r["rank"], r["hit_ranks"]))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()