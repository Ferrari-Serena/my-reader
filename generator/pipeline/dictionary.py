"""
词典查询器
输入：word-list.json + Merriam-Webster Collegiate API
输出：dictionary.json

查询策略：
1. 优先查 M-W API（如果 API Key 可用）
2. API 不可用时生成空词典框架
"""

import json
import time
import requests

MW_API_BASE = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/'


def lookup_dictionary(word_list: dict, chapters_data: dict, api_key: str = '') -> dict:
    """
    为词表中的每个词查询词典释义
    同时交叉匹配 SAT/AP 词表（内置在代码中）

    返回：dictionary.json 格式
    """
    words_data = word_list.get('words', {})
    book_id = word_list.get('bookId', '')

    # 加载 SAT/AP 标记词表
    sat_ap_words = _load_sat_ap_words()

    dictionary = {}
    total = len(words_data)
    api_available = bool(api_key)

    if not api_available:
        print('⚠️  未设置 MW_API_KEY，跳过 API 查询，生成空词典框架')

    for i, (lemma, info) in enumerate(words_data.items()):
        entry = {
            'lemma': lemma,
            'phonetic': '',
            'partOfSpeech': '',
            'definitions': [],
            'audioUrl': '',
            'level': sat_ap_words.get(lemma, None),  # SAT / AP 标记
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
                            # 音标
                            hwi = entry_data.get('hwi', {})
                            prs = hwi.get('prs', [])
                            if prs:
                                entry['phonetic'] = prs[0].get('mw', '')

                            # 词性
                            fl = entry_data.get('fl', '')
                            entry['partOfSpeech'] = fl

                            # 释义
                            shortdef = entry_data.get('shortdef', [])
                            entry['definitions'] = shortdef[:5]  # 最多 5 条

                            # 发音音频
                            if prs:
                                sound = prs[0].get('sound', {})
                                audio = sound.get('audio', '')
                                if audio:
                                    # M-W 音频 URL 格式
                                    subdir = audio[0] if audio else ''
                                    entry['audioUrl'] = (
                                        f'https://media.merriam-webster.com/audio/prons/en/us/mp3/'
                                        f'{subdir}/{audio}.mp3'
                                    )

                elif resp.status_code == 429:
                    print(f'  ⚠️  API 限流，暂停 1 秒...')
                    time.sleep(1)

            except requests.RequestException as e:
                print(f'  ⚠️  "{lemma}" 查询失败: {e}')
            except (KeyError, IndexError, TypeError) as e:
                print(f'  ⚠️  "{lemma}" 解析响应失败: {e}')

        dictionary[lemma] = entry

        if (i + 1) % 50 == 0:
            print(f'  词典进度: {i + 1}/{total}', flush=True)

    return {
        'bookId': book_id,
        'words': dictionary
    }


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
