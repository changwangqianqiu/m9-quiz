/* ===== DATA ===== */
let allQuestions = [];
let practiceState = null;
let examState = null;
let examTimer = null;
let currentUser = null;

const API_BASE = '/api';

/* ===== AUTO-RETRY: when server is unreachable, poll until it's back ===== */
let _serverDownBanner = null;
function showServerDown() {
  if (!_serverDownBanner) {
    _serverDownBanner = document.createElement('div');
    _serverDownBanner.id = 'server-down-banner';
    _serverDownBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#ea4335;color:#fff;text-align:center;padding:12px;font-size:14px;font-weight:600;';
    _serverDownBanner.textContent = '⏳ 服务器重连中，请稍候...';
    document.body.appendChild(_serverDownBanner);
  }
  _serverDownBanner.style.display = 'block';
}
function hideServerDown() {
  if (_serverDownBanner) _serverDownBanner.style.display = 'none';
}

async function apiFetch(method, path, data, withUser) {
  const headers = { 'Content-Type': 'application/json' };
  if (withUser) headers['X-Username'] = currentUser;
  const opts = { method, headers };
  if (data) opts.body = JSON.stringify(data);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API_BASE + path, opts);
      if (res.ok) { hideServerDown(); return res.json(); }
      // API returned an error (e.g. 400 login failed)
      return res.json();
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }
  }
  // All 3 attempts failed — show banner and start polling
  showServerDown();
  // Start background polling
  startServerPoll();
  throw lastError;
}

let _pollTimer = null;
function startServerPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    try {
      const res = await fetch('/');
      if (res.ok) {
        hideServerDown();
        clearInterval(_pollTimer);
        _pollTimer = null;
        showToast('✅ 服务器已恢复');
      }
    } catch (e) {}
  }, 5000);
}

/* ===== API Helpers ===== */
async function apiGet(path) {
  return apiFetch('GET', path);
}
async function apiPut(path, data) {
  return apiFetch('PUT', path, data, true);
}
async function apiPost(path, data, withUser) {
  return apiFetch('POST', path, data, withUser);
}
async function apiDelete(path) {
  return apiFetch('DELETE', path, null, true);
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  showLoading(false);
  // Check session from localStorage (just username, no sensitive data)
  const savedSession = localStorage.getItem('m9_session');
  if (savedSession) {
    currentUser = savedSession;
    loadQuestions();
    return;
  }
  showPage('login-page');
});

async function loadQuestions() {
  showLoading(true);
  try {
    const res = await fetch('/static/questions.json');
    const data = await res.json();
    allQuestions = data;
    updateStats();
    showPage('home-page');
    updateHomeUI();
    showLoading(false);
  } catch (e) {
    showLoading(false);
    showToast('题库加载失败，请刷新重试');
  }
}

function updateStats() {
  document.getElementById('total-count').textContent = allQuestions.length;
  document.getElementById('en2cn-count').textContent = allQuestions.filter(q => q.category === 'en2cn').length;
  document.getElementById('cn2en-count').textContent = allQuestions.filter(q => q.category === 'cn2en').length;
  document.getElementById('en2en-count').textContent = allQuestions.filter(q => q.category === 'en2en').length;
  document.getElementById('en2cn-btn-count').textContent = allQuestions.filter(q => q.category === 'en2cn').length + '题';
  document.getElementById('cn2en-btn-count').textContent = allQuestions.filter(q => q.category === 'cn2en').length + '题';
  document.getElementById('en2en-btn-count').textContent = allQuestions.filter(q => q.category === 'en2en').length + '题';
}

/* ===== AUTH ===== */
function switchTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
}

async function doRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  if (username.length < 3) { showToast('用户名至少3个字符'); return; }
  if (password.length < 4) { showToast('密码至少4个字符'); return; }
  if (password !== password2) { showToast('两次密码不一致'); return; }

  try {
    const res = await apiPost('/register', { username, password });
    if (res.ok) {
      showToast('注册成功，请登录');
      switchTab('login');
      document.getElementById('login-username').value = username;
      document.getElementById('login-password').value = '';
    } else {
      showToast(res.detail || '注册失败');
    }
  } catch (e) {
    showToast('网络错误，请检查后端服务');
  }
}

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) { showToast('请输入用户名和密码'); return; }

  try {
    const res = await apiPost('/login', { username, password });
    if (res.ok) {
      currentUser = username;
      localStorage.setItem('m9_session', username); // only save username hint
      loadQuestions();
      showToast(`欢迎回来，${username}！`);
    } else {
      showToast(res.detail || '登录失败');
    }
  } catch (e) {
    showToast('网络错误，请检查后端服务');
  }
}

async function doLogout() {
  await savePracticeState();
  await saveExamState();
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  currentUser = null;
  practiceState = null;
  examState = null;
  localStorage.removeItem('m9_session');
  showPage('login-page');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  showToast('已退出登录');
}

function updateHomeUI() {
  document.getElementById('user-info-bar').textContent = `👤 ${currentUser}`;
  checkResumeState();
  updateWrongBookBar();
}

/* ===== RESUME STATE ===== */
async function checkResumeState() {
  if (!currentUser) return;

  // Category-specific practice resumes
  for (const cat of ['en2cn', 'cn2en', 'en2en']) {
    try {
      const d = await apiGet('/practice/' + cat);
      const cnt = Object.keys(d.answered || {}).length;
      const btn = document.getElementById(cat + '-btn');
      const info = document.getElementById(cat + '-resume-info');
      const text = document.getElementById(cat + '-resume-text');
      if (cnt > 0) {
        const corr = Object.values(d.answered).filter(a => a.correct).length;
        const acc = cnt > 0 ? Math.round(corr / cnt * 100) : 0;
        btn.textContent = '继续练习';
        info.style.display = 'flex';
        text.textContent = `已答${cnt}题 · ${acc}% · 第${(d.currentIdx || 0) + 1}题`;
      } else {
        btn.textContent = '开始练习';
        info.style.display = 'none';
      }
    } catch (e) {
      // silently fail
    }
  }

  // All-practice resume
  try {
    const pData = await apiGet('/practice/all');
    const answeredCount = Object.keys(pData.answered || {}).length;
    const pBtn = document.getElementById('practice-btn');
    const pResumeInfo = document.getElementById('practice-resume-info');
    const pResumeText = document.getElementById('practice-resume-text');
    if (answeredCount > 0) {
      const correctCount = Object.values(pData.answered).filter(a => a.correct).length;
      const acc = Math.round(correctCount / answeredCount * 100);
      pBtn.textContent = '继续练习';
      pResumeInfo.style.display = 'flex';
      pResumeText.textContent = `已答 ${answeredCount} 题 · 准确率 ${acc}% · 第 ${(pData.currentIdx || 0) + 1} 题`;
    } else {
      pBtn.textContent = '开始练习';
      pResumeInfo.style.display = 'none';
    }
  } catch (e) {}

  // Exam resume
  try {
    const eData = await apiGet('/exam');
    const eBtn = document.getElementById('exam-btn');
    const eResumeInfo = document.getElementById('exam-resume-info');
    const eResumeText = document.getElementById('exam-resume-text');
    if (eData.submitted || !eData.questions) {
      eBtn.textContent = '开始考试';
      eResumeInfo.style.display = 'none';
    } else {
      const answeredCount = Object.keys(eData.answers || {}).length;
      const elapsed = Math.floor((Date.now() - eData.savedAt) / 1000);
      const remaining = Math.max(0, eData.timeLeftAtSave - elapsed);
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      eBtn.textContent = '继续考试';
      eResumeInfo.style.display = 'flex';
      eResumeText.textContent = `已答 ${answeredCount}/${eData.totalExam || 100} · 剩余 ${h > 0 ? h + '时' : ''}${m}分`;
    }
  } catch (e) {}
}

/* ===== IMPORT EXCEL ===== */
function importExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  showLoading(true);
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      let headerRow = 0;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i].map(c => String(c || '').trim());
        if (row.some(c => c.includes('题型') || c.includes('试题'))) { headerRow = i; break; }
      }

      const headers = rows[headerRow].map(c => String(c || '').trim());
      const idxQ = headers.findIndex(h => h.includes('试题') || h.includes('题目'));
      const idxA = headers.findIndex(h => h.match(/选项\s*A|A$/i));
      const idxB = headers.findIndex(h => h.match(/选项\s*B|B$/i));
      const idxC = headers.findIndex(h => h.match(/选项\s*C|C$/i));
      const idxAns = headers.findIndex(h => h.includes('答案'));
      if (idxQ === -1 || idxAns === -1) throw new Error('未找到必要列（试题内容、答案）');

      const newQuestions = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[idxQ]) continue;
        const ans = String(row[idxAns] || '').trim();
        const qType = ans.length > 1 ? 'multi' : 'single';
        const qStr = String(row[idxQ] || '').trim();
        const aStr = idxA >= 0 ? String(row[idxA] || '').trim() : '';
        const bStr = idxB >= 0 ? String(row[idxB] || '').trim() : '';
        const cStr = idxC >= 0 ? String(row[idxC] || '').trim() : '';
        newQuestions.push({
          id: newQuestions.length, type: qType,
          category: classifyQuestion(qStr, aStr, bStr, cStr),
          question: qStr,
          options: { A: aStr, B: bStr, C: cStr },
          answer: ans
        });
      }

      if (newQuestions.length === 0) throw new Error('未能解析到有效题目');
      allQuestions = newQuestions;

      // Reset all user data on server
      if (currentUser) {
        await apiDelete('/user-data/' + currentUser);
      }

      updateStats();
      checkResumeState();
      showLoading(false);
      showToast(`✅ 成功导入 ${newQuestions.length} 题`);
    } catch (err) {
      showLoading(false);
      showToast('导入失败：' + err.message);
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

function classifyQuestion(q, a, b, c) {
  const hasCnQ = /[\u4e00-\u9fff]/.test(q);
  const hasCnOpt = /[\u4e00-\u9fff]/.test(a) || /[\u4e00-\u9fff]/.test(b) || /[\u4e00-\u9fff]/.test(c);
  if (!hasCnQ && hasCnOpt) return 'en2cn';
  if (hasCnQ && !hasCnOpt) return 'cn2en';
  if (!hasCnQ && !hasCnOpt) return 'en2en';
  return 'other';
}

/* ===== NAVIGATION ===== */
async function goHome() {
  await savePracticeState();
  await saveExamState();
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  showPage('home-page');
  updateHomeUI();
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ===== PERSISTENCE ===== */
async function savePracticeState() {
  if (!practiceState || !currentUser) return;
  if (practiceState.category === 'random') return;
  const data = {
    currentIdx: practiceState.currentIdx,
    answered: practiceState.answered,
    total: practiceState.total,
    category: practiceState.category
  };
  await apiPut('/practice/' + practiceState.category, data);
}

async function saveExamState() {
  if (!examState || !currentUser) return;
  if (examState.submitted) {
    await apiDelete('/exam');
    return;
  }
  const data = {
    questions: examState.questions,
    currentIdx: examState.currentIdx,
    totalExam: examState.totalExam,
    answers: examState.answers,
    startTime: examState.startTime,
    totalTime: examState.totalTime,
    timeLeftAtSave: examState.timeLeft,
    savedAt: Date.now(),
    submitted: false
  };
  await apiPut('/exam', data);
}

async function resetPractice(cat) {
  await apiPut('/practice/' + (cat || 'all'), {});
  checkResumeState();
  showToast('练习进度已重置');
}

async function resetExam() {
  await apiDelete('/exam');
  checkResumeState();
  showToast('考试进度已重置');
}

/* ===== PRACTICE MODE ===== */
async function startPractice(cat) {
  cat = cat || 'all';
  const isRandom = cat === 'random';
  const pool = isRandom ? allQuestions : (cat === 'all' ? allQuestions : allQuestions.filter(q => q.category === cat));
  if (pool.length === 0) { showToast('该分类暂无题目'); return; }

  const questions = isRandom ? shuffleArr([...pool]) : [...pool];

  if (isRandom) {
    practiceState = {
      questions: questions, currentIdx: 0,
      answered: {}, total: pool.length, category: 'random'
    };
  } else {
    try {
      const pData = await apiGet('/practice/' + cat);
      if (pData && Object.keys(pData.answered || {}).length > 0) {
        practiceState = {
          questions: questions,
          currentIdx: pData.currentIdx || 0,
          answered: pData.answered || {},
          total: pool.length, category: cat
        };
        showToast('已恢复练习进度');
      } else {
        practiceState = { questions, currentIdx: 0, answered: {}, total: pool.length, category: cat };
      }
    } catch (e) {
      practiceState = { questions, currentIdx: 0, answered: {}, total: pool.length, category: cat };
    }
  }

  practiceSelected = [];
  const catNames = { all: '顺序练习', random: '随机练习', en2cn: '英译中练习', cn2en: '中译英练习', en2en: '英译英练习', retry: '错题重练' };
  document.getElementById('practice-page').querySelector('.quiz-title').textContent = catNames[cat] || '练习模式';
  showPage('practice-page');
  renderPracticeQuestion();
}

function renderPracticeQuestion() {
  const s = practiceState;
  const q = s.questions[s.currentIdx];
  const answered = s.answered[s.currentIdx];

  const answeredCount = Object.keys(s.answered).length;
  const correctCount = Object.values(s.answered).filter(a => a.correct).length;
  const accuracy = answeredCount > 0 ? Math.round(correctCount / answeredCount * 100) : 0;
  document.getElementById('practice-accuracy').textContent = accuracy + '%';
  document.getElementById('practice-progress').textContent = `${s.currentIdx + 1}/${s.total}`;

  const pct = ((s.currentIdx + 1) / s.total * 100).toFixed(1);
  document.getElementById('practice-progress-bar').style.width = pct + '%';

  const typeBadge = document.getElementById('practice-q-type');
  typeBadge.textContent = q.type === 'multi' ? '多选题' : '单选题';
  typeBadge.className = 'q-type-badge' + (q.type === 'multi' ? ' multi-badge' : '');
  document.getElementById('practice-q-number').textContent = `第 ${s.currentIdx + 1} 题`;
  document.getElementById('practice-question').textContent = q.question;

  const optList = document.getElementById('practice-options');
  optList.innerHTML = '';
  ['A', 'B', 'C'].filter(l => q.options[l]).forEach(letter => {
    const div = document.createElement('div');
    div.className = 'option-item' + (answered ? ' disabled' : '');
    div.dataset.letter = letter;
    if (answered) {
      const correctLetters = answered.answer.split('');
      if (correctLetters.includes(letter)) div.classList.add('correct');
      else if (answered.selected.includes(letter)) div.classList.add('wrong');
    }
    div.innerHTML = `<span class="option-letter">${letter}</span><span class="option-text">${q.options[letter]}</span>`;
    if (!answered) div.addEventListener('click', () => selectPracticeOption(letter));
    optList.appendChild(div);
  });

  const resultPanel = document.getElementById('practice-result');
  if (answered) {
    resultPanel.style.display = 'flex';
    if (answered.correct) {
      resultPanel.className = 'result-panel correct-panel';
      document.getElementById('practice-result-icon').textContent = '✅';
      document.getElementById('practice-result-text').textContent = '回答正确！';
    } else {
      resultPanel.className = 'result-panel wrong-panel';
      document.getElementById('practice-result-icon').textContent = '❌';
      document.getElementById('practice-result-text').textContent = `回答错误，正确答案是：${answered.answer}`;
    }
  } else {
    resultPanel.style.display = 'none';
  }

  document.getElementById('practice-prev').disabled = s.currentIdx === 0;
  const nextBtn = document.getElementById('practice-next-btn');
  if (answered) {
    if (s.currentIdx < s.total - 1) {
      nextBtn.textContent = '下一题 →';
      nextBtn.onclick = () => practiceNav(1);
    } else {
      nextBtn.textContent = '练习完成 🎉';
      nextBtn.onclick = practiceFinish;
    }
  } else {
    nextBtn.textContent = '提交答案';
    nextBtn.onclick = practiceSubmit;
  }
}

let practiceSelected = [];

function selectPracticeOption(letter) {
  const s = practiceState;
  const q = s.questions[s.currentIdx];
  if (s.answered[s.currentIdx]) return;
  if (q.type === 'single') {
    practiceSelected = [letter];
    document.querySelectorAll('#practice-options .option-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.letter === letter);
      const lEl = el.querySelector('.option-letter');
      lEl.style.background = el.dataset.letter === letter ? 'var(--primary)' : '';
      lEl.style.borderColor = el.dataset.letter === letter ? 'var(--primary)' : '';
      lEl.style.color = el.dataset.letter === letter ? '#fff' : '';
    });
  } else {
    const idx = practiceSelected.indexOf(letter);
    if (idx >= 0) practiceSelected.splice(idx, 1);
    else practiceSelected.push(letter);
    const el = document.querySelector(`#practice-options .option-item[data-letter="${letter}"]`);
    el.classList.toggle('selected', practiceSelected.includes(letter));
  }
}

async function practiceSubmit() {
  const s = practiceState;
  if (s.answered[s.currentIdx]) { practiceNav(1); return; }
  if (practiceSelected.length === 0) { showToast('请先选择答案'); return; }

  const q = s.questions[s.currentIdx];
  const selectedStr = practiceSelected.sort().join('');
  const ansStr = q.answer.split('').sort().join('');
  const correct = selectedStr === ansStr;

  s.answered[s.currentIdx] = { selected: practiceSelected.sort().join(''), answer: q.answer, correct };
  practiceSelected = [];

  // Record answer to server
  await recordAnswer(q, selectedStr, correct);
  await savePracticeState();
  renderPracticeQuestion();
}

function practiceNav(dir) {
  practiceSelected = [];
  practiceState.currentIdx = Math.max(0, Math.min(practiceState.total - 1, practiceState.currentIdx + dir));
  savePracticeState();
  renderPracticeQuestion();
}

function practiceFinish() {
  const s = practiceState;
  const answeredCount = Object.keys(s.answered).length;
  const correctCount = Object.values(s.answered).filter(a => a.correct).length;
  showToast(`练习完成！共作答 ${answeredCount} 题，正确 ${correctCount} 题，准确率 ${Math.round(correctCount/answeredCount*100)}%`);
  savePracticeState();
}

/* ===== EXAM MODE ===== */
async function startExam() {
  if (allQuestions.length < 100) { showToast(`题库不足100题`); return; }

  try {
    const eData = await apiGet('/exam');
    if (eData && eData.questions && !eData.submitted) {
      const elapsed = Math.floor((Date.now() - eData.savedAt) / 1000);
      const remaining = Math.max(0, eData.timeLeftAtSave - elapsed);
      if (remaining <= 0) {
        await apiDelete('/exam');
        showToast('考试时间已到期，请重新开始');
        checkResumeState();
        return;
      }
      examState = {
        questions: eData.questions, currentIdx: eData.currentIdx,
        totalExam: eData.totalExam || 100,
        answers: eData.answers || {}, currentSelected: [],
        totalTime: eData.totalTime, timeLeft: remaining,
        startTime: eData.startTime, submitted: false
      };
      showToast('已恢复考试进度');
      showPage('exam-page');
      renderExamQuestion();
      startExamTimer();
      return;
    }
  } catch (e) {}

  startExamNew();
}

function startExamNew() {
  const en2cnPool = shuffleArr(allQuestions.filter(q => q.category === 'en2cn'));
  const cn2enPool = shuffleArr(allQuestions.filter(q => q.category === 'cn2en'));
  const en2enPool = shuffleArr(allQuestions.filter(q => q.category === 'en2en'));
  const en2cnCount = Math.min(60, en2cnPool.length);
  const cn2enCount = Math.min(20, cn2enPool.length);
  const en2enCount = Math.min(20, en2enPool.length);
  let examQuestions = [...en2cnPool.slice(0, en2cnCount), ...cn2enPool.slice(0, cn2enCount), ...en2enPool.slice(0, en2enCount)];
  const shortfall = 100 - examQuestions.length;
  if (shortfall > 0) {
    const usedIds = new Set(examQuestions.map(q => q.id));
    const remaining = shuffleArr(allQuestions.filter(q => !usedIds.has(q.id)));
    examQuestions = [...examQuestions, ...remaining.slice(0, shortfall)];
  }
  examQuestions = shuffleArr(examQuestions);
  const total = examQuestions.length;
  if (total < 100) showToast(`本次考试${total}题`);

  examState = { questions: examQuestions, currentIdx: 0, totalExam: total, answers: {}, currentSelected: [], totalTime: 7200, timeLeft: 7200, startTime: Date.now(), submitted: false };
  saveExamState();
  showPage('exam-page');
  renderExamQuestion();
  startExamTimer();
}

function renderExamQuestion() {
  const s = examState;
  const q = s.questions[s.currentIdx];
  const savedAnswer = s.answers[s.currentIdx];
  s.currentSelected = savedAnswer ? savedAnswer.split('') : [];
  const pct = ((s.currentIdx + 1) / s.totalExam * 100).toFixed(1);
  document.getElementById('exam-progress-bar').style.width = pct + '%';
  const typeBadge = document.getElementById('exam-q-type');
  typeBadge.textContent = q.type === 'multi' ? '多选题' : '单选题';
  typeBadge.className = 'q-type-badge' + (q.type === 'multi' ? ' multi-badge' : '');
  document.getElementById('exam-q-number').textContent = `第 ${s.currentIdx + 1} 题 / 共${s.totalExam}题`;
  document.getElementById('exam-question').textContent = q.question;
  const optList = document.getElementById('exam-options');
  optList.innerHTML = '';
  ['A', 'B', 'C'].filter(l => q.options[l]).forEach(letter => {
    const div = document.createElement('div');
    div.className = 'option-item';
    div.dataset.letter = letter;
    if (s.currentSelected.includes(letter)) div.classList.add('selected');
    div.innerHTML = `<span class="option-letter">${letter}</span><span class="option-text">${q.options[letter]}</span>`;
    div.addEventListener('click', () => selectExamOption(letter));
    optList.appendChild(div);
  });
  document.getElementById('exam-answered-hint').style.display = savedAnswer ? 'block' : 'none';
  document.getElementById('exam-answered-count').textContent = Object.keys(s.answers).length;
}

function selectExamOption(letter) {
  const s = examState;
  if (s.submitted) return;
  const q = s.questions[s.currentIdx];
  if (q.type === 'single') s.currentSelected = [letter];
  else {
    const idx = s.currentSelected.indexOf(letter);
    if (idx >= 0) s.currentSelected.splice(idx, 1);
    else s.currentSelected.push(letter);
  }
  if (s.currentSelected.length > 0) s.answers[s.currentIdx] = s.currentSelected.sort().join('');
  else delete s.answers[s.currentIdx];
  document.querySelectorAll('#exam-options .option-item').forEach(el => {
    el.classList.toggle('selected', s.currentSelected.includes(el.dataset.letter));
  });
  document.getElementById('exam-answered-hint').style.display = s.answers[s.currentIdx] ? 'block' : 'none';
  document.getElementById('exam-answered-count').textContent = Object.keys(s.answers).length;
  saveExamState();
}

function examNav(dir) {
  examState.currentIdx = Math.max(0, Math.min(examState.totalExam - 1, examState.currentIdx + dir));
  saveExamState();
  renderExamQuestion();
}

function toggleQuestionMap() {
  const map = document.getElementById('question-map');
  if (map.style.display !== 'none') { map.style.display = 'none'; }
  else { renderQuestionMap(); map.style.display = 'flex'; }
}

function renderQuestionMap() {
  const s = examState;
  const grid = document.getElementById('map-grid');
  grid.innerHTML = '';
  for (let i = 0; i < s.totalExam; i++) {
    const dot = document.createElement('div');
    dot.className = 'map-dot';
    dot.textContent = i + 1;
    if (i === s.currentIdx) dot.classList.add('current');
    else if (s.answers[i]) dot.classList.add('answered');
    dot.onclick = () => { examState.currentIdx = i; saveExamState(); renderExamQuestion(); toggleQuestionMap(); };
    grid.appendChild(dot);
  }
}

function confirmExitExam() {
  if (confirm('确定要退出考试吗？\n进度已自动保存，下次可继续考试。')) {
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
    saveExamState();
    showPage('home-page');
    updateHomeUI();
  }
}

function confirmSubmitExam() {
  const answeredCount = Object.keys(examState.answers).length;
  const unanswered = examState.totalExam - answeredCount;
  let msg = `确定要交卷吗？`;
  if (unanswered > 0) msg += `\n还有 ${unanswered} 题未作答，未作答题目计为0分。`;
  if (confirm(msg)) submitExam();
}

async function submitExam() {
  const s = examState;
  if (s.submitted) return;
  s.submitted = true;
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  s.timeUsed = Math.min(s.totalTime - s.timeLeft, s.totalTime);

  let score = 0;
  for (let i = 0; i < s.totalExam; i++) {
    const q = s.questions[i];
    const userAns = s.answers[i] || '';
    const isCorrect = userAns.split('').sort().join('') === q.answer.split('').sort().join('');
    if (isCorrect) score++;
    await recordAnswer(q, userAns, isCorrect);
  }
  s.score = score;
  await apiDelete('/exam');
  showExamResult();
}

function showExamResult() {
  const s = examState;
  const score = s.score;
  const answeredCount = Object.keys(s.answers).length;
  const unanswered = s.totalExam - answeredCount;
  let correct = 0, wrong = 0;
  for (let i = 0; i < s.totalExam; i++) {
    const q = s.questions[i];
    const userAns = s.answers[i] || '';
    if (!userAns) continue;
    if (userAns.split('').sort().join('') === q.answer.split('').sort().join('')) correct++;
    else wrong++;
  }
  const accuracy = answeredCount > 0 ? Math.round(correct / answeredCount * 100) : 0;
  const h = Math.floor(s.timeUsed / 3600);
  const m = Math.floor((s.timeUsed % 3600) / 60);
  const sec = s.timeUsed % 60;
  const timeStr = `用时 ${h}小时 ${m}分钟 ${sec}秒`;
  let grade, gradeColor;
  if (score >= 90) { grade = '优秀 🏆'; gradeColor = '#1a73e8'; }
  else if (score >= 80) { grade = '良好 ✨'; gradeColor = '#34a853'; }
  else if (score >= 60) { grade = '通过 ✅'; gradeColor = '#fbbc04'; }
  else { grade = '未通过 ❌'; gradeColor = '#ea4335'; }
  const pct = score / s.totalExam * 360;
  document.getElementById('score-circle').style.background = `conic-gradient(${gradeColor} ${pct}deg, var(--border) ${pct}deg)`;
  document.getElementById('final-score').textContent = score;
  document.getElementById('final-score').style.color = gradeColor;
  document.getElementById('result-grade').textContent = grade;
  document.getElementById('result-grade').style.color = gradeColor;
  document.getElementById('result-time-used').textContent = timeStr;
  document.getElementById('rs-correct').textContent = correct;
  document.getElementById('rs-wrong').textContent = wrong;
  document.getElementById('rs-unanswered').textContent = unanswered;
  document.getElementById('rs-accuracy').textContent = accuracy + '%';
  document.getElementById('review-section').style.display = 'none';
  showPage('result-page');
}

function reviewExam() {
  const s = examState;
  const section = document.getElementById('review-section');
  const list = document.getElementById('review-list');
  if (section.style.display !== 'none') { section.style.display = 'none'; return; }
  list.innerHTML = '';
  for (let i = 0; i < s.totalExam; i++) {
    const q = s.questions[i];
    const userAns = s.answers[i] || '';
    const correctAns = q.answer.split('').sort().join('');
    const userAnsSorted = userAns.split('').sort().join('');
    let status, badgeClass, badgeText;
    if (!userAns) { status = 'skip'; badgeClass = 'badge-skip'; badgeText = '未作答'; }
    else if (userAnsSorted === correctAns) { status = 'correct'; badgeClass = 'badge-correct'; badgeText = '正确'; }
    else { status = 'wrong'; badgeClass = 'badge-wrong'; badgeText = '错误'; }
    const div = document.createElement('div');
    div.className = `review-item ${status}-item`;
    div.innerHTML = `<span class="review-badge ${badgeClass}">${badgeText}</span><div class="review-q">第${i + 1}题：${q.question}</div><div class="review-answers"><span class="review-your">你的答案：${userAns || '未作答'}</span><span class="review-correct">正确答案：${q.answer}</span></div>`;
    list.appendChild(div);
  }
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth' });
}

/* ===== EXAM TIMER ===== */
function startExamTimer() {
  updateTimerDisplay();
  examTimer = setInterval(() => {
    examState.timeLeft--;
    updateTimerDisplay();
    if (examState.timeLeft % 30 === 0) saveExamState();
    if (examState.timeLeft <= 0) { clearInterval(examTimer); examTimer = null; showToast('⏰ 考试时间到！'); submitExam(); }
  }, 1000);
}

function updateTimerDisplay() {
  const t = examState.timeLeft;
  const h = Math.floor(t / 3600).toString().padStart(2, '0');
  const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
  const s = (t % 60).toString().padStart(2, '0');
  const timerEl = document.getElementById('exam-timer');
  timerEl.textContent = `${h}:${m}:${s}`;
  timerEl.className = 'timer' + (t <= 600 ? ' warning' : '');
}

/* ===== ANSWER RECORDING ===== */
async function recordAnswer(q, userAns, correct) {
  if (!currentUser) return;
  try {
    await apiPost('/record-answer', { questionId: q.id, correct, username: currentUser }, false);
  } catch (e) { console.error('record-answer failed:', e); }
  // Wrong book
  try {
    if (!correct) {
      await apiPost('/record-wrong', { questionId: q.id, wrongAnswer: userAns }, true);
    } else {
      await apiPost('/remove-wrong', { questionId: q.id }, true);
    }
  } catch (e) { console.error('wrongbook update failed:', e); }
}

/* ===== WRONG BOOK ===== */
async function updateWrongBookBar() {
  if (!currentUser) return;
  try {
    const stats = await apiGet('/user-stats');
    const wrongCount = stats.wrongKindCount || 0;
    const totalAnswered = stats.totalAnswered || 0;
    const totalWrongs = stats.totalWrongs || 0;
    const rate = totalAnswered > 0 ? Math.round(totalWrongs / totalAnswered * 100) : 0;
    document.getElementById('wb-my-wrong-count').textContent = wrongCount + '道错题';
    document.getElementById('wb-my-wrong-rate').textContent = rate + '%';
  } catch (e) {}
}

async function showWrongBook() {
  showPage('wrongbook-page');
  await renderWrongBookPage('all');
}

async function renderWrongBookPage(filter) {
  try {
    const wb = await apiGet('/wrongbook');
    const globalStats = await apiGet('/global-stats');
    const userStats = await apiGet('/user-stats');
    const wrongKindCount = userStats.wrongKindCount || 0;
    const totalAnswered = userStats.totalAnswered || 0;
    const totalWrongs = userStats.totalWrongs || 0;
    const rate = totalAnswered > 0 ? Math.round(totalWrongs / totalAnswered * 100) : 0;

    document.getElementById('wb-total-wrong').textContent = wrongKindCount;
    document.getElementById('wb-total-rate').textContent = rate + '%';
    document.getElementById('wb-sum-total-answered').textContent = totalAnswered;
    document.getElementById('wb-sum-total-wrong').textContent = totalWrongs;
    document.getElementById('wb-sum-rate').textContent = rate + '%';

    let globalTotalAttempts = 0, globalCorrectAttempts = 0;
    Object.values(globalStats).forEach(s => { globalTotalAttempts += s.totalAttempts; globalCorrectAttempts += s.correctAttempts; });
    document.getElementById('wb-sum-global-rate').textContent = globalTotalAttempts > 0 ? Math.round(globalCorrectAttempts / globalTotalAttempts * 100) + '%' : '-';

    document.querySelectorAll('.wb-filter-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('wb-filter-' + (filter === 'all' ? 'all' : filter));
    if (activeBtn) activeBtn.classList.add('active');

    const listEl = document.getElementById('wb-list');
    const wrongIds = Object.keys(wb);
    if (wrongIds.length === 0) { listEl.innerHTML = '<p class="wb-empty">暂无错题记录，加油！</p>'; return; }

    const items = wrongIds.map(qId => {
      const question = allQuestions.find(q => String(q.id) === qId);
      if (!question) return null;
      const wbEntry = wb[qId];
      const gs = globalStats[qId] || { totalAttempts: 0, correctAttempts: 0 };
      const globalCorrectRate = gs.totalAttempts > 0 ? Math.round(gs.correctAttempts / gs.totalAttempts * 100) + '%' : '-';
      if (filter !== 'all' && question.category !== filter) return null;
      return { question, wbEntry, globalCorrectRate, gs };
    }).filter(Boolean);

    if (items.length === 0) { listEl.innerHTML = '<p class="wb-empty">该分类暂无错题</p>'; return; }
    items.sort((a, b) => b.wbEntry.wrongCount - a.wbEntry.wrongCount);

    const catNames = { en2cn: '英译中', cn2en: '中译英', en2en: '英译英', other: '其他' };
    listEl.innerHTML = items.map(item => {
      const q = item.question;
      const correctLetters = q.answer.split('');
      const wrongLetters = (item.wbEntry.lastWrongAnswer || '').split('');
      const optHtml = ['A', 'B', 'C'].filter(l => q.options[l]).map(l => {
        let cls = 'wb-opt';
        if (correctLetters.includes(l)) cls += ' wb-opt-correct';
        else if (wrongLetters.includes(l)) cls += ' wb-opt-wrong';
        return `<span class="${cls}"><b>${l}.</b> ${q.options[l]}</span>`;
      }).join('');
      return `<div class="wb-item"><div class="wb-item-head"><span class="wb-item-id">#${q.id}</span><span class="wb-item-cat">${catNames[q.category] || q.category}</span><span class="wb-item-wrongcount">错 ${item.wbEntry.wrongCount} 次</span><span class="wb-item-global">全局正确率 ${item.globalCorrectRate} (${item.gs.totalAttempts}人作答)</span></div><div class="wb-item-q">${q.question}</div><div class="wb-item-options">${optHtml}</div><div class="wb-item-footer"><span class="wb-item-answer-label">正确答案: <strong>${q.answer}</strong></span><span class="wb-item-my-label">你选了: <strong class="wb-wrong-ans">${item.wbEntry.lastWrongAnswer || '-'}</strong></span><button class="btn btn-retry" onclick="retryWrongQuestion(${q.id})">重新作答</button></div></div>`;
    }).join('');
  } catch (e) {
    document.getElementById('wb-list').innerHTML = '<p class="wb-empty">加载失败</p>';
  }
}

function filterWrongBook(filter) { renderWrongBookPage(filter); }

async function clearWrongBook() {
  if (!confirm('确定清空错题本？此操作不可撤销。')) return;
  await apiDelete('/wrongbook');
  updateWrongBookBar();
  renderWrongBookPage('all');
  showToast('错题本已清空');
}

function retryWrongQuestion(questionId) {
  const question = allQuestions.find(q => q.id === questionId);
  if (!question) { showToast('题目未找到'); return; }
  practiceState = { questions: [question], currentIdx: 0, answered: {}, total: 1, category: 'retry' };
  practiceSelected = [];
  document.getElementById('practice-page').querySelector('.quiz-title').textContent = '错题重练';
  showPage('practice-page');
  renderPracticeQuestion();
}

/* ===== UTILS ===== */
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function showLoading(show) { document.getElementById('loading').style.display = show ? 'flex' : 'none'; }

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
