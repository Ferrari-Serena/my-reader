"""
Kokoro TTS 章节音频生成器（CLI）
输入：reader/public/books/<bookId>/chapters.json
输出：reader/public/books/<bookId>/audio/<chapterId>.mp3

设计要点：
- 逐段落调用 Kokoro pipeline（段落边界插静音；段内 510 token 自动分块处不插）
- 断点续跑：已存在且非空的 mp3 跳过；先写 .tmp.wav 再转码改名，中断不留半截文件
- 完全离线：HF_HUB_OFFLINE=1 + 本地语音包 torch.load，不发任何网络请求
- 转码：soundfile 写 wav → static_ffmpeg 的 ffmpeg.exe 转 24kHz mono MP3（精确控码率）

用法（用 abogen-venv 的 python 运行）：
  python tts.py the-giver                       # 全书（跳过已生成）
  python tts.py the-giver --chapters ch-03      # 只生成指定章节
  python tts.py the-giver --chapters ch-03 --bitrate 32k --suffix _32k   # 码率对比试听
  python tts.py the-giver --skip ch-01 ch-02    # 跳过版权页/书目页
"""

import argparse
import json
import os
import subprocess
import sys
import time

# ---- 离线环境变量必须在 import kokoro / huggingface 之前设置 ----
os.environ.setdefault('HF_HOME', r'D:\PythonEnv\hf-cache')
os.environ.setdefault('HF_HUB_OFFLINE', '1')

import numpy as np
import soundfile as sf

# 输出被重定向/后台捕获时 Windows 会退回 cp936，emoji 会 UnicodeEncodeError 中断跑批
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

SAMPLE_RATE = 24000                     # Kokoro 固定输出 24kHz
PARAGRAPH_SILENCE_SEC = 0.35            # 段落之间的静音间隔
VOICE_PATH = r'D:\PythonEnv\abogen-test\voices\am_michael.pt'
FFMPEG = os.path.join(
    r'D:\PythonEnv\abogen-venv\Lib\site-packages\static_ffmpeg\bin\win32', 'ffmpeg.exe'
)

# 仓库根目录 = 本文件的上两级（generator/pipeline/tts.py）
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BOOKS_DIR = os.path.join(REPO_ROOT, 'reader', 'public', 'books')


def load_chapters(book_id: str) -> dict:
    path = os.path.join(BOOKS_DIR, book_id, 'chapters.json')
    if not os.path.exists(path):
        sys.exit(f'❌ 找不到 {path}')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_pipeline():
    """构建 Kokoro 英文管线（惰性导入，--help 时不加载 torch）"""
    from kokoro import KPipeline
    print('加载 Kokoro-82M 模型（本地缓存）...')
    return KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')  # 'a' = American English


def synthesize_chapter(pipeline, chapter: dict, read_title: bool = True) -> np.ndarray:
    """合成一章：逐段落生成，段落边界插静音"""
    texts = []
    if read_title and chapter.get('title'):
        texts.append(chapter['title'])
    texts.extend(p['text'] for p in chapter.get('paragraphs', []) if p.get('text', '').strip())

    silence = np.zeros(int(PARAGRAPH_SILENCE_SEC * SAMPLE_RATE), dtype=np.float32)
    pieces = []
    for i, text in enumerate(texts):
        if pieces:
            pieces.append(silence)
        # 段内因 510 token 上限自动切出的块直接拼接，不插静音
        for _, _, audio in pipeline(text, voice=VOICE_PATH):
            pieces.append(np.asarray(audio, dtype=np.float32))
        done = i + 1
        if done % 10 == 0 or done == len(texts):
            print(f'  段落 {done}/{len(texts)}', flush=True)

    if not pieces:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(pieces)


def encode_mp3(wav_path: str, mp3_path: str, bitrate: str):
    """ffmpeg 转码：24kHz mono MP3，先写 .tmp 再改名"""
    tmp_mp3 = mp3_path + '.tmp'
    cmd = [
        FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
        '-i', wav_path,
        '-ac', '1', '-ar', str(SAMPLE_RATE),
        '-codec:a', 'libmp3lame', '-b:a', bitrate,
        '-f', 'mp3',  # 临时文件名以 .tmp 结尾，必须显式指定容器格式
        tmp_mp3,
    ]
    try:
        subprocess.run(cmd, check=True)
        os.replace(tmp_mp3, mp3_path)
    finally:
        if os.path.exists(tmp_mp3):
            os.remove(tmp_mp3)


def main():
    ap = argparse.ArgumentParser(description='Kokoro 章节音频生成器')
    ap.add_argument('book_id', help='书 ID（reader/public/books/ 下的目录名）')
    ap.add_argument('--chapters', nargs='*', default=None, help='只生成这些章节 ID')
    ap.add_argument('--skip', nargs='*', default=['ch-01', 'ch-02'],
                    help='跳过的章节 ID（默认版权页 ch-01 ch-02）')
    ap.add_argument('--bitrate', nargs='+', default=['48k'],
                    help='MP3 码率（默认 48k；传多个值时一次合成、多档转码，文件名自动加 _<码率> 后缀）')
    ap.add_argument('--suffix', default='', help='输出文件名后缀（码率对比试听用）')
    ap.add_argument('--no-title', action='store_true', help='不朗读章节标题')
    ap.add_argument('--force', action='store_true', help='重新生成已存在的文件')
    args = ap.parse_args()

    if not os.path.exists(VOICE_PATH):
        sys.exit(f'❌ 语音包不存在: {VOICE_PATH}')
    if not os.path.exists(FFMPEG):
        sys.exit(f'❌ ffmpeg 不存在: {FFMPEG}')

    data = load_chapters(args.book_id)
    audio_dir = os.path.join(BOOKS_DIR, args.book_id, 'audio')
    os.makedirs(audio_dir, exist_ok=True)

    # 多码率对比时文件名加 _<码率> 后缀区分
    multi = len(args.bitrate) > 1

    if args.chapters is not None:
        known_ids = {ch['id'] for ch in data['chapters']}
        unknown = [c for c in args.chapters if c not in known_ids]
        if unknown:
            sys.exit(f'❌ 未知章节 ID: {unknown}（可用范围 {min(known_ids)}~{max(known_ids)}）')

    targets = []
    for ch in data['chapters']:
        if args.chapters is not None and ch['id'] not in args.chapters:
            continue
        if args.chapters is None and ch['id'] in args.skip:
            print(f'⏭️  跳过 {ch["id"]}（{ch["title"]}）')
            continue
        outputs = []  # [(mp3_path, bitrate), ...]
        for br in args.bitrate:
            tag = f'_{br}' if multi else ''
            mp3_path = os.path.join(audio_dir, f'{ch["id"]}{args.suffix}{tag}.mp3')
            if not args.force and os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
                continue
            outputs.append((mp3_path, br))
        if not outputs:
            print(f'✅ 已存在，跳过 {ch["id"]}')
            continue
        targets.append((ch, outputs))

    if not targets:
        print('没有需要生成的章节。')
        return

    print(f'待生成 {len(targets)} 章 → {audio_dir}（码率 {"/".join(args.bitrate)}）')
    pipeline = build_pipeline()

    for idx, (ch, outputs) in enumerate(targets, 1):
        n_words = sum(len(p.get('text', '').split()) for p in ch['paragraphs'])
        print(f'\n[{idx}/{len(targets)}] {ch["id"]} — {ch["title"]}（{n_words} 词）')
        t0 = time.time()

        audio = synthesize_chapter(pipeline, ch, read_title=not args.no_title)
        if audio.size == 0:
            print(f'⚠️  {ch["id"]} 无文本，跳过')
            continue

        wav_tmp = outputs[0][0] + '.tmp.wav'
        try:
            sf.write(wav_tmp, audio, SAMPLE_RATE, subtype='FLOAT')
            for mp3_path, br in outputs:
                encode_mp3(wav_tmp, mp3_path, br)
                size_mb = os.path.getsize(mp3_path) / 1024 / 1024
                print(f'   {os.path.basename(mp3_path)} → {size_mb:.2f} MB')
        finally:
            if os.path.exists(wav_tmp):
                os.remove(wav_tmp)

        dur = audio.size / SAMPLE_RATE
        print(f'   音频 {dur / 60:.1f} 分钟 | 耗时 {time.time() - t0:.0f}s')

    print('\n全部完成。')


if __name__ == '__main__':
    main()
