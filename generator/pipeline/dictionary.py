"""
词典查询器
输入：word-list.json + ECDICT 本地 SQLite（主） + Merriam-Webster Collegiate API（可选兜底）
输出：dictionary.json

查询策略：
1. ECDICT 本地 SQLite 优先（零延迟，中文释义，离线可用）
2. M-W API 兜底（英文释义，需要 MW_API_KEY 且 ECDICT 未命中时）
"""

import json
import time
import requests
from ecdict import get_ecdict

MW_API_BASE = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/'


def lookup_dictionary(word_list: dict, chapters_data: dict, api_key: str = '') -> dict:
    """
    为词表中的每个词查询词典释义。
    ECDICT 命中时直接填入中文释义；未命中且 api_key 非空时回退 M-W API。
    """
    words_data = word_list.get('words', {})
    book_id = word_list.get('bookId', '')

    sat_ap_words = _load_sat_ap_words()

    dictionary = {}
    total = len(words_data)
    ecdict = get_ecdict()
    api_available = bool(api_key)

    for i, (lemma, info) in enumerate(words_data.items()):
        # 查 ECDICT
        e = ecdict.lookup(lemma)
        if e and e.get('definitions'):
            entry = {
                'lemma': lemma,
                'phonetic': e['phonetic'],
                'partOfSpeech': e['partOfSpeech'],
                'definitions': e['definitions'][:6],
                'audioUrl': '',
                'level': sat_ap_words.get(lemma, None),
                'chapters': info.get('chapters', [])
            }
            dictionary[lemma] = entry
        else:
            # ECDICT 未命中 → 空壳 + M-W API 兜底（若有 key）
            entry = {
                'lemma': lemma,
                'phonetic': '',
                'partOfSpeech': '',
                'definitions': [],
                'audioUrl': '',
                'level': sat_ap_words.get(lemma, None),
                'chapters': info.get('chapters', [])
            }
            if api_available:
                try:
                    resp = requests.get(
                        f'{MW_API_BASE}{lemma}',
                        params={'key': api_key},
                        timeout=10
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        if data and isinstance(data, list) and len(data) > 0:
                            entry_data = data[0]
                            if isinstance(entry_data, dict):
                                hwi = entry_data.get('hwi', {})
                                prs = hwi.get('prs', [])
                                if prs:
                                    entry['phonetic'] = prs[0].get('mw', '')
                                entry['partOfSpeech'] = entry_data.get('fl', '')
                                entry['definitions'] = entry_data.get('shortdef', [])[:5]
                                if prs:
                                    sound = prs[0].get('sound', {})
                                    audio = sound.get('audio', '')
                                    if audio:
                                        subdir = audio[0] if audio else ''
                                        entry['audioUrl'] = (
                                            'https://media.merriam-webster.com/audio/prons/en/us/mp3/'
                                            f'{subdir}/{audio}.mp3'
                                        )
                    elif resp.status_code == 429:
                        time.sleep(1)
                except requests.RequestException:
                    pass
            dictionary[lemma] = entry

        if (i + 1) % 200 == 0:
            print(f'  词典进度: {i + 1}/{total}', flush=True)

    return {'bookId': book_id, 'words': dictionary}


def _load_sat_ap_words() -> dict:
    """
    内置 SAT + AP Literature 核心词汇表（精选高频考试词）
    格式：{ word: 'SAT' | 'AP' }

    TODO: 后续替换为完整的 Barron's 3500 + AP Lit 词表文件
    """
    sat_words = {
        # SAT 高频学术词汇（精简版，完整列表后续从文件加载）
        'ambiguous', 'analyze', 'assert', 'bias', 'coherent', 'compile',
        'comprehensive', 'conceive', 'contradict', 'corroborate', 'cynic',
        'deduce', 'depict', 'derive', 'deter', 'digress', 'dilemma',
        'disdain', 'disparity', 'elaborate', 'eloquent', 'embody',
        'empirical', 'enhance', 'ephemeral', 'equivocal', 'eradicate',
        'exemplify', 'explicit', 'facilitate', 'feasible', 'fluctuate',
        'formulate', 'hypothetical', 'illuminate', 'imminent', 'implement',
        'implicit', 'impose', 'incentive', 'indifferent', 'inevitable',
        'infer', 'innovative', 'integrity', 'intervene', 'intricate',
        'justify', 'latent', 'lucid', 'magnitude', 'manifest', 'mundane',
        'negate', 'nostalgia', 'notion', 'novel', 'nuance', 'null',
        'objective', 'obsolete', 'ominous', 'optimism', 'paradox',
        'perpetuate', 'plausible', 'pragmatic', 'precede', 'predominant',
        'profound', 'provoke', 'qualitative', 'quantitative', 'redundant',
        'refute', 'reinforce', 'reluctant', 'reproach', 'repudiate',
        'resolve', 'retain', 'reverent', 'rigorous', 'skeptical',
        'speculate', 'spontaneous', 'static', 'stringent', 'subordinate',
        'substantiate', 'subtle', 'succinct', 'superficial', 'suppress',
        'sustain', 'synthesis', 'tangible', 'tenacious', 'undermine',
        'uniform', 'universal', 'valid', 'verify', 'viable', 'vulnerable',
    }

    ap_lit_words = {
        # AP Literature 文学分析术语
        'allegory', 'alliteration', 'allusion', 'ambiguity', 'analogy',
        'anecdote', 'antagonist', 'apostrophe', 'archetype', 'aside',
        'assonance', 'atmosphere', 'bildungsroman', 'cacophony',
        'caesura', 'catharsis', 'characterization', 'climax', 'colloquial',
        'connotation', 'consonance', 'couplet', 'denotation', 'denouement',
        'dialect', 'dialogue', 'diction', 'dramatic', 'elegy', 'enjambment',
        'epic', 'epiphany', 'epistolary', 'euphemism', 'euphony',
        'exposition', 'figurative', 'flashback', 'foil', 'foreshadowing',
        'genre', 'hamartia', 'hubris', 'hyperbole', 'imagery', 'irony',
        'juxtaposition', 'metaphor', 'meter', 'metonymy', 'monologue',
        'motif', 'narrative', 'narrator', 'onomatopoeia', 'oxymoron',
        'paradox', 'parallelism', 'parody', 'pastoral', 'personification',
        'plot', 'point of view', 'protagonist', 'pun', 'quatrain',
        'rhetoric', 'rhyme', 'rhythm', 'satire', 'setting', 'simile',
        'soliloquy', 'sonnet', 'stanza', 'stream of consciousness',
        'symbol', 'synecdoche', 'syntax', 'theme', 'tone', 'tragedy',
        'understatement', 'vernacular', 'verse',
    }

    words = {}
    for w in sat_words:
        words[w] = 'SAT'
    for w in ap_lit_words:
        words[w] = 'AP'
    return words
