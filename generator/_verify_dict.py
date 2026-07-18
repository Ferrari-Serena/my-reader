# -*- coding: utf-8 -*-
"""One-off QA script for the-giver dictionary.json backfill."""
import json
import random
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PATH = r'D:\睿谊的WPS\Ferrariwork\my-reader\reader\public\books\the-giver\dictionary.json'

# 6. valid JSON + top-level format
raw = open(PATH, encoding='utf-8').read()
data = json.loads(raw)
print('TOP_KEYS:', sorted(data.keys()))
print('bookId:', data.get('bookId'))
words = data['words']
print('TOTAL_ENTRIES:', len(words))

HAN = re.compile(r'[一-鿿]')
REQ_KEYS = {'lemma', 'phonetic', 'partOfSpeech', 'definitions', 'audioUrl', 'level', 'chapters'}

# 5. counts
nonempty = sum(1 for e in words.values() if e.get('definitions'))
chinese = sum(1 for e in words.values()
              if any(HAN.search(d) for d in (e.get('definitions') or [])))
print('NONEMPTY_DEFS:', nonempty)
print('CHINESE_DEFS:', chinese)
print('EMPTY_DEFS:', len(words) - nonempty)

# 4. structural integrity
bad_keys = {}
for w, e in words.items():
    missing = REQ_KEYS - set(e.keys())
    if missing:
        bad_keys[w] = sorted(missing)
print('ENTRIES_MISSING_KEYS:', len(bad_keys))
for w, m in list(bad_keys.items())[:10]:
    print('  MISSING', w, m)

# extra: phonetic format & POS survey (only among non-empty entries)
phon_present = sum(1 for e in words.values()
                   if e.get('definitions') and e.get('phonetic'))
phon_slashed = sum(1 for e in words.values()
                   if e.get('definitions') and re.fullmatch(r'/.+/', e.get('phonetic') or ''))
print('PHONETIC_PRESENT(nonempty defs):', phon_present, '/', nonempty)
print('PHONETIC_SLASH_FORMAT:', phon_slashed)

from collections import Counter
pos_counter = Counter(e.get('partOfSpeech', '') for e in words.values() if e.get('definitions'))
print('POS_VALUES:', dict(pos_counter.most_common(30)))
weird_pos = {p: c for p, c in pos_counter.items()
             if p and p not in ('n.', 'v.', 'adj.', 'adv.', 'num.', 'conj.',
                                'prep.', 'interj.', 'det.', 'pron.')}
print('WEIRD_POS:', weird_pos)
if weird_pos:
    for p in weird_pos:
        examples = [w for w, e in words.items()
                    if e.get('partOfSpeech') == p and e.get('definitions')][:5]
        print('  POS', repr(p), 'examples:', examples)

# empty-def sample (should be old shells / proper nouns)
empties = [w for w, e in words.items() if not e.get('definitions')][:15]
print('EMPTY_DEF_SAMPLE:', empties)

# 2. random sample of 20 entries WITH definitions
random.seed(42)
sample = random.sample([w for w, e in words.items() if e.get('definitions')], 20)
print('\n--- RANDOM SAMPLE 20 ---')
for w in sample:
    e = words[w]
    defs = e['definitions']
    has_cn = any(HAN.search(d) for d in defs)
    phon = e.get('phonetic', '')
    phon_ok = bool(re.fullmatch(r'/.+/', phon))
    print(f"{w!r} lemma={e.get('lemma')!r} phon={phon!r}(ok={phon_ok}) "
          f"pos={e.get('partOfSpeech')!r} nDefs={len(defs)} CN={has_cn} "
          f"def0={defs[0][:60]!r}")

# 3. specific words
print('\n--- SPECIFIC WORDS ---')
for w in ['eloquent', 'gave', 'went', 'taken', 'children', 'the', 'and', 'jonas', 'a', 'i']:
    e = words.get(w)
    if e is None:
        print(f'{w!r}: ABSENT')
        continue
    defs = e.get('definitions') or []
    print(f"{w!r}: lemma={e.get('lemma')!r} phon={e.get('phonetic')!r} "
          f"pos={e.get('partOfSpeech')!r} nDefs={len(defs)} "
          f"CN={any(HAN.search(d) for d in defs)} defs={defs[:3]}")

# truncation check: how many hit the [:6] cap
capped = sum(1 for e in words.values() if len(e.get('definitions') or []) == 6)
print('\nENTRIES_AT_6_DEF_CAP:', capped)
over = [w for w, e in words.items() if len(e.get('definitions') or []) > 6][:5]
print('ENTRIES_OVER_6 (kept old M-W?):', over)

# mojibake / encoding sanity: look for replacement chars
bad_enc = [w for w, e in words.items()
           if any('�' in d for d in (e.get('definitions') or []))][:5]
print('REPLACEMENT_CHAR_ENTRIES:', bad_enc)
