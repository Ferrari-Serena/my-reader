"""
my-reader generator — 本地电子书处理管道
Flask 后端：上传页 UI + 后台生成任务 + TTS 触发 + 一键部署

用法：
  D:\\PythonEnv\\abogen-venv\\Scripts\\python.exe app.py
  浏览器打开 http://localhost:5174
"""

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import json
import os
import re
import subprocess
import sys
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'pipeline'))

from pipeline.parser import parse_epub, parse_txt
from pipeline.extractor import extract_vocabulary
from pipeline.dictionary import lookup_dictionary

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, '..', 'uploads')
OUTPUT_FOLDER = os.path.join(BASE_DIR, '..', 'reader', 'public', 'books')
BOOK_INDEX = os.path.join(OUTPUT_FOLDER, 'book-index.json')
NGSL_PATH = os.path.join(BASE_DIR, 'pipeline', 'ngsl.txt')
REPO_READER = os.path.join(BASE_DIR, '..', 'reader')
GIT_EXE = r'D:\my AI agent\Git\bin\git.exe'
VENV_PYTHON = r'D:\PythonEnv\abogen-venv\Scripts\python.exe'
PROXY = 'http://127.0.0.1:7897'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# ---- 全局任务状态（单用户本地工具，一次只跑一个生成任务） ----

_lock = threading.Lock()
_state = {
    'stage': 'idle',   # idle | parsing | extracting | dictionary | done | error
    'percent': 0,
    'bookId': '',
    'message': '',
    'result': None
}

_tts_procs = {}  # bookId → Popen（TTS 子进程句柄）


def _set_state(**kwargs):
    with _lock:
        _state.update(kwargs)


def _safe_book_id(filename):
    """文件名 → bookId：只保留字母数字和连字符，防路径遍历"""
    base = os.path.splitext(os.path.basename(filename))[0]
    book_id = re.sub(r'[^a-zA-Z0-9-]+', '-', base.replace(' ', '-')).strip('-').lower()
    return book_id[:60] or 'untitled'


def _register_book(book_id, title, author):
    """幂等注册到 book-index.json（复用 build_sat_bank.py 模式）"""
    index = {'books': []}
    if os.path.exists(BOOK_INDEX):
        with open(BOOK_INDEX, 'r', encoding='utf-8') as f:
            index = json.load(f)
    if not any(b.get('id') == book_id for b in index.get('books', [])):
        index['books'].append({
            'id': book_id,
            'title': title or book_id,
            'author': author or '',
            'coverUrl': None,
            'dataUrl': f'books/{book_id}/'
        })
        with open(BOOK_INDEX, 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)


def _run_pipeline(file_path, ext, book_id):
    """后台线程：解析 → 提取 → 词典 → 注册"""
    try:
        _set_state(stage='parsing', percent=10, message='解析章节...')
        if ext == '.epub':
            chapters = parse_epub(file_path, book_id)
        else:
            chapters = parse_txt(file_path, book_id)

        book_dir = os.path.join(OUTPUT_FOLDER, book_id)
        os.makedirs(book_dir, exist_ok=True)

        _set_state(stage='extracting', percent=35, message='提取词汇...')
        word_list = extract_vocabulary(chapters, NGSL_PATH)

        _set_state(stage='dictionary', percent=55, message='查询词典 (ECDICT 本地)...')
        mw_api_key = os.environ.get('MW_API_KEY', '')
        dictionary = lookup_dictionary(word_list, chapters, mw_api_key)

        _set_state(percent=90, message='写出数据文件...')
        with open(os.path.join(book_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
            json.dump(chapters, f, ensure_ascii=False, indent=1)
        with open(os.path.join(book_dir, 'dictionary.json'), 'w', encoding='utf-8') as f:
            json.dump(dictionary, f, ensure_ascii=False, separators=(',', ':'))

        _register_book(book_id, chapters.get('title', ''), chapters.get('author', ''))

        n_ch = len(chapters.get('chapters', []))
        n_words = len(dictionary.get('words', {}))
        n_defs = sum(1 for w in dictionary.get('words', {}).values() if w.get('definitions'))
        _set_state(stage='done', percent=100,
                   message=f'完成: {n_ch} 章, {n_words} 词 ({n_defs} 词有释义)',
                   result={'bookId': book_id, 'chapterCount': n_ch, 'wordCount': n_words})
    except Exception as e:
        _set_state(stage='error', message=str(e))


@app.route('/')
def index():
    return render_template('upload.html')


@app.route('/api/generate', methods=['POST'])
def generate():
    with _lock:
        if _state['stage'] in ('parsing', 'extracting', 'dictionary'):
            return jsonify({'error': '已有任务在运行'}), 409

    if 'file' not in request.files:
        return jsonify({'error': '未找到文件'}), 400
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': '文件名为空'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.epub', '.txt'):
        return jsonify({'error': f'不支持的格式: {ext}（仅 epub/txt）'}), 400

    book_id = _safe_book_id(file.filename)
    file_path = os.path.join(UPLOAD_FOLDER, f'{book_id}{ext}')
    file.save(file_path)

    _set_state(stage='parsing', percent=0, bookId=book_id, message='开始处理...', result=None)
    threading.Thread(target=_run_pipeline, args=(file_path, ext, book_id), daemon=True).start()
    return jsonify({'started': True, 'bookId': book_id})


@app.route('/api/progress')
def progress():
    with _lock:
        return jsonify(dict(_state))


@app.route('/api/tts/<book_id>', methods=['POST'])
def start_tts(book_id):
    book_id = _safe_book_id(book_id)
    if not os.path.exists(os.path.join(OUTPUT_FOLDER, book_id, 'chapters.json')):
        return jsonify({'error': f'书 {book_id} 不存在'}), 404

    proc = _tts_procs.get(book_id)
    if proc and proc.poll() is None:
        return jsonify({'error': 'TTS 已在运行'}), 409

    # tts.py 断点续跑：已生成的章节自动跳过
    tts_script = os.path.join(BASE_DIR, 'pipeline', 'tts.py')
    _tts_procs[book_id] = subprocess.Popen(
        [VENV_PYTHON, tts_script, book_id],
        cwd=BASE_DIR,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    return jsonify({'started': True})


@app.route('/api/tts-progress/<book_id>')
def tts_progress(book_id):
    book_id = _safe_book_id(book_id)
    book_dir = os.path.join(OUTPUT_FOLDER, book_id)
    chapters_path = os.path.join(book_dir, 'chapters.json')
    if not os.path.exists(chapters_path):
        return jsonify({'error': 'not found'}), 404

    with open(chapters_path, 'r', encoding='utf-8') as f:
        total = len(json.load(f).get('chapters', []))
    audio_dir = os.path.join(book_dir, 'audio')
    done = 0
    if os.path.isdir(audio_dir):
        done = len([f for f in os.listdir(audio_dir)
                    if f.endswith('.mp3') and os.path.getsize(os.path.join(audio_dir, f)) > 0])
    proc = _tts_procs.get(book_id)
    running = bool(proc and proc.poll() is None)
    return jsonify({'total': total, 'done': done, 'running': running})


@app.route('/api/deploy', methods=['POST'])
def deploy():
    """git add public/books + commit + push（走 Clash 代理）"""
    try:
        def git(*args):
            r = subprocess.run(
                [GIT_EXE, '-C', REPO_READER] + list(args),
                capture_output=True, text=True, timeout=120
            )
            return r

        git('add', 'public/books')
        status = git('status', '--porcelain')
        if not status.stdout.strip():
            return jsonify({'deployed': False, 'message': '没有新的改动需要部署'})

        msg = request.json.get('message', 'Add book via local generator') if request.is_json else 'Add book via local generator'
        commit = git('commit', '-m', msg)
        if commit.returncode != 0:
            return jsonify({'error': f'commit 失败: {commit.stderr[:300]}'}), 500

        push = subprocess.run(
            [GIT_EXE, '-C', REPO_READER,
             '-c', f'http.proxy={PROXY}', '-c', f'https.proxy={PROXY}', 'push'],
            capture_output=True, text=True, timeout=300
        )
        if push.returncode != 0:
            return jsonify({'error': f'push 失败: {push.stderr[:300]}'}), 500

        return jsonify({'deployed': True, 'message': '已推送，GitHub Actions 部署中（约 2 分钟）'})
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'git 操作超时'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print('my-reader 本地生成器: http://localhost:5174')
    app.run(debug=False, port=5174, host='127.0.0.1')
