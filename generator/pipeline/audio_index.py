"""生成 <book>/audio-index.json —— 哪些章有音频、哪些没有及原因。

「有音频」= reader/public/books/<book>/audio/<chapterId>.mp3 存在且非空。
「没有」的原因两种，判据与 tts.py 跳过朗读的判据同源（见 frontmatter.py）：
  - front_matter：短 + 标题像版权页/目录页 → 本来就不打算朗读
  - unrecorded  ：其它 → 该录没录（如 divergent 的 89 章）

前端据此在章表里标「无音频（前置页）/（未录制）」，并让无音频章「明确提示 +
浏览器朗读兜底」，不静默卡住。清单只由本地 audio/ 目录算出（那正是上传 R2 的
暂存区），所以 upload_audio.py 传完顺手刷新，保证清单与 R2 一致。

用法：
    python generator/pipeline/audio_index.py --all
    python generator/pipeline/audio_index.py the-giver
"""

import argparse
import json
import os
import sys

try:  # 作为包导入：upload_audio.py / python -m pipeline.audio_index
    from .frontmatter import DEFAULT_MIN_WORDS, chapter_word_count, is_front_matter
except ImportError:  # 直接当脚本跑：python audio_index.py
    from frontmatter import DEFAULT_MIN_WORDS, chapter_word_count, is_front_matter

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BOOKS_DIR = os.path.join(REPO_ROOT, 'reader', 'public', 'books')

FRONT_MATTER = 'front_matter'
UNRECORDED = 'unrecorded'


def _has_audio(book_id: str, chapter_id: str) -> bool:
    path = os.path.join(BOOKS_DIR, book_id, 'audio', f'{chapter_id}.mp3')
    return os.path.exists(path) and os.path.getsize(path) > 0


def build_index(book_id: str) -> dict:
    """算出某本书的音频清单（不落盘）。输出确定：同样的本地文件 → 同样的 JSON。"""
    chapters_path = os.path.join(BOOKS_DIR, book_id, 'chapters.json')
    with open(chapters_path, 'rb') as f:
        data = json.loads(f.read().decode('utf-8-sig'))

    with_audio, missing = [], {}
    for ch in data['chapters']:
        cid = ch['id']
        if _has_audio(book_id, cid):
            with_audio.append(cid)
        else:
            missing[cid] = FRONT_MATTER if is_front_matter(ch) else UNRECORDED

    return {
        'book': book_id,
        'withAudio': with_audio,
        'missing': missing,
    }


def write_index(book_id: str, dry_run: bool = False):
    """生成并落盘 <book>/audio-index.json。返回 (路径, 清单)。"""
    index = build_index(book_id)
    path = os.path.join(BOOKS_DIR, book_id, 'audio-index.json')
    if not dry_run:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
            f.write('\n')
    return path, index


def books_with_chapters() -> list:
    return sorted(
        name for name in os.listdir(BOOKS_DIR)
        if os.path.exists(os.path.join(BOOKS_DIR, name, 'chapters.json'))
    )


def summary(book_id: str, index: dict) -> str:
    return (f'{book_id}: {len(index["withAudio"])} 有音频 / '
            f'{len(index["missing"])} 无音频')


def main():
    ap = argparse.ArgumentParser(description='生成 audio-index.json')
    ap.add_argument('book_id', nargs='?', help='书名 id（reader/public/books/ 下的目录名）')
    ap.add_argument('--all', action='store_true', help='所有含 chapters.json 的书')
    ap.add_argument('--dry-run', action='store_true', help='只打印，不落盘')
    args = ap.parse_args()

    if args.all:
        books = books_with_chapters()
    elif args.book_id:
        books = [args.book_id]
    else:
        ap.error('需要 book_id，或 --all')

    for book_id in books:
        path, index = write_index(book_id, dry_run=args.dry_run)
        tag = '[dry-run] ' if args.dry_run else ''
        print(f'{tag}{summary(book_id, index)} → {os.path.relpath(path, REPO_ROOT)}')


if __name__ == '__main__':
    main()
