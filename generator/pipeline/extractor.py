"""
词汇提取器
输入：chapters.json 数据结构
输出：word-list.json（候选词汇 + 章节出现信息）
过滤策略：NGSL 2,800 常见词 + 连字符复合词整体纳入（clothes / ground 例外见 NGSL_EXCEPTIONS）
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


# NGSL 例外：这两个词的表面形本身就是要查的词，但 ECDICT 的词头表会把它们并到
# 语义不同的原形上（ground→grind「磨」、clothes→clothe「给…穿衣」），而 NGSL 词表
# 收的恰好是屈折形本身 → 按原形过滤会把正文里真正会点的这两条整条滤掉。
# 例外只认表面形：以自身为词头、且不参与 NGSL 过滤（见 _resolve_lemma / extract_vocabulary）。
NGSL_EXCEPTIONS = {'clothes', 'ground'}


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

    # 连字符复合词不套后缀规则：low-roofed 会被 'ed' 规则砍成 low-roof 这种残根
    if '-' in w:
        return w

    # 查不规则表
    if w in IRREGULAR_LEMMAS:
        return IRREGULAR_LEMMAS[w]

    # 只处理最确定的屈折变化，不猜测（避免 Jonas→jona, giver→giv）
    if w.endswith('ies') and len(w) > 5:
        return w[:-3] + 'y'
    if w.endswith('ves') and len(w) > 5:
        return w[:-3] + 'f'
    # 双写辅音还原一个：running → runn → run。判据必须是「末两字母相同」——
    # 原先写的 base.endswith(base[-1]) 是恒真式（末字母当然等于它自己），
    # 于是所有 ed/ing 词都被多砍一字母，accustomed → accustom → accusto
    # 这种残根会被当成词典 key 写进 dictionary.json（查不到释义）。
    if w.endswith('ing') and len(w) > 5:
        base = w[:-3]
        if len(base) > 2 and base[-1] == base[-2]:
            base = base[:-1]
        return base
    if w.endswith('ed') and len(w) > 5:
        base = w[:-2]
        if len(base) > 2 and base[-1] == base[-2]:
            base = base[:-1]
        return base
    # 复数 s — 只在足够长的词上处理，避免破坏人名（Jonas, James 等）
    if w.endswith('s') and not w.endswith('ss') and not w.endswith('us') and len(w) > 6:
        return w[:-1]

    return w


def _resolve_lemma(word: str, ecdict=None) -> str:
    """
    表面形 → 词头。**ECDICT 优先，手写规则兜底**。

    为什么不是规则优先：ECDICT 自己的变形表（exchange 的 ``0:`` 字段）就是权威映射，
    实测 accustomed→accustom、benches→bench、chuckled→chuckle、buttressed→buttress 全对。
    手写规则只靠后缀猜，会出两类错：把词根多砍一字母（accustomed→accusto）或
    命中同形异义词（chuckled→chuck，而 chuck 本身是合法词条，事后查不出来）。
    """
    surface = (word or '').strip().lower()
    if surface in NGSL_EXCEPTIONS:
        return surface
    if ecdict is not None:
        try:
            entry = ecdict.lookup(word)
        except Exception:
            entry = None
        if entry:
            lemma = (entry.get('lemma') or '').strip().lower()
            if lemma:
                return lemma
    return _simple_lemmatize(word)


_ECDICT = None
_ECDICT_TRIED = False


def _load_ecdict():
    """ECDICT 单例（惰性、只尝试一次）；不可用时返回 None，管道静默退回规则法。"""
    global _ECDICT, _ECDICT_TRIED
    if not _ECDICT_TRIED:
        _ECDICT_TRIED = True
        try:
            from ecdict import get_ecdict
            _ECDICT = get_ecdict()
            print('词形还原：ECDICT 词头表（优先）')
        except Exception as exc:
            _ECDICT = None
            print(f'⚠️  ECDICT 不可用（{type(exc).__name__}），词形还原退回规则法')
    return _ECDICT


def load_lemma_resolver(ecdict=None):
    """返回一个带缓存的 (token -> 词头) 解析器；ECDICT 不可用时静默退回规则法。"""
    if ecdict is None:
        ecdict = _load_ecdict()

    cache = {}

    def resolve(token: str) -> str:
        key = cache.get(token)
        if key is None:
            key = _resolve_lemma(token, ecdict)
            cache[token] = key
        return key

    return resolve


# 连字符复合词算一个 token（well-known / after-dinner）。前端点击热区用的是
# 「只剥首尾非字母」的 data-word（ReaderView.vue），内部连字符保留 —— 两端必须对齐，
# 否则词典里永远不会有正文实际点击的那个表面形。
TOKEN_RE = re.compile(r'\b[a-zA-Z]{3,}(?:-[a-zA-Z]+)*\b')


def tokenize(text: str) -> list:
    """从文本中提取单词（≥3 字符；连字符复合词整体算一个）"""
    return [w.lower() for w in TOKEN_RE.findall(text)]


def _candidate_lemmas(token: str, ecdict, resolve) -> list:
    """
    token → [(表面形, 词头)]。

    连字符复合词整体查 ECDICT：拆成 well + known 两个碎片的话，两个部分都在 NGSL 里、
    会被整条滤掉 —— 点 well-known 只能联网，这就是 0.3 要修的系统性缺口。
    整体查不到时（ECDICT 没这条，如 low-roofed）退回拆词口径：复合词里的实词
    （bible-word → bible）照旧进候选，不因为改了分词口径反而丢词。
    """
    if '-' not in token:
        return [(token, resolve(token))]

    entry = None
    if ecdict is not None:
        try:
            entry = ecdict.lookup(token)
        except Exception:
            entry = None
    if entry and entry.get('definitions'):
        lemma = (entry.get('lemma') or token).strip().lower()
        return [(token, lemma or token)]

    candidates = []
    for part in token.split('-'):
        if len(part) >= 3:
            candidates.append((part, resolve(part)))
    return candidates


def extract_vocabulary(chapters_data: dict, ngsl_path: str, ecdict=None) -> dict:
    """
    从章节数据中提取候选词汇
    返回：{ words: { lemma: { lemma, chapters, totalOccurrences, surfaces } } }

    surfaces = 该书正文里映射到这个词头的**全部表面形**（小写、去重、含自身）。
    阅读端用它建「表面形 → 词条」别名表：点 abandoned 也能离线命中 abandon 的词条，
    不必再依赖联网兜底；「已收藏」绿点线也靠它（数据模型里终于有表面形这个字段）。
    """
    ngsl = load_ngsl(ngsl_path)
    print(f'NGSL 词表加载了 {len(ngsl)} 个常见词')
    if ecdict is None:
        ecdict = _load_ecdict()
    resolve = load_lemma_resolver(ecdict)

    word_info = {}  # lemma -> { lemma, chapters: set, count: int, surfaces: set }

    for chapter in chapters_data.get('chapters', []):
        ch_id = chapter['id']
        for para in chapter.get('paragraphs', []):
            tokens = tokenize(para['text'])
            for token in tokens:
                for surface, lemma in _candidate_lemmas(token, ecdict, resolve):
                    # 过滤：常见词、短词（clothes / ground 例外见 NGSL_EXCEPTIONS）
                    if (lemma in ngsl or surface in ngsl) \
                            and surface not in NGSL_EXCEPTIONS \
                            and lemma not in NGSL_EXCEPTIONS:
                        continue
                    if len(lemma) < 3:
                        continue

                    key = lemma  # 以 lemma 为键
                    if key not in word_info:
                        word_info[key] = {
                            'lemma': lemma,
                            'chapters': set(),
                            'totalOccurrences': 0,
                            'surfaces': set()
                        }
                    word_info[key]['chapters'].add(ch_id)
                    word_info[key]['totalOccurrences'] += 1
                    word_info[key]['surfaces'].add(surface)

    # 转为可序列化格式
    words = {}
    for lemma, info in sorted(word_info.items()):
        words[lemma] = {
            'lemma': info['lemma'],
            'chapters': sorted(info['chapters']),
            'totalOccurrences': info['totalOccurrences'],
            'surfaces': sorted(info['surfaces'])
        }

    n_forms = sum(len(w['surfaces']) for w in words.values())
    print(f'提取了 {len(words)} 个候选词汇，覆盖 {n_forms} 个表面形（过滤掉了 {len(ngsl)} 个 NGSL 词）')
    return {
        'bookId': chapters_data.get('bookId', ''),
        'words': words
    }
