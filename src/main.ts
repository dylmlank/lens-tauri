// Lens v2 — Tauri + Bun

// ── State ──
let messages: { role: string; content: string }[] = [];
let voiceMode = false;
let currentTab = "chat";
let isLoading = false;

// ── Config ──
const CONFIG = {
  apiKey: "",
  model: "minimax/minimax-m2.5:free",
  systemPrompt: "You are Lens, a witty AI assistant. Be concise. Use emoji and markdown. Never ask permission. Just do it.",
};

function loadConfig() {
  try {
    const s = localStorage.getItem("lens-config");
    if (s) Object.assign(CONFIG, JSON.parse(s));
  } catch {}
}

function saveConfig() {
  localStorage.setItem("lens-config", JSON.stringify(CONFIG));
}

// ── API ──
const MODELS = [
  "minimax/minimax-m2.5:free",
  "tencent/hy3-preview:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-2.6-flash:free",
];

async function callLLM(): Promise<string> {
  const apiMsgs = [{ role: "system", content: CONFIG.systemPrompt }, ...messages.slice(-20)];
  const models = [CONFIG.model, ...MODELS.filter(m => m !== CONFIG.model)];

  for (const model of models) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${CONFIG.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: apiMsgs, stream: false }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.status === 401) return "Invalid API key. Click Settings to update.";
      if (!r.ok) continue;
      const d = await r.json();
      const txt = d.choices?.[0]?.message?.content || "";
      if (txt) return txt;
    } catch { continue; }
  }
  return "All models busy. Try again.";
}

// ── Markdown ──
function md(text: string): string {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${lang ? `<span style="color:var(--text-muted);font-size:11px">${lang}</span>\n` : ""}${code.trim()}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<strong style="font-size:16px">$1</strong>');
  s = s.replace(/^# (.+)$/gm, '<strong style="font-size:18px">$1</strong>');
  s = s.replace(/^[-*] (.+)$/gm, "&nbsp;&nbsp;• $1");
  s = s.replace(/\n/g, "<br>");
  return s;
}

// ── Render ──
function render() {
  const app = document.getElementById("app")!;

  if (!CONFIG.apiKey) {
    app.innerHTML = `
      <div class="welcome">
        <div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
        <div class="welcome-logo">Lens</div>
        <div class="welcome-sub">Enter your OpenRouter API key to get started</div>
        <div class="welcome-sub" style="font-size:12px;margin-top:-8px">
          Get a free key at <span style="color:var(--purple)">openrouter.ai/keys</span>
        </div>
        <div style="z-index:1;display:flex;gap:10px;margin-top:16px">
          <input type="password" id="api-key-input" placeholder="sk-or-v1-..."
                 style="width:350px;padding:12px 18px;border-radius:12px;border:2px solid var(--border);
                        background:var(--surface);color:var(--text);font-size:14px;outline:none">
          <button id="btn-save-key" style="padding:12px 24px;border-radius:12px;border:none;
                  background:var(--gradient-1);color:white;font-weight:700;font-size:14px;cursor:pointer">Start</button>
        </div>
      </div>`;
    attachSetupListeners();
    return;
  }

  const tabsHtml = ["Chat", "Memory", "Tools", "History"].map(t =>
    `<div class="tab ${currentTab === t.toLowerCase() ? "active" : ""}" data-tab="${t.toLowerCase()}">${t}</div>`
  ).join("");

  const chatContent = messages.length === 0
    ? `<div class="welcome">
        <div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
        <div class="welcome-logo">Lens</div>
        <div class="welcome-sub">Hey, what are we building today?</div>
        <div class="suggestions">
          <div class="suggestion" data-suggestion="What can you do?">What can you do?</div>
          <div class="suggestion" data-suggestion="Build something cool">Build something cool</div>
          <div class="suggestion" data-suggestion="Search the web">Search the web</div>
          <div class="suggestion" data-suggestion="Help me with code">Help me with code</div>
        </div>
      </div>`
    : `<div class="chat-area">${messages.filter(m => m.role !== "system").map(m => {
        const cls = m.role === "user" ? "user" : "lens";
        const label = m.role === "user" ? "YOU" : "LENS";
        const body = m.role === "user" ? m.content.replace(/</g, "&lt;").replace(/\n/g, "<br>") : md(m.content);
        return `<div class="message ${cls}"><div class="role">${label}</div><div class="body">${body}</div></div>`;
      }).join("")}${isLoading ? '<div class="thinking">Working on it...</div>' : ''}</div>`;

  app.innerHTML = `
    <div class="tab-bar">
      ${tabsHtml}
      <div style="flex:1"></div>
      <div class="tab" id="btn-settings">Settings</div>
    </div>
    <div class="tab-content ${currentTab === "chat" ? "active" : ""}">${chatContent}</div>
    <div class="tab-content ${currentTab === "memory" ? "active" : ""}">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#fbbf24">Memory</div></div>
      <div class="panel-empty">Memories appear here as you chat.</div></div>
    </div>
    <div class="tab-content ${currentTab === "tools" ? "active" : ""}">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#22c55e">Tools</div></div>
      ${["run_command","read_file","write_file","web_search","speak","screenshot","git","clipboard","calc"].map(t =>
        `<div class="card"><div class="card-title" style="color:#22c55e">${t}</div></div>`).join("")}
      </div>
    </div>
    <div class="tab-content ${currentTab === "history" ? "active" : ""}">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#ec4899">History</div></div>
      <div class="panel-empty">Past conversations appear here.</div></div>
    </div>
    ${currentTab === "chat" ? `
    <div class="input-bar">
      <button class="btn-icon btn-voice ${voiceMode ? "active" : ""}" id="btn-voice">${voiceMode ? "Voice ON" : "Voice"}</button>
      <textarea id="chat-input" placeholder="Message Lens..." ${isLoading ? "disabled" : ""}></textarea>
      <button class="btn-send" id="btn-send" ${isLoading ? "disabled" : ""}>Send</button>
    </div>` : ""}
    <div class="model-bar">${CONFIG.model}${isLoading ? " • Working on it..." : ""}</div>
  `;

  attachListeners();

  const chatArea = document.querySelector(".chat-area");
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

  const textarea = document.getElementById("chat-input") as HTMLTextAreaElement;
  if (textarea && !isLoading) textarea.focus();
}

// ── Event Listeners (no inline onclick) ──
function attachSetupListeners() {
  document.getElementById("btn-save-key")?.addEventListener("click", () => {
    const input = document.getElementById("api-key-input") as HTMLInputElement;
    const key = input?.value?.trim();
    if (key) { CONFIG.apiKey = key; saveConfig(); render(); }
  });
  document.getElementById("api-key-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-save-key")?.click();
  });
}

function attachListeners() {
  // Tabs
  document.querySelectorAll(".tab[data-tab]").forEach(el => {
    el.addEventListener("click", () => {
      currentTab = (el as HTMLElement).dataset.tab || "chat";
      render();
    });
  });

  // Settings
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    const key = prompt("OpenRouter API Key:", CONFIG.apiKey);
    if (key !== null) { CONFIG.apiKey = key; saveConfig(); render(); }
  });

  // Suggestions
  document.querySelectorAll(".suggestion").forEach(el => {
    el.addEventListener("click", () => {
      sendAndRender((el as HTMLElement).dataset.suggestion || "");
    });
  });

  // Send button
  document.getElementById("btn-send")?.addEventListener("click", doSend);

  // Enter to send
  document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // Auto-resize textarea
  document.getElementById("chat-input")?.addEventListener("input", (e) => {
    const ta = e.target as HTMLTextAreaElement;
    ta.style.height = "48px";
    ta.style.height = ta.scrollHeight + "px";
  });

  // Voice toggle
  document.getElementById("btn-voice")?.addEventListener("click", () => {
    voiceMode = !voiceMode;
    render();
  });
}

function doSend() {
  const textarea = document.getElementById("chat-input") as HTMLTextAreaElement;
  const text = textarea?.value?.trim();
  if (!text || isLoading) return;
  textarea.value = "";
  sendAndRender(text);
}

async function sendAndRender(text: string) {
  if (isLoading) return;
  messages.push({ role: "user", content: text });
  isLoading = true;
  render();

  const response = await callLLM();
  messages.push({ role: "assistant", content: response });
  isLoading = false;
  render();
}

// ── Init ──
loadConfig();
render();
