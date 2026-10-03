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
    python upload_audio.py --all                     # 已在线且字节数一致的对象自动跳过
    python upload_audio.py --all --force             # 忽略跳过判据，全部重传

跳过判据：上传前先 HEAD 线上对象，Content-Length 与本地文件大小一致就跳过 ——
没有它，--all 会把 660MB 级的已在线音频整个重传一遍。

前置：在 worker/ 目录下先跑 `npx wrangler login`（token 会过期，需重登）。
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, '..'))
WORKER_DIR = os.path.join(REPO_ROOT, 'worker')
BOOKS_DIR = os.path.join(REPO_ROOT, 'reader', 'public', 'books')

# 生成端与前端共用的音频清单（传完顺手刷新，见 pipeline/audio_index.py）
sys.path.insert(0, BASE_DIR)
from pipeline.audio_index import summary, write_index

# wrangler 走 Cloudflare API，需要科学上网
PROXY = 'http://127.0.0.1:7897'
# 线上探测用（--verify）
AUDIO_BASE = 'https://www.ferrari11.com/api/audio'
# Cloudflare 会挡掉 Python-urllib 的默认 UA（403 Forbidden），必须显式带一个
UA = 'my-reader-upload-check/1.0'

CONTENT_TYPES = {'.mp3': 'audio/mpeg', '.json': 'application/json'}


def _bucket_name() -> str:
    """从 worker/wrangler.toml 读桶名，避免和 Worker 绑定写岔。"""
    with open(os.path.join(WORKER_DIR, 'wrangler.toml'), encoding='utf-8') as f:
        match = re.search(r'bucket_name\s*=\s*"([^"]+)"', f.read())
    if not match:
        sys.exit('wrangler.toml 里找不到 r2 bucket_name')
    return match.group(1)


def _npx() -> str:
    """解析 npx 的完整路径。

    Windows 上 npx 实际是 npx.CMD，subprocess 不走 shell 时不会做 PATHEXT
    解析，直接传 'npx' 会 FileNotFoundError（WinError 2）。
    """
    path = shutil.which('npx')
    if not path:
        sys.exit('❌ 找不到 npx，请确认 Node.js 已安装并在 PATH 中')
    return path


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
        _npx(), '--no-install', 'wrangler', 'r2', 'object', 'put', f'{bucket}/{key}',
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


def _verify(book_id: str, name: str) -> tuple:
    """HEAD 线上 URL，确认 Worker 能取到，且 R2 上的字节数与本地一致。

    用 HEAD 而非 GET：一本书几十 MB，探活不该把音频整个拉下来。
    这依赖 Worker 的 /api/audio 分支接住 HEAD —— 它原先只放 GET 过，
    HEAD 会掉到兜底 404，一次成功的上传看起来会像全部失败。
    返回 (是否通过, 失败原因)；原因必须带出来，否则 403/超时/404 会长得一模一样。
    """
    path = os.path.join(BOOKS_DIR, book_id, 'audio', name)
    url = f'{AUDIO_BASE}/{book_id}/{name}'
    # 不带 UA 会被 Cloudflare 判成爬虫挡掉（403），和对象不存在（404）是两回事
    request = urllib.request.Request(url, method='HEAD',
                                     headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            length = resp.headers.get('Content-Length')
            if length is None:
                return True, ''
            local = os.path.getsize(path)
            if int(length) == local:
                return True, ''
            return False, f'字节数不符（线上 {length} / 本地 {local}）'
    except urllib.error.HTTPError as e:
        return False, f'HTTP {e.code}'
    except Exception as e:
        return False, type(e).__name__


def _remote_size(book_id: str, name: str) -> tuple:
    """HEAD 线上对象，取 Content-Length。

    返回 (字节数 | None, 失败原因)。None 且原因是 'HTTP 404' 才是「线上确实没有」；
    其它失败（403/超时/DNS）一律当作「判不了」，交给调用方保守处理 ——
    绝不能把「探测失败」当成「要跳过」，那会把缺的对象永远补不上。
    """
    url = f'{AUDIO_BASE}/{book_id}/{name}'
    request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            length = resp.headers.get('Content-Length')
            return (int(length) if length is not None else None), ''
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}'
    except Exception as e:
        return None, type(e).__name__


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
    parser.add_argument('--force', action='store_true',
                        help='忽略「线上字节数一致就跳过」的判据，全部重传')
    args = parser.parse_args()

    if args.all:
        books = _books_with_audio()
    elif args.book_id:
        books = [args.book_id]
    else:
        parser.error('需要 book_id，或 --all')

    bucket = _bucket_name()
    print(f'R2 桶: {bucket}\n')

    total = uploaded = skipped = failed = 0
    verified = []
    for book_id in books:
        names = _audio_files(book_id)
        if not names:
            print(f'{book_id}: audio/ 下没有可上传的文件，跳过')
            continue

        print(f'{book_id}: {len(names)} 个对象')
        for name in names:
            total += 1
            path = os.path.join(BOOKS_DIR, book_id, 'audio', name)
            local_size = os.path.getsize(path)

            # 已在线且字节数一致 → 跳过（--force 可关）。判不出（非 404）时保守重传。
            if not args.force:
                remote, why = _remote_size(book_id, name)
                if remote is not None and remote == local_size:
                    skipped += 1
                    verified.append((book_id, name))
                    print(f'  跳过 {name}（线上 {remote} B 一致）')
                    continue
                if remote is None and why != 'HTTP 404':
                    print(f'  ⚠️  线上探测失败（{why}），按需重传: {name}')

            if args.dry_run:
                print(f'  [dry-run] 将上传 {bucket}/{book_id}/{name}（本地 {local_size} B）')
                continue
            if _put(bucket, book_id, name):
                uploaded += 1
                print(f'  ok  {name}')
                verified.append((book_id, name))
            else:
                failed += 1
        print()

    if args.dry_run:
        print(f'共 {total} 个对象：{skipped} 个已在线可跳过，{total - skipped} 个待上传（未上传）')
        return

    print(f'完成: {uploaded} 上传 / {skipped} 跳过 / 共 {total} 个对象, {failed} 失败')

    if args.verify and verified:
        print('\n线上探测:')
        bad = 0
        for book_id, name in verified:
            ok, why = _verify(book_id, name)
            if not ok:
                bad += 1
                print(f'  失败 {book_id}/{name} — {why}')
        print(f'  {len(verified) - bad}/{len(verified)} 可访问')

    # 收尾：刷新 audio-index.json（前端据此标「无音频章」＋ 明确提示）。
    # 只在上传零失败时刷新 —— 有失败就说明清单会和 R2 对不上，宁可不写。
    if not failed:
        print('\n刷新 audio-index.json:')
        for book_id in books:
            if not os.path.exists(os.path.join(BOOKS_DIR, book_id, 'chapters.json')):
                print(f'  跳过 {book_id}（无 chapters.json，算不出清单）')
                continue
            _, index = write_index(book_id)
            print(f'  {summary(book_id, index)}')

    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
