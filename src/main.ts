// Lens v2.1 — All features
import { invoke } from "@tauri-apps/api/core";

// ── Types ──
interface Message { role: string; content: string; image?: string; }
interface Conversation { id: string; title: string; created: string; messages: Message[]; pinned?: boolean; }

// ── State ──
let messages: Message[] = [];
let voiceMode = false;
let currentTab = "chat";
let isLoading = false;
let conversations: Conversation[] = [];
let memories: string[] = [];
let currentConvoId = "";
let searchQuery = "";
let theme = "void"; // void | daylight | ocean

// ── Config ──
const CONFIG = {
  apiKey: "",
  model: "minimax/minimax-m2.5:free",
  ollamaUrl: "",
  systemPrompt: "You are Lens, a witty AI assistant. Be concise. Use emoji and markdown. Never ask permission. Just do it.",
};

const MODELS = [
  "minimax/minimax-m2.5:free", "tencent/hy3-preview:free",
  "google/gemma-4-26b-a4b-it:free", "inclusionai/ling-2.6-flash:free",
];

const THEMES: Record<string, Record<string, string>> = {
  void: { bg: "#0a0a0f", bg2: "#12121a", surface: "#1a1a2e", text: "#e4e4ef", muted: "#8888a4", purple: "#8b5cf6", pink: "#ec4899", cyan: "#06b6d4", border: "#1e1e30" },
  daylight: { bg: "#fafafa", bg2: "#ffffff", surface: "#f0f0f5", text: "#1a1a2e", muted: "#6b7280", purple: "#7c3aed", pink: "#db2777", cyan: "#0891b2", border: "#e5e7eb" },
  ocean: { bg: "#0c1222", bg2: "#111827", surface: "#1e293b", text: "#e2e8f0", muted: "#64748b", purple: "#6366f1", pink: "#f472b6", cyan: "#22d3ee", border: "#1e3a5f" },
};

function loadConfig() { try { const s = localStorage.getItem("lens-config"); if (s) Object.assign(CONFIG, JSON.parse(s)); } catch {} }
function saveConfig() { localStorage.setItem("lens-config", JSON.stringify(CONFIG)); }
function loadConversations() { try { const s = localStorage.getItem("lens-convos"); if (s) conversations = JSON.parse(s); } catch {} }
function saveConversations() { localStorage.setItem("lens-convos", JSON.stringify(conversations.slice(0, 50))); }
function loadMemories() { try { const s = localStorage.getItem("lens-memories"); if (s) memories = JSON.parse(s); } catch {} }
function saveMemories() { localStorage.setItem("lens-memories", JSON.stringify(memories.slice(0, 20))); }
function loadTheme() { theme = localStorage.getItem("lens-theme") || "void"; applyTheme(); }
function saveTheme() { localStorage.setItem("lens-theme", theme); applyTheme(); }

function applyTheme() {
  const t = THEMES[theme] || THEMES.void;
  const r = document.documentElement.style;
  r.setProperty("--bg", t.bg); r.setProperty("--bg2", t.bg2); r.setProperty("--surface", t.surface);
  r.setProperty("--text", t.text); r.setProperty("--text-muted", t.muted); r.setProperty("--purple", t.purple);
  r.setProperty("--pink", t.pink); r.setProperty("--cyan", t.cyan); r.setProperty("--border", t.border);
}

// ── Conversation Management ──
function saveCurrentConversation() {
  if (messages.length < 2) return;
  const title = messages.find(m => m.role === "user")?.content.slice(0, 50) || "Untitled";
  if (currentConvoId) {
    const idx = conversations.findIndex(c => c.id === currentConvoId);
    if (idx >= 0) { conversations[idx].messages = [...messages]; conversations[idx].title = title; }
  } else {
    currentConvoId = Date.now().toString();
    conversations.unshift({ id: currentConvoId, title, created: new Date().toISOString(), messages: [...messages] });
  }
  saveConversations();
}

function loadConversation(id: string) {
  saveCurrentConversation();
  const c = conversations.find(c => c.id === id);
  if (c) { messages = [...c.messages]; currentConvoId = id; currentTab = "chat"; render(); }
}

function newChat() {
  saveCurrentConversation();
  messages = []; currentConvoId = ""; currentTab = "chat"; render();
}

function deleteConversation(id: string) {
  conversations = conversations.filter(c => c.id !== id);
  saveConversations(); render();
}

function togglePin(id: string) {
  const c = conversations.find(c => c.id === id);
  if (c) { c.pinned = !c.pinned; saveConversations(); render(); }
}

function exportChat() {
  const md = messages.map(m => `**${m.role === "user" ? "You" : "Lens"}:**\n${m.content}`).join("\n\n---\n\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `lens-chat-${Date.now()}.md`; a.click();
}

// ── Memory ──
function addMemory(fact: string) {
  fact = fact.trim();
  if (fact && !memories.includes(fact)) { memories.push(fact); saveMemories(); }
}

function removeMemory(idx: number) { memories.splice(idx, 1); saveMemories(); render(); }

function extractMemories(text: string) {
  const re = /\[REMEMBER\](.*?)\[\/REMEMBER\]/gs;
  let m; while ((m = re.exec(text)) !== null) { addMemory(m[1].trim()); }
  const re2 = /\[REMEMBER\]\s*(.+)/gm;
  if (!re.test(text)) { let m2; while ((m2 = re2.exec(text)) !== null) { addMemory(m2[1].trim()); } }
}

// ── API ──
function needsTools(text: string): boolean {
  const keywords = /\b(run|execute|create|build|open|read|write|list|search|install|screenshot|file|command|script|make|download|git)\b/i;
  return keywords.test(text);
}

async function callLLM(onToken?: (t: string) => void): Promise<string> {
  const sysPrompt = CONFIG.systemPrompt + (memories.length > 0 ? `\nUser: ${memories.slice(0, 3).join("; ")}` : "");
  const apiMsgs = [{ role: "system", content: sysPrompt }, ...messages.slice(-16)];

  // Try Ollama first if configured
  if (CONFIG.ollamaUrl) {
    try {
      const r = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ model: CONFIG.model, messages: apiMsgs, stream: false }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const d = await r.json();
        const txt = d.message?.content || "";
        if (txt) { onToken?.(txt); return txt; }
      }
    } catch {}
  }

  // OpenRouter with streaming
  const models = [CONFIG.model, ...MODELS.filter(m => m !== CONFIG.model)];
  for (const model of models) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${CONFIG.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: apiMsgs, stream: true }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.status === 401) return "Invalid API key. Go to Settings.";
      if (!r.ok) continue;

      const reader = r.body?.getReader();
      if (!reader) continue;
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const tok = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || "";
            if (tok) { full += tok; onToken?.(tok); }
          } catch {}
        }
      }
      if (full) return full;
    } catch { continue; }
  }
  return "All models busy. Try again.";
}

// ── Tool Execution ──
async function runTool(name: string, args: Record<string, string>): Promise<string> {
  try {
    if (name === "run_command") return await invoke<string>("run_command", { command: args.command || "" });
    if (name === "read_file") return await invoke<string>("read_file", { path: args.path || "" });
    if (name === "write_file") return await invoke<string>("write_file", { path: args.path || "", content: args.content || "" });
    return await invoke<string>("run_command", { command: `echo "Unknown tool: ${name}"` });
  } catch (e) { return `Error: ${e}`; }
}

function parseToolCalls(text: string): { name: string; args: Record<string, string> }[] {
  const calls: { name: string; args: Record<string, string> }[] = [];
  const re2 = /\[TOOL:name="([\w.-]+)"\s*(.*?)\]/gs;
  const re1 = /\[TOOL:(\w+)\s*(.*?)\]/gs;
  for (const re of [re2, re1]) {
    let m; while ((m = re.exec(text)) !== null) {
      let name = m[1]; let argsStr = (m[2] || "").replace(/\[\/TOOL[^\]]*\]?$/g, "").trim();
      for (const p of ["desktop-commander_", "cli-mcp-server_", "filesystem.", "github_"]) if (name.startsWith(p)) name = name.slice(p.length);
      const rn: Record<string, string> = { list_directory: "list_files", "cli:run": "run_command", run: "run_command", exec: "run_command" };
      name = rn[name] || name;
      const args: Record<string, string> = {};
      const aw = argsStr.match(/^args="(.*)"$/s); if (aw) argsStr = aw[1].replace(/\\"/g, '"');
      const kr = /(?:^|\s)(\w+)=/g; const pos: { k: string; s: number }[] = [];
      let km; while ((km = kr.exec(argsStr)) !== null) pos.push({ k: km[1], s: km.index + km[0].length });
      for (let i = 0; i < pos.length; i++) {
        const end = i + 1 < pos.length ? pos[i + 1].s - pos[i + 1].k.length - 1 : argsStr.length;
        let v = argsStr.slice(pos[i].s, end).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        args[pos[i].k] = v;
      }
      if (args.key && args.value && Object.keys(args).length === 2) { args[args.key] = args.value; delete args.key; delete args.value; }
      if (args.cmd) { args.command = args.cmd; delete args.cmd; }
      if (args.file) { args.path = args.file; delete args.file; }
      calls.push({ name, args });
    }
    if (calls.length > 0) break;
  }
  return calls;
}

function stripToolTokens(t: string): string {
  return t.replace(/\[TOOL[\s\S]*?\[\/TOOL[^\]]*\]/g, "").replace(/\[TOOL:[^\]]*\]/g, "")
    .replace(/\[\/TOOL[^\]]*\]/g, "").replace(/\[WRITE_FILE:[^\]]+\][\s\S]*?\[\/WRITE_FILE\]/g, "")
    .replace(/\[CAPTURE\]/g, "").replace(/\[REMEMBER\][\s\S]*?\[\/REMEMBER\]/g, "")
    .replace(/\[REMEMBER\]\s*.+/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Markdown ──
function md(text: string): string {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${l ? `<span style="color:var(--text-muted);font-size:11px">${l}</span>\n` : ""}${c.trim()}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<strong style="font-size:16px">$1</strong>');
  s = s.replace(/^# (.+)$/gm, '<strong style="font-size:18px">$1</strong>');
  s = s.replace(/^[-*] (.+)$/gm, "&nbsp;&nbsp;• $1");
  s = s.replace(/^(\d+)\. (.+)$/gm, "&nbsp;&nbsp;$1. $2");
  s = s.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid var(--purple);padding-left:12px;color:var(--text-muted)">$1</div>');
  s = s.replace(/\n/g, "<br>");
  return s;
}

// ── Render ──
function render() {
  const app = document.getElementById("app")!;

  if (!CONFIG.apiKey && !CONFIG.ollamaUrl) { renderSetup(app); return; }

  const tabs = ["Chat", "Memory", "Tools", "History", "Settings"];
  app.innerHTML = `
    <div class="tab-bar">
      ${tabs.map(t => `<div class="tab ${currentTab === t.toLowerCase() ? "active" : ""}" data-tab="${t.toLowerCase()}">${t}</div>`).join("")}
      <div style="flex:1"></div>
      <div class="tab" id="btn-new-chat" title="Ctrl+N">+ New</div>
    </div>
    ${renderTabContent()}
    ${currentTab === "chat" ? renderInputBar() : ""}
    <div class="model-bar">${CONFIG.model}${isLoading ? " • streaming..." : ""} • ${theme} theme</div>
  `;
  attachListeners();
  const ca = document.querySelector(".chat-area"); if (ca) ca.scrollTop = ca.scrollHeight;
  const ta = document.getElementById("chat-input") as HTMLTextAreaElement; if (ta && !isLoading) ta.focus();
}

function renderSetup(app: HTMLElement) {
  app.innerHTML = `<div class="welcome">
    <div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-logo">Lens</div>
    <div class="welcome-sub">Enter your OpenRouter API key to start</div>
    <div style="z-index:1;display:flex;gap:10px;margin-top:16px;flex-direction:column;align-items:center">
      <input type="password" id="api-key-input" placeholder="sk-or-v1-..."
             style="width:380px;padding:14px 20px;border-radius:14px;border:2px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;outline:none">
      <div style="font-size:12px;color:var(--text-muted)">Or enter Ollama URL (e.g. http://localhost:11434)</div>
      <input id="ollama-input" placeholder="http://localhost:11434 (optional)"
             style="width:380px;padding:12px 18px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;outline:none">
      <button id="btn-save-key" style="padding:14px 32px;border-radius:14px;border:none;background:var(--gradient-1);color:white;font-weight:700;font-size:15px;cursor:pointer;margin-top:8px">Start</button>
    </div>
  </div>`;
  document.getElementById("btn-save-key")?.addEventListener("click", () => {
    const key = (document.getElementById("api-key-input") as HTMLInputElement)?.value?.trim();
    const ollama = (document.getElementById("ollama-input") as HTMLInputElement)?.value?.trim();
    if (key) CONFIG.apiKey = key;
    if (ollama) CONFIG.ollamaUrl = ollama;
    if (key || ollama) { saveConfig(); render(); }
  });
  document.getElementById("api-key-input")?.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-save-key")?.click(); });
}

function renderTabContent(): string {
  if (currentTab === "chat") return `<div class="tab-content active">${messages.length === 0 ? renderWelcome() : renderChat()}</div>`;
  if (currentTab === "memory") return `<div class="tab-content active">${renderMemory()}</div>`;
  if (currentTab === "tools") return `<div class="tab-content active">${renderTools()}</div>`;
  if (currentTab === "history") return `<div class="tab-content active">${renderHistory()}</div>`;
  if (currentTab === "settings") return `<div class="tab-content active">${renderSettings()}</div>`;
  return "";
}

function renderWelcome(): string {
  return `<div class="welcome">
    <div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-logo">Lens</div>
    <div class="welcome-sub">Hey, what are we building today?</div>
    <div class="suggestions">
      <div class="suggestion" data-suggestion="What can you do?">What can you do?</div>
      <div class="suggestion" data-suggestion="Build something cool">Build something cool</div>
      <div class="suggestion" data-suggestion="Search the web">Search the web</div>
      <div class="suggestion" data-suggestion="Help me with code">Help me with code</div>
    </div>
  </div>`;
}

function renderChat(): string {
  const msgs = messages.filter(m => m.role !== "system").map(m => {
    const cls = m.role === "user" ? "user" : "lens";
    const label = m.role === "user" ? "YOU" : "LENS";
    const c = m.role === "user" ? m.content : stripToolTokens(m.content);
    const body = m.role === "user" ? c.replace(/</g, "&lt;").replace(/\n/g, "<br>") : md(c);
    const img = m.image ? `<img src="data:image/png;base64,${m.image}" style="max-width:300px;max-height:200px;border-radius:10px;margin:8px 0;border:1px solid var(--border)">` : "";
    return `<div class="message ${cls}"><div class="role">${label}</div>${img}<div class="body">${body}</div></div>`;
  }).join("");
  return `<div class="chat-area">${msgs}${isLoading ? '<div class="thinking">Working on it...</div>' : ''}</div>`;
}

function renderMemory(): string {
  if (memories.length === 0) return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:#fbbf24">Memory</div><div class="panel-count">${memories.length}</div></div><div class="panel-empty">Memories appear as you chat. Add manually below.</div><div class="input-row"><input id="memory-input" placeholder="Add a memory..." class="panel-input"><button id="btn-add-memory" class="btn-small">Add</button></div></div>`;
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:#fbbf24">Memory</div><div class="panel-count">${memories.length} memories</div></div>
    ${memories.map((m, i) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span>${m}</span><button class="btn-delete" data-mem-del="${i}">×</button></div>`).join("")}
    <div class="input-row"><input id="memory-input" placeholder="Add a memory..." class="panel-input"><button id="btn-add-memory" class="btn-small">Add</button></div></div>`;
}

function renderTools(): string {
  const tools = ["run_command", "read_file", "write_file", "list_files", "web_search", "speak", "voice_input", "screenshot", "git", "clipboard", "notify", "calc", "datetime", "search_files", "download_file", "diff", "processes"];
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:#22c55e">Tools</div><div class="panel-count">${tools.length} tools</div></div>
    ${tools.map(t => `<div class="card"><div class="card-title" style="color:#22c55e">${t}</div></div>`).join("")}</div>`;
}

function renderHistory(): string {
  const sorted = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.created.localeCompare(a.created));
  const filtered = searchQuery ? sorted.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))) : sorted;
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:#ec4899">History</div><div class="panel-count">${conversations.length}</div></div>
    <input id="search-input" placeholder="Search conversations..." class="panel-input" value="${searchQuery}" style="margin-bottom:12px">
    ${filtered.length === 0 ? '<div class="panel-empty">No conversations found.</div>' :
    filtered.map(c => `<div class="card" style="cursor:pointer" data-convo="${c.id}">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><div class="card-title">${c.pinned ? "📌 " : ""}${c.title}</div>
        <div class="card-meta">${new Date(c.created).toLocaleDateString()} • ${c.messages.length} msgs</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn-small" data-pin="${c.id}">${c.pinned ? "Unpin" : "Pin"}</button>
          <button class="btn-delete" data-convo-del="${c.id}">×</button>
        </div>
      </div>
    </div>`).join("")}</div>`;
}

function renderSettings(): string {
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:var(--purple)">Settings</div></div>
    <div class="card"><div class="card-title">API Key</div><input id="set-api-key" type="password" class="panel-input" value="${CONFIG.apiKey}" style="margin-top:8px"></div>
    <div class="card"><div class="card-title">Model</div><select id="set-model" class="panel-input" style="margin-top:8px">
      ${MODELS.map(m => `<option value="${m}" ${m === CONFIG.model ? "selected" : ""}>${m}</option>`).join("")}
    </select></div>
    <div class="card"><div class="card-title">Ollama URL (local models)</div><input id="set-ollama" class="panel-input" value="${CONFIG.ollamaUrl || ""}" placeholder="http://localhost:11434" style="margin-top:8px"></div>
    <div class="card"><div class="card-title">Theme</div><div style="display:flex;gap:8px;margin-top:8px">
      ${["void", "daylight", "ocean"].map(t => `<button class="btn-small ${t === theme ? "active" : ""}" data-theme="${t}" style="${t === theme ? "background:var(--purple);color:white" : ""}">${t}</button>`).join("")}
    </div></div>
    <div class="card"><div class="card-title">System Prompt</div><textarea id="set-prompt" class="panel-input" style="margin-top:8px;min-height:80px">${CONFIG.systemPrompt}</textarea></div>
    <button id="btn-save-settings" class="btn-send" style="margin-top:12px;width:100%">Save Settings</button>
    <button id="btn-export" class="btn-small" style="margin-top:8px;width:100%">Export Current Chat (.md)</button>
  </div>`;
}

let pendingImage: string | null = null;

function renderInputBar(): string {
  return `<div class="input-bar">
    <button class="btn-icon btn-voice ${voiceMode ? "active" : ""}" id="btn-voice">${voiceMode ? "Voice ON" : "Voice"}</button>
    <button class="btn-icon btn-upload" id="btn-upload" title="Upload file">Upload</button>
    <input type="file" id="file-input" style="display:none" accept="image/*,.txt,.py,.js,.ts,.json,.md,.csv,.html,.css">
    <div style="flex:1;display:flex;flex-direction:column;gap:4px">
      ${pendingImage ? `<div style="position:relative;display:inline-block"><img src="data:image/png;base64,${pendingImage}" style="max-height:60px;border-radius:8px;border:1px solid var(--border)"><button id="btn-remove-img" style="position:absolute;top:-6px;right:-6px;background:var(--pink);color:white;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:16px">×</button></div>` : ""}
      <textarea id="chat-input" placeholder="${pendingImage ? "Describe what you want to know about this image..." : "Message Lens... (paste images with Ctrl+V)"}" ${isLoading ? "disabled" : ""}></textarea>
    </div>
    <button class="btn-send" id="btn-send" ${isLoading ? "disabled" : ""}>Send</button>
  </div>`;
}

// ── Event Listeners ──
function attachListeners() {
  document.querySelectorAll(".tab[data-tab]").forEach(el => el.addEventListener("click", () => { currentTab = (el as HTMLElement).dataset.tab || "chat"; render(); }));
  document.getElementById("btn-new-chat")?.addEventListener("click", newChat);
  document.querySelectorAll(".suggestion").forEach(el => el.addEventListener("click", () => sendAndRender((el as HTMLElement).dataset.suggestion || "")));
  document.getElementById("btn-send")?.addEventListener("click", doSend);
  document.getElementById("chat-input")?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
  document.getElementById("chat-input")?.addEventListener("input", e => { const ta = e.target as HTMLTextAreaElement; ta.style.height = "48px"; ta.style.height = ta.scrollHeight + "px"; });
  document.getElementById("btn-voice")?.addEventListener("click", () => { voiceMode = !voiceMode; render(); });

  // Memory
  document.getElementById("btn-add-memory")?.addEventListener("click", () => { const i = document.getElementById("memory-input") as HTMLInputElement; if (i?.value?.trim()) { addMemory(i.value.trim()); render(); } });
  document.querySelectorAll("[data-mem-del]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); removeMemory(parseInt((el as HTMLElement).dataset.memDel || "0")); }));

  // History
  document.getElementById("search-input")?.addEventListener("input", e => { searchQuery = (e.target as HTMLInputElement).value; render(); setTimeout(() => { const si = document.getElementById("search-input") as HTMLInputElement; if (si) { si.focus(); si.setSelectionRange(searchQuery.length, searchQuery.length); } }, 0); });
  document.querySelectorAll("[data-convo]").forEach(el => el.addEventListener("click", () => loadConversation((el as HTMLElement).dataset.convo || "")));
  document.querySelectorAll("[data-convo-del]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); deleteConversation((el as HTMLElement).dataset.convoDel || ""); }));
  document.querySelectorAll("[data-pin]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); togglePin((el as HTMLElement).dataset.pin || ""); }));

  // Settings
  document.querySelectorAll("[data-theme]").forEach(el => el.addEventListener("click", () => { theme = (el as HTMLElement).dataset.theme || "void"; saveTheme(); render(); }));
  document.getElementById("btn-save-settings")?.addEventListener("click", () => {
    CONFIG.apiKey = (document.getElementById("set-api-key") as HTMLInputElement)?.value || "";
    CONFIG.model = (document.getElementById("set-model") as HTMLSelectElement)?.value || CONFIG.model;
    CONFIG.ollamaUrl = (document.getElementById("set-ollama") as HTMLInputElement)?.value || "";
    CONFIG.systemPrompt = (document.getElementById("set-prompt") as HTMLTextAreaElement)?.value || CONFIG.systemPrompt;
    saveConfig(); render();
  });
  document.getElementById("btn-export")?.addEventListener("click", exportChat);

  // Upload button
  document.getElementById("btn-upload")?.addEventListener("click", () => document.getElementById("file-input")?.click());
  document.getElementById("file-input")?.addEventListener("change", handleFileUpload);
  document.getElementById("btn-remove-img")?.addEventListener("click", () => { pendingImage = null; render(); });

  // Paste image (Ctrl+V)
  document.getElementById("chat-input")?.addEventListener("paste", handlePaste);

  // Drag and drop
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("dragover", e => { e.preventDefault(); chatInput.style.borderColor = "var(--purple)"; });
    chatInput.addEventListener("dragleave", () => { chatInput.style.borderColor = "var(--border)"; });
    chatInput.addEventListener("drop", handleDrop);
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key === "n") { e.preventDefault(); newChat(); }
    if (e.ctrlKey && e.key === "k") { e.preventDefault(); currentTab = "history"; searchQuery = ""; render(); setTimeout(() => document.getElementById("search-input")?.focus(), 0); }
    if (e.ctrlKey && e.key === "/") { e.preventDefault(); voiceMode = !voiceMode; render(); }
    if (e.ctrlKey && e.key === "u") { e.preventDefault(); document.getElementById("file-input")?.click(); }
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (file.type.startsWith("image/")) {
    pendingImage = await fileToBase64(file);
    render();
  } else {
    // Text file — read and paste into chat
    const text = await file.text();
    const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
    if (ta) {
      ta.value += `\n--- ${file.name} ---\n${text.slice(0, 3000)}${text.length > 3000 ? "\n...(truncated)" : ""}`;
      ta.style.height = ta.scrollHeight + "px";
    }
  }
  input.value = "";
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        pendingImage = await fileToBase64(file);
        render();
      }
      return;
    }
  }
}

async function handleDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.type.startsWith("image/")) {
    pendingImage = await fileToBase64(file);
    render();
  } else {
    const text = await file.text();
    const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
    if (ta) ta.value += `\n--- ${file.name} ---\n${text.slice(0, 3000)}`;
  }
}

function doSend() {
  const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
  let text = ta?.value?.trim(); if (!text && !pendingImage) return; if (isLoading) return;
  if (pendingImage) {
    // Add image to message
    text = text || "What's in this image?";
    messages.push({ role: "user", content: text, image: pendingImage });
    pendingImage = null;
    ta.value = "";
    isLoading = true; render();
    // Send with image context
    sendImageMessage(text, messages[messages.length - 1].image!);
    return;
  }
  ta.value = ""; sendAndRender(text);
}

async function sendAndRender(text: string) {
  if (isLoading) return;
  messages.push({ role: "user", content: text });
  isLoading = true; render();

  let streamedText = "";
  const response = await callLLM(token => {
    streamedText += token;
    const ca = document.querySelector(".chat-area");
    document.querySelector(".thinking")?.remove();
    let sm = document.getElementById("streaming-msg");
    if (!sm) { sm = document.createElement("div"); sm.id = "streaming-msg"; sm.className = "message lens"; sm.innerHTML = '<div class="role">LENS</div><div class="body"></div>'; ca?.appendChild(sm); }
    const body = sm.querySelector(".body"); if (body) body.textContent = streamedText;
    if (ca) ca.scrollTop = ca.scrollHeight;
  });

  // Extract memories
  extractMemories(response);

  // Execute tools
  let final = response;
  const tools = parseToolCalls(response);
  if (tools.length > 0) {
    const results: string[] = [];
    for (const c of tools) { results.push(`[${c.name}]: ${(await runTool(c.name, c.args)).slice(0, 500)}`); }
    messages.push({ role: "assistant", content: response });
    messages.push({ role: "user", content: `[results] ${results.join("\n").slice(0, 1000)}\nSummarize.` });
    final = await callLLM();
  }

  const clean = stripToolTokens(final);
  messages.push({ role: "assistant", content: clean || final });
  isLoading = false;
  saveCurrentConversation();
  render();

  // Desktop notification if window not focused
  if (document.hidden) { try { new Notification("Lens", { body: clean.slice(0, 100) }); } catch {} }
}

async function sendImageMessage(text: string, imageBase64: string) {
  // Save the upload
  try { await invoke("save_upload", { name: `img_${Date.now()}.png`, data: imageBase64 }); } catch {}

  // Call vision-capable model with image
  const apiMsgs = [
    { role: "system", content: CONFIG.systemPrompt },
    ...messages.slice(-16).map(m => {
      if (m.image) {
        return { role: m.role, content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${m.image}` } },
          { type: "text", text: m.content }
        ]};
      }
      return { role: m.role, content: m.content };
    })
  ];

  // Try vision-capable models
  const visionModels = ["google/gemma-4-26b-a4b-it:free", ...MODELS];
  let response = "";
  for (const model of visionModels) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${CONFIG.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: apiMsgs, stream: false }),
        signal: ctrl.signal,
      });
      if (!r.ok) continue;
      const d = await r.json();
      response = d.choices?.[0]?.message?.content || "";
      if (response) break;
    } catch { continue; }
  }

  if (!response) response = "Couldn't analyze the image. Vision models may be unavailable.";
  messages.push({ role: "assistant", content: response });
  isLoading = false;
  saveCurrentConversation();
  render();
}

// ── Init ──
loadConfig(); loadConversations(); loadMemories(); loadTheme();
Notification.requestPermission().catch(() => {});
render();
