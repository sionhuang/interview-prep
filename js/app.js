// 面试题库记忆助手 — 核心逻辑
// ============================================

// ---- 艾宾浩斯排程 ----
const INTERVALS = [2, 4, 7, 15];
const DEFAULT_DAILY_NEW = 5;

// ---- 题库配置 ----
const QUESTIONS_BANKS = {
  accounting: { label: "会计专业", icon: "📊", questions: [] },
  english:    { label: "英文面试", icon: "🌐", questions: [] },
};

function getActiveBank() {
  const state = loadState();
  return state.activeBank || "accounting";
}

function setActiveBank(name) {
  const state = loadState();
  state.activeBank = name;
  saveState(state);
}

function getActiveQuestions() {
  const bank = getActiveBank();
  return QUESTIONS_BANKS[bank]?.questions || [];
}

// 获取题目（叠加用户编辑）
function getQuestion(id) {
  const q = getActiveQuestions().find((q) => q.id === id);
  if (!q) return null;
  const state = loadState();
  const edits = (state.editedQuestions && state.editedQuestions[id]) || {};
  return {
    ...q,
    title: edits.title || q.title,
    keys: edits.keys !== undefined ? edits.keys : q.keys,
    answer: edits.answer !== undefined ? edits.answer : q.answer,
  };
}

// 保存用户编辑
function saveQuestionEdit(id, fields) {
  const state = loadState();
  if (!state.editedQuestions) state.editedQuestions = {};
  if (!state.editedQuestions[id]) state.editedQuestions[id] = {};
  Object.assign(state.editedQuestions[id], fields);
  saveState(state);
  if (typeof SyncManager !== "undefined") SyncManager.schedulePush();
}

function getDailyNewCount(state) {
  const s = state || loadState();
  const bank = getActiveBank();
  if (typeof s.dailyNewCount === "object" && s.dailyNewCount !== null) {
    return s.dailyNewCount[bank] || DEFAULT_DAILY_NEW;
  }
  // Backward compat: old single-number format
  return s.dailyNewCount || DEFAULT_DAILY_NEW;
}

function getNextReviewDate(completionDates) {
  if (!completionDates || completionDates.length === 0) return null;
  if (completionDates.length > INTERVALS.length) return null;
  const sorted = [...completionDates].sort();
  const last = new Date(sorted[sorted.length - 1]);
  last.setDate(last.getDate() + INTERVALS[completionDates.length - 1]);
  return last.toISOString().split("T")[0];
}

// ---- 日期工具（支持模拟日期） ----
function realToday() {
  return new Date().toISOString().split("T")[0];
}

function getToday() {
  const state = loadState();
  return state.debugDate || realToday();
}

// ---- 状态管理 ----
const STORAGE_KEY = "interview_prep_state";

function defaultState() {
  return {
    completionHistory: {},
    streak: 0,
    lastStreakDate: null,
    dailyNewCount: { accounting: DEFAULT_DAILY_NEW, english: DEFAULT_DAILY_NEW },
    todayNewAssigned: {},
    manuallyAddedToday: {},
    debugDate: null,
    activeBank: "accounting",
    editedQuestions: {},
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      let migrated = false;
      // Migrate dailyNewCount: single number → per-bank object
      if (s.dailyNewCount == null) {
        s.dailyNewCount = { accounting: DEFAULT_DAILY_NEW, english: DEFAULT_DAILY_NEW };
        migrated = true;
      } else if (typeof s.dailyNewCount === "number") {
        s.dailyNewCount = { accounting: s.dailyNewCount, english: DEFAULT_DAILY_NEW };
        migrated = true;
      }
      // Migrate todayNewAssigned & manuallyAddedToday: flat → per-bank
      if (s.todayNewAssigned == null || !s.todayNewAssigned.accounting) {
        const oldAssigned = (s.todayNewAssigned && s.todayNewAssigned.date) ? s.todayNewAssigned : null;
        s.todayNewAssigned = { accounting: oldAssigned, english: null };
        migrated = true;
      }
      if (s.manuallyAddedToday == null || !s.manuallyAddedToday.accounting) {
        const oldManual = (s.manuallyAddedToday && s.manuallyAddedToday.date) ? s.manuallyAddedToday : null;
        s.manuallyAddedToday = { accounting: oldManual, english: null };
        migrated = true;
      }
      if (s.debugDate == null) s.debugDate = null;
      if (s.activeBank == null) s.activeBank = "accounting";
      if (s.editedQuestions == null) s.editedQuestions = {};
      // Persist migration immediately so subsequent reads don't see old format
      if (migrated) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      }
      return s;
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---- 每日新题分配 ----
function getOrAssignTodayNew(state) {
  const today = getToday();
  const count = getDailyNewCount(state);
  const bank = getActiveBank();

  const bankAssigned = state.todayNewAssigned[bank];
  if (bankAssigned && bankAssigned.date === today) {
    return bankAssigned.questionIds;
  }

  // 1. Carry over unfinished from yesterday's assignment
  let carryOver = [];
  if (bankAssigned) {
    carryOver = bankAssigned.questionIds.filter((id) => {
      const hist = state.completionHistory[id] || [];
      return !hist.includes(bankAssigned.date);
    });
  }

  // 2. Fill remaining from unlearned (exclude carry-over)
  const unlearned = getActiveQuestions().filter(
    (q) =>
      !carryOver.includes(q.id) &&
      (!state.completionHistory[q.id] || state.completionHistory[q.id].length === 0)
  );
  const remaining = Math.max(0, count - carryOver.length);
  const fresh = unlearned.slice(0, remaining).map((q) => q.id);

  let assigned = [...carryOver, ...fresh];

  // Merge manually added IDs for this bank (survive reassignment)
  const manual = state.manuallyAddedToday[bank];
  if (manual && manual.date === today) {
    for (const mid of manual.ids) {
      if (!assigned.includes(mid)) {
        assigned.push(mid);
      }
    }
  }

  state.todayNewAssigned[bank] = { date: today, questionIds: assigned };
  saveState(state);
  return assigned;
}

// ---- 手动加入今日任务 ----
function getOrCreateTodayManual(state) {
  const today = getToday();
  const bank = getActiveBank();
  if (state.manuallyAddedToday[bank] && state.manuallyAddedToday[bank].date === today) {
    return state.manuallyAddedToday[bank];
  }
  state.manuallyAddedToday[bank] = { date: today, ids: [] };
  saveState(state);
  return state.manuallyAddedToday[bank];
}

function isManuallyAdded(questionId) {
  const state = loadState();
  const bank = getActiveBank();
  const manual = state.manuallyAddedToday[bank];
  return manual && manual.ids ? manual.ids.includes(questionId) : false;
}

function addToTodayTasks(questionId) {
  const state = loadState();
  const bank = getActiveBank();
  const manual = getOrCreateTodayManual(state);
  if (!manual.ids.includes(questionId)) {
    manual.ids.push(questionId);
  }
  // Also ensure it's in todayNewAssigned for the current bank
  const today = getToday();
  if (!state.todayNewAssigned[bank] || state.todayNewAssigned[bank].date !== today) {
    state.todayNewAssigned[bank] = { date: today, questionIds: [] };
  }
  if (!state.todayNewAssigned[bank].questionIds.includes(questionId)) {
    state.todayNewAssigned[bank].questionIds.push(questionId);
  }
  saveState(state);
  renderAll();
  if (typeof SyncManager !== "undefined") SyncManager.schedulePush();
}

function removeFromTodayTasks(questionId) {
  const state = loadState();
  const bank = getActiveBank();
  const manual = state.manuallyAddedToday[bank];
  if (manual && manual.ids) {
    manual.ids = manual.ids.filter((id) => id !== questionId);
  }
  // Also remove from todayNewAssigned
  const assigned = state.todayNewAssigned[bank];
  if (assigned) {
    assigned.questionIds = assigned.questionIds.filter((id) => id !== questionId);
  }
  saveState(state);
  renderAll();
  if (typeof SyncManager !== "undefined") SyncManager.schedulePush();
}

// ---- 每日任务计算 ----
function getDailyTasks() {
  const state = loadState();
  const today = getToday();

  const newToday = getOrAssignTodayNew(state);
  reLoadState(state); // refresh after getOrAssignTodayNew may have saved

  const reviewToday = [];
  for (const q of getActiveQuestions()) {
    const hist = state.completionHistory[q.id];
    if (!hist || hist.length === 0) continue;
    if (hist.length > INTERVALS.length) continue;
    const nextDate = getNextReviewDate(hist);
    if (nextDate && nextDate <= today) {
      reviewToday.push(q.id);
    }
  }

  return { date: today, newQuestions: newToday, reviewQuestions: reviewToday };
}

// Helper: reload state from localStorage into an existing object
function reLoadState(state) {
  const fresh = loadState();
  Object.assign(state, fresh);
}

// ---- 完成记录操作 ----
function toggleComplete(questionId) {
  const state = loadState();
  const today = getToday();

  if (!state.completionHistory[questionId]) {
    state.completionHistory[questionId] = [];
  }

  const hist = state.completionHistory[questionId];
  const alreadyDone = hist.includes(today);

  if (alreadyDone) {
    state.completionHistory[questionId] = hist.filter((d) => d !== today);
  } else {
    state.completionHistory[questionId] = [...hist, today];
  }

  updateStreak(state, today);
  saveState(state);

  // 触发云端同步（防抖）
  if (typeof SyncManager !== "undefined") {
    SyncManager.schedulePush();
  }

  return state;
}

function updateStreak(state, today) {
  const tasks = getDailyTasks();
  const allTaskIds = [...tasks.newQuestions, ...tasks.reviewQuestions];

  if (allTaskIds.length === 0) return;

  const allDone = allTaskIds.every((id) => {
    const hist = state.completionHistory[id] || [];
    return hist.includes(today);
  });

  if (allDone) {
    if (state.lastStreakDate) {
      const lastDate = new Date(state.lastStreakDate);
      const todayDate = new Date(today);
      const diff = (todayDate - lastDate) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        state.streak += 1;
      } else if (diff > 1) {
        state.streak = 1;
      }
    } else {
      state.streak = 1;
    }
    state.lastStreakDate = today;
  }
}

function isQuestionCompleteToday(questionId) {
  const state = loadState();
  const today = getToday();
  return (state.completionHistory[questionId] || []).includes(today);
}

// ---- 每日新题数量设置 ----
function setDailyNewCount(count) {
  const n = parseInt(count);
  if (isNaN(n) || n < 1 || n > 20) return false;
  const state = loadState();
  const bank = getActiveBank();
  if (typeof state.dailyNewCount !== "object" || state.dailyNewCount === null) {
    state.dailyNewCount = { accounting: DEFAULT_DAILY_NEW, english: DEFAULT_DAILY_NEW };
  }
  state.dailyNewCount[bank] = n;
  state.todayNewAssigned[bank] = null; // force reassign for this bank
  saveState(state);

  // 触发云端同步
  if (typeof SyncManager !== "undefined") {
    SyncManager.schedulePush();
  }

  return true;
}

// ---- 模拟日期 ----
function setDebugDate(dateStr) {
  const state = loadState();
  if (dateStr) {
    state.debugDate = dateStr;
    state.todayNewAssigned = {}; // force reassign on date change (all banks)
    state.manuallyAddedToday = {};
  } else {
    state.debugDate = null;
    state.todayNewAssigned = {};
    state.manuallyAddedToday = {};
  }
  saveState(state);
}

// ---- 统计 ----
function getStats() {
  const state = loadState();
  const learned = Object.keys(state.completionHistory).filter(
    (id) => state.completionHistory[id] && state.completionHistory[id].length > 0
  ).length;
  const mastered = Object.keys(state.completionHistory).filter(
    (id) => state.completionHistory[id] && state.completionHistory[id].length > INTERVALS.length
  ).length;
  return {
    total: getActiveQuestions().length,
    learned,
    mastered,
    streak: state.streak || 0,
    dailyNewCount: getDailyNewCount(state),
    debugDate: state.debugDate || null,
  };
}

function getQuestionStatus(questionId) {
  const state = loadState();
  const hist = state.completionHistory[questionId];
  if (!hist || hist.length === 0) return "unlearned";
  if (hist.length > INTERVALS.length) return "done";
  return "learning";
}

// ---- 渲染 ----
function renderAll() {
  renderBankSwitcher();
  renderDailyTab();
  renderBrowseTab();
  renderStatsTab();
  updateHeader();
}

// --- Bank Switcher ---
function renderBankSwitcher() {
  const container = document.getElementById("bankSwitcher");
  if (!container) return;

  const active = getActiveBank();
  let html = "";
  for (const [key, bank] of Object.entries(QUESTIONS_BANKS)) {
    if (bank.questions.length === 0) continue; // hide empty banks
    const activeClass = key === active ? " active" : "";
    html += `<button class="bank-btn${activeClass}" data-bank="${key}">${bank.icon} ${bank.label}</button>`;
  }
  container.innerHTML = html;
}

function initBankSwitcher() {
  const container = document.getElementById("bankSwitcher");
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bank-btn");
    if (!btn) return;

    const bank = btn.dataset.bank;
    if (bank === getActiveBank()) return;

    setActiveBank(bank);
    // Clear browse filters when switching banks
    const searchInput = document.getElementById("searchInput");
    const statusFilter = document.getElementById("statusFilter");
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    renderAll();
  });

  renderBankSwitcher();
}

// --- Header ---
function updateHeader() {
  const stats = getStats();
  const today = getToday();
  const dateObj = new Date(today + "T00:00:00");
  const label = dateObj.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const simBadge = stats.debugDate
    ? ' <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:.75rem;">🧪 模拟</span>'
    : "";
  document.getElementById("streakBadge").textContent = `🔥 ${stats.streak} 天`;
  document.getElementById("dateLabel").innerHTML = label + simBadge;
}

// --- Daily Tab ---
function renderDailyTab() {
  const tasks = getDailyTasks();
  const state = loadState();
  const today = getToday();

  const allIds = [...tasks.newQuestions, ...tasks.reviewQuestions];
  const doneCount = allIds.filter((id) =>
    (state.completionHistory[id] || []).includes(today)
  ).length;
  const total = allIds.length;

  // Progress bar
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 100;
  document.getElementById("dailyProgress").style.width = pct + "%";
  document.getElementById("dailyProgressText").textContent =
    total > 0 ? `${doneCount}/${total}` : "无任务";

  // Settings
  const settingsEl = document.getElementById("dailySettings");
  if (settingsEl) {
    settingsEl.innerHTML = `
      <span class="setting-label">每日新题数：</span>
      <input type="number" id="dailyCountInput" class="count-input" value="${getDailyNewCount(state)}" min="1" max="20">
      <button id="applyCountBtn" class="btn-apply">应用</button>
      <span class="setting-hint">（修改后当日任务立即更新）</span>
    `;
  }

  // New questions
  const newContainer = document.getElementById("newQuestions");
  const newSection = document.getElementById("newSection");
  if (tasks.newQuestions.length === 0) {
    newSection.style.display = "none";
  } else {
    newSection.style.display = "block";
    newContainer.innerHTML = tasks.newQuestions
      .map((id) => renderQuestionCard(id, "new"))
      .join("");
  }

  // Review questions
  const reviewContainer = document.getElementById("reviewQuestions");
  const reviewSection = document.getElementById("reviewSection");
  if (tasks.reviewQuestions.length === 0) {
    reviewSection.style.display = "none";
  } else {
    reviewSection.style.display = "block";
    reviewContainer.innerHTML = tasks.reviewQuestions
      .map((id) => renderQuestionCard(id, "review"))
      .join("");
  }

  // All done
  const allDone = document.getElementById("allDone");
  if (total > 0 && doneCount === total) {
    allDone.classList.remove("hidden");
  } else {
    allDone.classList.add("hidden");
  }

  // Debug panel
  const debugInput = document.getElementById("debugDateInput");
  if (debugInput) {
    debugInput.value = today;
  }

  bindCardEvents();
  bindSettingsEvents();
}

function renderQuestionCard(id, type) {
  const q = getQuestion(id);
  if (!q) return "";

  const checked = isQuestionCompleteToday(id) ? "checked" : "";
  const isManual = type === "new" && isManuallyAdded(id);
  const tagClass = isManual ? "manual" : (type === "new" ? "new" : "review");
  const tagText = isManual ? "📌 手动" : (type === "new" ? "新题" : "复习");

  return `
    <div class="question-card" data-id="${id}">
      <div class="qc-header" data-action="expand">
        <input type="checkbox" class="qc-checkbox" data-id="${id}" ${checked}>
        <div class="qc-info">
          <div class="qc-title">#${q.id} ${escapeHtml(q.title)}</div>
          <div class="qc-meta">
            <span class="qc-tag ${tagClass}">${tagText}</span>
            ${q.keys ? `<span class="qc-tag" style="background:#fef3c7;color:#92400e;">关键点: ${escapeHtml(q.keys.substring(0, 40))}${q.keys.length > 40 ? "..." : ""}</span>` : ""}
          </div>
        </div>
        <span class="qc-expand">▼</span>
      </div>
      <div class="qc-body">
        <div class="qc-body-inner">
          ${q.keys ? `<div class="qc-keys" data-field="keys"><div class="qc-keys-label">🔑 关键点</div><div class="qc-keys-content">${escapeHtml(q.keys)}</div></div>` : ""}
          <div class="qc-answer"><div class="qc-answer-label">📝 参考答案</div><div class="qc-answer-content">${escapeHtml(q.answer)}</div></div>
          <div class="qc-edit-bar">
            <button class="btn-edit" data-action="editStart">✏️ 编辑</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindCardEvents() {
  document.querySelectorAll(".qc-header").forEach((header) => {
    header.addEventListener("click", function (e) {
      if (e.target.classList.contains("qc-checkbox")) return;
      if (e.target.closest("button[data-action]")) return;
      const card = this.closest(".question-card");
      const body = card.querySelector(".qc-body");
      const arrow = this.querySelector(".qc-expand");
      body.classList.toggle("open");
      if (arrow) arrow.classList.toggle("open");
    });
  });

  document.querySelectorAll(".qc-checkbox").forEach((cb) => {
    cb.addEventListener("change", function () {
      const id = parseInt(this.dataset.id);
      toggleComplete(id);
      renderAll();
    });
  });

  // Edit buttons
  document.querySelectorAll("[data-action='editStart']").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const card = this.closest(".question-card");
      const id = parseInt(card.dataset.id);
      const q = getQuestion(id);
      if (!q) return;

      const body = card.querySelector(".qc-body-inner");
      const keysEl = body.querySelector(".qc-keys-content");
      const answerEl = body.querySelector(".qc-answer-content");
      const editBar = body.querySelector(".qc-edit-bar");

      // Store original for cancel
      const origKeys = q.keys;
      const origAnswer = q.answer;

      // Replace content divs with textareas
      let editHtml = "";
      if (keysEl) {
        editHtml += `<div class="qc-keys"><div class="qc-keys-label">🔑 关键点</div><textarea class="edit-textarea" data-field="keys" rows="4">${escapeHtml(origKeys)}</textarea></div>`;
      }
      editHtml += `<div class="qc-answer"><div class="qc-answer-label">📝 参考答案</div><textarea class="edit-textarea" data-field="answer" rows="8">${escapeHtml(origAnswer)}</textarea></div>`;

      // Save original HTML for cancel
      const origHtml = body.innerHTML;

      body.innerHTML = editHtml;
      editBar.innerHTML = `
        <button class="btn-edit-save" data-action="editSave">💾 保存</button>
        <button class="btn-edit-cancel" data-action="editCancel">取消</button>
      `;

      // Save handler
      body.querySelector("[data-action='editSave']").addEventListener("click", function (ev) {
        ev.stopPropagation();
        const fields = {};
        body.querySelectorAll(".edit-textarea").forEach((ta) => {
          fields[ta.dataset.field] = ta.value.trim();
        });
        saveQuestionEdit(id, fields);
        renderAll();
      });

      // Cancel handler
      body.querySelector("[data-action='editCancel']").addEventListener("click", function (ev) {
        ev.stopPropagation();
        renderAll();
      });
    });
  });
}

function bindSettingsEvents() {
  const btn = document.getElementById("applyCountBtn");
  const input = document.getElementById("dailyCountInput");
  if (btn && input) {
    btn.addEventListener("click", () => {
      const val = parseInt(input.value);
      if (isNaN(val) || val < 1 || val > 20) {
        alert("请输入 1-20 之间的数字");
        input.value = getDailyNewCount();
        return;
      }
      if (setDailyNewCount(val)) {
        renderAll();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });
  }
}

// --- Browse Tab ---
function renderBrowseTab(filter = "all", search = "") {
  const container = document.getElementById("browseList");
  let filtered = [...getActiveQuestions()];

  if (filter !== "all") {
    filtered = filtered.filter((q) => getQuestionStatus(q.id) === filter);
  }

  if (search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (q) =>
        q.title.toLowerCase().includes(s) ||
        q.keys.toLowerCase().includes(s) ||
        q.answer.toLowerCase().includes(s)
    );
  }

  container.innerHTML = filtered
    .map((q) => {
      const eq = getQuestion(q.id);
      const status = getQuestionStatus(q.id);
      const statusLabels = {
        unlearned: '<span class="qc-tag" style="background:#e2e8f0;color:#64748b;">未学习</span>',
        learning: '<span class="qc-tag new">学习中</span>',
        done: '<span class="qc-tag done">已掌握</span>',
      };
      const added = isManuallyAdded(q.id);
      const btnLabel = added ? "✓ 已加入" : "＋ 加入今日";
      const btnClass = added ? "add-today-btn added" : "add-today-btn";
      return `
        <div class="question-card" data-id="${q.id}">
          <div class="qc-header" data-action="expand">
            <div class="qc-info">
              <div class="qc-title">#${eq.id} ${escapeHtml(eq.title)}</div>
              <div class="qc-meta">
                ${statusLabels[status]}
                ${eq.keys ? `<span style="font-size:.75rem;color:var(--text-secondary);">${escapeHtml(eq.keys.substring(0, 50))}${eq.keys.length > 50 ? "..." : ""}</span>` : ""}
              </div>
            </div>
            <button class="${btnClass}" data-add-id="${eq.id}" data-action="addToday">${btnLabel}</button>
            <span class="qc-expand">▼</span>
          </div>
          <div class="qc-body">
            <div class="qc-body-inner">
              ${eq.keys ? `<div class="qc-keys"><div class="qc-keys-label">🔑 关键点</div><div class="qc-keys-content">${escapeHtml(eq.keys)}</div></div>` : ""}
              <div class="qc-answer"><div class="qc-answer-label">📝 参考答案</div><div class="qc-answer-content">${escapeHtml(eq.answer)}</div></div>
              <div class="qc-edit-bar">
                <button class="btn-edit" data-action="editStart">✏️ 编辑</button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("#browseList .qc-header").forEach((header) => {
    header.addEventListener("click", function (e) {
      // Don't expand card when clicking the add button
      if (e.target.closest("[data-action='addToday']")) return;
      const card = this.closest(".question-card");
      const body = card.querySelector(".qc-body");
      const arrow = this.querySelector(".qc-expand");
      body.classList.toggle("open");
      if (arrow) arrow.classList.toggle("open");
    });
  });

  document.querySelectorAll("#browseList [data-action='addToday']").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const id = parseInt(this.dataset.addId);
      if (isManuallyAdded(id)) {
        removeFromTodayTasks(id);
      } else {
        addToTodayTasks(id);
      }
    });
  });
}

// --- Stats Tab ---
function renderStatsTab() {
  const stats = getStats();
  document.getElementById("statTotal").textContent = stats.total;
  document.getElementById("statLearned").textContent = stats.learned;
  document.getElementById("statStreak").textContent = stats.streak;
  document.getElementById("statCompleted").textContent = stats.mastered;
  renderHeatmap();
}

function renderHeatmap() {
  const container = document.getElementById("heatmap");
  const state = loadState();
  const today = new Date(getToday() + "T00:00:00");

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  container.innerHTML = `
    <div class="heatmap-title">📅 最近 30 天学习记录</div>
    <div class="heatmap-grid">
      ${days
        .map((date) => {
          let count = 0;
          const hist = state.completionHistory || {};
          for (const id of Object.keys(hist)) {
            if (hist[id].includes(date)) count++;
          }

          let cls = "none";
          let label = "0题";
          if (count > 0) {
            label = `${count}题`;
            if (count <= 2) cls = "low";
            else if (count <= 5) cls = "med";
            else if (count <= 10) cls = "high";
            else cls = "complete";
          }

          const shortDate = date.slice(5);
          return `<div class="heatmap-cell ${cls}" data-tooltip="${date}: ${label}">${shortDate}</div>`;
        })
        .join("")}
    </div>
  `;
}

// ---- Utilities ----
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Tab Switching ----
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      this.classList.add("active");
      document.getElementById("tab-" + this.dataset.tab).classList.add("active");

      if (this.dataset.tab === "browse") renderBrowseTab();
      if (this.dataset.tab === "stats") renderStatsTab();
      if (this.dataset.tab === "daily") renderDailyTab();
    });
  });
}

// ---- Browse Filters ----
function initBrowseFilters() {
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");
  searchInput.addEventListener("input", () => {
    renderBrowseTab(statusFilter.value, searchInput.value);
  });
  statusFilter.addEventListener("change", () => {
    renderBrowseTab(statusFilter.value, searchInput.value);
  });
}

// ---- Export / Import / Copy ----
function exportData() {
  const state = loadState();
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    completionHistory: state.completionHistory,
    streak: state.streak,
    lastStreakDate: state.lastStreakDate,
    dailyNewCount: state.dailyNewCount,
    editedQuestions: state.editedQuestions,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `interview-prep-backup-${realToday()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.completionHistory) throw new Error("Invalid format");
    const state = loadState();
    state.completionHistory = data.completionHistory;
    state.streak = data.streak || 0;
    state.lastStreakDate = data.lastStreakDate || null;
    // dailyNewCount: handle both old (number) and new (object) formats
    if (data.dailyNewCount == null) {
      state.dailyNewCount = { accounting: DEFAULT_DAILY_NEW, english: DEFAULT_DAILY_NEW };
    } else if (typeof data.dailyNewCount === "number") {
      state.dailyNewCount = { accounting: data.dailyNewCount, english: DEFAULT_DAILY_NEW };
    } else {
      state.dailyNewCount = data.dailyNewCount;
    }
    state.editedQuestions = data.editedQuestions || {};
    // Reset date-dependent state so it recalculates
    state.todayNewAssigned = {};
    state.manuallyAddedToday = {};
    state.debugDate = null;
    saveState(state);
    return true;
  } catch (e) {
    return false;
  }
}

function copyToClipboard() {
  const state = loadState();
  const data = {
    version: 1,
    completionHistory: state.completionHistory,
    streak: state.streak,
    lastStreakDate: state.lastStreakDate,
    dailyNewCount: state.dailyNewCount,
    editedQuestions: state.editedQuestions,
  };
  const text = JSON.stringify(data);
  navigator.clipboard.writeText(text).then(
    () => alert("✅ 数据已复制到剪贴板！在另一台设备上使用「导入数据」或直接粘贴即可恢复。"),
    () => alert("❌ 复制失败，请尝试「导出数据」下载文件。")
  );
}

function pasteFromClipboard() {
  navigator.clipboard.readText().then((text) => {
    if (importData(text)) {
      alert("✅ 数据导入成功！");
      renderAll();
    } else {
      alert("❌ 剪贴板内容格式不正确，请检查。");
    }
  }).catch(() => {
    alert("❌ 无法读取剪贴板，请使用「导入数据」选择文件。");
  });
}

function initSyncButtons() {
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });
  document.getElementById("copyBtn").addEventListener("click", copyToClipboard);
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (importData(ev.target.result)) {
        alert("✅ 数据导入成功！");
        renderAll();
      } else {
        alert("❌ 文件格式不正确，请检查。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // Keyboard shortcut: Ctrl+Shift+V to paste
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "V") {
      e.preventDefault();
      pasteFromClipboard();
    }
  });
}

// ---- Reset ----
function initReset() {
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("确定要重置所有学习进度吗？此操作不可撤销！")) {
      localStorage.removeItem(STORAGE_KEY);
      renderAll();
    }
  });
}

// ---- Debug Date Panel ----
function initDebugPanel() {
  const applyBtn = document.getElementById("debugApplyBtn");
  const nextBtn = document.getElementById("debugNextBtn");
  const todayBtn = document.getElementById("debugTodayBtn");
  const input = document.getElementById("debugDateInput");

  if (applyBtn && input) {
    applyBtn.addEventListener("click", () => {
      const val = input.value;
      if (!val) return;
      setDebugDate(val);
      renderAll();
    });
  }

  if (nextBtn && input) {
    nextBtn.addEventListener("click", () => {
      const current = input.value || getToday();
      const d = new Date(current + "T00:00:00");
      d.setDate(d.getDate() + 1);
      const next = d.toISOString().split("T")[0];
      input.value = next;
      setDebugDate(next);
      renderAll();
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      setDebugDate(null);
      renderAll();
    });
  }
}

// ---- Init ----
async function init() {
  // Populate question banks
  if (typeof QUESTIONS === "undefined") {
    document.body.innerHTML =
      '<div style="text-align:center;padding:40px;">❌ 题库加载失败，请确保 questions.js 文件存在</div>';
    return;
  }
  QUESTIONS_BANKS.accounting.questions = QUESTIONS;
  if (typeof QUESTIONS_ENGLISH !== "undefined") {
    QUESTIONS_BANKS.english.questions = QUESTIONS_ENGLISH;
  }

  initBankSwitcher();
  initTabs();
  initBrowseFilters();
  initReset();
  initSyncButtons();
  initDebugPanel();

  // 初始化登录面板
  if (typeof initLoginPanel !== "undefined") {
    initLoginPanel();
  }

  // 尝试恢复云端会话并同步数据
  if (typeof SyncManager !== "undefined") {
    const dataChanged = await SyncManager.init();
    if (dataChanged) {
      // 云端数据已合并到本地，需要重新渲染
      renderAll();
      return;
    }
  }

  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
