# -*- coding: utf-8 -*-
"""
专升本英语 - 网页版后端
======================
Flask 服务，电脑和手机都可以访问
"""
import os
import sys
import json
import sqlite3
import socket
import webbrowser
import threading
import time
from datetime import datetime, date, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, Response

# ============================================================
# 路径
# ============================================================
def get_base_dir():
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent
    return Path(__file__).parent


def get_data_dir():
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent


BASE_DIR = get_base_dir()

# 云环境（Render）文件系统只读，数据库写到 /tmp
IS_CLOUD = os.environ.get('RENDER') or os.environ.get('DYNO') or os.environ.get('RAILWAY_ENVIRONMENT')

if IS_CLOUD:
    DATA_DIR = Path('/tmp') / 'zkb_data'
else:
    DATA_DIR = get_data_dir()

try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# 词库：优先当前目录，其次 /tmp
WORDS_FILE = BASE_DIR / 'data' / 'words.json'
if not WORDS_FILE.exists():
    WORDS_FILE = DATA_DIR / 'data' / 'words.json'

DB_PATH = DATA_DIR / 'study.db'

app = Flask(__name__, static_folder=None)
app.config['JSON_AS_ASCII'] = False

import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)


# ============================================================
# 数据库
# ============================================================
def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS word_progress (
        word TEXT PRIMARY KEY,
        unit INTEGER,
        learned INTEGER DEFAULT 0,
        correct INTEGER DEFAULT 0,
        wrong INTEGER DEFAULT 0,
        last_study TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS daily_log (
        log_date TEXT PRIMARY KEY,
        study_seconds INTEGER DEFAULT 0,
        words_learned INTEGER DEFAULT 0,
        questions_done INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS exam_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_date TEXT,
        score REAL,
        total REAL,
        correct INTEGER,
        duration_seconds INTEGER
    )''')
    conn.commit()
    conn.close()


init_db()


# ============================================================
# 词库
# ============================================================
_wordbook = None


def load_wordbook():
    global _wordbook
    if _wordbook is None:
        try:
            with open(WORDS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            units = data.get('units', {})
            _wordbook = {
                'units': units,
                'unit_list': sorted([int(k) for k in units.keys()]),
            }
        except Exception as e:
            print(f'词库加载失败: {e}')
            _wordbook = {'units': {}, 'unit_list': []}
    return _wordbook


# ============================================================
# 静态页面
# ============================================================
@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR / 'web'), 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    if filename.startswith('api/'):
        return jsonify({'error': 'not found'}), 404
    try:
        return send_from_directory(str(BASE_DIR / 'web'), filename)
    except Exception:
        return jsonify({'error': 'not found', 'file': filename}), 404


# ============================================================
# API
# ============================================================
@app.route('/api/health')
def api_health():
    wb = load_wordbook()
    return jsonify({
        'status': 'ok',
        'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'units': len(wb['unit_list']),
        'words': sum(len(v) for v in wb['units'].values()),
    })


@app.route('/api/units')
def api_units():
    """单元列表 + 学习进度"""
    wb = load_wordbook()
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()

    result = []
    for u in wb['unit_list']:
        words = wb['units'][str(u)]
        c.execute('SELECT COUNT(*) FROM word_progress WHERE unit = ? AND learned = 1', (u,))
        learned = c.fetchone()[0]
        result.append({
            'unit': u,
            'total': len(words),
            'learned': learned,
            'percent': round(learned / len(words) * 100) if words else 0,
        })

    conn.close()
    return jsonify({'success': True, 'units': result})


@app.route('/api/unit/<int:unit_no>')
def api_unit(unit_no):
    """某单元的所有单词"""
    wb = load_wordbook()
    words = wb['units'].get(str(unit_no), [])

    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()

    result = []
    for w in words:
        c.execute('SELECT learned, correct, wrong FROM word_progress WHERE word = ?', (w['word'],))
        row = c.fetchone()
        result.append({
            **w,
            'learned': row[0] if row else 0,
            'correct': row[1] if row else 0,
            'wrong': row[2] if row else 0,
        })

    conn.close()
    return jsonify({'success': True, 'unit': unit_no, 'words': result})


@app.route('/api/mark', methods=['POST'])
def api_mark():
    """标记单词已学"""
    body = request.get_json(silent=True) or {}
    word = body.get('word')
    unit = body.get('unit')
    is_correct = body.get('correct')

    if not word:
        return jsonify({'success': False, 'message': '缺少 word'})

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()

    c.execute('SELECT correct, wrong FROM word_progress WHERE word = ?', (word,))
    row = c.fetchone()

    if row:
        cor, wr = row
        if is_correct is True:
            cor += 1
        elif is_correct is False:
            wr += 1
        c.execute('''UPDATE word_progress SET learned=1, correct=?, wrong=?, last_study=?
                     WHERE word=?''', (cor, wr, now, word))
    else:
        cor = 1 if is_correct else 0
        wr = 1 if is_correct is False else 0
        c.execute('''INSERT INTO word_progress (word, unit, learned, correct, wrong, last_study)
                     VALUES (?, ?, 1, ?, ?, ?)''', (word, unit, cor, wr, now))

    # 打卡记录
    today = date.today().strftime('%Y-%m-%d')
    c.execute('SELECT words_learned FROM daily_log WHERE log_date=?', (today,))
    r = c.fetchone()
    if r:
        c.execute('UPDATE daily_log SET words_learned = words_learned + 1 WHERE log_date=?', (today,))
    else:
        c.execute('INSERT INTO daily_log (log_date, words_learned) VALUES (?, 1)', (today,))

    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/quiz', methods=['POST'])
def api_quiz():
    """生成测验题"""
    body = request.get_json(silent=True) or {}
    count = min(int(body.get('count', 10)), 50)
    q_type = body.get('type', 'en2cn')     # en2cn / cn2en
    scope = body.get('scope', 'all')       # all / wrong / unit
    unit_no = body.get('unit')

    wb = load_wordbook()
    import random

    # 构建题库
    pool = []
    if scope == 'unit' and unit_no:
        pool = wb['units'].get(str(unit_no), [])
    elif scope == 'wrong':
        conn = sqlite3.connect(str(DB_PATH))
        c = conn.cursor()
        c.execute('SELECT word FROM word_progress WHERE wrong > 0 ORDER BY wrong DESC LIMIT 200')
        wrong_words = set(r[0] for r in c.fetchall())
        conn.close()
        for u in wb['unit_list']:
            for w in wb['units'][str(u)]:
                if w['word'] in wrong_words:
                    pool.append(w)
    else:
        for u in wb['unit_list']:
            pool.extend(wb['units'][str(u)])

    if len(pool) < 4:
        return jsonify({'success': False, 'message': f'可用单词太少（{len(pool)} 个）'})

    # 去重
    seen = set()
    uniq = []
    for w in pool:
        if w['word'] not in seen:
            seen.add(w['word'])
            uniq.append(w)
    pool = uniq

    count = min(count, len(pool))
    selected = random.sample(pool, count)

    questions = []
    for target in selected:
        others = [w for w in pool if w['word'] != target['word']]
        if len(others) < 3:
            continue
        distractors = random.sample(others, 3)

        if q_type == 'cn2en':
            question = target.get('meaning', '')[:60]
            correct = target['word']
            options = [correct] + [d['word'] for d in distractors]
        else:
            question = target['word']
            if target.get('phonetic'):
                question += f" {target['phonetic']}"
            correct = target.get('meaning', '')[:60]
            options = [correct] + [d.get('meaning', '')[:60] for d in distractors]

        random.shuffle(options)
        questions.append({
            'word': target['word'],
            'question': question,
            'correct': correct,
            'options': options,
            'phonetic': target.get('phonetic', ''),
        })

    return jsonify({'success': True, 'questions': questions})


@app.route('/api/answer', methods=['POST'])
def api_answer():
    """记录答题结果"""
    body = request.get_json(silent=True) or {}
    word = body.get('word')
    is_correct = body.get('correct', False)
    unit = body.get('unit', 0)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()

    c.execute('SELECT correct, wrong FROM word_progress WHERE word=?', (word,))
    row = c.fetchone()
    if row:
        cor, wr = row
        if is_correct:
            cor += 1
        else:
            wr += 1
        c.execute('UPDATE word_progress SET correct=?, wrong=?, last_study=?, learned=1 WHERE word=?',
                  (cor, wr, now, word))
    else:
        c.execute('''INSERT INTO word_progress (word, unit, learned, correct, wrong, last_study)
                     VALUES (?, ?, 1, ?, ?, ?)''',
                  (word, unit, 1 if is_correct else 0, 0 if is_correct else 1, now))

    today = date.today().strftime('%Y-%m-%d')
    c.execute('SELECT questions_done, correct_count, wrong_count FROM daily_log WHERE log_date=?', (today,))
    r = c.fetchone()
    if r:
        qd, cc, wc = r
        c.execute('''UPDATE daily_log SET questions_done=?, correct_count=?, wrong_count=?
                     WHERE log_date=?''',
                  (qd + 1, cc + (1 if is_correct else 0), wc + (0 if is_correct else 1), today))
    else:
        c.execute('''INSERT INTO daily_log (log_date, questions_done, correct_count, wrong_count)
                     VALUES (?, 1, ?, ?)''',
                  (today, 1 if is_correct else 0, 0 if is_correct else 1))

    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/stats')
def api_stats():
    """学习统计"""
    today = date.today().strftime('%Y-%m-%d')
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()

    # 今日
    c.execute('''SELECT study_seconds, words_learned, questions_done, correct_count, wrong_count
                 FROM daily_log WHERE log_date=?''', (today,))
    row = c.fetchone()
    if row:
        secs, words, qs, cor, wr = row
        today_stats = {
            'minutes': secs // 60,
            'words': words,
            'questions': qs,
            'correct': cor,
            'wrong': wr,
            'accuracy': round(cor / qs * 100, 1) if qs > 0 else 0,
        }
    else:
        today_stats = {'minutes': 0, 'words': 0, 'questions': 0, 'correct': 0, 'wrong': 0, 'accuracy': 0}

    # 打卡日历（30 天）
    end = date.today()
    start = end - timedelta(days=29)
    c.execute('SELECT log_date, study_seconds, words_learned FROM daily_log WHERE log_date >= ? ORDER BY log_date',
              (start.strftime('%Y-%m-%d'),))
    checkins = {}
    for d, secs, wl in c.fetchall():
        checkins[d] = {'seconds': secs, 'words': wl}

    # 连续打卡
    c.execute('SELECT log_date FROM daily_log WHERE study_seconds > 0 OR words_learned > 0 ORDER BY log_date DESC')
    dates = set(r[0] for r in c.fetchall())
    streak = 0
    check = date.today()
    if check.strftime('%Y-%m-%d') not in dates:
        check -= timedelta(days=1)
    while check.strftime('%Y-%m-%d') in dates:
        streak += 1
        check -= timedelta(days=1)

    # 总进度
    wb = load_wordbook()
    total_words = sum(len(v) for v in wb['units'].values())
    c.execute('SELECT COUNT(*) FROM word_progress WHERE learned = 1')
    learned_total = c.fetchone()[0]

    # 错词
    c.execute('SELECT word, unit, correct, wrong FROM word_progress WHERE wrong > 0 ORDER BY wrong DESC LIMIT 30')
    wrong_list = [{'word': r[0], 'unit': r[1], 'correct': r[2], 'wrong': r[3]} for r in c.fetchall()]

    # 考试记录
    c.execute('SELECT exam_date, score, total, correct, duration_seconds FROM exam_log ORDER BY id DESC LIMIT 10')
    exams = [{'date': r[0], 'score': r[1], 'total': r[2], 'correct': r[3], 'duration': r[4]}
             for r in c.fetchall()]

    conn.close()

    return jsonify({
        'success': True,
        'today': today_stats,
        'streak': streak,
        'checkins': checkins,
        'totalWords': total_words,
        'learnedWords': learned_total,
        'wrongWords': wrong_list,
        'exams': exams,
    })


@app.route('/api/study-time', methods=['POST'])
def api_study_time():
    """记录学习时间"""
    body = request.get_json(silent=True) or {}
    seconds = int(body.get('seconds', 60))

    today = date.today().strftime('%Y-%m-%d')
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute('SELECT study_seconds FROM daily_log WHERE log_date=?', (today,))
    r = c.fetchone()
    if r:
        c.execute('UPDATE daily_log SET study_seconds = study_seconds + ? WHERE log_date=?', (seconds, today))
    else:
        c.execute('INSERT INTO daily_log (log_date, study_seconds) VALUES (?, ?)', (today, seconds))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/exam', methods=['POST'])
def api_exam():
    """生成模拟考试（40 题）"""
    wb = load_wordbook()
    import random

    pool = []
    for u in wb['unit_list']:
        for w in wb['units'][str(u)]:
            pool.append(w)

    if len(pool) < 20:
        return jsonify({'success': False, 'message': '单词太少'})

    # 去重
    seen = set()
    uniq = []
    for w in pool:
        if w['word'] not in seen and w.get('meaning'):
            seen.add(w['word'])
            uniq.append(w)
    pool = uniq

    selected = random.sample(pool, min(40, len(pool)))
    questions = []

    for i, target in enumerate(selected):
        others = [w for w in pool if w['word'] != target['word']]
        if len(others) < 3:
            continue
        distractors = random.sample(others, 3)

        # 前 20 题英译中，中间 10 题中译英，后 10 题词形
        if i < 20:
            q_type = '英译中'
            question = target['word'] + (f" {target['phonetic']}" if target.get('phonetic') else '')
            correct = target.get('meaning', '')[:60]
            options = [correct] + [d.get('meaning', '')[:60] for d in distractors]
        elif i < 30:
            q_type = '中译英'
            question = target.get('meaning', '')[:60]
            correct = target['word']
            options = [correct] + [d['word'] for d in distractors]
        else:
            q_type = '词形填空'
            question = f"选择正确单词：{target.get('meaning', '')[:50]}"
            correct = target['word']
            options = [correct] + [d['word'] for d in distractors]

        random.shuffle(options)
        questions.append({
            'idx': len(questions) + 1,
            'type': q_type,
            'question': question,
            'correct': correct,
            'options': options,
            'word': target['word'],
        })

    return jsonify({
        'success': True,
        'questions': questions,
        'duration': 1800,   # 30 分钟
    })


@app.route('/api/exam-result', methods=['POST'])
def api_exam_result():
    """保存考试成绩"""
    body = request.get_json(silent=True) or {}
    score = float(body.get('score', 0))
    total = float(body.get('total', 100))
    correct = int(body.get('correct', 0))
    duration = int(body.get('duration', 0))

    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute('''INSERT INTO exam_log (exam_date, score, total, correct, duration_seconds)
                 VALUES (?, ?, ?, ?, ?)''',
              (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), score, total, correct, duration))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ============================================================
# 启动
# ============================================================
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def get_free_port(start=8849):
    for p in range(start, start + 20):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.3)
            if s.connect_ex(('127.0.0.1', p)) != 0:
                s.close()
                return p
            s.close()
        except Exception:
            pass
    return start


def open_browser(url, delay=2):
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass
    threading.Thread(target=_open, daemon=True).start()


def print_qr(url):
    try:
        import qrcode
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=1, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        m = qr.get_matrix()
        print()
        for row in m:
            print(''.join('██' if c else '  ' for c in row))
        print()
    except Exception as e:
        print(f'（二维码生成失败: {e}）')


def main():
    if sys.stdout.encoding and 'utf' not in sys.stdout.encoding.lower():
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass

    port = get_free_port(8849)
    ip = get_local_ip()
    url = f'http://127.0.0.1:{port}/'
    mobile_url = f'http://{ip}:{port}/'

    print('=' * 62)
    print('  专升本英语 - 网页版')
    print('=' * 62)
    print()
    print(f'  💻 电脑访问: {url}')
    print(f'  📱 手机访问: {mobile_url}')
    print()
    print('  📱 手机访问（同一 WiFi，扫码直接打开）')
    print('=' * 62)
    print_qr(mobile_url)
    print('  👆 用手机相机扫码，或手动输入上面的地址')
    print()
    print('  💡 手机可「添加到主屏幕」，像 APP 一样使用')
    print('  ⚠️ 关闭本窗口 = 停止服务')
    print('=' * 62)
    print()

    open_browser(url, delay=1.5)

    app.run(host='0.0.0.0', port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == '__main__':
    main()
