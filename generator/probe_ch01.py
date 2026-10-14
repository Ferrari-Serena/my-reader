# -*- coding: utf-8 -*-
"""第 10 步 · 块 C 第一步：ch.01 的 span 复算 ＋ 16 处「本句义」人工标注（预期三态）。

口径：切词 / 最长匹配 **逐条照 `usePhrases.scanParagraph` 复刻**（maxPhraseWords 由 phrases.json 现算）。
本件**不写 cue、不实跑 L1** —— 只出「span 能不能切对」＋「本句真正用的是哪条义项」。
标注里的 `truth_rank` **机器校验**：必须真存在于 `phrases_senses_curated.json`（否则报错）。
基准身份 = 书文本 `chapters.json` 的 sha256（§17.11 Q4 的「钉四版」）。

（块 C 第二步起，L1 实跑在 `l1_probe.py`；本件被它 import，复用切词 / 切句逻辑。）
"""
import io, json, re, hashlib, os

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
BOOK = os.path.join(ROOT, "reader", "public", "books", "dr-jekyll-and-mr-hyde", "chapters.json")
PH = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
CUR = os.path.join(ROOT, "generator", "output", "phrases_senses_curated.json")
OUT = os.path.join(ROOT, "generator", "output", "ch01_probe.json")

# span（ch.01 内唯一）→ (预期三态, 义项 rank 或 None, 说明)
LABEL = {
  "came about":   ("unique", 2, "空间义「来到/靠近」（come about r2，古/文学）"),
  "set aside":    ("unique", 2, "搁置/撇开（set aside r2）"),
  "laying out":   ("unique", 3, "花费（lay out r3，spend/invest）"),
  "lighted up":   ("unique", 1, "照亮（light up r1）"),
  "ran into":     ("unique", 2, "相撞（run into r2）"),
  "brought out":  ("unique", 1, "使显现（bring out r1）"),
  "turned out":   ("unique", 2, "聚集/出席（turn out r2）"),
  "put in":       ("unique", 4, "习语「露面」（put in r4）"),
  "stick out":    ("unique", 3, "硬撑/不松口（stick out r3）"),
  "came back":    ("unique", 1, "回来（come back r1）"),
  "pointing out": ("unique", 1, "指出（point out r1）"),
  "come out":     ("unique", 1, "出来（come out r1）"),
  "set off":      ("unique", 1, "出发（set off r1）"),
  "in a body":    ("unique", 1, "全体/一起（in a body r1）"),
  "gave in":      ("unique", 2, "交上/递交（give in r2）"),
  "looking on":   ("unique", 3, "朝向（look on r3）"),
}

SENT_END = re.compile(r'([.!?]+["\u201d\u2019]?)(\s+)')


def split_sent(t):
    res = []; i = 0
    for m in SENT_END.finditer(t):
        end = m.end(1); j = m.end()
        if j >= len(t):
            break
        if not (t[j].isupper() or t[j] in '"\u201c\u2018\''):
            continue
        seg = t[i:end].strip()
        if len(seg) >= 2:
            res.append(seg)
        i = m.end()
    tail = t[i:].strip()
    if tail:
        res.append(tail)
    return res


def clean(t):
    return re.sub(r"^[^a-zA-Z]+|[^a-zA-Z']+$", "", t).lower()


def load_chapters():
    raw = io.open(BOOK, "rb").read()
    return raw, json.loads(raw.decode("utf-8"))


def build_index():
    """照 usePhrases.init()：base ∪ forms → base；maxw ＝ 最长键词数。"""
    ph = json.load(io.open(PH, encoding="utf-8"))
    idx = {}; maxw = 2
    for base, e in ph.items():
        idx[base] = base; maxw = max(maxw, len(base.split()))
        for f in e.get("forms") or []:
            idx[f] = base; maxw = max(maxw, len(f.split()))
    return idx, maxw


def find_occurrences(ch, idx, maxw):
    """照 usePhrases.scanParagraph 复刻（最长匹配 2..maxw、句内约束）。返回 [{para,para_id,base,span,sentence}]。"""
    SENTRE = re.compile(r"[.!?]$")
    hits = []
    for pi, pobj in enumerate(ch["paragraphs"]):
        para = pobj["text"]; toks = re.split(r"(\s+)", para)
        words = [{"idx": i, "clean": clean(tk), "raw": tk}
                 for i, tk in enumerate(toks) if re.search(r"\S", tk)]
        claimed = set()
        for wi in range(len(words)):
            if wi in claimed:
                continue
            for ln in range(min(maxw, len(words) - wi), 1, -1):
                sl = words[wi:wi + ln]
                if any(SENTRE.search(w["raw"]) for w in sl[:-1]):
                    continue
                if any(k > 0 and (wi + k) in claimed for k in range(ln)):
                    continue
                if any(not w["clean"] for w in sl):
                    continue
                key = " ".join(w["clean"] for w in sl)
                if key not in idx:
                    continue
                base = idx[key]; span = " ".join(w["raw"] for w in sl)
                sent = next((s for s in split_sent(para)
                             if re.search(r"\b" + re.escape(span).replace(r"\ ", r"\s+"), s)), None)
                hits.append({"para": pi, "para_id": pobj["id"], "base": base,
                             "span": span, "sentence": sent})
                for k in range(ln):
                    claimed.add(wi + k)
                break
    return hits


def truth_of(span):
    return LABEL.get(span.strip(";,.").strip(), ("?", None, "未标注"))


def label_hits(hits, cur):
    errs = []
    for h in hits:
        state, rank, note = truth_of(h["span"])
        h["truth_state"] = state; h["truth_rank"] = rank; h["truth"] = note
        n = len(cur.get(h["base"], {}).get("senses", []))
        if state in ("unique", "multi"):
            if not (isinstance(rank, int) and 1 <= rank <= n):
                errs.append("%s: truth_rank=%r 不在 %s 的 %d 条义项里" % (h["span"], rank, h["base"], n))
    return errs


def main():
    raw, ch = load_chapters()
    ch = ch["chapters"][0]
    cur = json.load(io.open(CUR, encoding="utf-8"))
    idx, maxw = build_index()
    hits = find_occurrences(ch, idx, maxw)
    errs = label_hits(hits, cur)
    assert not errs, errs
    summ = {"unique": 0, "multi": 0, "zero": 0}
    for h in hits:
        summ[h["truth_state"]] = summ.get(h["truth_state"], 0) + 1
    payload = {"meta": {"book": "dr-jekyll-and-mr-hyde", "chapter": ch["id"], "chapter_title": ch["title"],
                        "chapters_sha256": hashlib.sha256(raw).hexdigest(),
                        "curated_sha256": hashlib.sha256(io.open(CUR, "rb").read()).hexdigest(),
                        "matches_scanParagraph": True, "maxPhraseWords": maxw,
                        "note": "span 复算 ＋ 人工本句义标注（预期三态）；truth_rank 已机器校验在库；cue 见 l1_probe.py",
                        "counts": summ, "hits": len(hits)},
               "hits": hits}
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=1))
    print("hits=%d unique=%d multi=%d zero=%d" % (len(hits), summ["unique"], summ["multi"], summ["zero"]))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()