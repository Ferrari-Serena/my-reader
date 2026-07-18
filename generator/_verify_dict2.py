# -*- coding: utf-8 -*-
import json, re, sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
data = json.load(open(r'D:\睿谊的WPS\Ferrariwork\my-reader\reader\public\books\the-giver\dictionary.json', encoding='utf-8'))
words = data['words']
HAN = re.compile(r'[一-鿿]')
nocn = [w for w, e in words.items() if e.get('definitions') and not any(HAN.search(d) for d in e['definitions'])]
print('NO_CHINESE_ENTRIES:', nocn)
for w in nocn:
    print(' ', w, words[w]['definitions'][:2])
conn = sqlite3.connect(r'file:D:\PythonEnv\ecdict\stardict.db?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
for w in ['jonas', 'jona', 'about', 'every', 'the', 'strongest']:
    r = conn.execute('SELECT word,phonetic,pos,exchange,translation FROM stardict WHERE word=? COLLATE NOCASE LIMIT 1', (w,)).fetchone()
    if r:
        print(f"ECDICT {w!r}: pos={r['pos']!r} exchange={r['exchange']!r} phon={r['phonetic']!r} trans={(r['translation'] or '')[:45]!r}")
