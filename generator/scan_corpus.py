# -*- coding: utf-8 -*-
"""第 10 步 · 语料链 dry-run（2026-10-10 · Codex）
只读：corpus/*.txt（Gutenberg 纯文本）＋ reader/public/data/phrases.json ＋ generator/output/phrases_senses.json
只写：generator/output/corpus_scan.json
不动任何义项数据（phrases.json / phrases_senses*.json 一字不改）。

口径（**暂定、未钉** —— 钉了才会进基准身份）：
 1. 语料 = generator/corpus/*.txt；切头尾按 `*** START/END OF ... GUTENBERG EBOOK ***`。
 2. 归一化 = 段内硬换行合并为空格；连续空白折叠。
 3. 切句 = 句末 `.`/`!`/`?`（可带收尾引号）＋ 空白 ＋ 大写或引号开头；带常用缩写守卫 + 单字母首字母守卫。
 4. 匹配 = **与运行时 usePhrases 同口径**：空白分词 → 去首尾非字母 → 小写 → 最长优先 2..maxWords 词窗。
 5. 松匹配（只为诊断「宾语插入」）= 动词形 + 0..3 个词的间隙 + 粒子短语，且间隙内无句末标点。
"""
import os, io, re, json, sys
from collections import defaultdict

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
CORPUS = os.path.join(ROOT, "generator", "corpus")
PHRASES = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
SKEL = os.path.join(ROOT, "generator", "output", "phrases_senses.json")
OUT = os.path.join(ROOT, "generator", "output", "corpus_scan.json")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpus_lib import clean_tok, normalize, split_sentences, strip_gutenberg  # noqa: E402
from targets import verb_particle_targets  # noqa: E402

def main():
    ph = json.load(io.open(PHRASES, encoding="utf-8"))
    skel = json.load(io.open(SKEL, encoding="utf-8"))
    have_wn = set(skel)
    targets = verb_particle_targets(ph)
    zero_wn = [k for k in targets if k not in have_wn]
    print("目标(动词头+粒子尾): %d | 有 WordNet 覆盖: %d | 零覆盖: %d" % (len(targets), len(targets)-len(zero_wn), len(zero_wn)))

    # form -> base 索引
    idx = {}; maxw = 2
    for b in targets:
        e = ph[b]
        wc = len(b.split()); maxw = max(maxw, wc)
        idx[b] = b
        for f in e.get("forms") or []:
            idx[f.lower()] = b; maxw = max(maxw, len(f.split()))
    print("索引条目(基本形+屈折): %d | maxWords %d" % (len(idx), maxw))

    files = sorted(f for f in os.listdir(CORPUS) if f.endswith(".txt"))
    bookid = {f: f.split("-", 1)[0] for f in files}
    counts = defaultdict(int)
    texts = []
    loose_only = defaultdict(list)
    examples = defaultdict(list)
    n_sent = 0; n_tok = 0; bytes_norm = 0
    per_book = {}

    for f in files:
        print("  book", f, flush=True)
        raw = io.open(os.path.join(CORPUS, f), encoding="utf-8", errors="replace").read()
        txt = normalize(strip_gutenberg(raw))
        bytes_norm += len(txt.encode("utf-8"))
        texts.append((bookid[f], txt))
        sents = split_sentences(txt)
        per_book[bookid[f]] = len(sents)
        n_sent += len(sents)
        for s in sents:
            toks = s.split()
            n_tok += len(toks)
            cl = [clean_tok(t) for t in toks]
            for wi in range(len(cl)):
                if not cl[wi]: continue
                for ln in range(min(maxw, len(cl) - wi), 1, -1):
                    win = cl[wi:wi+ln]
                    if any(not w for w in win): continue
                    key = " ".join(win)
                    b = idx.get(key)
                    if not b: continue
                    counts[b] += 1
                    if len(examples[b]) < 5:
                        examples[b].append({"book": bookid[f], "text": s[:400]})
                    break

    hit = [b for b in targets if counts[b] > 0]
    print("语料体量：%d 本 | 归一化后 %.1f MB | 句 %d | 词 %d" % (len(files), bytes_norm/1e6, n_sent, n_tok))
    print("筛 1（严格连续匹配）：有 ≥1 真实用例 %d/%d = %.1f%% | 0 命中 %d"
          % (len(hit), len(targets), 100.0*len(hit)/len(targets), len(targets)-len(hit)))

    # 松匹配：只对 0 命中的做（诊断宾语插入）
    loosed = {}
    for b in targets:
        if counts[b] > 0: continue
        e = ph[b]; verb = e.get("verb", ""); part = b[len(verb):].strip()
        vforms = set()
        for fm in [b] + list(e.get("forms") or []):
            toks = fm.split()
            if len(toks) > len(part.split()):
                vforms.add(" ".join(toks[:len(toks)-len(part.split())]))
        if not vforms: continue
        alt = r"\b(" + "|".join(re.escape(v) for v in sorted(vforms, key=len, reverse=True)) + r")\b"
        part_re = r"\b" + r"\s+".join(re.escape(w) for w in part.split()) + r"\b"
        rx = re.compile(alt + r"(?:\s+[A-Za-z']+){0,3}\s+" + part_re, re.I)
        for bid, txt in texts:
            m = rx.search(txt)
            if m:
                s = m.group(0)
                if not re.search(r'[.!?]', s):
                    loosed[b] = {"book": bid, "text": s[:120]}
                    break

    # 与旧轴对比
    wk = [(b, counts[b], max([s.get("wn_count", 0) for s in skel[b]["senses"]] or [0])) for b in targets if b in have_wn]
    def ranks(vals):
        order = sorted(range(len(vals)), key=lambda i: -vals[i])
        r = [0]*len(vals)
        for pos, i in enumerate(order): r[i] = pos
        return r
    rc = ranks([x[1] for x in wk]); rw = ranks([x[2] for x in wk])
    n = len(wk); d2 = sum((rc[i]-rw[i])**2 for i in range(n))
    rho = 1 - 6*d2/(n*(n*n-1)) if n > 1 else 0

    top = sorted(targets, key=lambda b: -counts[b])[:12]
    print("语料计数 top12: " + " | ".join("%s=%d" % (b, counts[b]) for b in top))
    print("语料计数 vs wn_count（旧轴）Spearman rho = %.3f（n=%d）⇒ 两轴差异" % (rho, n))
    print("零覆盖那 %d 条里，语料有 ≥1 用例的: %d ⇒ %s" % (len(zero_wn), len([b for b in zero_wn if counts[b] > 0]),
          "、".join(b for b in zero_wn if counts[b] > 0) or "（无）"))
    print("0 命中里「松匹配（宾语插入）」能救回的: %d" % len(loosed))
    for b in sorted(loosed)[:15]:
        print("   ~ %s -> %s" % (b, loosed[b]["text"]))

    out = {"meta": {"books": len(files), "sentences": n_sent, "tokens": n_tok,
                    "targets": len(targets), "with_wn": len(targets)-len(zero_wn),
                    "matched": len(hit), "spearman_vs_wn": round(rho, 3),
                    "corpus_bytes_norm": bytes_norm},
           "per_book_sentences": per_book,
           "phrases": {b: {"count": counts[b], "loose": loosed.get(b), "examples": examples[b]} for b in targets}}
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()