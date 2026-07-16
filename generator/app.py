"""
my-reader generator — 本地电子书处理管道
Flask 后端：接收 epub/txt → 解析 → 提取词汇 → 查词典 → 产出数据文件
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import sys

# 添加 pipeline 模块路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'pipeline'))

from pipeline.parser import parse_epub, parse_txt
from pipeline.extractor import extract_vocabulary
from pipeline.dictionary import lookup_dictionary

app = Flask(__name__, static_folder='../reader/dist', static_url_path='/')
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), '..', 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), '..', 'reader', 'public', 'books')
NGSL_PATH = os.path.join(os.path.dirname(__file__), 'pipeline', 'ngsl.txt')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)


@app.route('/')
def index():
    """开发模式下返回前端入口"""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/generate', methods=['POST'])
def generate():
    """主入口：上传电子书 → 全流程处理"""
    if 'file' not in request.files:
        return jsonify({'error': '未找到文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '文件名为空'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.epub', '.txt'):
        return jsonify({'error': f'不支持的文件格式: {ext}，仅支持 epub/txt'}), 400

    try:
        # Step 1: 解析电子书 → chapters.json
        book_id = os.path.splitext(file.filename)[0].replace(' ', '-').lower()
        book_dir = os.path.join(OUTPUT_FOLDER, book_id)
        os.makedirs(book_dir, exist_ok=True)

        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)

        if ext == '.epub':
            chapters = parse_epub(file_path, book_id)
        else:
            chapters = parse_txt(file_path, book_id)

        # Step 2: 提取词汇 → word-list.json
        word_list = extract_vocabulary(chapters, NGSL_PATH)

        # Step 3: 查词典 → dictionary.json
        mw_api_key = os.environ.get('MW_API_KEY', '')
        dictionary = lookup_dictionary(word_list, chapters, mw_api_key)

        # 输出文件
        import json
        chapters_path = os.path.join(book_dir, 'chapters.json')
        dict_path = os.path.join(book_dir, 'dictionary.json')

        with open(chapters_path, 'w', encoding='utf-8') as f:
            json.dump(chapters, f, ensure_ascii=False, indent=2)
        with open(dict_path, 'w', encoding='utf-8') as f:
            json.dump(dictionary, f, ensure_ascii=False, indent=2)

        return jsonify({
            'success': True,
            'bookId': book_id,
            'chapters': chapters_path,
            'dictionary': dict_path,
            'chapterCount': len(chapters.get('chapters', [])),
            'wordCount': len(dictionary.get('words', {}))
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/progress')
def progress():
    """轮询进度（简化版，后续可改为 WebSocket）"""
    return jsonify({'status': 'idle'})


if __name__ == '__main__':
    mw_key = os.environ.get('MW_API_KEY', '')
    if not mw_key:
        print('⚠️  未设置 MW_API_KEY 环境变量，词典查询将跳过')
    app.run(debug=True, port=5173, host='0.0.0.0')
