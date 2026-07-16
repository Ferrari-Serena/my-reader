"""
词汇提取器
输入：chapters.json 数据结构
输出：word-list.json（候选词汇 + 章节出现信息）
过滤策略：NGSL 2,800 常见词
"""

import re
import os

# 词形还原的最小实现（避免引入重量级 NLP 库）
# 仅处理常见屈折变化：复数、过去式、进行时、比较级等
IRREGULAR_LEMMAS = {
    'was': 'be', 'were': 'be', 'been': 'be', 'being': 'be',
    'had': 'have', 'has': 'have', 'having': 'have',
    'did': 'do', 'does': 'do', 'done': 'do', 'doing': 'do',
    'said': 'say', 'says': 'say', 'saying': 'say',
    'went': 'go', 'goes': 'go', 'gone': 'go', 'going': 'go',
    'made': 'make', 'makes': 'make', 'making': 'make',
    'took': 'take', 'takes': 'take', 'taken': 'take', 'taking': 'take',
    'came': 'come', 'comes': 'come', 'coming': 'come',
    'knew': 'know', 'knows': 'know', 'known': 'know', 'knowing': 'know',
    'got': 'get', 'gets': 'get', 'gotten': 'get', 'getting': 'get',
    'gave': 'give', 'gives': 'give', 'given': 'give', 'giving': 'give',
    'found': 'find', 'finds': 'find', 'finding': 'find',
    'thought': 'think', 'thinks': 'think', 'thinking': 'think',
    'told': 'tell', 'tells': 'tell', 'telling': 'tell',
    'became': 'become', 'becomes': 'become', 'becoming': 'become',
    'left': 'leave', 'leaves': 'leave', 'leaving': 'leave',
    'felt': 'feel', 'feels': 'feel', 'feeling': 'feel',
    'put': 'put', 'puts': 'put', 'putting': 'put',
    'brought': 'bring', 'brings': 'bring', 'bringing': 'bring',
    'began': 'begin', 'begins': 'begin', 'begun': 'begin', 'beginning': 'begin',
    'kept': 'keep', 'keeps': 'keep', 'keeping': 'keep',
    'held': 'hold', 'holds': 'hold', 'holding': 'hold',
    'wrote': 'write', 'writes': 'write', 'written': 'write', 'writing': 'write',
    'stood': 'stand', 'stands': 'stand', 'standing': 'stand',
    'heard': 'hear', 'hears': 'hear', 'hearing': 'hear',
    'ran': 'run', 'runs': 'run', 'running': 'run',
    'sat': 'sit', 'sits': 'sit', 'sitting': 'sit',
    'spoke': 'speak', 'speaks': 'speak', 'spoken': 'speak', 'speaking': 'speak',
    'saw': 'see', 'sees': 'see', 'seen': 'see', 'seeing': 'see',
    'lay': 'lie', 'lies': 'lie', 'lain': 'lie', 'lying': 'lie',
    'led': 'lead', 'leads': 'lead', 'leading': 'lead',
    'read': 'read', 'reads': 'read', 'reading': 'read',
    'grew': 'grow', 'grows': 'grow', 'grown': 'grow', 'growing': 'grow',
    'fell': 'fall', 'falls': 'fall', 'fallen': 'fall', 'falling': 'fall',
    'drew': 'draw', 'draws': 'draw', 'drawn': 'draw', 'drawing': 'draw',
    'won': 'win', 'wins': 'win', 'winning': 'win',
    'bought': 'buy', 'buys': 'buy', 'buying': 'buy',
    'caught': 'catch', 'catches': 'catch', 'catching': 'catch',
    'chose': 'choose', 'chooses': 'choose', 'chosen': 'choose', 'choosing': 'choose',
    'drove': 'drive', 'drives': 'drive', 'driven': 'drive', 'driving': 'drive',
    'ate': 'eat', 'eats': 'eat', 'eaten': 'eat', 'eating': 'eat',
    'flew': 'fly', 'flies': 'fly', 'flown': 'fly', 'flying': 'fly',
    'rose': 'rise', 'rises': 'rise', 'risen': 'rise', 'rising': 'rise',
    'sang': 'sing', 'sings': 'sing', 'sung': 'sing', 'singing': 'sing',
    'swam': 'swim', 'swims': 'swim', 'swum': 'swim', 'swimming': 'swim',
    'threw': 'throw', 'throws': 'throw', 'thrown': 'throw', 'throwing': 'throw',
    'wore': 'wear', 'wears': 'wear', 'worn': 'wear', 'wearing': 'wear',
}


def load_ngsl(ngsl_path: str) -> set:
    """加载 NGSL 词表"""
    if not os.path.exists(ngsl_path):
        print(f'⚠️  NGSL 词表未找到: {ngsl_path}，使用空过滤集')
        return set()

    common_words = set()
    with open(ngsl_path, 'r', encoding='utf-8') as f:
        for line in f:
            word = line.strip().lower()
            if word and not word.startswith('#'):
                common_words.add(word)
    return common_words


def _simple_lemmatize(word: str) -> str:
    """简化的词形还原 — 保守策略，避免破坏专有名词"""
    w = word.lower()
    if len(w) < 3:
        return w

    # 查不规则表
    if w in IRREGULAR_LEMMAS:
        return IRREGULAR_LEMMAS[w]

    # 只处理最确定的屈折变化，不猜测（避免 Jonas→jona, giver→giv）
    if w.endswith('ies') and len(w) > 5:
        return w[:-3] + 'y'
    if w.endswith('ves') and len(w) > 5:
        return w[:-3] + 'f'
    if w.endswith('ing') and len(w) > 5:
        base = w[:-3]
        if base.endswith(base[-1]) and len(base) > 2:
            base = base[:-1]
        return base
    if w.endswith('ed') and len(w) > 5:
        base = w[:-2]
        if base.endswith(base[-1]) and len(base) > 2:
            base = base[:-1]
        return base
    # 复数 s — 只在足够长的词上处理，避免破坏人名（Jonas, James 等）
    if w.endswith('s') and not w.endswith('ss') and not w.endswith('us') and len(w) > 6:
        return w[:-1]

    return w


def tokenize(text: str) -> list:
    """从文本中提取纯字母单词（≥3 字符）"""
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text)
    return [w.lower() for w in words]


def extract_vocabulary(chapters_data: dict, ngsl_path: str) -> dict:
    """
    从章节数据中提取候选词汇
    返回：{ words: { word: { lemma, chapters, totalOccurrences } } }
    """
    ngsl = load_ngsl(ngsl_path)
    print(f'NGSL 词表加载了 {len(ngsl)} 个常见词')

    word_info = {}  # word -> { lemma, chapters: set, count: int }

    for chapter in chapters_data.get('chapters', []):
        ch_id = chapter['id']
        for para in chapter.get('paragraphs', []):
            tokens = tokenize(para['text'])
            for token in tokens:
                lemma = _simple_lemmatize(token)

                # 过滤：常见词、短词、纯数字
                if lemma in ngsl or token in ngsl:
                    continue
                if len(lemma) < 3:
                    continue

                key = lemma  # 以 lemma 为键
                if key not in word_info:
                    word_info[key] = {
                        'lemma': lemma,
                        'chapters': set(),
                        'totalOccurrences': 0
                    }
                word_info[key]['chapters'].add(ch_id)
                word_info[key]['totalOccurrences'] += 1

    # 转为可序列化格式
    words = {}
    for lemma, info in sorted(word_info.items()):
        words[lemma] = {
            'lemma': info['lemma'],
            'chapters': sorted(info['chapters']),
            'totalOccurrences': info['totalOccurrences']
        }

    print(f'提取了 {len(words)} 个候选词汇（过滤掉了 {len(ngsl)} 个 NGSL 词）')
    return {
        'bookId': chapters_data.get('bookId', ''),
        'words': words
    }
