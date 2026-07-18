# -*- coding: utf-8 -*-
import json, sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
conn = sqlite3.connect(r'file:D:\PythonEnv\ecdict\stardict.db?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
for w in ['he', 'she', 'him', 'them', 'with', 'of', 'in', 'to']:
    r = conn.execute('SELECT pos FROM stardict WHERE word=? COLLATE NOCASE LIMIT 1', (w,)).fetchone()
    print(w, '->', r['pos'] if r else None)
# which words in the output dict got labeled prep.?
data = json.load(open(r'D:\睿谊的WPS\Ferrariwork\my-reader\reader\public\books\the-giver\dictionary.json', encoding='utf-8'))
preps = [w for w, e in data['words'].items() if e.get('partOfSpeech') == 'prep.'][:15]
print('LABELED prep.:', preps)
