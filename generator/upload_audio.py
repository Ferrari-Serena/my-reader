"""
把章节音频上传到 Cloudflare R2。

音频经 Worker 代理分发（https://www.ferrari11.com/api/audio/<bookId>/<file>），
不进 git —— 所以 TTS 跑完之后必须走这一步，线上才有声音。

wrangler 的 r2 子命令没有批量模式：一本书是「章数 × 2」个对象
（<ch>.mp3 + <ch>.timings.json），只能逐个 put，这个脚本负责循环和重试。

用法：
    python upload_audio.py dr-jekyll-and-mr-hyde     # 上传一本书
    python upload_audio.py --all                     # 上传所有含音频的书
    python upload_audio.py <bookId> --verify         # 传完顺便探测线上可访问
    python upload_audio.py <bookId> --dry-run        # 只列出要传什么

前置：在 worker/ 目录下先跑 `npx wrangler login`（token 会过期，需重登）。
"""

import argparse
import os
import re
import subprocess
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, '..'))
WORKER_DIR = os.path.join(REPO_ROOT, 'worker')
BOOKS_DIR = os.path.join(REPO_ROOT, 'reader', 'public', 'books')

# wrangler 走 Cloudflare API，需要科学上网
PROXY = 'http://127.0.0.1:7897'
# 线上探测用（--verify）
AUDIO_BASE = 'https://www.ferrari11.com/api/audio'

CONTENT_TYPES = {'.mp3': 'audio/mpeg', '.json': 'application/json'}


def _bucket_name() -> str:
    """从 worker/wrangler.toml 读桶名，避免和 Worker 绑定写岔。"""
    with open(os.path.join(WORKER_DIR, 'wrangler.toml'), encoding='utf-8') as f:
        match = re.search(r'bucket_name\s*=\s*"([^"]+)"', f.read())
    if not match:
        sys.exit('wrangler.toml 里找不到 r2 bucket_name')
    return match.group(1)


def _audio_files(book_id: str) -> list:
    """本书 audio/ 下所有要上传的文件（跳过空文件和临时文件）。"""
    audio_dir = os.path.join(BOOKS_DIR, book_id, 'audio')
    if not os.path.isdir(audio_dir):
        return []
    names = []
    for name in sorted(os.listdir(audio_dir)):
        path = os.path.join(audio_dir, name)
        ext = os.path.splitext(name)[1].lower()
        if ext not in CONTENT_TYPES:
            continue  # 跳过 .tmp/.wav 等中间产物
        if os.path.getsize(path) == 0:
            print(f'  跳过空文件: {name}')
            continue
        names.append(name)
    return names


def _put(bucket: str, book_id: str, name: str) -> bool:
    """上传单个对象；失败重试一次。"""
    path = os.path.join(BOOKS_DIR, book_id, 'audio', name)
    key = f'{book_id}/{name}'
    cmd = [
        'npx', '--no-install', 'wrangler', 'r2', 'object', 'put', f'{bucket}/{key}',
        f'--file={path}',
        f'--content-type={CONTENT_TYPES[os.path.splitext(name)[1].lower()]}',
        '--remote',  # wrangler 4.x 默认操作本地模拟存储，必须显式指定远端
    ]
    env = dict(os.environ, HTTP_PROXY=PROXY, HTTPS_PROXY=PROXY,
               http_proxy=PROXY, https_proxy=PROXY)

    for attempt in (1, 2):
        proc = subprocess.run(cmd, cwd=WORKER_DIR, env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if proc.returncode == 0:
            return True
        if attempt == 2:
            print(f'  失败: {key}')
            print('    ' + (proc.stdout or '').strip().replace('\n', '\n    ')[:600])
    return False


def _verify(book_id: str, name: str) -> bool:
    """HEAD 线上 URL，确认 Worker 真的能取到。"""
    url = f'{AUDIO_BASE}/{book_id}/{name}'
    request = urllib.request.Request(url, method='HEAD')
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status == 200
    except Exception:
        return False


def _books_with_audio() -> list:
    return sorted(
        name for name in os.listdir(BOOKS_DIR)
        if os.path.isdir(os.path.join(BOOKS_DIR, name, 'audio'))
    )


def main():
    parser = argparse.ArgumentParser(description='上传章节音频到 Cloudflare R2')
    parser.add_argument('book_id', nargs='?', help='书名 id（reader/public/books/ 下的目录名）')
    parser.add_argument('--all', action='store_true', help='上传所有含 audio/ 的书')
    parser.add_argument('--dry-run', action='store_true', help='只列出将上传的对象')
    parser.add_argument('--verify', action='store_true', help='传完探测线上是否可访问')
    args = parser.parse_args()

    if args.all:
        books = _books_with_audio()
    elif args.book_id:
        books = [args.book_id]
    else:
        parser.error('需要 book_id，或 --all')

    bucket = _bucket_name()
    print(f'R2 桶: {bucket}\n')

    total = uploaded = failed = 0
    verified = []
    for book_id in books:
        names = _audio_files(book_id)
        if not names:
            print(f'{book_id}: audio/ 下没有可上传的文件，跳过')
            continue

        print(f'{book_id}: {len(names)} 个对象')
        for name in names:
            total += 1
            if args.dry_run:
                print(f'  [dry-run] {bucket}/{book_id}/{name}')
                continue
            if _put(bucket, book_id, name):
                uploaded += 1
                print(f'  ok  {name}')
                verified.append((book_id, name))
            else:
                failed += 1
        print()

    if args.dry_run:
        print(f'共 {total} 个对象（未上传）')
        return

    print(f'完成: {uploaded}/{total} 成功, {failed} 失败')

    if args.verify and verified:
        print('\n线上探测:')
        bad = 0
        for book_id, name in verified:
            ok = _verify(book_id, name)
            if not ok:
                bad += 1
                print(f'  404 {book_id}/{name}')
        print(f'  {len(verified) - bad}/{len(verified)} 可访问')

    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
