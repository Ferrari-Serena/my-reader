# -*- coding: utf-8 -*-
"""第 10 步 块 B′：义项对象**形状的唯一权威**（落 §5.3）。

两个 build 脚本都 import 本件；块 D 的 verify-senses 复用同一套断言 —— 免得三处各抄一份、各漂各的。
只判「形状」与「机器可判的约束」，不判义项对不对（那是人工层的事）。

**例句两条口径**（回应 §17.11 阻塞 ① 的「空满足」）：
  ① 有例句 ⇒ 每条必须含**本短语（含屈折）**且 `src` 形如 `gutenberg:<id>`（WordNet synset 例句正是栽在这条上：
     它们**不含本短语**，却曾经把判据 2「每条义项 >=1 例句」空集通过）；
  ② 没例句 ⇒ **必须**写 `examples_gap` 说明为什么（点名式豁免，不是静默留空）——
     闸会把空例句的条数**报出来**，不许悄悄过关；
  ③ **可分离式短语**（宾语插入，如 `take sb out`／`pick sb up`）⇒ 该 sense 显式标 `separable: true`，
     闸改按「头词(含屈折) ＋ 间隔 ≤4 词 ＋ 粒子」匹配。**不标仍走连续匹配** —— 默认闸不放开，
     标记本身就是「本条正是插入式用法」的人工断言（2026-10-10 十二续 · 块 B″ 第二批）。
"""
import json
import re

ALLOWED_SRC = ("wn", "drafted")
CORE_CAP = 5
# 产品件只许这两种；wn-count 是**骨架生成件**的非权威排序轴 —— 进了产品件就意味着 rank 不可复算
RB_PRODUCT = ("corpus", "manual")
RB_SKELETON = ("wn-count",)

SENSE_FIELDS = ("id", "rank", "zh", "en", "pattern", "cue", "tier",
                "wn", "rank_basis", "src", "reviewed", "examples")
# 条件字段：只在「examples 为空」时必填；骨架件（product=False）不强制
OPTIONAL_FIELDS = ("examples_gap", "separable")


def has_form(text, forms):
    """text 里是否出现 forms 里的任一个（词边界、大小写不敏感）。"""
    tl = text.lower()
    for f in forms:
        if re.search(r"(?<![a-z])" + re.escape(f.lower()) + r"(?![a-z])", tl):
            return True
    return False


def has_form_gapped(text, forms, max_gap=4):
    """**可分离式**短语：头词（含屈折）与尾部（粒子）之间允许夹 ≤max_gap 个词（宾语插入）。
    只在 sense 显式标 `separable: true` 时使用 —— 标记即「本条是插入式用法」的人工断言。
    头词 = 各屈折形的首 token；尾部 = 其余 token（各形须一致）。"""
    tl = str(text).lower()
    heads, tails = set(), set()
    for f in forms:
        toks = f.lower().split()
        if len(toks) < 2:
            continue
        heads.add(toks[0])
        tails.add(" ".join(toks[1:]))
    if not heads or len(tails) != 1:
        return False
    head = "|".join(re.escape(h) for h in sorted(heads))
    tail = r"\s+".join(re.escape(t) for t in tails.pop().split())
    pat = r"(?<![a-z])(?:%s)(?:\s+[\w'\u2019\-]+){0,%d}\s+%s(?![a-z])" % (head, max_gap, tail)
    return re.search(pat, tl) is not None


def check_entry(phrase, entry, product, extra_fields=(), forms=None):
    """一条词条的义项表体检。返回错误清单（空 = 过）。product=True 按产品件口径（更严）。"""
    errs = []
    senses = entry.get("senses")
    if not isinstance(senses, list) or not senses:
        return ["%s: senses 缺失或为空" % phrase]
    allowed = set(SENSE_FIELDS) | set(OPTIONAL_FIELDS) | set(extra_fields)
    seen_ids = set()
    for i, s in enumerate(senses, 1):
        where = "%s#%d" % (phrase, i)
        for f in SENSE_FIELDS:
            if f not in s:
                errs.append("%s: 缺字段 %s" % (where, f))
        for f in s:
            if f not in allowed:
                errs.append("%s: 多出字段 %s（形状外）" % (where, f))
        if s.get("rank") != i:
            errs.append("%s: rank=%r，数组须按 rank 升序（此处应为 %d）" % (where, s.get("rank"), i))
        if s.get("id") in seen_ids:
            errs.append("%s: id 重复 %r" % (where, s.get("id")))
        seen_ids.add(s.get("id"))
        if s.get("src") not in ALLOWED_SRC:
            errs.append("%s: src=%r 不在 %s" % (where, s.get("src"), list(ALLOWED_SRC)))
        if not isinstance(s.get("reviewed"), bool):
            errs.append("%s: reviewed 须为布尔，现 %r" % (where, s.get("reviewed")))
        if "separable" in s and not isinstance(s["separable"], bool):
            errs.append("%s: separable 须为布尔（可分离式标记）" % where)
        tier = s.get("tier")
        if tier not in ("core", "extended"):
            errs.append("%s: tier=%r 不在 ('core','extended')" % (where, tier))
        elif tier == "core" and i > CORE_CAP:
            errs.append("%s: tier='core' 但 rank=%d > %d（core ⟹ rank<=%d；"
                        "extended 可出现在任意 rank —— 2026-10-10 放宽为单向蕴含）"
                        % (where, i, CORE_CAP, CORE_CAP))
        okrb = list(RB_PRODUCT)
        if not product:
            okrb = okrb + list(RB_SKELETON)
        if s.get("rank_basis") not in okrb:
            errs.append("%s: rank_basis=%r 不在 %s" % (where, s.get("rank_basis"), okrb))
        wn_ = s.get("wn")
        if wn_ is not None and not isinstance(wn_, str):
            errs.append("%s: wn 须为 synset 名或 null" % where)
        if wn_:
            want_id = "%s#%s" % (phrase, wn_)
            if s.get("id") != want_id:
                errs.append("%s: id 与 wn 不对齐（应 %r）" % (where, want_id))

        ex = s.get("examples")
        if not isinstance(ex, list):
            errs.append("%s: examples 须为数组" % where)
            ex = []
        gap = s.get("examples_gap")
        if product:
            if not ex:
                if not (isinstance(gap, str) and gap.strip()):
                    errs.append("%s: examples 为空却没有 examples_gap（不许静默留空）" % where)
            elif gap is not None:
                errs.append("%s: 有例句就不该带 examples_gap（豁免与事实二选一）" % where)
        for j, e in enumerate(ex, 1):
            if not isinstance(e, dict) or "src" not in e or "text" not in e:
                errs.append("%s: examples[%d] 须形如 {src,text}" % (where, j))
                continue
            if not str(e.get("src", "")).startswith("gutenberg:"):
                errs.append("%s: examples[%d].src 须形如 gutenberg:<id>，现 %r" % (where, j, e.get("src")))
            if not isinstance(e.get("text"), str) or len(e["text"]) < 8:
                errs.append("%s: examples[%d].text 太短" % (where, j))
            if forms:
                txt = str(e.get("text", ""))
                ok = has_form(txt, forms)
                if not ok and s.get("separable") is True:
                    ok = has_form_gapped(txt, forms)
                if not ok:
                    errs.append("%s: examples[%d] 不含本短语（含屈折%s）—— 「空满足」就是栽在这条上"
                                % (where, j,
                                   "；separable 已放宽为可插入宾语" if s.get("separable") is True else ""))
        if product:
            if s.get("reviewed") is not True:
                errs.append("%s: 产品件每条须 reviewed=true" % where)
            if not isinstance(s.get("cue"), str):
                errs.append("%s: cue 须为字符串（块 C 填；现可为空串）" % where)
    return errs


def check_selftest():
    """自咬闸：故意注入的故障必须被抓到，正常件不许报红。返回被抓住的故障数。"""
    good = {"senses": [{"id": "x out#prove.v.01", "rank": 1, "zh": "z", "en": "e", "pattern": "",
                        "cue": "", "tier": "core", "wn": "prove.v.01", "rank_basis": "manual",
                        "src": "wn", "reviewed": True,
                        "examples": [{"src": "gutenberg:43", "text": "It may well turn out to be so."}]}]}
    forms = ["turn out", "turned out"]
    assert check_entry("x out", good, True, forms=forms) == [], check_entry("x out", good, True, forms=forms)
    faults = []
    def mut(fn):
        b = json.loads(json.dumps(good)); fn(b); return b
    # tier 闸（2026-10-10 放宽：core ⟹ rank<=5；extended 可到任意 rank）
    six = {"senses": [dict(good["senses"][0], rank=i, id="x out#p%d" % i, wn=None,
                           tier=("core" if i <= CORE_CAP else "extended")) for i in range(1, 7)]}
    assert check_entry("x out", six, True) == [], check_entry("x out", six, True)
    ext_low = json.loads(json.dumps(six)); ext_low["senses"][0]["tier"] = "extended"
    assert check_entry("x out", ext_low, True) == [], "extended 落在 rank<=5 应放行（放宽后）"
    faults.append(("core 出现在 rank>5",
                   (lambda: (lambda b: (b["senses"][5].__setitem__("tier", "core"), b)[1])(json.loads(json.dumps(six))))()))
    faults.append(("rank 断号", mut(lambda b: b["senses"][0].__setitem__("rank", 2))))
    faults.append(("src 第三种值", mut(lambda b: b["senses"][0].__setitem__("src", "llm"))))
    faults.append(("产品件用 wn-count", mut(lambda b: b["senses"][0].__setitem__("rank_basis", "wn-count"))))
    faults.append(("缺 cue", mut(lambda b: b["senses"][0].pop("cue"))))
    faults.append(("产品件未过校", mut(lambda b: b["senses"][0].__setitem__("reviewed", False))))
    faults.append(("id 与 wn 不对齐", mut(lambda b: b["senses"][0].__setitem__("id", "x out#other.v.01"))))
    faults.append(("例句缺 text", mut(lambda b: b["senses"][0].__setitem__("examples", [{"src": "gutenberg:43"}]))))
    faults.append(("例句不含本短语（空满足）",
                   mut(lambda b: b["senses"][0].__setitem__("examples", [{"src": "gutenberg:43", "text": "These birds can splay out their toes."}]))))
    faults.append(("src 不是 gutenberg:<id>",
                   mut(lambda b: b["senses"][0]["examples"][0].__setitem__("src", "wordnet"))))
    faults.append(("空例句却没 examples_gap",
                   mut(lambda b: b["senses"][0].__setitem__("examples", []))))
    faults.append(("有例句又带 examples_gap",
                   mut(lambda b: b["senses"][0].__setitem__("examples_gap", "不该有"))))
    for name, bad in faults:
        out = check_entry("x out", bad, True, forms=forms)
        assert out, "自咬闸漏了：%s" % name
    # 可分离式（separable）：标记后允许宾语插入（间隔 ≤4 词），但连成分都不含 / 间隔超限 / 非布尔仍须报
    sep_forms = ["take out", "took out", "takes out"]
    sep_ok = {"senses": [dict(good["senses"][0],
                              examples=[{"src": "gutenberg:1400",
                                         "text": "I took him out for a walk next morning, and we talked."}],
                              separable=True)]}
    assert check_entry("x out", sep_ok, True, forms=sep_forms) == [], \
        check_entry("x out", sep_ok, True, forms=sep_forms)

    def mut2(fn):
        b = json.loads(json.dumps(sep_ok)); fn(b); return b
    sep_faults = []
    sep_faults.append(("separable 但例句连成分都不含",
                       mut2(lambda b: b["senses"][0].__setitem__("examples", [{"src": "gutenberg:1400", "text": "These birds can splay out their toes."}]))))
    sep_faults.append(("separable 但插入间隔 >4 词",
                       mut2(lambda b: b["senses"][0].__setitem__("examples", [{"src": "gutenberg:1400", "text": "I took the old brown paper parcel out of the drawer."}]))))
    sep_faults.append(("separable 非布尔",
                       mut2(lambda b: b["senses"][0].__setitem__("separable", "yes"))))
    for name, bad in sep_faults:
        out = check_entry("x out", bad, True, forms=sep_forms)
        assert out, "自咬闸漏了（separable）：%s" % name
    ok = json.loads(json.dumps(good))
    ok["senses"][0]["rank_basis"] = "wn-count"
    ok["senses"][0]["reviewed"] = False
    ok["senses"][0]["examples"] = []
    assert check_entry("x out", ok, False) == [], "骨架件口径不该报这些"
    return len(faults) + len(sep_faults)
