# -*- coding: utf-8 -*-
"""第 10 步 · 目标词口径的唯一权威。

**2026-10-10 裁：316 → 315**（§17.22 待裁 1 的 316；§17.36「表级清理」删 4 个 `-ing` 垃圾键
＋补 3 个正形键 ⇒ 315）—— 「剔除「头词非动词」的名词／形容词＋介词搭配」
（`abdomen in`／`agreement on`／`complaint about`…，它们的 `forms` 是 `abdomened in` 这类**垃圾屈折**，
正是「名词被当成动词变位」的痕迹）。**保留** `pick on`／`base on` 一类真短语动词。

两口径都从这个函数出：默认 **315**（`include_nonverb=False`），`include_nonverb=True` → 330。
换口径只改这一个函数 —— 三个脚本（`scan_corpus`／`extract_examples`／`build_senses_curated`）一起跟着变。
"""
PARTICLE = {"up", "down", "out", "in", "off", "on", "over", "through", "around", "about", "away", "back",
            "along", "apart", "by", "forth", "forward", "round", "together", "across", "after",
            "into", "upon", "aside", "ahead"}

# 头词**无 WordNet 动词义**的条目（WordNet 一次筛出的 15 条，**冻结**；免运行时 nltk 依赖）。
# `selftest()` 在 nltk 可用时**复算核对**这张表 —— 表是「回归闸」，不是新的真相来源。
NON_VERB_HEADS = frozenset([
    "abdomen in", "abidance by", "abundant in", "adept in", "agreement on",
    "anxious about", "belief in", "clarification on", "commentary on", "complaint about",
    "concentration on", "conditional on", "confidence in", "contingent on", "deficient in",
])


def verb_particle_targets(phrases, include_nonverb=False):
    """「动词头 ＋ 粒子尾」目标词表（升序）。默认 **315 口径**；`include_nonverb=True` → 330。"""
    return sorted(k for k, v in phrases.items()
                  if len(k.split()) > 1 and v.get("verb")
                  and k.split()[-1].lower() in PARTICLE
                  and (include_nonverb or k not in NON_VERB_HEADS))


def match_keys(phrase, entry):
    """匹配键 = 基本形 ∪ 屈折形（全小写）。构建时 `phrases.json` 已展开屈折，运行时零计算。"""
    return [phrase.lower()] + [f.lower() for f in (entry.get("forms") or [])]


def selftest(phrases, use_wn=True):
    """自咬闸：① 330 − 冻结表 = 315，且表内每条真在 330 里；② nltk 可用时复核「头词无／有动词义」。"""
    allv = verb_particle_targets(phrases, include_nonverb=True)
    strict = verb_particle_targets(phrases, include_nonverb=False)
    assert allv == sorted(set(allv))
    assert set(strict) <= set(allv)
    assert len(allv) == 330 and len(strict) == 315, (len(allv), len(strict))
    assert len(allv) - len(strict) == len(NON_VERB_HEADS) == 15
    assert all(k in set(allv) for k in NON_VERB_HEADS)
    n = 5
    if use_wn:
        try:
            import os
            os.environ.setdefault("NLTK_DATA", r"D:\Temp\nltk_data")
            from nltk.corpus import wordnet as wn
            for k in NON_VERB_HEADS:
                assert not wn.synsets(k.split()[0], pos="v"), k
            for k in strict:
                assert wn.synsets(k.split()[0], pos="v"), k
            n += 2
        except Exception:
            pass
    return n