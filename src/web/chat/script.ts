export const WEB_CHAT_APP_SCRIPT = String.raw`
(function () {
  var MAX_PENDING_FILE_BYTES = 30 * 1024 * 1024;
  var REFERENCE_KIND_ORDER = {
    plugin: 0,
    skill: 1,
    app: 2,
    file: 3,
    directory: 4
  };
  var fileDragDepth = 0;
  var composerIsComposing = false;
  var composerCompositionEndedAt = 0;
  var state = {
    user: null,
    csrfToken: "",
    models: [],
    sessions: [],
    currentSession: null,
    messages: [],
    traces: [],
    commands: [],
    capabilities: [],
    selectedReferences: [],
    pendingFiles: [],
    eventSource: null,
    streamText: new Map(),
    activities: new Map(),
    expandedTraceIds: new Set(),
    notices: [],
    contextSessionId: null,
    renamingSessionId: null,
    sessionSelectionMode: false,
    selectedSessionIds: new Set(),
    deletingSessions: false,
    longPressTimer: null,
    suppressSessionClick: false,
    paletteItems: [],
    paletteIndex: 0,
    activePalette: "",
    referenceFromAdd: false,
    referenceSearchTimer: null,
    referenceSearchSequence: 0,
    commandMode: null,
    runtimeSection: "root",
    traceRefreshTimer: null,
    accountSettings: null,
    accountSettingsTab: "model",
    savingAccountSettings: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function resetAuthenticationState() {
    state.eventSource?.close();
    state.eventSource = null;
    state.user = null;
    state.csrfToken = "";
    state.sessions = [];
    state.currentSession = null;
    state.messages = [];
    state.traces = [];
    state.commands = [];
    state.capabilities = [];
    state.selectedReferences = [];
    state.pendingFiles = [];
    state.notices = [];
    state.sessionSelectionMode = false;
    state.selectedSessionIds.clear();
    state.deletingSessions = false;
    state.accountSettings = null;
    state.accountSettingsTab = "model";
    state.savingAccountSettings = false;
    state.streamText.clear();
    state.activities.clear();
    state.expandedTraceIds.clear();
    closeSessionContextMenu();
    closeComposerPopovers();
    byId("currentUserName").textContent = "";
    byId("sessionList").replaceChildren();
    byId("messageList").replaceChildren();
    byId("pendingFiles").replaceChildren();
    byId("selectedReferences").replaceChildren();
    if (byId("accountDialog").open) byId("accountDialog").close();
    resetFileDropState();
    switchAuthMode("login");
    setAuthenticated(false);
  }

  async function api(path, options, csrfRetried) {
    var requestOptions = Object.assign({}, options || {});
    requestOptions.headers = new Headers(requestOptions.headers || {});
    if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
      requestOptions.headers.set("content-type", "application/json");
      requestOptions.body = JSON.stringify(requestOptions.body);
    }
    if (requestOptions.method && requestOptions.method !== "GET") {
      requestOptions.headers.set("x-csrf-token", state.csrfToken);
    }
    var response = await fetch(path, requestOptions);
    var contentType = response.headers.get("content-type") || "";
    var body = contentType.includes("application/json") ? await response.json() : null;
    if (
      response.status === 403 && body && body.error === "CSRF 校验失败。"
      && csrfRetried !== true
    ) {
      var sameUser = await refreshCsrfIdentity();
      if (sameUser) return api(path, options, true);
      var changedUserError = new Error("登录账户已变化，请重试当前操作。");
      changedUserError.status = 409;
      throw changedUserError;
    }
    if (response.status === 401) resetAuthenticationState();
    if (!response.ok) {
      var error = new Error(body && body.error ? body.error : "请求失败（" + response.status + "）");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function refreshCsrfIdentity() {
    var previousUserId = state.user && state.user.id;
    var response = await fetch("/api/chat/me");
    var contentType = response.headers.get("content-type") || "";
    var body = contentType.includes("application/json") ? await response.json() : null;
    if (response.status === 401) resetAuthenticationState();
    if (!response.ok) {
      var error = new Error(body && body.error ? body.error : "登录状态已失效，请重新登录。");
      error.status = response.status;
      throw error;
    }
    acceptIdentity(body);
    if (previousUserId && previousUserId !== body.user.id) {
      await loadInitialData();
      return false;
    }
    return true;
  }

  function showError(error) {
    var toast = byId("errorToast");
    toast.textContent = error instanceof Error ? error.message : String(error);
    toast.hidden = false;
    clearTimeout(showError.timer);
    showError.timer = setTimeout(function () {
      toast.hidden = true;
    }, 5000);
  }

  function showNotice(message, data) {
    var text = message || "操作完成。";
    if (data !== undefined) {
      try {
        text += "\n" + JSON.stringify(data, null, 2);
      } catch (_) {}
    }
    state.notices.push({
      id: "notice-" + Date.now() + "-" + Math.random(),
      text: text,
      createdAt: new Date().toISOString()
    });
    if (state.notices.length > 3) state.notices.shift();
    renderMessages();
  }

  function setAuthenticated(authenticated) {
    byId("loginView").hidden = authenticated;
    byId("chatApp").hidden = !authenticated;
  }

  async function bootstrap() {
    applyTheme(localStorage.getItem("codex-gateway-theme") || "system");
    bindEvents();
    var serverBootstrap = readServerBootstrap();
    try {
      if (serverBootstrap) {
        restoreServerBootstrap(serverBootstrap);
      } else {
        await restoreAuthenticatedPage();
      }
    } catch (error) {
      showError(error);
    } finally {
      document.documentElement.removeAttribute("data-chat-bootstrap");
    }
  }

  function readServerBootstrap() {
    var element = byId("webChatBootstrap");
    if (!element) return null;
    var source = element.textContent || "";
    element.remove();
    try {
      var data = JSON.parse(source);
      return data && data.version === 1 ? data : null;
    } catch (_error) {
      return null;
    }
  }

  function restoreServerBootstrap(data) {
    acceptIdentity(data.identity);
    state.models = Array.isArray(data.models) ? data.models : [];
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    state.currentSession = data.current ? data.current.session : null;
    state.messages =
      data.current && data.current.messages
        ? data.current.messages.messages || []
        : [];
    state.traces =
      data.current && Array.isArray(data.current.traces)
        ? data.current.traces
        : [];
    state.capabilities =
      data.current && Array.isArray(data.current.capabilities)
        ? data.current.capabilities
        : [];
    state.commands = Array.isArray(data.commands) ? data.commands : [];
    state.selectedReferences = [];
    state.notices = [];
    state.streamText.clear();
    state.activities.clear();
    renderSessions();
    renderCurrentSession();
    connectEvents();
  }

  async function restoreAuthenticatedPage() {
    var me;
    try {
      me = await api("/api/chat/me");
    } catch (error) {
      if (error.status !== 401) showError(error);
      return;
    }
    acceptIdentity(me);
    await loadInitialData().catch(showError);
  }

  function acceptIdentity(data) {
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    byId("currentUserName").textContent = data.user.username;
    setAuthenticated(true);
  }

  async function loadInitialData() {
    var results = await Promise.all([
      api("/api/chat/models"),
      api("/api/chat/sessions")
    ]);
    state.models = results[0].models || [];
    state.sessions = results[1].sessions || [];
    renderSessions();
    connectEvents();
    if (state.sessions.length) {
      await openSession(state.sessions[0].id);
    } else {
      await createSession();
    }
  }

  async function login(event) {
    event.preventDefault();
    var submit = byId("loginButton");
    submit.disabled = true;
    byId("loginError").textContent = "";
    try {
      var response = await fetch("/api/chat/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: byId("usernameInput").value,
          password: byId("passwordInput").value
        })
      });
      var body = await response.json();
      if (!response.ok) throw new Error(body.error || "登录失败");
      acceptIdentity(body);
      byId("passwordInput").value = "";
      await loadInitialData().catch(showError);
    } catch (error) {
      byId("loginError").textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  }

  function switchAuthMode(mode) {
    var registerForm = byId("registerForm");
    if (!registerForm) return;
    var loginMode = mode !== "register";
    byId("loginForm").hidden = !loginMode;
    registerForm.hidden = loginMode;
    byId("authLoginTab").classList.toggle("active", loginMode);
    byId("authRegisterTab").classList.toggle("active", !loginMode);
    byId("authLoginTab").setAttribute("aria-selected", String(loginMode));
    byId("authRegisterTab").setAttribute("aria-selected", String(!loginMode));
    byId("loginError").textContent = "";
    byId("registerError").textContent = "";
  }

  async function register(event) {
    event.preventDefault();
    var submit = byId("registerButton");
    var password = byId("registerPasswordInput").value;
    var confirmation = byId("registerConfirmPasswordInput").value;
    byId("registerError").textContent = "";
    if (password !== confirmation) {
      byId("registerError").textContent = "密码输入不一致。";
      return;
    }
    submit.disabled = true;
    try {
      var response = await fetch("/api/chat/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: byId("registerUsernameInput").value,
          password: password
        })
      });
      var body = await response.json();
      if (!response.ok) throw new Error(body.error || "注册失败");
      acceptIdentity(body);
      byId("registerPasswordInput").value = "";
      byId("registerConfirmPasswordInput").value = "";
      await loadInitialData().catch(showError);
    } catch (error) {
      byId("registerError").textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  }

  async function logout() {
    try {
      await api("/api/chat/auth/logout", { method: "POST" });
    } catch (_) {}
    resetAuthenticationState();
  }

  async function loadSessions() {
    var data = await api("/api/chat/sessions");
    state.sessions = data.sessions || [];
    var availableIds = new Set(state.sessions.map(function (session) { return session.id; }));
    state.selectedSessionIds = new Set(
      Array.from(state.selectedSessionIds).filter(function (sessionId) {
        return availableIds.has(sessionId);
      })
    );
    renderSessions();
  }

  function renderSessions() {
    var list = byId("sessionList");
    var fragment = document.createDocumentFragment();
    updateSessionSelectionToolbar();
    if (!state.sessions.length) {
      var empty = document.createElement("div");
      empty.className = "empty-chat";
      empty.textContent = "暂无对话";
      fragment.append(empty);
    }
    state.sessions.forEach(function (session) {
      var item = document.createElement("div");
      var selecting = state.sessionSelectionMode;
      var selected = state.selectedSessionIds.has(session.id);
      item.className = "session-item"
        + (state.currentSession && state.currentSession.id === session.id ? " active" : "")
        + (selecting ? " selecting" : "")
        + (selected ? " selected" : "");
      item.dataset.sessionId = session.id;
      item.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        if (state.sessionSelectionMode) return;
        openSessionContextMenu(session.id, event.clientX, event.clientY);
      });
      item.addEventListener("pointerdown", function (event) {
        if (state.sessionSelectionMode) return;
        startSessionLongPress(event, session);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
        item.addEventListener(type, cancelSessionLongPress);
      });

      if (state.renamingSessionId === session.id) {
        var input = document.createElement("input");
        input.className = "session-rename-input";
        input.value = session.title;
        input.maxLength = 100;
        input.setAttribute("aria-label", "重命名对话");
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            commitSessionRename(session.id, input.value).catch(showError);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            state.renamingSessionId = null;
            renderSessions();
          }
        });
        input.addEventListener("blur", function () {
          if (state.renamingSessionId === session.id) {
            commitSessionRename(session.id, input.value).catch(showError);
          }
        });
        item.append(input);
        requestAnimationFrame(function () {
          input.focus();
          input.select();
        });
      } else {
        if (selecting) {
          var selectBox = document.createElement("input");
          selectBox.type = "checkbox";
          selectBox.className = "session-select-box";
          selectBox.checked = selected;
          selectBox.setAttribute("aria-label", "选择“" + session.title + "”");
          selectBox.addEventListener("change", function () {
            toggleSessionSelection(session.id);
          });
          item.append(selectBox);
        }
        var open = document.createElement("button");
        open.type = "button";
        open.className = "session-open";
        open.addEventListener("click", function () {
          if (state.sessionSelectionMode) {
            toggleSessionSelection(session.id);
            return;
          }
          if (state.suppressSessionClick) {
            state.suppressSessionClick = false;
            return;
          }
          openSession(session.id).catch(showError);
        });
        var title = document.createElement("span");
        title.className = "session-title";
        title.textContent = session.title;
        var dot = document.createElement("span");
        dot.className = "status-dot" + (session.running ? " running" : "");
        var time = document.createElement("span");
        time.className = "session-time";
        time.textContent = formatTime(session.updatedAt);
        open.append(title, dot, time);

        item.append(open);
        if (!selecting) {
          var more = document.createElement("button");
          more.type = "button";
          more.className = "session-more";
          more.title = "对话操作";
          more.setAttribute("aria-label", "对话操作");
          more.append(byId("sessionMoreIconTemplate").content.cloneNode(true));
          more.addEventListener("click", function (event) {
            event.stopPropagation();
            var rect = more.getBoundingClientRect();
            openSessionContextMenu(session.id, rect.right, rect.bottom);
          });
          item.append(more);
        }
      }
      fragment.append(item);
    });
    list.replaceChildren(fragment);
  }

  function enterSessionSelection() {
    closeSessionContextMenu();
    state.renamingSessionId = null;
    state.sessionSelectionMode = true;
    state.selectedSessionIds.clear();
    renderSessions();
  }

  function exitSessionSelection() {
    state.sessionSelectionMode = false;
    state.selectedSessionIds.clear();
    state.deletingSessions = false;
    renderSessions();
  }

  function toggleSessionSelection(sessionId) {
    if (state.selectedSessionIds.has(sessionId)) {
      state.selectedSessionIds.delete(sessionId);
    } else {
      state.selectedSessionIds.add(sessionId);
    }
    renderSessions();
  }

  function toggleAllSessions() {
    if (
      state.sessions.length > 0
      && state.selectedSessionIds.size === state.sessions.length
    ) {
      state.selectedSessionIds.clear();
    } else {
      state.selectedSessionIds = new Set(
        state.sessions.map(function (session) { return session.id; })
      );
    }
    renderSessions();
  }

  function updateSessionSelectionToolbar() {
    var selectionButton = byId("sessionSelectionButton");
    var actions = byId("sessionSelectionActions");
    var selectAll = byId("sessionSelectAll");
    var selectedCount = state.selectedSessionIds.size;
    var totalCount = state.sessions.length;
    selectionButton.hidden = state.sessionSelectionMode;
    selectionButton.disabled = totalCount === 0 || state.deletingSessions;
    actions.hidden = !state.sessionSelectionMode;
    selectAll.checked = totalCount > 0 && selectedCount === totalCount;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    selectAll.disabled = state.deletingSessions || totalCount === 0;
    byId("sessionSelectionCount").textContent = "已选 " + selectedCount + " 项";
    byId("sessionBulkDelete").disabled =
      state.deletingSessions || selectedCount === 0;
    byId("sessionSelectionCancel").disabled = state.deletingSessions;
    byId("newSessionButton").disabled = state.deletingSessions;
  }

  async function batchDeleteSessions() {
    var selectedIds = state.sessions
      .filter(function (session) { return state.selectedSessionIds.has(session.id); })
      .map(function (session) { return session.id; });
    if (selectedIds.length === 0 || state.deletingSessions) return;
    var runningCount = state.sessions.filter(function (session) {
      return state.selectedSessionIds.has(session.id) && session.running;
    }).length;
    var confirmation = "确定删除已选择的 " + selectedIds.length + " 个会话？";
    if (runningCount > 0) {
      confirmation += "其中 " + runningCount + " 个正在运行，将先停止任务。";
    }
    if (!window.confirm(confirmation)) return;

    state.deletingSessions = true;
    updateSessionSelectionToolbar();
    try {
      var data = await api("/api/chat/sessions", {
        method: "DELETE",
        body: { sessionIds: selectedIds }
      });
      var deletedIds = new Set(data.deletedIds || []);
      var failed = data.failed || [];
      var removedCurrent = Boolean(
        state.currentSession && deletedIds.has(state.currentSession.id)
      );
      state.selectedSessionIds = new Set(
        failed.map(function (item) { return item.sessionId; })
      );
      state.sessionSelectionMode = failed.length > 0;
      if (removedCurrent) {
        state.currentSession = null;
        state.messages = [];
        state.traces = [];
      }
      await loadSessions();
      if (removedCurrent) {
        if (state.sessions.length) await openSession(state.sessions[0].id);
        else await createSession();
      }
      if (failed.length > 0) {
        showError(new Error(
          "部分会话删除失败：" + failed.map(function (item) {
            return item.error;
          }).join("；")
        ));
      }
    } finally {
      state.deletingSessions = false;
      updateSessionSelectionToolbar();
    }
  }

  function startSessionLongPress(event, session) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelSessionLongPress();
    var x = event.clientX;
    var y = event.clientY;
    state.longPressTimer = setTimeout(function () {
      state.suppressSessionClick = true;
      openSessionContextMenu(session.id, x, y);
    }, 550);
  }

  function cancelSessionLongPress() {
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }

  function openSessionContextMenu(sessionId, x, y) {
    if (state.sessionSelectionMode) return;
    var menu = byId("sessionContextMenu");
    var session = state.sessions.find(function (item) { return item.id === sessionId; });
    if (!session) return;
    state.contextSessionId = sessionId;
    byId("sessionContextDelete").disabled = false;
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 172)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - 104)) + "px";
    byId("sessionContextRename").focus();
  }

  function closeSessionContextMenu() {
    var menu = byId("sessionContextMenu");
    if (menu) menu.hidden = true;
    state.contextSessionId = null;
  }

  function beginSessionRename(sessionId) {
    closeSessionContextMenu();
    state.renamingSessionId = sessionId;
    renderSessions();
  }

  async function commitSessionRename(sessionId, value) {
    if (state.renamingSessionId !== sessionId) return;
    var title = value.trim();
    state.renamingSessionId = null;
    var current = state.sessions.find(function (item) { return item.id === sessionId; });
    if (!title || !current || title === current.title) {
      renderSessions();
      return;
    }
    var data = await api("/api/chat/sessions/" + encodeURIComponent(sessionId), {
      method: "PATCH",
      body: { title: title }
    });
    if (state.currentSession && state.currentSession.id === sessionId) {
      state.currentSession = data.session;
      byId("sessionTitleInput").value = data.session.title;
    }
    await loadSessions();
  }

  async function deleteSessionById(sessionId) {
    var session = state.sessions.find(function (item) { return item.id === sessionId; });
    closeSessionContextMenu();
    if (!session) return;
    var confirmation = "删除“" + session.title + "”及其历史？";
    if (session.running) confirmation += "当前任务将先停止。";
    if (!window.confirm(confirmation)) return;
    await api("/api/chat/sessions/" + encodeURIComponent(sessionId), {
      method: "DELETE"
    });
    var removedCurrent = state.currentSession && state.currentSession.id === sessionId;
    if (removedCurrent) {
      state.currentSession = null;
      state.messages = [];
      state.traces = [];
    }
    await loadSessions();
    if (removedCurrent) {
      if (state.sessions.length) await openSession(state.sessions[0].id);
      else await createSession();
    }
  }

  async function createSession() {
    if (state.sessionSelectionMode) exitSessionSelection();
    var data = await api("/api/chat/sessions", { method: "POST", body: {} });
    await loadSessions();
    await openSession(data.session.id);
    closeSidebar();
  }

  async function openSession(sessionId) {
    var data = await api("/api/chat/sessions/" + encodeURIComponent(sessionId));
    state.currentSession = data.session;
    state.messages = data.messages && data.messages.messages ? data.messages.messages : [];
    state.traces = data.traces || [];
    state.selectedReferences = [];
    state.notices = [];
    state.streamText.clear();
    state.activities.clear();
    renderSessions();
    renderCurrentSession();
    closeSidebar();
    await loadSessionCapabilities(sessionId);
  }

  async function loadSessionCapabilities(sessionId) {
    var data = await api("/api/chat/capabilities?sessionId=" + encodeURIComponent(sessionId));
    if (!state.currentSession || state.currentSession.id !== sessionId) return;
    state.capabilities = data.capabilities || [];
    state.commands = data.commands || [];
  }

  function renderCurrentSession() {
    var session = state.currentSession;
    var disabled = !session;
    byId("sessionTitleInput").disabled = disabled;
    byId("composerInput").disabled = disabled;
    byId("sendButton").disabled = disabled;
    byId("runtimeSummaryButton").disabled = disabled;
    if (!session) {
      byId("sessionTitleInput").value = "";
      renderRuntimeSummary();
      renderMessages();
      renderSelectedReferences();
      updateLatestActivityBar();
      return;
    }
    byId("sessionTitleInput").value = session.title || "新对话";
    renderRuntimeSummary();
    updateRunControls();
    renderSelectedReferences();
    renderMessages();
    updateLatestActivityBar();
  }

  function renderMessages() {
    var list = byId("messageList");
    var follow = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    var fragment = document.createDocumentFragment();
    var traceByUserMessage = new Map();
    var traceByAssistantMessage = new Map();
    var messageById = new Map();
    state.traces.forEach(function (trace) {
      traceByUserMessage.set(trace.messageId, trace);
      if (trace.assistantMessageId) {
        traceByAssistantMessage.set(trace.assistantMessageId, trace);
      }
    });
    state.messages.forEach(function (message) {
      if (message.id) messageById.set(message.id, message);
    });
    var renderedMessages = new Set();
    var renderedTraces = new Set();
    if (!state.messages.length && !state.traces.length && !state.notices.length) {
      var empty = document.createElement("div");
      empty.className = "empty-chat";
      empty.textContent = "开始一段新对话";
      fragment.append(empty);
    } else {
      state.messages.forEach(function (message) {
        if (message.id && renderedMessages.has(message.id)) return;
        if (message.role === "user") {
          fragment.append(createMessageNode(message));
          if (message.id) renderedMessages.add(message.id);
          var trace = traceByUserMessage.get(message.id);
          if (trace) {
            var assistantMessage = messageById.get(trace.assistantMessageId);
            if (assistantMessage && assistantMessage.role === "assistant") {
              fragment.append(createMessageNode(assistantMessage, trace));
              if (assistantMessage.id) renderedMessages.add(assistantMessage.id);
            } else {
              fragment.append(createTraceAssistantNode(trace));
            }
            renderedTraces.add(trace.messageId);
          }
          return;
        }
        var trace = traceByAssistantMessage.get(message.id);
        var userMessage = trace ? messageById.get(trace.messageId) : null;
        if (userMessage && !renderedMessages.has(userMessage.id)) {
          return;
        }
        fragment.append(createMessageNode(message, trace));
        if (message.id) renderedMessages.add(message.id);
        if (trace) renderedTraces.add(trace.messageId);
      });
      state.traces.forEach(function (trace) {
        if (!renderedTraces.has(trace.messageId)) {
          fragment.append(createTraceAssistantNode(trace));
        }
      });
      state.notices.forEach(function (notice) {
        fragment.append(createNoticeNode(notice));
      });
    }
    list.replaceChildren(fragment);
    if (follow) {
      requestAnimationFrame(function () {
        list.scrollTop = list.scrollHeight;
      });
    }
  }

  function createMessageNode(message, trace) {
    var article = document.createElement("article");
    article.className = "message " + message.role;
    if (message.id) article.dataset.messageId = message.id;
    var avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = message.role === "user" ? "你" : "CG";
    var content = document.createElement("div");
    var head = document.createElement("div");
    head.className = "message-head";
    var author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.role === "user" ? (state.user ? state.user.username : "你") : "Codex";
    var time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.createdAt);
    head.append(author, time);
    content.append(head);
    if (trace && message.role === "assistant") {
      content.append(createTraceNode(trace, true));
    }
    if (message.text || message.streaming) {
      var body = document.createElement("div");
      body.className = "message-body" + (message.streaming ? " streaming" : "");
      window.renderSafeMarkdown(body, message.text || "");
      content.append(body);
    }
    if (message.references && message.references.length) {
      content.append(createHistoryReferences(message.references));
    }
    if (message.attachments && message.attachments.length) {
      content.append(createAttachments(message.attachments));
    }
    article.append(avatar, content);
    return article;
  }

  function createTraceAssistantNode(trace) {
    return createMessageNode(
      {
        id: trace.assistantMessageId || "",
        role: "assistant",
        text: "",
        createdAt: trace.startedAt
      },
      trace
    );
  }

  function createNoticeNode(notice) {
    var article = document.createElement("article");
    article.className = "message assistant command-result";
    var avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "/";
    var content = document.createElement("div");
    var head = document.createElement("div");
    head.className = "message-head";
    var author = document.createElement("span");
    author.className = "message-author";
    author.textContent = "命令";
    var time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(notice.createdAt);
    head.append(author, time);
    var body = document.createElement("div");
    body.className = "message-body";
    window.renderSafeMarkdown(body, notice.text);
    content.append(head, body);
    article.append(avatar, content);
    return article;
  }

  function createHistoryReferences(references) {
    var container = document.createElement("div");
    container.className = "attachments";
    references.forEach(function (reference) {
      var item = document.createElement("span");
      item.className = "attachment";
      item.textContent = "@" + reference.name;
      container.append(item);
    });
    return container;
  }

  function createAttachments(attachments) {
    var container = document.createElement("div");
    container.className = "attachments";
    attachments.forEach(function (file) {
      var link = document.createElement("a");
      link.className = "attachment";
      link.href = "/api/chat/files/" + encodeURIComponent(file.id);
      link.textContent = "↓ " + file.name;
      link.setAttribute("download", file.name);
      container.append(link);
    });
    return container;
  }

  function createTraceNode(trace, inline) {
    var section = document.createElement("section");
    section.className = "trace-card " + trace.status + (inline ? " inline" : "");
    section.id = "trace-" + trace.messageId;
    section.dataset.traceId = trace.messageId;
    var details = document.createElement("details");
    var canRememberToggle = trace.status !== "running";
    details.open = trace.status === "running" || state.expandedTraceIds.has(trace.messageId);
    details.addEventListener("toggle", function () {
      if (!canRememberToggle) return;
      if (details.open) state.expandedTraceIds.add(trace.messageId);
      else state.expandedTraceIds.delete(trace.messageId);
    });
    var summary = document.createElement("summary");
    var dot = document.createElement("span");
    dot.className = "trace-status-dot";
    var text = document.createElement("span");
    text.textContent = traceSummary(trace);
    summary.append(dot, text);
    var body = document.createElement("div");
    body.className = "trace-body";
    if (trace.status === "failed" && trace.error) {
      var error = document.createElement("div");
      error.className = "trace-error";
      error.textContent = trace.error;
      body.append(error);
    }
    (trace.entries || []).forEach(function (entry) {
      if (entry.type === "tool_group") {
        body.append(createToolGroupNode(entry));
        return;
      }
      if (entry.type === "message") {
        var message = document.createElement("div");
        message.className = "trace-message";
        var label = document.createElement("div");
        label.className = "trace-entry-label";
        label.textContent = entry.kind === "reasoning"
          ? "推理"
          : entry.kind === "plan"
            ? "计划"
            : "Codex";
        var messageBody = document.createElement("div");
        messageBody.className = "message-body";
        window.renderSafeMarkdown(messageBody, entry.text || "");
        message.append(label, messageBody);
        body.append(message);
        return;
      }
      var context = document.createElement("div");
      context.className = "trace-context";
      context.textContent = entry.title || "上下文已压缩";
      body.append(context);
    });
    details.append(summary, body);
    section.append(details);
    return section;
  }

  function createToolGroupNode(entry) {
    var details = document.createElement("details");
    details.className = "tool-group";
    details.open = entry.status === "running";
    var summary = document.createElement("summary");
    var title = document.createElement("span");
    title.className = "tool-group-title";
    title.textContent = entry.title || "工具调用";
    var status = document.createElement("span");
    status.className = "tool-group-state";
    status.textContent = statusLabel(entry.status);
    summary.append(title, status);
    var activities = document.createElement("div");
    activities.className = "tool-activities";
    (entry.activities || []).forEach(function (activity) {
      var item = document.createElement("div");
      item.className = "tool-activity";
      var head = document.createElement("div");
      head.className = "tool-activity-head";
      var name = document.createElement("span");
      name.textContent = activity.title || activity.kind || "工具";
      var timing = document.createElement("span");
      timing.textContent = activity.durationMs !== undefined
        ? statusLabel(activity.status) + " · " + formatDuration(activity.durationMs)
        : statusLabel(activity.status);
      head.append(name, timing);
      item.append(head);
      if (activity.input !== undefined || activity.output) {
        var detail = document.createElement("pre");
        detail.className = "tool-detail";
        detail.textContent = [
          activity.input !== undefined ? safeStringify(activity.input) : "",
          activity.output || ""
        ].filter(Boolean).join("\n\n");
        item.append(detail);
      }
      activities.append(item);
    });
    details.append(summary, activities);
    return details;
  }

  function traceSummary(trace) {
    if (trace.status === "running") {
      return trace.latestActivity || "Codex 正在处理";
    }
    return trace.summary || (
      trace.status === "completed"
        ? "过程已完成"
        : trace.status === "failed"
          ? "过程失败"
          : "过程已停止"
    );
  }

  function statusLabel(status) {
    return status === "running"
      ? "运行中"
      : status === "completed"
        ? "已完成"
        : status === "failed"
          ? "失败"
          : "已停止";
  }

  function safeStringify(value) {
    try {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function formatDuration(value) {
    return value < 1000 ? value + " ms" : (value / 1000).toFixed(1) + " s";
  }

  function effectiveModel() {
    if (!state.currentSession) return null;
    var configured = state.models.find(function (model) {
      return model.model === state.currentSession.model || model.id === state.currentSession.model;
    });
    return configured || state.models.find(function (model) {
      return model.isDefault;
    }) || state.models[0] || null;
  }

  function effectiveModelLabel(session, model) {
    return model
      ? model.displayName || model.model
      : session && session.model
        ? session.model
        : "未指定模型";
  }

  function effectiveReasoningEffort(session, model) {
    return session && session.reasoningEffort
      ? session.reasoningEffort
      : model && model.defaultReasoningEffort
        ? model.defaultReasoningEffort
        : "未指定";
  }

  function renderRuntimeSummary() {
    var session = state.currentSession;
    if (!session) {
      byId("runtimeSummaryText").textContent = "未选择会话";
      return;
    }
    var model = effectiveModel();
    byId("runtimeSummaryText").textContent = [
      effectiveModelLabel(session, model),
      effectiveReasoningEffort(session, model),
      session.fast ? "Fast" : "标准"
    ].join(" · ");
  }

  function toggleRuntimeMenu() {
    var menu = byId("runtimeMenu");
    if (!menu.hidden) {
      closeComposerPopovers();
      return;
    }
    closeComposerPopovers("runtimeMenu");
    state.runtimeSection = "root";
    renderRuntimeMenu("root");
    menu.hidden = false;
    byId("runtimeSummaryButton").setAttribute("aria-expanded", "true");
  }

  function renderRuntimeMenu(section) {
    state.runtimeSection = section || "root";
    var menu = byId("runtimeMenu");
    var fragment = document.createDocumentFragment();
    var session = state.currentSession;
    if (!session) {
      menu.replaceChildren();
      return;
    }
    var head = document.createElement("div");
    head.className = "runtime-menu-head";
    var heading = document.createElement("span");
    heading.textContent = section === "root"
      ? "模型配置"
      : section === "model"
        ? "模型"
        : section === "effort"
          ? "推理强度"
          : section === "speed"
            ? "速度"
            : "高级";
    head.append(heading);
    if (section !== "root") {
      var back = document.createElement("button");
      back.type = "button";
      back.className = "secondary-button";
      back.textContent = "返回";
      back.addEventListener("click", function () { renderRuntimeMenu("root"); });
      head.append(back);
    }
    fragment.append(head);

    if (section === "root") {
      var model = effectiveModel();
      fragment.append(
        createRuntimeRow("模型", effectiveModelLabel(session, model), function () {
          renderRuntimeMenu("model");
        }),
        createRuntimeRow("推理强度", effectiveReasoningEffort(session, model), function () {
          renderRuntimeMenu("effort");
        }),
        createRuntimeRow("速度", session.fast ? "Fast" : "标准", function () {
          renderRuntimeMenu("speed");
        }),
        createRuntimeRow("高级", session.planMode ? "Plan Mode" : "权限与计划", function () {
          renderRuntimeMenu("advanced");
        })
      );
    } else if (section === "model") {
      state.models.forEach(function (model) {
        fragment.append(createRuntimeChoice(
          model.displayName || model.model,
          model.description || model.model,
          model.model === effectiveModel()?.model,
          function () {
            var effortSupported = !session.reasoningEffort || (model.supportedReasoningEfforts || []).some(function (item) {
              return item.reasoningEffort === session.reasoningEffort;
            });
            saveRuntimePatch({
              model: model.model,
              reasoningEffort: effortSupported ? session.reasoningEffort || null : null,
              fast: session.fast && model.supportsFast ? true : false
            }).catch(showError);
          }
        ));
      });
    } else if (section === "effort") {
      var selectedModel = effectiveModel();
      fragment.append(createRuntimeChoice(
        "跟随模型（当前 " + effectiveReasoningEffort(null, selectedModel) + "）",
        "",
        !session.reasoningEffort,
        function () {
        saveRuntimePatch({ reasoningEffort: null }).catch(showError);
        }
      ));
      (selectedModel ? selectedModel.supportedReasoningEfforts || [] : []).forEach(function (item) {
        fragment.append(createRuntimeChoice(
          item.reasoningEffort,
          item.description || "",
          item.reasoningEffort === session.reasoningEffort,
          function () {
            saveRuntimePatch({ reasoningEffort: item.reasoningEffort }).catch(showError);
          }
        ));
      });
    } else if (section === "speed") {
      var speedModel = effectiveModel();
      fragment.append(createRuntimeChoice("标准", "标准速度与用量", session.fast !== true, function () {
        saveRuntimePatch({ fast: false }).catch(showError);
      }));
      var fastChoice = createRuntimeChoice("Fast", "更快响应，使用量更高", session.fast === true, function () {
        saveRuntimePatch({ fast: true }).catch(showError);
      });
      fastChoice.disabled = Boolean(speedModel && !speedModel.supportsFast);
      fragment.append(fastChoice);
    } else {
      fragment.append(
        createRuntimeRow("Plan Mode", session.planMode ? "已开启" : "已关闭", function () {
          executeCommand("plan", { value: session.planMode ? "off" : "on" }).catch(showError);
        }),
        createRuntimeRow("权限配置", session.permissionProfile || "默认安全权限", function () {
          prepareCommandOptions("permissions").catch(showError);
        })
      );
    }
    menu.replaceChildren(fragment);
  }

  function createRuntimeRow(label, current, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "runtime-row";
    var name = document.createElement("span");
    name.className = "runtime-row-label";
    name.textContent = label;
    var value = document.createElement("span");
    value.className = "runtime-current";
    value.textContent = current + " ›";
    button.append(name, value);
    button.addEventListener("click", action);
    return button;
  }

  function createRuntimeChoice(label, description, selected, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "runtime-row" + (selected ? " selected" : "");
    var name = document.createElement("span");
    name.className = "runtime-row-label";
    name.textContent = label;
    var marker = document.createElement("span");
    marker.textContent = selected ? "✓" : "";
    button.append(name, marker);
    if (description) {
      var detail = document.createElement("span");
      detail.className = "runtime-row-description";
      detail.textContent = description;
      button.append(detail);
    }
    button.addEventListener("click", action);
    return button;
  }

  async function saveRuntimePatch(patch) {
    if (!state.currentSession || state.currentSession.running) return;
    var data = await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/runtime", {
      method: "PUT",
      body: patch
    });
    state.currentSession = data.session;
    await loadSessions();
    renderCurrentSession();
    closeComposerPopovers();
  }

  async function renameCurrentSession() {
    if (!state.currentSession) return;
    var title = byId("sessionTitleInput").value.trim();
    if (!title || title === state.currentSession.title) return;
    var data = await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id), {
      method: "PATCH",
      body: { title: title }
    });
    state.currentSession = data.session;
    await loadSessions();
  }

  function renderPendingFiles() {
    var container = byId("pendingFiles");
    var fragment = document.createDocumentFragment();
    state.pendingFiles.forEach(function (file, index) {
      var item = document.createElement("span");
      item.className = "pending-file";
      var name = document.createElement("span");
      name.textContent = file.name;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button small";
      remove.title = "移除附件";
      remove.setAttribute("aria-label", "移除附件");
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        state.pendingFiles.splice(index, 1);
        renderPendingFiles();
      });
      item.append(name, remove);
      fragment.append(item);
    });
    container.replaceChildren(fragment);
  }

  function renderSelectedReferences() {
    var container = byId("selectedReferences");
    var fragment = document.createDocumentFragment();
    state.selectedReferences.forEach(function (reference, index) {
      var item = document.createElement("span");
      item.className = "reference-chip";
      var kind = document.createElement("span");
      kind.className = "reference-kind";
      kind.textContent = referenceKindLabel(reference.kind);
      var name = document.createElement("span");
      name.textContent = reference.name;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button small";
      remove.title = "移除引用";
      remove.setAttribute("aria-label", "移除引用");
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        state.selectedReferences.splice(index, 1);
        renderSelectedReferences();
      });
      item.append(kind, name, remove);
      fragment.append(item);
    });
    container.replaceChildren(fragment);
  }

  function referenceKindLabel(kind) {
    return kind === "skill"
      ? "Skill"
      : kind === "plugin"
        ? "插件"
        : kind === "app"
          ? "应用"
          : kind === "directory"
            ? "目录"
            : "文件";
  }

  function referenceKindRank(kind) {
    return Object.prototype.hasOwnProperty.call(REFERENCE_KIND_ORDER, kind)
      ? REFERENCE_KIND_ORDER[kind]
      : 5;
  }

  function pendingFileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("\u0000");
  }

  function addPendingFiles(files) {
    var existing = new Set(state.pendingFiles.map(pendingFileKey));
    var errors = [];
    Array.from(files || []).forEach(function (file) {
      if (!(file instanceof File)) return;
      if (file.size <= 0) {
        errors.push(file.name + " 是空文件。");
        return;
      }
      if (file.size > MAX_PENDING_FILE_BYTES) {
        errors.push(file.name + " 超过 30MB。");
        return;
      }
      var key = pendingFileKey(file);
      if (existing.has(key)) return;
      existing.add(key);
      state.pendingFiles.push(file);
    });
    renderPendingFiles();
    if (errors.length > 0) {
      showError(new Error(errors[0] + (errors.length > 1 ? " 另有 " + (errors.length - 1) + " 个文件未添加。" : "")));
    }
  }

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer && event.dataTransfer.types || []).includes("Files");
  }

  function resetFileDropState() {
    fileDragDepth = 0;
    var overlay = byId("fileDropOverlay");
    if (overlay) overlay.hidden = true;
  }

  async function uploadPendingFiles() {
    var ids = [];
    for (var index = 0; index < state.pendingFiles.length; index += 1) {
      var form = new FormData();
      form.set("file", state.pendingFiles[index]);
      var data = await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/files", {
        method: "POST",
        body: form
      });
      ids.push(data.file.id);
    }
    return ids;
  }

  function renderCommandPalette(query) {
    var normalized = (query || "").toLowerCase();
    state.commandMode = { type: "commands" };
    var items = state.commands
      .filter(function (command) {
        return !normalized
          || command.name.toLowerCase().includes(normalized)
          || (command.description || "").toLowerCase().includes(normalized);
      })
      .map(function (command) {
        return {
          id: command.name,
          name: "/" + command.name,
          description: command.description || "",
          action: function () { selectCommand(command); }
        };
      });
    showPalette("commandPalette", items);
  }

  function selectCommand(command) {
    if (["model", "effort", "fast", "review", "permissions"].includes(command.name)) {
      prepareCommandOptions(command.name).catch(showError);
      return;
    }
    if (command.takesArgument) {
      byId("composerInput").value = "/" + command.name + " ";
      closeComposerPopovers();
      byId("composerInput").focus();
      return;
    }
    executeCommand(command.name, {}).catch(showError);
  }

  async function prepareCommandOptions(name) {
    var options = [];
    if (name === "model") {
      options = state.models.map(function (model) {
        return {
          label: model.displayName || model.model,
          description: model.description || model.model,
          arguments: { value: model.model }
        };
      });
    } else if (name === "effort") {
      var model = currentModel();
      options = (model ? model.supportedReasoningEfforts || [] : []).map(function (item) {
        return {
          label: item.reasoningEffort,
          description: item.description || "",
          arguments: { value: item.reasoningEffort }
        };
      });
    } else if (name === "fast") {
      options = [
        { label: "标准", description: "标准速度与用量", arguments: { value: "off" } },
        { label: "Fast", description: "更快响应，使用量更高", arguments: { value: "on" } }
      ];
    } else if (name === "review") {
      options = [
        {
          label: "未提交的更改",
          description: "审查当前工作区尚未提交的更改",
          arguments: { target: { type: "uncommittedChanges" } }
        }
      ];
    } else {
      var response = await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/commands", {
        method: "POST",
        body: { name: "permissions", arguments: {} }
      });
      options = Array.isArray(response.result.data)
        ? response.result.data.map(function (profile) {
            return {
              label: profile.name || profile.id,
              description: profile.description || "",
              arguments: { value: profile.id }
            };
          })
        : [];
    }
    state.commandMode = { type: "options", name: name };
    showPalette("commandPalette", options.map(function (option) {
      return {
        id: name + ":" + option.label,
        name: option.label,
        description: option.description,
        action: function () {
          executeCommand(name, option.arguments).catch(showError);
        }
      };
    }));
  }

  async function executeCommand(name, argumentsValue) {
    if (!state.currentSession) return;
    var data = await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/commands", {
      method: "POST",
      body: { name: name, arguments: argumentsValue || {} }
    });
    var result = data.result || {};
    closeComposerPopovers();
    byId("composerInput").value = "";
    if (result.session && (name === "new" || name === "fork")) {
      await loadSessions();
      await openSession(result.session.id);
      return;
    }
    if (result.session) state.currentSession = result.session;
    await refreshCurrent();
    showNotice(result.message, result.data);
  }

  function renderReferencePalette(query, fromAdd) {
    state.referenceFromAdd = fromAdd === true;
    var normalized = (query || "").toLowerCase();
    var base = state.capabilities.filter(function (item) {
      return !normalized
        || item.name.toLowerCase().includes(normalized)
        || (item.description || "").toLowerCase().includes(normalized);
    });
    showReferenceItems(base, state.referenceFromAdd);
    clearTimeout(state.referenceSearchTimer);
    if (!state.currentSession) return;
    var sequence = ++state.referenceSearchSequence;
    state.referenceSearchTimer = setTimeout(function () {
      api(
        "/api/chat/files/search?sessionId="
        + encodeURIComponent(state.currentSession.id)
        + "&q="
        + encodeURIComponent(query || "")
      ).then(function (data) {
        if (sequence !== state.referenceSearchSequence) return;
        showReferenceItems((data.capabilities || []).concat(base), state.referenceFromAdd);
      }).catch(showError);
    }, 180);
  }

  function showReferenceItems(capabilities, includeUpload) {
    var unique = [];
    var ids = new Set();
    capabilities.forEach(function (item) {
      if (ids.has(item.id)) return;
      ids.add(item.id);
      unique.push(item);
    });
    unique.sort(function (left, right) {
      return referenceKindRank(left.kind) - referenceKindRank(right.kind);
    });
    var items = [];
    if (includeUpload) {
      items.push({
        id: "__upload__",
        name: "上传本地文件",
        description: "选择、拖拽或粘贴文件",
        section: "添加",
        meta: "文件",
        action: function () {
          closeComposerPopovers();
          byId("fileInput").click();
        }
      });
    }
    unique.forEach(function (item) {
      items.push({
        id: item.id,
        name: item.name,
        description: item.description || "",
        section: referenceKindLabel(item.kind),
        meta: referenceKindLabel(item.kind),
        action: function () { selectReference(item); }
      });
    });
    showPalette("referencePalette", items, true);
  }

  function selectReference(reference) {
    if (!state.selectedReferences.some(function (item) { return item.id === reference.id; })) {
      state.selectedReferences.push(reference);
    }
    var textarea = byId("composerInput");
    textarea.value = textarea.value.replace(/(^|\s)@[^\s@]*$/, "$1");
    renderSelectedReferences();
    closeComposerPopovers();
    textarea.focus();
  }

  function showPalette(id, items, grouped) {
    closeComposerPopovers(id);
    var container = byId(id);
    var fragment = document.createDocumentFragment();
    var lastSection = "";
    state.paletteItems = items;
    state.paletteIndex = 0;
    state.activePalette = id;
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "palette-section";
      empty.textContent = "暂无匹配项";
      fragment.append(empty);
    }
    items.forEach(function (item, index) {
      if (grouped && item.section && item.section !== lastSection) {
        lastSection = item.section;
        var section = document.createElement("div");
        section.className = "palette-section";
        section.textContent = lastSection;
        fragment.append(section);
      }
      var button = document.createElement("button");
      button.type = "button";
      button.className = "palette-item" + (index === state.paletteIndex ? " selected" : "");
      button.dataset.paletteIndex = String(index);
      button.setAttribute("role", "option");
      var name = document.createElement("span");
      name.className = "palette-name";
      name.textContent = item.name;
      button.append(name);
      if (item.meta) {
        var meta = document.createElement("span");
        meta.className = "palette-meta";
        meta.textContent = item.meta;
        button.append(meta);
      }
      if (item.description) {
        var description = document.createElement("span");
        description.className = "palette-description";
        description.textContent = item.description;
        button.append(description);
      }
      button.addEventListener("click", item.action);
      fragment.append(button);
    });
    container.replaceChildren(fragment);
    container.hidden = false;
  }

  function refreshPaletteSelection() {
    if (!state.activePalette) return;
    var container = byId(state.activePalette);
    container.querySelectorAll(".palette-item").forEach(function (item, index) {
      item.classList.toggle("selected", index === state.paletteIndex);
      if (index === state.paletteIndex) item.scrollIntoView({ block: "nearest" });
    });
  }

  function selectCurrentPaletteItem() {
    var item = state.paletteItems[state.paletteIndex];
    if (item && item.action) item.action();
  }

  function closeComposerPopovers(exceptId) {
    ["commandPalette", "referencePalette", "runtimeMenu"].forEach(function (id) {
      if (id === exceptId) return;
      byId(id).hidden = true;
    });
    if (exceptId !== "commandPalette") state.commandMode = null;
    if (exceptId !== "referencePalette") state.referenceFromAdd = false;
    if (exceptId !== "commandPalette" && exceptId !== "referencePalette") {
      state.activePalette = "";
      state.paletteItems = [];
    }
    if (exceptId !== "runtimeMenu") {
      byId("runtimeSummaryButton").setAttribute("aria-expanded", "false");
    }
  }

  function updateComposerPanels() {
    var value = byId("composerInput").value;
    var commandMatch = value.match(/^\/([^\s]*)$/);
    if (commandMatch) {
      renderCommandPalette(commandMatch[1] || "");
      return;
    }
    var referenceMatch = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (referenceMatch) {
      renderReferencePalette(referenceMatch[1] || "", false);
      return;
    }
    if (state.activePalette === "commandPalette" || state.activePalette === "referencePalette") {
      closeComposerPopovers();
    }
  }

  async function sendMessage() {
    if (!state.currentSession) return;
    var textarea = byId("composerInput");
    var text = textarea.value.trim();
    if (
      !text
      && state.pendingFiles.length === 0
      && state.selectedReferences.length === 0
    ) return;
    if (
      text.startsWith("/")
      && state.pendingFiles.length === 0
      && state.selectedReferences.length === 0
    ) {
      var matched = text.match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
      if (!matched) {
        showError(new Error("命令格式不正确。"));
        return;
      }
      await executeCommand(matched[1].toLowerCase(), { value: (matched[2] || "").trim() });
      return;
    }
    var send = byId("sendButton");
    send.disabled = true;
    try {
      var fileIds = await uploadPendingFiles();
      await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/messages", {
        method: "POST",
        body: {
          text: text,
          fileIds: fileIds,
          references: state.selectedReferences.map(function (item) { return item.id; })
        }
      });
      textarea.value = "";
      textarea.style.height = "";
      state.pendingFiles = [];
      state.selectedReferences = [];
      renderPendingFiles();
      renderSelectedReferences();
      closeComposerPopovers();
    } catch (error) {
      showError(error);
    } finally {
      send.disabled = false;
    }
  }

  async function stopCurrentSession() {
    if (!state.currentSession) return;
    try {
      await api("/api/chat/sessions/" + encodeURIComponent(state.currentSession.id) + "/stop", {
        method: "POST"
      });
    } catch (error) {
      showError(error);
    }
  }

  function connectEvents() {
    state.eventSource?.close();
    var events = new EventSource("/api/chat/events");
    state.eventSource = events;
    [
      "session.created",
      "session.updated",
      "session.deleted",
      "session.running",
      "message.accepted",
      "message.progress",
      "message.activity",
      "message.trace",
      "message.completed",
      "message.failed",
      "file.available",
      "snapshot.required"
    ].forEach(function (type) {
      events.addEventListener(type, function (event) {
        handleEvent(type, event);
      });
    });
    events.onerror = function () {
      if (events.readyState === EventSource.CLOSED) {
        setTimeout(connectEvents, 1500);
      }
    };
  }

  function handleEvent(type, event) {
    var data;
    try {
      data = JSON.parse(event.data || "{}");
    } catch (_) {
      return;
    }
    if (type === "snapshot.required") {
      refreshCurrent().catch(showError);
      return;
    }
    if (type.startsWith("session.")) {
      loadSessions().catch(showError);
      if (state.currentSession && data.sessionId === state.currentSession.id) {
        if (type === "session.running") {
          state.currentSession.running = data.running === true;
          updateRunControls();
        } else if (data.session) {
          state.currentSession = data.session;
          renderCurrentSession();
        }
      }
      return;
    }
    if (!state.currentSession || data.sessionId !== state.currentSession.id) return;
    if (type === "message.accepted") {
      state.messages.push({
        id: data.messageId,
        role: "user",
        text: data.text,
        attachments: data.attachments || [],
        references: data.references || [],
        createdAt: data.createdAt
      });
      renderMessages();
      scheduleTraceRefresh();
      return;
    }
    if (type === "message.progress") {
      state.streamText.set(data.messageId, (state.streamText.get(data.messageId) || "") + (data.text || ""));
      scheduleTraceRefresh();
      return;
    }
    if (type === "message.activity") {
      if (data.activity && data.activity.id) {
        state.activities.set(
          data.activity.id,
          Object.assign(
            {},
            state.activities.get(data.activity.id) || {},
            data.activity,
            { messageId: data.messageId }
          )
        );
      }
      updateLatestActivityBar();
      scheduleTraceRefresh();
      return;
    }
    if (type === "message.trace") {
      var trace = state.traces.find(function (item) { return item.messageId === data.messageId; });
      var wasRunning = trace && trace.status === "running";
      if (trace && data.trace) Object.assign(trace, data.trace);
      if (wasRunning && trace.status !== "running") {
        state.expandedTraceIds.delete(trace.messageId);
      }
      updateLatestActivityBar();
      scheduleTraceRefresh();
      return;
    }
    if (type === "message.completed") {
      state.streamText.clear();
      state.messages.push({
        id: data.messageId,
        role: "assistant",
        text: data.text || "",
        attachments: data.attachments || [],
        createdAt: data.createdAt
      });
      renderMessages();
      scheduleTraceRefresh();
      loadSessions().catch(showError);
      return;
    }
    if (type === "message.failed") {
      state.streamText.clear();
      scheduleTraceRefresh();
      showError(data.message || "处理失败");
    }
  }

  function scheduleTraceRefresh() {
    clearTimeout(state.traceRefreshTimer);
    state.traceRefreshTimer = setTimeout(function () {
      refreshSessionSnapshot().catch(showError);
    }, 120);
  }

  async function refreshSessionSnapshot() {
    if (!state.currentSession) return;
    var sessionId = state.currentSession.id;
    var data = await api("/api/chat/sessions/" + encodeURIComponent(sessionId));
    if (!state.currentSession || state.currentSession.id !== sessionId) return;
    state.currentSession = data.session;
    state.messages = data.messages && data.messages.messages ? data.messages.messages : [];
    state.traces = data.traces || [];
    renderCurrentSession();
  }

  async function refreshCurrent() {
    await loadSessions();
    if (state.currentSession) await refreshSessionSnapshot();
  }

  function updateLatestActivityBar() {
    var bar = byId("latestActivityBar");
    var running = state.traces.filter(function (trace) { return trace.status === "running"; }).at(-1);
    if (!running) {
      bar.hidden = true;
      return;
    }
    var activities = Array.from(state.activities.values()).filter(function (activity) {
      return !activity.messageId || activity.messageId === running.messageId;
    });
    var activity = activities.at(-1);
    var parts = [];
    if (running.steps && running.steps.current) {
      parts.push(
        "第 "
        + running.steps.current
        + (running.steps.total ? "/" + running.steps.total : "")
        + " 步"
      );
    }
    parts.push(activity && activity.title ? activity.title : running.latestActivity || "Codex 正在处理");
    if (running.fileChanges && running.fileChanges.files) {
      parts.push("已修改 " + running.fileChanges.files + " 个文件");
    }
    byId("latestActivityText").textContent = parts.join(" · ");
    bar.dataset.traceId = running.messageId;
    bar.hidden = false;
  }

  function updateRunControls() {
    var running = Boolean(state.currentSession && state.currentSession.running);
    byId("stopButton").hidden = !running;
    byId("sendButton").hidden = running;
    byId("runtimeSummaryButton").disabled = !state.currentSession || running;
    byId("fileButton").disabled = !state.currentSession || running;
    byId("composerInput").disabled = !state.currentSession;
    updateLatestActivityBar();
    renderRuntimeSummary();
  }

  function switchAccountSettingsTab(tab) {
    var modelMode = tab !== "password";
    state.accountSettingsTab = modelMode ? "model" : "password";
    byId("accountSettingsModelTab").classList.toggle("active", modelMode);
    byId("accountSettingsPasswordTab").classList.toggle("active", !modelMode);
    byId("accountSettingsModelTab").setAttribute("aria-selected", String(modelMode));
    byId("accountSettingsPasswordTab").setAttribute("aria-selected", String(!modelMode));
    byId("accountModelPanel").hidden = !modelMode;
    byId("accountPasswordPanel").hidden = modelMode;
    byId("accountModelError").textContent = "";
    byId("passwordError").textContent = "";
  }

  function findAccountModel(value) {
    var normalized = String(value || "").trim();
    return state.models.find(function (model) {
      return model.model === normalized || model.id === normalized;
    }) || null;
  }

  function accountModelLabel(value) {
    var model = findAccountModel(value);
    return model
      ? model.displayName || model.model
      : value || "未指定";
  }

  function appendSelectOption(select, value, label, disabled) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.disabled = disabled === true;
    select.append(option);
    return option;
  }

  function refreshAccountRuntimeFields(preferredEffort, preferredFast) {
    var accountSettings = state.accountSettings;
    if (!accountSettings) return;
    var configuredModel = byId("accountModelInput").value.trim();
    var effectiveModelId = configuredModel || accountSettings.effective.model || "";
    var model = findAccountModel(effectiveModelId);
    var inheritedEffort = accountSettings.inherited.reasoningEffort;
    var effortValue = preferredEffort === undefined
      ? byId("accountEffortSelect").value
      : preferredEffort || "";
    var effortSelect = byId("accountEffortSelect");
    effortSelect.replaceChildren();
    appendSelectOption(
      effortSelect,
      "",
      "继承全局（当前：" + (inheritedEffort || "未指定") + "）"
    );
    (model ? model.supportedReasoningEfforts || [] : []).forEach(function (item) {
      appendSelectOption(
        effortSelect,
        item.reasoningEffort,
        item.reasoningEffort
      );
    });
    var supportedEffort = !effortValue || Array.from(effortSelect.options).some(function (option) {
      return option.value === effortValue;
    });
    effortSelect.value = supportedEffort ? effortValue : "";

    var fastValue = preferredFast === undefined
      ? byId("accountSpeedSelect").value
      : preferredFast === null
        ? ""
        : String(preferredFast);
    var speedSelect = byId("accountSpeedSelect");
    var inheritedFast = accountSettings.inherited.fast === true;
    speedSelect.replaceChildren();
    appendSelectOption(
      speedSelect,
      "",
      "继承全局（当前：" + (inheritedFast ? "Fast" : "标准") + "）"
    );
    appendSelectOption(speedSelect, "false", "标准");
    appendSelectOption(
      speedSelect,
      "true",
      "Fast",
      Boolean(model && !model.supportsFast)
    );
    speedSelect.value = fastValue;
    if (speedSelect.value !== fastValue) speedSelect.value = "false";

    byId("accountEffortEffective").textContent = accountSettings.defaults.reasoningEffort
      ? "账户默认：" + accountSettings.defaults.reasoningEffort
      : "继承全局，当前：" + (accountSettings.inherited.reasoningEffort || "未指定");
    byId("accountSpeedEffective").textContent = accountSettings.defaults.fast === null
      ? "继承全局，当前：" + (accountSettings.inherited.fast ? "Fast" : "标准")
      : "账户默认：" + (accountSettings.defaults.fast ? "Fast" : "标准");
  }

  function renderAccountSettings() {
    var accountSettings = state.accountSettings;
    if (!accountSettings) return;
    var modelOptions = byId("accountModelOptions");
    var modelFragment = document.createDocumentFragment();
    var inheritOption = document.createElement("option");
    inheritOption.value = "";
    inheritOption.label = "继承全局";
    modelFragment.append(inheritOption);
    state.models.forEach(function (model) {
      var option = document.createElement("option");
      option.value = model.model;
      option.label = model.displayName || model.model;
      modelFragment.append(option);
    });
    modelOptions.replaceChildren(modelFragment);
    byId("accountModelInput").value = accountSettings.defaults.model || "";
    byId("accountModelEffective").textContent = accountSettings.defaults.model
      ? "账户默认：" + accountModelLabel(accountSettings.defaults.model)
      : "继承全局，当前：" + accountModelLabel(accountSettings.inherited.model);
    refreshAccountRuntimeFields(
      accountSettings.defaults.reasoningEffort,
      accountSettings.defaults.fast
    );
    byId("accountModelSave").disabled = state.savingAccountSettings;
  }

  async function openAccountSettings() {
    var dialog = byId("accountDialog");
    switchAccountSettingsTab("model");
    byId("accountModelError").textContent = "";
    byId("accountModelSave").disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
      var data = await api("/api/chat/account-settings");
      state.accountSettings = data.settings;
      renderAccountSettings();
    } catch (error) {
      byId("accountModelError").textContent = error instanceof Error ? error.message : String(error);
    } finally {
      byId("accountModelSave").disabled = false;
    }
  }

  async function saveAccountSettings(event) {
    event.preventDefault();
    if (!state.accountSettings || state.savingAccountSettings) return;
    state.savingAccountSettings = true;
    byId("accountModelSave").disabled = true;
    byId("accountModelError").textContent = "";
    var speed = byId("accountSpeedSelect").value;
    try {
      var data = await api("/api/chat/account-settings", {
        method: "PUT",
        body: {
          model: byId("accountModelInput").value.trim() || null,
          reasoningEffort: byId("accountEffortSelect").value || null,
          fast: speed === "" ? null : speed === "true"
        }
      });
      state.accountSettings = data.settings;
      state.user = data.settings.user;
      byId("currentUserName").textContent = data.settings.user.username;
      renderAccountSettings();
      await loadSessions();
      if (state.currentSession) await refreshSessionSnapshot();
    } catch (error) {
      byId("accountModelError").textContent = error instanceof Error ? error.message : String(error);
    } finally {
      state.savingAccountSettings = false;
      byId("accountModelSave").disabled = false;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    var submit = byId("passwordSave");
    var currentPassword = byId("currentPasswordInput").value;
    var newPassword = byId("newPasswordInput").value;
    submit.disabled = true;
    byId("passwordError").textContent = "";
    try {
      await api("/api/chat/auth/password", {
        method: "POST",
        body: { currentPassword: currentPassword, newPassword: newPassword }
      });
      byId("accountDialog").close();
      await logout();
    } catch (error) {
      byId("passwordError").textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  }

  function toggleTheme() {
    var current = document.documentElement.dataset.theme || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function applyTheme(theme) {
    var resolved = theme;
    if (theme === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("codex-gateway-theme", resolved);
    var themeButton = byId("themeButton");
    var themeLabel = resolved === "dark"
      ? "切换到浅色主题"
      : "切换到深色主题";
    themeButton.title = themeLabel;
    themeButton.setAttribute("aria-label", themeLabel);
    themeButton.setAttribute("data-tooltip", themeLabel);
  }

  function openSidebar() {
    byId("sessionSidebar").classList.add("open");
    byId("drawerBackdrop").classList.add("open");
  }

  function closeSidebar() {
    byId("sessionSidebar").classList.remove("open");
    byId("drawerBackdrop").classList.remove("open");
  }

  function formatTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function bindEvents() {
    byId("loginForm").addEventListener("submit", login);
    var registerForm = byId("registerForm");
    if (registerForm) {
      registerForm.addEventListener("submit", register);
      byId("authLoginTab").addEventListener("click", function () {
        switchAuthMode("login");
      });
      byId("authRegisterTab").addEventListener("click", function () {
        switchAuthMode("register");
      });
    }
    byId("newSessionButton").addEventListener("click", function () {
      createSession().catch(showError);
    });
    byId("sessionSelectionButton").addEventListener("click", enterSessionSelection);
    byId("sessionSelectAll").addEventListener("change", toggleAllSessions);
    byId("sessionBulkDelete").addEventListener("click", function () {
      batchDeleteSessions().catch(showError);
    });
    byId("sessionSelectionCancel").addEventListener("click", exitSessionSelection);
    byId("mobileMenuButton").addEventListener("click", openSidebar);
    byId("drawerBackdrop").addEventListener("click", closeSidebar);
    byId("themeButton").addEventListener("click", toggleTheme);
    byId("logoutButton").addEventListener("click", logout);
    byId("accountButton").addEventListener("click", function () {
      openAccountSettings().catch(showError);
    });
    byId("accountDialogClose").addEventListener("click", function () {
      byId("accountDialog").close();
    });
    byId("accountSettingsModelTab").addEventListener("click", function () {
      switchAccountSettingsTab("model");
    });
    byId("accountSettingsPasswordTab").addEventListener("click", function () {
      switchAccountSettingsTab("password");
    });
    byId("accountModelInput").addEventListener("input", function (event) {
      var value = event.target.value.trim();
      if (!value || findAccountModel(value)) refreshAccountRuntimeFields();
    });
    byId("accountModelInput").addEventListener("change", function () {
      refreshAccountRuntimeFields();
    });
    byId("accountModelForm").addEventListener("submit", saveAccountSettings);
    byId("passwordForm").addEventListener("submit", changePassword);
    byId("sessionContextRename").addEventListener("click", function () {
      if (state.contextSessionId) beginSessionRename(state.contextSessionId);
    });
    byId("sessionContextDelete").addEventListener("click", function () {
      if (state.contextSessionId) deleteSessionById(state.contextSessionId).catch(showError);
    });
    document.addEventListener("pointerdown", function (event) {
      if (!byId("sessionContextMenu").hidden && !byId("sessionContextMenu").contains(event.target)) {
        closeSessionContextMenu();
      }
      var stack = event.target.closest && event.target.closest(".composer-stack");
      if (!stack) closeComposerPopovers();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeSessionContextMenu();
        closeComposerPopovers();
        if (state.sessionSelectionMode && !state.deletingSessions) {
          exitSessionSelection();
        }
      }
    });
    byId("sessionTitleInput").addEventListener("change", function () {
      renameCurrentSession().catch(showError);
    });
    byId("runtimeSummaryButton").addEventListener("click", toggleRuntimeMenu);
    byId("fileButton").addEventListener("click", function () {
      if (!state.currentSession || state.currentSession.running) return;
      if (!byId("referencePalette").hidden && state.referenceFromAdd) {
        closeComposerPopovers();
      } else {
        renderReferencePalette("", true);
      }
    });
    byId("fileInput").addEventListener("change", function (event) {
      addPendingFiles(event.target.files);
      event.target.value = "";
    });
    byId("latestActivityBar").addEventListener("click", function () {
      var traceId = byId("latestActivityBar").dataset.traceId;
      var trace = traceId ? byId("trace-" + traceId) : null;
      if (trace) trace.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    var workspace = byId("chatWorkspace");
    workspace.addEventListener("dragenter", function (event) {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      fileDragDepth += 1;
      byId("fileDropOverlay").hidden = false;
    });
    workspace.addEventListener("dragover", function (event) {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    workspace.addEventListener("dragleave", function (event) {
      if (fileDragDepth === 0) return;
      event.preventDefault();
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0) byId("fileDropOverlay").hidden = true;
    });
    workspace.addEventListener("drop", function (event) {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      var files = event.dataTransfer.files;
      resetFileDropState();
      addPendingFiles(files);
    });
    byId("sendButton").addEventListener("click", function () {
      sendMessage().catch(showError);
    });
    byId("stopButton").addEventListener("click", stopCurrentSession);
    var composerInput = byId("composerInput");
    composerInput.addEventListener("compositionstart", function () {
      composerIsComposing = true;
      composerCompositionEndedAt = 0;
    });
    composerInput.addEventListener("compositionend", function () {
      composerIsComposing = false;
      composerCompositionEndedAt = Date.now();
    });
    composerInput.addEventListener("keydown", function (event) {
      // Safari 结束输入法组合时可能提前清除 isComposing，229 作为兼容兜底。
      if (event.isComposing || composerIsComposing || event.keyCode === 229) return;
      if (
        event.key === "Enter" && Date.now() - composerCompositionEndedAt < 200
      ) {
        event.preventDefault();
        return;
      }
      if (
        (state.activePalette === "commandPalette" || state.activePalette === "referencePalette")
        && event.key === "ArrowDown"
      ) {
        event.preventDefault();
        state.paletteIndex = Math.min(state.paletteItems.length - 1, state.paletteIndex + 1);
        refreshPaletteSelection();
        return;
      }
      if (
        (state.activePalette === "commandPalette" || state.activePalette === "referencePalette")
        && event.key === "ArrowUp"
      ) {
        event.preventDefault();
        state.paletteIndex = Math.max(0, state.paletteIndex - 1);
        refreshPaletteSelection();
        return;
      }
      if (
        (state.activePalette === "commandPalette" || state.activePalette === "referencePalette")
        && event.key === "Enter"
        && !event.shiftKey
      ) {
        event.preventDefault();
        selectCurrentPaletteItem();
        return;
      }
      if (event.key === "Escape") {
        closeComposerPopovers();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage().catch(showError);
      }
    });
    composerInput.addEventListener("input", function (event) {
      event.target.style.height = "auto";
      event.target.style.height = Math.min(160, event.target.scrollHeight) + "px";
      updateComposerPanels();
    });
    composerInput.addEventListener("paste", function (event) {
      var items = Array.from(event.clipboardData && event.clipboardData.items || []);
      var files = items
        .filter(function (item) { return item.kind === "file"; })
        .map(function (item) { return item.getAsFile(); })
        .filter(Boolean);
      if (files.length > 0) addPendingFiles(files);
    });
  }

  bootstrap();
})();
`;
