"""
ecdict.py — ECDICT SQLite 本地词典查询封装（stdlib sqlite3，零新依赖）。

数据库：D:\\PythonEnv\\ecdict\\stardict.db（ECDICT release 1.0.28，~340万词条）
表 stardict 字段：
  word        词头（COLLATE NOCASE 唯一索引）
  phonetic    IPA 音标
  definition  英文释义（\\n 分隔多行）
  translation 中文释义（\\n 分隔多行）
  pos         词性频率 "n:60/v:40"
  tag         考试标签 "zk gk cet4 cet6 ky toefl ielts gre"
  exchange    变形 "d:过去式/p:过去分词/3:三单/i:现在分词/s:复数/0:lemma/1:变形类型"
  frq         COCA 词频排名
"""

import os
import re
import sqlite3

DB_PATH = r'D:\PythonEnv\ecdict\stardict.db'


class Ecdict:
    def __init__(self, db_path=DB_PATH):
        if not os.path.exists(db_path):
            raise FileNotFoundError(
                f'ECDICT 数据库不存在: {db_path}\n'
                '下载: https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip'
            )
        # 只读打开；check_same_thread=False 允许 Flask 线程共用（只读安全）
        self.conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def _query(self, word):
        cur = self.conn.execute(
            'SELECT word, phonetic, definition, translation, pos, tag, exchange, frq '
            'FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1', (word,))
        return cur.fetchone()

    def lookup(self, word, follow_lemma=True):
        """
        查询单词，返回统一格式 dict；查不到返回 None。
        follow_lemma: 命中的是变形词（exchange 含 "0:lemma"）时自动再查原形，
                      释义取原形的（went → go 的释义），lemma 字段记录原形。
        """
        word = (word or '').strip().lower()
        if not word:
            return None

        row = self._query(word)
        if row is None:
            return None

        lemma = word
        # 变形词反查原形："0:give" 表示本词是 give 的变形
        if follow_lemma and row['exchange']:
            m = re.search(r'0:([a-zA-Z-]+)', row['exchange'])
            if m and m.group(1).lower() != word:
                base_row = self._query(m.group(1))
                if base_row is not None and (base_row['translation'] or base_row['definition']):
                    lemma = m.group(1).lower()
                    # 本词自身无释义时用原形的释义
                    if not (row['translation'] or row['definition']):
                        row = base_row

        definitions = []
        # 中文释义在前
        if row['translation']:
            definitions += [ln.strip() for ln in row['translation'].split('\n') if ln.strip()]
        # 英文释义追加在后
        if row['definition']:
            definitions += [ln.strip() for ln in row['definition'].split('\n') if ln.strip()]
        if not definitions:
            return None

        # pos "n:60/v:40" → 主词性；ECDICT 代码映射为常规缩写（j→adj, r→adv 等）
        POS_MAP = {'j': 'adj', 'r': 'adv', 'v': 'v', 'n': 'n', 'm': 'num',
                   'c': 'conj', 'p': 'prep', 'u': 'interj', 'd': 'det', 't': 'pron'}
        pos = ''
        if row['pos']:
            first = row['pos'].split('/')[0].split(':')[0].strip()
            if first:
                pos = POS_MAP.get(first, first) + '.'

        return {
            'lemma': lemma,
            'phonetic': f"/{row['phonetic']}/" if row['phonetic'] else '',
            'partOfSpeech': pos,
            'definitions': definitions,
            'tag': row['tag'] or '',
            'frq': row['frq'] or 0,
        }

    def close(self):
        self.conn.close()


# 模块级单例（管道内多处使用同一连接）
_instance = None


def get_ecdict():
    global _instance
    if _instance is None:
        _instance = Ecdict()
    return _instance


if __name__ == '__main__':
    # 冒烟测试
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    d = Ecdict()
    for w in ['eloquent', 'gave', 'parsimonious', 'run', 'notaword123']:
        r = d.lookup(w)
        if r:
            print(f"{w} -> lemma={r['lemma']} {r['phonetic']} {r['partOfSpeech']} "
                  f"defs={r['definitions'][:2]} tag={r['tag']}")
        else:
            print(f'{w} -> None')
