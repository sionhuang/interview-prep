// 面试题库记忆助手 — Supabase 云同步模块
// ============================================

// ---- 配置（替换为你的 Supabase 项目信息） ----
// 在 https://supabase.com 创建项目后，在 Settings → API 中找到这两个值
const SUPABASE_URL = "https://moisdtddekzsghdiichl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vaXNkdGRkZWt6c2doZGlpY2hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjcyNTIsImV4cCI6MjA5Nzk0MzI1Mn0.Tja3QuwwieJhOHgTQQ_n22gKW4Usoq3YtugFGPr6Om4";

// ---- Supabase 客户端 ----
let supabase = null;

function getSupabase() {
  if (supabase) return supabase;
  if (typeof window.supabase !== "undefined" && window.supabase.createClient) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabase;
  }
  return null;
}

function isSyncAvailable() {
  return getSupabase() !== null;
}

// ---- 认证 ----
async function syncSignUp(email, password) {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase SDK 未加载" };
  const { data, error } = await sb.auth.signUp({ email, password });
  return { data, error };
}

async function syncSignIn(email, password) {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase SDK 未加载" };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (!error && data.session) {
    saveSession(data.session);
  }
  return { data, error };
}

async function syncSignOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  clearSession();
}

async function syncRestoreSession() {
  const sb = getSupabase();
  if (!sb) return null;

  const saved = loadSession();
  if (!saved) return null;

  // 尝试验证并恢复会话
  try {
    // 先尝试用 refresh token 恢复
    if (saved.refresh_token) {
      const { data, error } = await sb.auth.refreshSession({
        refresh_token: saved.refresh_token,
      });
      if (!error && data.session) {
        saveSession(data.session);
        return data.session;
      }
    }
  } catch (e) {
    /* refresh failed, session expired */
  }
  clearSession();
  return null;
}

function saveSession(session) {
  try {
    localStorage.setItem(
      "interview_prep_session",
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
      })
    );
  } catch (e) {
    /* ignore */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem("interview_prep_session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem("interview_prep_session");
}

function getSyncUser() {
  const session = loadSession();
  return session?.user || null;
}

function isSyncLoggedIn() {
  return !!loadSession()?.user;
}

// ---- 云端数据拉取 ----
async function syncPull() {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase SDK 未加载" };

  const user = getSyncUser();
  if (!user) return { error: "未登录" };

  // 查询该用户在 user_data 表中的数据
  const { data, error } = await sb
    .from("user_data")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return { error };

  if (!data) return { data: null }; // 新用户，还没有云端数据

  return {
    data: {
      completionHistory: data.completion_history || {},
      streak: data.streak || 0,
      lastStreakDate: data.last_streak_date || null,
      dailyNewCount: data.daily_new_count || 5,
      updatedAt: data.updated_at,
    },
  };
}

// ---- 云端数据推送 ----
async function syncPush(localState) {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase SDK 未加载" };

  const user = getSyncUser();
  if (!user) return { error: "未登录" };

  const payload = {
    user_id: user.id,
    completion_history: localState.completionHistory || {},
    streak: localState.streak || 0,
    last_streak_date: localState.lastStreakDate || null,
    daily_new_count: localState.dailyNewCount || 5,
    updated_at: new Date().toISOString(),
  };

  // Upsert：有则更新，无则插入（以 user_id 为冲突键）
  const { data, error } = await sb
    .from("user_data")
    .upsert(payload, { onConflict: "user_id" });

  if (!error) {
    saveSyncMeta({ lastPushedAt: new Date().toISOString() });
  }
  return { data, error };
}

// ---- 同步元数据（本地） ----
function getSyncMeta() {
  try {
    const raw = localStorage.getItem("interview_prep_sync_meta");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSyncMeta(meta) {
  try {
    const existing = getSyncMeta();
    const merged = { ...existing, ...meta };
    localStorage.setItem("interview_prep_sync_meta", JSON.stringify(merged));
  } catch (e) {
    /* ignore */
  }
}

// ---- 合并策略 ----
// 将本地和云端数据合并，返回合并后的 state 字段
function mergeData(localState, cloudData) {
  if (!cloudData) return localState; // 云端无数据，保持本地

  const mergedHistory = {};

  // 遍历本地完成记录
  const localHist = localState.completionHistory || {};
  const cloudHist = cloudData.completionHistory || {};

  // 收集所有题目 ID
  const allIds = new Set([
    ...Object.keys(localHist),
    ...Object.keys(cloudHist),
  ]);

  // 对每个题目，取本地和云端完成日期的并集
  for (const id of allIds) {
    const localDates = localHist[id] || [];
    const cloudDates = cloudHist[id] || [];
    // 并集 + 去重 + 排序
    const merged = [...new Set([...localDates, ...cloudDates])].sort();
    mergedHistory[id] = merged;
  }

  return {
    completionHistory: mergedHistory,
    // 连续天数取较大值
    streak: Math.max(localState.streak || 0, cloudData.streak || 0),
    // 最后打卡日期取较新
    lastStreakDate:
      (localState.lastStreakDate || "") > (cloudData.lastStreakDate || "")
        ? localState.lastStreakDate
        : cloudData.lastStreakDate,
    // 每日新题数云端优先
    dailyNewCount: cloudData.dailyNewCount || localState.dailyNewCount || 5,
  };
}

// ---- 同步管理器（防抖 + 状态跟踪） ----
const SyncManager = {
  _pending: false, // 是否有待推送的数据
  _timer: null, // 防抖计时器
  _syncing: false, // 是否正在同步中
  _pushVersion: 0, // 递增版本号，用于追踪最新请求

  // 调度一次推送（防抖 2 秒）
  schedulePush() {
    if (!isSyncLoggedIn()) return;
    this._pending = true;
    this._pushVersion++;

    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._doPush(this._pushVersion);
    }, 2000);
  },

  // 立即推送（跳过防抖）
  async pushNow() {
    if (!isSyncLoggedIn()) return { error: "未登录" };
    if (this._timer) clearTimeout(this._timer);
    return await this._doPush(this._pushVersion + 1);
  },

  async _doPush(version) {
    if (this._syncing) {
      // 正在同步中，稍后再试
      this._timer = setTimeout(() => this._doPush(version), 1000);
      return;
    }

    this._syncing = true;
    this._pending = false;

    try {
      // 先从云端拉取最新数据
      const pullResult = await syncPull();
      if (pullResult.error) {
        // 拉取失败不阻止推送，使用本地数据
        console.warn("Pull before push failed:", pullResult.error);
      }

      // 如果有云端数据，先合并再推送
      let localState = loadState();
      if (pullResult.data) {
        const merged = mergeData(localState, pullResult.data);
        // 用合并后的数据更新本地
        localState.completionHistory = merged.completionHistory;
        localState.streak = merged.streak;
        localState.lastStreakDate = merged.lastStreakDate;
        localState.dailyNewCount = merged.dailyNewCount;
        saveState(localState);
      }

      // 推送本地数据到云端
      const pushResult = await syncPush(localState);
      if (!pushResult.error) {
        console.log("✅ 云端同步成功");
        updateSyncIndicator("synced");
      } else {
        console.error("推送失败:", pushResult.error);
        updateSyncIndicator("error");
      }
    } catch (e) {
      console.error("同步异常:", e);
      updateSyncIndicator("error");
    } finally {
      this._syncing = false;
      // 如果在同步期间又有新变更，安排下一次推送
      if (this._pending) {
        this.schedulePush();
      }
    }
  },

  // 初始化同步：恢复会话 → 拉取云端数据 → 合并
  async init() {
    if (!isSyncAvailable()) {
      updateSyncIndicator("offline");
      return;
    }

    updateSyncIndicator("syncing");

    // 尝试恢复之前的登录会话
    const session = await syncRestoreSession();
    if (session) {
      updateSyncIndicator("syncing");
      // 拉取云端数据并合并
      const pullResult = await syncPull();
      if (!pullResult.error && pullResult.data) {
        const localState = loadState();
        const merged = mergeData(localState, pullResult.data);
        localState.completionHistory = merged.completionHistory;
        localState.streak = merged.streak;
        localState.lastStreakDate = merged.lastStreakDate;
        localState.dailyNewCount = merged.dailyNewCount;
        localState.todayNewAssigned = null; // 重新计算当日任务
        saveState(localState);
        saveSyncMeta({ lastPulledAt: new Date().toISOString() });
        console.log("✅ 已从云端恢复数据");
        updateSyncIndicator("synced");
        return true; // 返回 true 表示数据已更新，需要重新渲染
      } else {
        // 已登录但云端无数据，推送本地数据上去
        const localState = loadState();
        await syncPush(localState);
        updateSyncIndicator("synced");
        return false;
      }
    } else {
      updateSyncIndicator("logged-out");
      return false;
    }
  },
};

// ---- UI: 同步状态指示灯 ----
function updateSyncIndicator(state) {
  const el = document.getElementById("syncIndicator");
  if (!el) return;

  const user = getSyncUser();
  const email = user?.email || "";

  switch (state) {
    case "synced":
      el.className = "sync-indicator synced";
      el.title = `已同步${email ? " — " + email : ""}`;
      el.innerHTML = `<span class="sync-dot"></span>${email ? email.split("@")[0] : "已同步"}`;
      break;
    case "syncing":
      el.className = "sync-indicator syncing";
      el.innerHTML = `<span class="sync-dot"></span>同步中...`;
      break;
    case "error":
      el.className = "sync-indicator error";
      el.innerHTML = `<span class="sync-dot"></span>同步失败`;
      break;
    case "logged-out":
      el.className = "sync-indicator logged-out";
      el.innerHTML = `<span class="sync-dot"></span>未登录`;
      el.title = "点击登录 / 注册";
      break;
    case "offline":
      el.className = "sync-indicator offline";
      el.innerHTML = `<span class="sync-dot"></span>离线模式`;
      el.title = "Supabase SDK 未加载";
      break;
  }
}

// ---- UI: 登录面板 ----
function initLoginPanel() {
  const indicator = document.getElementById("syncIndicator");
  const panel = document.getElementById("loginPanel");
  const overlay = document.getElementById("loginOverlay");

  if (!indicator || !panel || !overlay) return;

  // 点击指示灯 → 打开面板
  indicator.addEventListener("click", () => {
    renderLoginForm();
    panel.classList.add("open");
    overlay.classList.add("open");
  });

  // 点击遮罩 → 关闭面板
  overlay.addEventListener("click", closeLoginPanel);

  // ESC 关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLoginPanel();
  });
}

function closeLoginPanel() {
  document.getElementById("loginPanel").classList.remove("open");
  document.getElementById("loginOverlay").classList.remove("open");
}

function renderLoginForm(errorMsg = "") {
  const panel = document.getElementById("loginPanel");
  if (!panel) return;

  const loggedIn = isSyncLoggedIn();
  const user = getSyncUser();

  if (loggedIn && user) {
    panel.innerHTML = `
      <div class="login-header">☁️ 云同步</div>
      <div class="login-status">
        <span class="login-status-dot online"></span>
        已登录：<strong>${escapeHtml(user.email)}</strong>
      </div>
      <div class="login-actions">
        <button class="btn-login-row" id="btnForceSync">🔄 强制同步</button>
        <button class="btn-login-row btn-danger" id="btnLogout">🚪 退出登录</button>
      </div>
      <div class="login-hint">
        勾选题目后自动同步到云端。<br>
        其他设备打开网页并登录同一账号后自动拉取。
      </div>
    `;

    document.getElementById("btnForceSync").addEventListener("click", async () => {
      updateSyncIndicator("syncing");
      // 先拉后推
      const pullResult = await syncPull();
      if (!pullResult.error && pullResult.data) {
        const localState = loadState();
        const merged = mergeData(localState, pullResult.data);
        localState.completionHistory = merged.completionHistory;
        localState.streak = merged.streak;
        localState.lastStreakDate = merged.lastStreakDate;
        localState.dailyNewCount = merged.dailyNewCount;
        localState.todayNewAssigned = null;
        saveState(localState);
      }
      await SyncManager.pushNow();
      if (typeof renderAll !== "undefined") renderAll();
      renderLoginForm();
      updateSyncIndicator("synced");
    });

    document.getElementById("btnLogout").addEventListener("click", async () => {
      await syncSignOut();
      updateSyncIndicator("logged-out");
      renderLoginForm();
    });
  } else {
    panel.innerHTML = `
      <div class="login-header">☁️ 云同步登录</div>
      ${errorMsg ? `<div class="login-error">${escapeHtml(errorMsg)}</div>` : ""}
      <div class="login-form">
        <input type="email" id="loginEmail" placeholder="邮箱地址" class="login-input" autocomplete="email">
        <input type="password" id="loginPassword" placeholder="密码（至少6位）" class="login-input" autocomplete="current-password">
        <div class="login-actions">
          <button class="btn-login-row btn-primary" id="btnLogin">登录</button>
          <button class="btn-login-row" id="btnRegister">注册</button>
        </div>
      </div>
      <div class="login-hint">
        首次使用请先点「注册」创建账号。<br>
        在不同设备上用同一账号登录即可自动同步进度。
      </div>
    `;

    const doLogin = async () => {
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!email || !password) {
        renderLoginForm("请输入邮箱和密码");
        return;
      }
      if (password.length < 6) {
        renderLoginForm("密码至少需要6位");
        return;
      }

      updateSyncIndicator("syncing");
      const { error } = await syncSignIn(email, password);
      if (error) {
        renderLoginForm("登录失败：" + (error.message || "未知错误"));
        updateSyncIndicator("logged-out");
      } else {
        // 拉取云端数据
        const pullResult = await syncPull();
        if (!pullResult.error && pullResult.data) {
          const localState = loadState();
          const merged = mergeData(localState, pullResult.data);
          localState.completionHistory = merged.completionHistory;
          localState.streak = merged.streak;
          localState.lastStreakDate = merged.lastStreakDate;
          localState.dailyNewCount = merged.dailyNewCount;
          localState.todayNewAssigned = null;
          saveState(localState);
          saveSyncMeta({ lastPulledAt: new Date().toISOString() });
        } else {
          // 云端无数据，推送本地
          await syncPush(loadState());
        }
        if (typeof renderAll !== "undefined") renderAll();
        updateSyncIndicator("synced");
        renderLoginForm();
      }
    };

    const doRegister = async () => {
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!email || !password) {
        renderLoginForm("请输入邮箱和密码");
        return;
      }
      if (password.length < 6) {
        renderLoginForm("密码至少需要6位");
        return;
      }

      updateSyncIndicator("syncing");
      const { error } = await syncSignUp(email, password);
      if (error) {
        renderLoginForm("注册失败：" + (error.message || "未知错误"));
        updateSyncIndicator("logged-out");
      } else {
        // 注册成功后自动登录
        const { error: signInError } = await syncSignIn(email, password);
        if (!signInError) {
          // 推送本地数据到云端
          await syncPush(loadState());
          if (typeof renderAll !== "undefined") renderAll();
          updateSyncIndicator("synced");
          renderLoginForm();
        } else {
          renderLoginForm("注册成功！请点击「登录」按钮。");
          updateSyncIndicator("logged-out");
        }
      }
    };

    document.getElementById("btnLogin").addEventListener("click", doLogin);
    document.getElementById("btnRegister").addEventListener("click", doRegister);

    // 回车登录
    document.getElementById("loginPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  }
}
