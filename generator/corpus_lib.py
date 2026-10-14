# -*- coding: utf-8 -*-
"""第 10 步 · 语料层公共件：Gutenberg 剥头尾 ＋ 归一化 ＋ 切句 ＋ token 清洗。

`scan_corpus.py`（筛 1／rank 计数）与 `extract_examples.py`（工序 4 例句候选）**共用本件** ——
两边各写一份的话，切句口径会悄悄漂，而两个产物里的「句子」必须是**同一个东西**
（筛 1 说「这条短语在语料里有 12 句」、例句池只有 9 句，就成了对不上的账）。

口径（**暂定、未钉** —— 钉了才会进基准身份，见 §17.12／§17.14）：
  1. 语料 = `generator/corpus/*.txt`；切头尾按 `*** START/END OF ... GUTENBERG EBOOK ***`。
  2. 归一化 = 段内硬换行合并为空格；连续空白折叠。
  3. 切句 = 句末 `.`/`!`/`?`（可带收尾引号）＋ 空白 ＋ 大写或引号开头；带常用缩写守卫 ＋ 单字母首字母守卫。
"""
import os, io, re

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
CORPUS = os.path.join(ROOT, "generator", "corpus")

ABBR = set("mr mrs ms dr st jr sr prof capt col gen lt sgt rev hon messrs vs etc no vol ch pp ave rd fig".split())
SENT_END = re.compile(r'([.!?]+["\u201d\u2019]?)(\s+)')
TOKEN = re.compile(r"[^a-zA-Z']+")
BOOK_RE = re.compile(r"\*\*\*\s*START OF[^\n]*\*\*\*")
BOOK_END_RE = re.compile(r"\*\*\*\s*END OF[^\n]*\*\*\*")


def clean_tok(t):
    return TOKEN.sub("", t).lower()


def strip_gutenberg(t):
    m = BOOK_RE.search(t)
    if m:
        t = t[m.end():]
    m = BOOK_END_RE.search(t)
    if m:
        t = t[:m.start()]
    return t


def normalize(t):
    paras = re.split(r'\n\s*\n', t)
    return " ".join(" ".join(p.split()) for p in paras if p.strip())


def split_sentences(text):
    res = []
    i = 0
    for m in SENT_END.finditer(text):
        end = m.end(1)
        j = m.end()
        if j >= len(text):
            break
        nxt = text[j]
        if not (nxt.isupper() or nxt in '"\u201c\u2018\''):
            continue
        prev = text[max(0, end - 40):end]
        w = re.search(r'([A-Za-z]+)$', prev)
        if w and w.group(1).lower() in ABBR:
            continue
        if re.search(r'\b[A-Z]\.$', prev):
            continue
        seg = text[i:end].strip()
        if len(seg) < 2:
            continue
        res.append(seg)
        i = m.end()
    tail = text[i:].strip()
    if tail:
        res.append(tail)
    return res


def book_files():
    return sorted(f for f in os.listdir(CORPUS) if f.endswith(".txt"))


def book_id(fname):
    """`pg` 编号前缀 = 引用身份（例句的 src 写 `gutenberg:<id>`）。"""
    return fname.split("-", 1)[0]


def load_books():
    """返回 [(bookid, 归一化后全文)]，顺序 = `book_files()` 顺序（固定，产物可复算）。"""
    out = []
    for f in book_files():
        raw = io.open(os.path.join(CORPUS, f), encoding="utf-8", errors="replace").read()
        out.append((book_id(f), normalize(strip_gutenberg(raw))))
    return out
