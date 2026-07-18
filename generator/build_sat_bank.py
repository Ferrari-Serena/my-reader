"""
build_sat_bank.py — 从 tasks1/tasks2 现有 SAT 词表数据生成 my-reader 标准书格式。

数据源（全部本地，无网络请求）：
  tasks2/vocabulary/src/vocabulary/json_original/json-sentence/SAT_2.json  主数据（音标/词性/中文释义/例句/词组）
  tasks2/vocabulary/src/vocabulary/json_original/json-sentence/SAT_3.json  同上，与 SAT_2 合并去重
  tasks1/merged_dict.json                                                  英文释义补充（{p,c,e} 格式）

输出：
  reader/public/books/sat-practice/chapters.json    按首字母分章；段落 = 有例句词的真实例句（供 sentenceCloze）
  reader/public/books/sat-practice/dictionary.json  标准词典格式，全部 level: "SAT"
  reader/public/books/book-index.json               注册 sat-practice（幂等）
  output/sat_phrases_staging.json                   SAT 数据中的词组搭配（后续构建 phrases.json 的原料）

用法：
  D:\\PythonEnv\\abogen-venv\\Scripts\\python.exe build_sat_bank.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # d:/睿谊的WPS/Ferrariwork
READER_PUBLIC = ROOT / "my-reader" / "reader" / "public"
OUT_DIR = READER_PUBLIC / "books" / "sat-practice"
STAGING_DIR = Path(__file__).resolve().parent / "output"

SAT_SENTENCE_FILES = [
    ROOT / "tasks2" / "vocabulary" / "src" / "vocabulary" / "json_original" / "json-sentence" / "SAT_2.json",
    ROOT / "tasks2" / "vocabulary" / "src" / "vocabulary" / "json_original" / "json-sentence" / "SAT_3.json",
]
MERGED_DICT = ROOT / "tasks1" / "merged_dict.json"

# 首字母分章：8 组
LETTER_GROUPS = [
    ("a", "c"), ("d", "f"), ("g", "i"), ("j", "l"),
    ("m", "o"), ("p", "r"), ("s", "u"), ("v", "z"),
]


def load_sat_words():
    """合并 SAT_2/SAT_3，按词去重（先出现者保留，例句合并）。"""
    words = {}
    for path in SAT_SENTENCE_FILES:
        if not path.exists():
            print(f"WARN: {path} 不存在，跳过")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in data:
            w = (item.get("word") or "").strip().lower()
            # 只收纯字母词（跳过专有名词乱入、带空格的条目）
            if not w or not re.fullmatch(r"[a-z][a-z-]*", w):
                continue
            if w in words:
                # 合并例句和词组（去重）
                seen_s = {s["sentence"] for s in words[w].get("sentences", [])}
                for s in item.get("sentences", []):
                    if s.get("sentence") and s["sentence"] not in seen_s:
                        words[w]["sentences"].append(s)
                seen_p = {p["phrase"] for p in words[w].get("phrases", [])}
                for p in item.get("phrases", []):
                    if p.get("phrase") and p["phrase"] not in seen_p:
                        words[w]["phrases"].append(p)
            else:
                words[w] = {
                    "word": w,
                    "us": item.get("us") or "",
                    "translations": item.get("translations") or [],
                    "sentences": [s for s in (item.get("sentences") or []) if s.get("sentence")],
                    "phrases": [p for p in (item.get("phrases") or []) if p.get("phrase")],
                }
    return words


def load_english_defs():
    """merged_dict.json：word → 英文释义（e 字段）。"""
    if not MERGED_DICT.exists():
        print(f"WARN: {MERGED_DICT} 不存在")
        return {}
    data = json.loads(MERGED_DICT.read_text(encoding="utf-8"))
    return {w.lower(): v.get("e", "") for w, v in data.items() if isinstance(v, dict)}


def group_id(word):
    ch = word[0]
    for lo, hi in LETTER_GROUPS:
        if lo <= ch <= hi:
            return f"sat-{lo}-{hi}", f"Words {lo.upper()}–{hi.upper()}"
    return "sat-v-z", "Words V–Z"


def is_clean_sentence(text):
    """段落只收纯英文完整句：过滤过短片段和含中文的句子。"""
    if not text or len(text) < 15 or len(text) > 300:
        return False
    if re.search(r"[一-鿿]", text):
        return False
    return True


def build():
    sat_words = load_sat_words()
    eng_defs = load_english_defs()
    print(f"SAT 词条: {len(sat_words)}, merged_dict 英文释义: {len(eng_defs)}")

    dictionary = {}
    chapters_map = {}  # id → {id, title, paragraphs}
    phrase_staging = []
    para_counters = {}

    for w in sorted(sat_words):
        item = sat_words[w]
        gid, gtitle = group_id(w)

        # ---- dictionary 条目 ----
        translations = item["translations"]
        pos = (translations[0].get("type") + ".") if translations and translations[0].get("type") else ""
        definitions = []
        for t in translations:
            ttype = (t.get("type") or "").strip()
            ttext = (t.get("translation") or "").strip()
            if ttext:
                definitions.append(f"{ttype}. {ttext}" if ttype else ttext)
        eng = eng_defs.get(w, "").strip()
        if eng:
            definitions.append(f"(EN) {eng}")
        if not definitions:
            continue  # 无释义的词不收录

        phonetic = f"/{item['us']}/" if item["us"] else ""

        dictionary[w] = {
            "lemma": w,
            "phonetic": phonetic,
            "partOfSpeech": pos,
            "definitions": definitions,
            "audioUrl": "",
            "level": "SAT",
            "chapters": [gid],
        }

        # ---- 例句 → 章节段落（供 sentenceCloze 出题 + 阅读浏览） ----
        if gid not in chapters_map:
            chapters_map[gid] = {"id": gid, "title": gtitle, "paragraphs": []}
            para_counters[gid] = 0
        for s in item["sentences"][:2]:  # 每词最多 2 句
            text = s["sentence"].strip()
            if not is_clean_sentence(text):
                continue
            # 句尾补句号（源数据部分是片段短语）
            if not re.search(r"[.!?]$", text):
                text += "."
            para_counters[gid] += 1
            chapters_map[gid]["paragraphs"].append({
                "id": f"p-{gid}-{para_counters[gid]:03d}",
                "text": text[0].upper() + text[1:],
                "annotatedWords": [w],
            })

        # ---- 词组 → staging（后续 phrases.json 原料） ----
        for p in item["phrases"]:
            phrase_staging.append({
                "phrase": p["phrase"].strip().lower(),
                "translation": (p.get("translation") or "").strip(),
                "headword": w,
            })

    # 按 LETTER_GROUPS 顺序输出章节；空章节跳过
    chapters = [chapters_map[f"sat-{lo}-{hi}"] for lo, hi in LETTER_GROUPS
                if f"sat-{lo}-{hi}" in chapters_map and chapters_map[f"sat-{lo}-{hi}"]["paragraphs"]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    chapters_json = {
        "bookId": "sat-practice",
        "title": "SAT Vocabulary Practice",
        "author": "Compiled from local word lists",
        "chapters": chapters,
    }
    (OUT_DIR / "chapters.json").write_text(
        json.dumps(chapters_json, ensure_ascii=False, indent=1), encoding="utf-8")

    dict_json = {"bookId": "sat-practice", "words": dictionary}
    (OUT_DIR / "dictionary.json").write_text(
        json.dumps(dict_json, ensure_ascii=False, indent=1), encoding="utf-8")

    (STAGING_DIR / "sat_phrases_staging.json").write_text(
        json.dumps(phrase_staging, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- 注册到 book-index.json（幂等） ----
    index_path = READER_PUBLIC / "books" / "book-index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if not any(b.get("id") == "sat-practice" for b in index.get("books", [])):
        index["books"].append({
            "id": "sat-practice",
            "title": "SAT Vocabulary Practice",
            "author": "Word Lists",
            "coverUrl": None,
            "dataUrl": "books/sat-practice/",
        })
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        print("已注册 sat-practice 到 book-index.json")
    else:
        print("sat-practice 已在 book-index.json 中")

    total_paras = sum(len(c["paragraphs"]) for c in chapters)
    print(f"完成: {len(dictionary)} 词, {len(chapters)} 章, {total_paras} 例句段落, "
          f"{len(phrase_staging)} 条词组进 staging")


if __name__ == "__main__":
    build()
