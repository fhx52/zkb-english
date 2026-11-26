/**
 * 专升本英语 - 网页版前端
 */
'use strict';

const API = '';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// ============ 状态 ============
const state = {
    page: 'study',
    units: [],
    currentUnit: null,
    words: [],
    wordIndex: 0,
    // 测验
    quiz: { questions: [], idx: 0, correct: 0, wrong: 0, answered: false },
    // 考试
    exam: { questions: [], idx: 0, answers: [], timer: null, remain: 0, startTime: 0 },
    stats: null,
};

// ============ 工具 ============
function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 2200);
}

async function api(path, options = {}) {
    const res = await fetch(API + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    return res.json();
}

// ============ 发音 ============
const speech = (() => {
    let voice = null;

    function init() {
        if (!('speechSynthesis' in window)) return;
        const load = () => {
            const voices = speechSynthesis.getVoices();
            voice = voices.find(v => v.lang === 'en-US' && /female|zira|samantha/i.test(v.name))
                || voices.find(v => v.lang === 'en-US')
                || voices.find(v => v.lang.startsWith('en'));
        };
        load();
        speechSynthesis.onvoiceschanged = load;
    }

    function speak(text, rate = 0.9) {
        if (!('speechSynthesis' in window)) {
            toast('浏览器不支持语音', 'error');
            return;
        }
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = rate;
        u.pitch = 1;
        if (voice) u.voice = voice;
        speechSynthesis.speak(u);
    }

    return { init, speak };
})();

// ============ 页面渲染 ============
function renderStudy() {
    if (state.currentUnit === null) {
        // 单元列表
        const list = state.units.map(u => `
            <div class="unit-item ${u.percent >= 100 ? 'done' : ''}" data-unit="${u.unit}">
                <div class="unit-no">第 ${u.unit} 单元</div>
                <div class="unit-count">${u.learned} / ${u.total} 词</div>
                <div class="unit-bar">
                    <div class="unit-bar-fill" style="width:${u.percent}%"></div>
                </div>
            </div>
        `).join('');

        $('#content').innerHTML = `
            <div class="card">
                <div class="card-title">📚 选择单元</div>
                <div class="unit-grid">${list || '<div class="loading">暂无单元</div>'}</div>
            </div>
        `;

        $$('.unit-item').forEach(el => {
            el.onclick = () => loadUnit(parseInt(el.dataset.unit));
        });
        return;
    }

    // 单词学习
    if (!state.words.length) {
        $('#content').innerHTML = '<div class="loading">该单元没有单词</div>';
        return;
    }

    const w = state.words[state.wordIndex];
    const learnedCount = state.words.filter(x => x.learned).length;

    const examples = (w.examples || []).slice(0, 3).map(ex => `
        <div class="example-box">
            <div class="example-en">${escapeHtml(ex.en || '')}</div>
            <button class="ex-play" data-say="${escapeAttr(ex.en || '')}">🔊</button>
            <div class="example-cn">${escapeHtml(ex.cn || '')}</div>
        </div>
    `).join('');

    $('#content').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <button class="btn btn-ghost" id="backUnits" style="padding:8px 14px;min-height:38px;font-size:13px">← 单元列表</button>
            <span style="font-size:13px;color:#7f8c8d">第 ${state.currentUnit} 单元</span>
        </div>

        <div class="progress-bar">
            <div class="progress-fill" style="width:${learnedCount / state.words.length * 100}%"></div>
        </div>
        <div class="progress-text">已学 ${learnedCount} / ${state.words.length}</div>

        <div class="word-card">
            <div class="word-main">${escapeHtml(w.word)}</div>
            <div class="word-phonetic">${escapeHtml(w.phonetic || '')}</div>

            <div class="pronounce-row">
                <button class="pron-btn" data-pron="normal">🔊 美音</button>
                <button class="pron-btn" data-pron="slow">🐢 慢速</button>
                <button class="pron-btn" data-pron="again">🔁 再听</button>
            </div>

            <div class="word-meaning">${escapeHtml(w.meaning || '')}</div>

            ${examples}
        </div>

        <div class="word-actions">
            <button class="btn btn-ghost" id="prevWord">← 上一个</button>
            <button class="btn btn-success" id="markKnown">✓ 我认识</button>
            <button class="btn btn-primary" id="nextWord">下一个 →</button>
        </div>

        <div class="progress-text">${state.wordIndex + 1} / ${state.words.length}</div>
    `;

    // 事件
    $('#backUnits').onclick = () => {
        state.currentUnit = null;
        state.words = [];
        state.wordIndex = 0;
        loadUnits();
    };

    $$('.pron-btn').forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.pron;
            if (type === 'slow') speech.speak(w.word, 0.55);
            else speech.speak(w.word, 0.9);
        };
    });

    $$('.ex-play').forEach(btn => {
        btn.onclick = () => speech.speak(btn.dataset.say, 0.85);
    });

    $('#prevWord').onclick = () => {
        if (state.wordIndex > 0) {
            state.wordIndex--;
            renderStudy();
        }
    };

    $('#nextWord').onclick = () => {
        if (state.wordIndex < state.words.length - 1) {
            state.wordIndex++;
            renderStudy();
        } else {
            toast('已是最后一个');
        }
    };

    $('#markKnown').onclick = async () => {
        await api('/api/mark', {
            method: 'POST',
            body: JSON.stringify({ word: w.word, unit: state.currentUnit, correct: true }),
        });
        w.learned = 1;
        toast('已标记', 'success');
        refreshTopBar();
        if (state.wordIndex < state.words.length - 1) {
            state.wordIndex++;
            renderStudy();
        } else {
            renderStudy();
        }
    };

    // 自动发音
    setTimeout(() => speech.speak(w.word, 0.9), 300);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============ 测验 ============
function renderQuiz() {
    const q = state.quiz;

    if (!q.questions.length) {
        $('#content').innerHTML = `
            <div class="card">
                <div class="card-title">✏️ 单词测验</div>
                <div style="display:flex;flex-direction:column;gap:10px">
                    <div>
                        <label style="font-size:13px;color:#7f8c8d;display:block;margin-bottom:6px">题型</label>
                        <select id="quizType" style="width:100%;padding:12px;border:1px solid #e1e8ed;border-radius:10px;font-size:15px;font-family:inherit">
                            <option value="en2cn">英译中（看英文选中文）</option>
                            <option value="cn2en">中译英（看中文选英文）</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:13px;color:#7f8c8d;display:block;margin-bottom:6px">范围</label>
                        <select id="quizScope" style="width:100%;padding:12px;border:1px solid #e1e8ed;border-radius:10px;font-size:15px;font-family:inherit">
                            <option value="all">全部单词</option>
                            <option value="wrong">只测错过的词</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:13px;color:#7f8c8d;display:block;margin-bottom:6px">题数</label>
                        <select id="quizCount" style="width:100%;padding:12px;border:1px solid #e1e8ed;border-radius:10px;font-size:15px;font-family:inherit">
                            <option value="10">10 题</option>
                            <option value="20">20 题</option>
                            <option value="30">30 题</option>
                        </select>
                    </div>
                    <button class="btn btn-primary btn-block" id="startQuiz" style="margin-top:6px">开始测验</button>
                </div>
            </div>
        `;

        $('#startQuiz').onclick = startQuiz;
        return;
    }

    // 测验中
    if (q.idx >= q.questions.length) {
        // 结果
        const acc = q.correct / q.questions.length * 100;
        $('#content').innerHTML = `
            <div class="card" style="text-align:center">
                <div style="font-size:52px;margin-bottom:12px">${acc >= 80 ? '🎉' : acc >= 60 ? '👍' : '💪'}</div>
                <div style="font-size:22px;font-weight:800;margin-bottom:16px">测验完成</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
                    <div>
                        <div class="stat-label">正确</div>
                        <div class="stat-value" style="color:#27ae60">${q.correct}</div>
                    </div>
                    <div>
                        <div class="stat-label">错误</div>
                        <div class="stat-value" style="color:#e74c3c">${q.wrong}</div>
                    </div>
                </div>
                <div style="font-size:16px;margin-bottom:20px">准确率 <b style="color:${acc >= 60 ? '#27ae60' : '#e74c3c'}">${acc.toFixed(1)}%</b></div>
                <button class="btn btn-primary btn-block" id="restartQuiz">再来一轮</button>
            </div>
        `;
        $('#restartQuiz').onclick = () => {
            state.quiz = { questions: [], idx: 0, correct: 0, wrong: 0, answered: false };
            renderQuiz();
        };
        return;
    }

    const question = q.questions[q.idx];
    const optionsHtml = question.options.map((opt, i) => `
        <button class="option-btn" data-idx="${i}">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</button>
    `).join('');

    $('#content').innerHTML = `
        <div class="progress-bar">
            <div class="progress-fill" style="width:${q.idx / q.questions.length * 100}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#7f8c8d;margin-bottom:12px">
            <span>第 ${q.idx + 1} / ${q.questions.length} 题</span>
            <span>✅ ${q.correct} ❌ ${q.wrong}</span>
        </div>

        <div class="card">
            <div class="question">${escapeHtml(question.question)}</div>
            <div style="text-align:center;margin-bottom:14px">
                <button class="pron-btn" id="quizPlay" style="display:inline-block;padding:10px 20px">🔊 听发音</button>
            </div>
            <div class="options" id="quizOptions">${optionsHtml}</div>
        </div>
    `;

    $('#quizPlay').onclick = () => speech.speak(question.word, 0.9);

    $$('#quizOptions .option-btn').forEach(btn => {
        btn.onclick = () => answerQuiz(parseInt(btn.dataset.idx));
    });
}

async function startQuiz() {
    const type = $('#quizType').value;
    const scope = $('#quizScope').value;
    const count = parseInt($('#quizCount').value);

    toast('生成题目中...');

    const res = await api('/api/quiz', {
        method: 'POST',
        body: JSON.stringify({ type, scope, count }),
    });

    if (!res.success) {
        toast(res.message || '生成失败', 'error');
        return;
    }

    state.quiz = {
        questions: res.questions,
        idx: 0,
        correct: 0,
        wrong: 0,
        answered: false,
    };
    renderQuiz();
}

async function answerQuiz(optionIdx) {
    const q = state.quiz;
    if (q.answered) return;
    q.answered = true;

    const question = q.questions[q.idx];
    const picked = question.options[optionIdx];
    const isCorrect = picked === question.correct;

    // 标记颜色
    $$('#quizOptions .option-btn').forEach((btn, i) => {
        btn.disabled = true;
        if (question.options[i] === question.correct) {
            btn.classList.add('correct');
        } else if (i === optionIdx) {
            btn.classList.add('wrong');
        }
    });

    if (isCorrect) {
        q.correct++;
        toast('✅ 正确', 'success');
    } else {
        q.wrong++;
        toast('❌ 正确答案：' + question.correct, 'error');
        speech.speak(question.word, 0.9);
    }

    // 上报
    await api('/api/answer', {
        method: 'POST',
        body: JSON.stringify({ word: question.word, correct: isCorrect }),
    });

    refreshTopBar();

    // 1.2 秒后下一题
    setTimeout(() => {
        q.idx++;
        q.answered = false;
        renderQuiz();
    }, 1300);
}

// ============ 统计 ============
async function renderStats() {
    $('#content').innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

    const res = await api('/api/stats');
    if (!res.success) {
        $('#content').innerHTML = '<div class="loading">加载失败</div>';
        return;
    }

    const s = res;
    state.stats = s;

    // 日历
    const today = new Date();
    const calDays = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const info = s.checkins[ds];
        let cls = '';
        if (info) {
            if (info.seconds >= 3600 || info.words >= 30) cls = 'high';
            else if (info.seconds >= 600 || info.words >= 10) cls = 'mid';
            else cls = 'low';
        }
        calDays.push({ ds, cls, day: d.getDate() });
    }

    // 补齐到整周
    const firstDay = new Date(today);
    firstDay.setDate(firstDay.getDate() - 29);
    const padStart = (firstDay.getDay() + 6) % 7;
    const padDays = Array(padStart).fill({ cls: 'empty', day: '' });

    const calHtml = [...padDays, ...calDays].map(d =>
        `<div class="cal-day ${d.cls}" title="${d.ds}">${d.day}</div>`
    ).join('');

    // 错词
    const wrongHtml = s.wrongWords.length
        ? s.wrongWords.map(w => `
            <div class="wrong-item">
                <span class="wrong-word">${escapeHtml(w.word)}</span>
                <span class="wrong-count">错 ${w.wrong} 次</span>
            </div>
        `).join('')
        : '<div style="text-align:center;color:#95a5a6;padding:20px 0;font-size:14px">还没有错题</div>';

    // 考试记录
    const examHtml = s.exams.length
        ? s.exams.map(e => {
            const acc = (e.correct / (e.total / 2.5) * 100).toFixed(0);
            return `<div class="wrong-item">
                <span style="font-size:13px">${e.date.slice(0, 16)}</span>
                <span style="font-weight:700;color:${acc >= 60 ? '#27ae60' : '#e74c3c'}">${e.score} 分</span>
            </div>`;
        }).join('')
        : '<div style="text-align:center;color:#95a5a6;padding:20px 0;font-size:14px">还没有考试记录</div>';

    $('#content').innerHTML = `
        <div class="stat-cards">
            <div class="stat-card">
                <div class="stat-label">🔥 连续打卡</div>
                <div class="stat-value">${s.streak}</div>
                <div class="stat-sub">天</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">⏱️ 今日学习</div>
                <div class="stat-value">${s.today.minutes}</div>
                <div class="stat-sub">分钟</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">📖 今日单词</div>
                <div class="stat-value">${s.today.words}</div>
                <div class="stat-sub">个</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">🎯 今日准确率</div>
                <div class="stat-value">${s.today.questions > 0 ? s.today.accuracy + '%' : '--'}</div>
                <div class="stat-sub">${s.today.questions} 题</div>
            </div>
        </div>

        <div class="card">
            <div class="card-title">📅 打卡记录（近 30 天）</div>
            <div class="calendar">
                <div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div>
                <div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>
                <div class="cal-header">日</div>
                ${calHtml}
            </div>
            <div style="display:flex;gap:14px;justify-content:center;margin-top:12px;font-size:11px;color:#95a5a6">
                <span style="display:flex;align-items:center;gap:4px"><i style="width:10px;height:10px;background:#27ae60;border-radius:2px;display:inline-block"></i>≥1小时</span>
                <span style="display:flex;align-items:center;gap:4px"><i style="width:10px;height:10px;background:#82e0aa;border-radius:2px;display:inline-block"></i>≥10分钟</span>
                <span style="display:flex;align-items:center;gap:4px"><i style="width:10px;height:10px;background:#ecf0f1;border-radius:2px;display:inline-block"></i>未学</span>
            </div>
        </div>

        <div class="card">
            <div class="card-title">📈 总体进度</div>
            <div class="progress-bar" style="height:12px">
                <div class="progress-fill" style="width:${s.totalWords > 0 ? s.learnedWords / s.totalWords * 100 : 0}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#7f8c8d;margin-top:8px">
                <span>已掌握 ${s.learnedWords} / ${s.totalWords} 词</span>
                <span>${s.totalWords > 0 ? (s.learnedWords / s.totalWords * 100).toFixed(1) : 0}%</span>
            </div>
        </div>

        <div class="card">
            <div class="card-title">📕 错词本</div>
            ${wrongHtml}
        </div>

        <div class="card">
            <div class="card-title">📝 考试记录</div>
            ${examHtml}
        </div>
    `;
}

// ============ 考试 ============
function renderExam() {
    const e = state.exam;

    if (!e.questions.length) {
        $('#content').innerHTML = `
            <div class="card" style="text-align:center">
                <div style="font-size:44px;margin-bottom:12px">📝</div>
                <div style="font-size:20px;font-weight:800;margin-bottom:10px">模拟考试</div>
                <div style="font-size:14px;color:#7f8c8d;line-height:1.8;margin-bottom:20px">
                    • 共 40 题<br>
                    • 英译中 20 题 + 中译英 10 题 + 词形填空 10 题<br>
                    • 每题 2.5 分，总分 100 分<br>
                    • 限时 30 分钟
                </div>
                <button class="btn btn-primary btn-block" id="startExam">开始考试</button>
            </div>
        `;
        $('#startExam').onclick = startExam;
        return;
    }

    if (e.idx >= e.questions.length) {
        renderExamResult();
        return;
    }

    const q = e.questions[e.idx];
    const picked = e.answers[e.idx];

    const optionsHtml = q.options.map((opt, i) => {
        const selected = picked === opt;
        return `<button class="option-btn${selected ? ' correct' : ''}" data-idx="${i}">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</button>`;
    }).join('');

    const m = Math.floor(e.remain / 60);
    const s = e.remain % 60;

    $('#content').innerHTML = `
        <div class="card" style="padding:12px">
            <div class="exam-timer">⏱️ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</div>
            <div class="exam-info">
                <span>第 ${e.idx + 1} / ${e.questions.length} 题</span>
                <span>${q.type}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width:${e.idx / e.questions.length * 100}%"></div>
            </div>
        </div>

        <div class="card">
            <div class="question">${escapeHtml(q.question)}</div>
            <div class="options">${optionsHtml}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <button class="btn btn-ghost" id="examPrev" ${e.idx === 0 ? 'disabled' : ''}>← 上一题</button>
            <button class="btn btn-primary" id="examNext" ${e.idx === e.questions.length - 1 ? 'disabled' : ''}>下一题 →</button>
        </div>
        <button class="btn btn-danger btn-block" id="examSubmit">交卷</button>
    `;

    $$('.options .option-btn').forEach(btn => {
        btn.onclick = () => chooseExamAnswer(parseInt(btn.dataset.idx));
    });

    $('#examPrev').onclick = () => {
        if (e.idx > 0) {
            e.idx--;
            renderExam();
        }
    };

    $('#examNext').onclick = () => {
        if (e.idx < e.questions.length - 1) {
            e.idx++;
            renderExam();
        }
    };

    $('#examSubmit').onclick = submitExam;
}

function chooseExamAnswer(idx) {
    const e = state.exam;
    const q = e.questions[e.idx];
    e.answers[e.idx] = q.options[idx];
    renderExam();
    // 自动下一题
    if (e.idx < e.questions.length - 1) {
        setTimeout(() => {
            e.idx++;
            renderExam();
        }, 350);
    }
}

async function startExam() {
    toast('生成试卷中...');
    const res = await api('/api/exam', { method: 'POST', body: '{}' });

    if (!res.success) {
        toast(res.message || '生成失败', 'error');
        return;
    }

    state.exam = {
        questions: res.questions,
        idx: 0,
        answers: Array(res.questions.length).fill(null),
        remain: res.duration,
        startTime: Date.now(),
        timer: null,
    };

    if (state.exam.timer) clearInterval(state.exam.timer);
    state.exam.timer = setInterval(() => {
        state.exam.remain--;
        if (state.exam.remain <= 0) {
            clearInterval(state.exam.timer);
            toast('时间到，自动交卷', 'error');
            submitExam();
            return;
        }
        const el = document.querySelector('.exam-timer');
        if (el) {
            const m = Math.floor(state.exam.remain / 60);
            const s = state.exam.remain % 60;
            el.textContent = `⏱️ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }, 1000);

    renderExam();
}

async function submitExam() {
    const e = state.exam;
    if (!e.questions.length) return;

    const unanswered = e.answers.filter(a => a === null).length;
    if (unanswered > 0) {
        if (!confirm(`还有 ${unanswered} 题未作答，确定交卷？`)) return;
    }

    if (e.timer) clearInterval(e.timer);

    let correct = 0;
    e.questions.forEach((q, i) => {
        if (e.answers[i] === q.correct) correct++;
    });

    const score = correct * 2.5;
    const total = e.questions.length * 2.5;
    const duration = Math.round((Date.now() - e.startTime) / 1000);

    await api('/api/exam-result', {
        method: 'POST',
        body: JSON.stringify({ score, total, correct, duration }),
    });

    e.result = { correct, score, total, duration };
    e.idx = e.questions.length;
    renderExamResult();
}

function renderExamResult() {
    const e = state.exam;
    const r = e.result || { correct: 0, score: 0, total: 100, duration: 0 };
    const acc = e.questions.length > 0 ? r.correct / e.questions.length * 100 : 0;

    // 错题
    const wrongList = [];
    e.questions.forEach((q, i) => {
        if (e.answers[i] !== q.correct) {
            wrongList.push({
                word: q.word,
                correct: q.correct,
                yours: e.answers[i] || '未作答',
            });
        }
    });

    const wrongHtml = wrongList.slice(0, 15).map(w => `
        <div class="wrong-item" style="flex-direction:column;align-items:flex-start;gap:4px">
            <span class="wrong-word">${escapeHtml(w.word)}</span>
            <span style="font-size:12px;color:#27ae60">正确：${escapeHtml(w.correct)}</span>
            <span style="font-size:12px;color:#e74c3c">你选：${escapeHtml(w.yours)}</span>
        </div>
    `).join('');

    $('#content').innerHTML = `
        <div class="card" style="text-align:center">
            <div style="font-size:52px;margin-bottom:10px">${acc >= 90 ? '🎉' : acc >= 75 ? '👍' : acc >= 60 ? '✅' : '💪'}</div>
            <div style="font-size:22px;font-weight:800;margin-bottom:16px">考试完成</div>

            <div style="font-size:44px;font-weight:900;color:${acc >= 60 ? '#27ae60' : '#e74c3c'};margin-bottom:6px">
                ${r.score.toFixed(1)}
            </div>
            <div style="font-size:14px;color:#7f8c8d;margin-bottom:20px">满分 ${r.total.toFixed(0)} 分</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
                <div>
                    <div class="stat-label">正确</div>
                    <div class="stat-value" style="color:#27ae60">${r.correct}</div>
                </div>
                <div>
                    <div class="stat-label">用时</div>
                    <div class="stat-value" style="font-size:18px">${Math.floor(r.duration / 60)}分${r.duration % 60}秒</div>
                </div>
            </div>

            <div style="font-size:15px;margin-bottom:20px">
                准确率 <b style="color:${acc >= 60 ? '#27ae60' : '#e74c3c'}">${acc.toFixed(1)}%</b>
            </div>

            <button class="btn btn-primary btn-block" id="newExam">再考一次</button>
        </div>

        ${wrongList.length ? `
        <div class="card">
            <div class="card-title">❌ 错题（${wrongList.length} 题）</div>
            ${wrongHtml}
        </div>` : ''}
    `;

    $('#newExam').onclick = () => {
        state.exam = { questions: [], idx: 0, answers: [], timer: null, remain: 0, startTime: 0 };
        renderExam();
    };
}

// ============ 数据加载 ============
async function loadUnits() {
    const res = await api('/api/units');
    if (res.success) {
        state.units = res.units;
    }
    renderStudy();
}

async function loadUnit(unitNo) {
    state.currentUnit = unitNo;
    state.wordIndex = 0;

    $('#content').innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

    const res = await api('/api/unit/' + unitNo);
    if (res.success) {
        state.words = res.words;
        // 从未学的第一个开始
        const firstUnlearned = state.words.findIndex(w => !w.learned);
        state.wordIndex = firstUnlearned >= 0 ? firstUnlearned : 0;
    }
    renderStudy();
}

async function refreshTopBar() {
    try {
        const res = await api('/api/stats');
        if (res.success) {
            $('#todayMinutes').textContent = res.today.minutes;
            $('#todayWords').textContent = res.today.words;
            $('#streakDays').textContent = res.streak;
        }
    } catch (e) {}
}

// ============ 页面切换 ============
function switchPage(page) {
    state.page = page;

    $$('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    if (page === 'study') {
        if (state.currentUnit !== null) {
            renderStudy();
        } else {
            loadUnits();
        }
    } else if (page === 'quiz') {
        renderQuiz();
    } else if (page === 'stats') {
        renderStats();
    } else if (page === 'exam') {
        renderExam();
    }
}

// ============ 学习时间统计 ============
function startStudyTimer() {
    setInterval(() => {
        if (state.page === 'study' && !document.hidden) {
            fetch('/api/study-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seconds: 60 }),
            }).catch(() => {});
        }
    }, 60000);
}

// ============ 初始化 ============
function init() {
    speech.init();

    const today = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    $('#todayDate').textContent = `${today.getMonth() + 1}月${today.getDate()}日 ${weekdays[today.getDay()]}`;

    $$('.nav-btn').forEach(btn => {
        btn.onclick = () => switchPage(btn.dataset.page);
    });

    loadUnits();
    refreshTopBar();
    startStudyTimer();
}

document.addEventListener('DOMContentLoaded', init);
