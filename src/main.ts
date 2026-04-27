// Lens v2.3 — Brain architecture
import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js";
import { tryInstantResponse, pickModel, summarizeConversation, extractMemoriesFromText, isGoodResponse } from "./brain";

// ── Types ──
interface Message { role: string; content: string; image?: string; id: string; internal?: boolean; }
interface Conversation { id: string; title: string; created: string; messages: Message[]; pinned?: boolean; branches?: Record<string, Message[]>; }
interface PromptTemplate { name: string; prompt: string; }

// ── State ──
let messages: Message[] = [];
let voiceMode = false;
let currentTab = "chat";
let isLoading = false;
let conversations: Conversation[] = [];
let memories: string[] = [];
let currentConvoId = "";
let searchQuery = "";
let vaultNotes: string[] = [];
let vaultSearch = "";
let activeNote = "";
let activeNoteContent = "";
let theme = "void";
let pendingImage: string | null = null;
let responseCache: Record<string, string> = {};
let promptTemplates: PromptTemplate[] = [
  { name: "Review code", prompt: "Review this code for bugs, security issues, and improvements:" },
  { name: "ELI5", prompt: "Explain this like I'm 5 years old:" },
  { name: "Write tests", prompt: "Write comprehensive tests for this:" },
  { name: "Summarize", prompt: "Summarize this concisely in bullet points:" },
  { name: "Debug", prompt: "Debug this error and explain the fix:" },
  { name: "Refactor", prompt: "Refactor this code to be cleaner and more efficient:" },
  { name: "Translate", prompt: "Translate this to Python:" },
  { name: "Pros & Cons", prompt: "Give me the pros and cons of this:" },
  { name: "Email", prompt: "Write a professional email about this:" },
  { name: "Brainstorm", prompt: "Brainstorm 5 creative ideas for:" },
  { name: "Regex", prompt: "Write a regex pattern that matches:" },
  { name: "SQL", prompt: "Write an SQL query to:" },
  { name: "Humanize", prompt: "Rewrite this to sound like a real person wrote it — use casual grammar, contractions, vary sentence length, start some sentences with 'and' or 'but', throw in filler words like 'honestly' or 'basically', mix up the order of points so it doesn't feel like a list, and make it sound like you're just talking to a friend. No perfect structure. No robotic patterns:" },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Config ──
const CONFIG = {
  apiKey: "", geminiKey: "", model: "minimax/minimax-m2.5:free", ollamaUrl: "",
  systemPrompt: "You are Lens, a witty AI assistant. Be concise. Use emoji and markdown. Never ask permission. Just do it.",
};

const MODELS = ["minimax/minimax-m2.5:free", "tencent/hy3-preview:free", "google/gemma-4-26b-a4b-it:free", "inclusionai/ling-2.6-flash:free"];
const THEMES: Record<string, Record<string, string>> = {
  void: { bg:"#0a0a0f", bg2:"#12121a", surface:"#1a1a2e", text:"#e4e4ef", muted:"#8888a4", purple:"#8b5cf6", pink:"#ec4899", cyan:"#06b6d4", orange:"#f97316", green:"#22c55e", border:"#1e1e30" },
  daylight: { bg:"#fafafa", bg2:"#ffffff", surface:"#f0f0f5", text:"#1a1a2e", muted:"#6b7280", purple:"#7c3aed", pink:"#db2777", cyan:"#0891b2", orange:"#ea580c", green:"#16a34a", border:"#e5e7eb" },
  ocean: { bg:"#0c1222", bg2:"#111827", surface:"#1e293b", text:"#e2e8f0", muted:"#64748b", purple:"#6366f1", pink:"#f472b6", cyan:"#22d3ee", orange:"#fb923c", green:"#4ade80", border:"#1e3a5f" },
};

// ── Persistence ──
const load = (k: string, d: any) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } };
const save = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));

function init() {
  Object.assign(CONFIG, load("lens-config", {}));
  conversations = load("lens-convos", []);
  memories = load("lens-memories", []);
  theme = localStorage.getItem("lens-theme") || "void";
  const savedTemplates = load("lens-templates", null);
  // Use saved if user has customized, otherwise use defaults (which may have new ones)
  if (savedTemplates && savedTemplates.length >= promptTemplates.length) {
    promptTemplates = savedTemplates;
  } else {
    // Merge: keep user's customizations + add any new defaults
    save("lens-templates", promptTemplates);
  }
  responseCache = load("lens-cache", {});
  applyTheme();
}

function applyTheme() {
  const t = THEMES[theme] || THEMES.void;
  const r = document.documentElement.style;
  Object.entries(t).forEach(([k, v]) => r.setProperty(`--${k}`, v));
}

// ── API ──
async function callLLM(onToken?: (t: string) => void, forceModels?: string[]): Promise<string> {
  const sysPrompt = CONFIG.systemPrompt + (memories.length > 0 ? `\nUser: ${memories.slice(0, 3).join("; ")}` : "");
  const apiMsgs = [{ role: "system", content: sysPrompt }, ...messages.slice(-16).map(m => ({ role: m.role, content: m.content }))];
  const lastMsg = messages.slice(-1)[0]?.content || "";

  // Check cache
  const cacheKey = lastMsg.slice(0, 100);
  if (responseCache[cacheKey]) { onToken?.(responseCache[cacheKey]); return responseCache[cacheKey]; }

  const models = forceModels || pickModel(lastMsg, false);

  for (const model of models) {
    try {
      // Local Ollama — use Rust backend (reliable, no CORS/CSP issues)
      if (!model.includes("/")) {
        const result = await invoke<string>("ollama_chat", {
          model,
          messagesJson: JSON.stringify(apiMsgs),
          geminiKey: CONFIG.geminiKey || "",
        });
        if (result && !result.startsWith("Error:")) {
          onToken?.(result);
          if (isGoodResponse(lastMsg, result) || models.length <= 1) {
            responseCache[cacheKey] = result;
            if (Object.keys(responseCache).length > 100) responseCache = Object.fromEntries(Object.entries(responseCache).slice(-50));
            save("lens-cache", responseCache);
            return result;
          }
          continue; // Bad quality, try next model
        }
        continue;
      }

      // Cloud model (OpenRouter) — only if API key exists
      if (!CONFIG.apiKey) continue;
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { "Authorization": `Bearer ${CONFIG.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: apiMsgs, stream: true }),
      });
      clearTimeout(timer);
      if (r.status === 401) continue; // Bad key, try next
      if (!r.ok) continue;
      const reader = r.body?.getReader(); if (!reader) continue;
      const dec = new TextDecoder(); let full = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of dec.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try { const tok = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ""; if (tok) { full += tok; onToken?.(tok); } } catch {}
        }
      }
      if (full) {
        responseCache[cacheKey] = full;
        save("lens-cache", responseCache);
        return full;
      }
    } catch { continue; }
  }
  return "Couldn't get a response. Make sure Ollama is running (ollama serve) or update your API key in Settings.";
}

// ── Tool Execution ──
async function runTool(name: string, args: Record<string, string>): Promise<string> {
  try {
    if (name === "run_command") return await invoke<string>("run_command", { command: args.command || "" });
    if (name === "read_file") return await invoke<string>("read_file", { path: args.path || "" });
    if (name === "write_file") return await invoke<string>("write_file", { path: args.path || "", content: args.content || "" });
    return await invoke<string>("run_command", { command: `echo "Unknown: ${name}"` });
  } catch (e) { return `Error: ${e}`; }
}

function parseToolCalls(text: string): { name: string; args: Record<string, string> }[] {
  const calls: { name: string; args: Record<string, string> }[] = [];
  for (const re of [/\[TOOL:name="([\w.-]+)"\s*(.*?)\]/gs, /\[TOOL:(\w+)\s*(.*?)\]/gs]) {
    let m; while ((m = re.exec(text)) !== null) {
      let name = m[1]; let as = (m[2] || "").replace(/\[\/TOOL[^\]]*\]?$/g, "").trim();
      for (const p of ["desktop-commander_", "cli-mcp-server_", "filesystem.", "github_"]) if (name.startsWith(p)) name = name.slice(p.length);
      const rn: Record<string, string> = { list_directory: "list_files", "cli:run": "run_command", run: "run_command", exec: "run_command" };
      name = rn[name] || name;
      const args: Record<string, string> = {};
      const aw = as.match(/^args="(.*)"$/s); if (aw) as = aw[1].replace(/\\"/g, '"');
      const kr = /(?:^|\s)(\w+)=/g; const pos: { k: string; s: number }[] = [];
      let km; while ((km = kr.exec(as)) !== null) pos.push({ k: km[1], s: km.index + km[0].length });
      for (let i = 0; i < pos.length; i++) { const end = i + 1 < pos.length ? pos[i + 1].s - pos[i + 1].k.length - 1 : as.length; let v = as.slice(pos[i].s, end).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); args[pos[i].k] = v; }
      if (args.key && args.value && Object.keys(args).length === 2) { args[args.key] = args.value; delete args.key; delete args.value; }
      if (args.cmd) { args.command = args.cmd; delete args.cmd; }
      calls.push({ name, args });
    }
    if (calls.length > 0) break;
  }
  return calls;
}

function stripToolTokens(t: string): string {
  return t.replace(/\[TOOL[\s\S]*?\[\/TOOL[^\]]*\]/g, "").replace(/\[TOOL:[^\]]*\]/g, "").replace(/\[\/TOOL[^\]]*\]/g, "")
    .replace(/\[WRITE_FILE:[^\]]+\][\s\S]*?\[\/WRITE_FILE\]/g, "").replace(/\[CAPTURE\]/g, "")
    .replace(/\[REMEMBER\][\s\S]*?\[\/REMEMBER\]/g, "").replace(/\[REMEMBER\]\s*.+/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Markdown with syntax highlighting ──
function md(text: string): string {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Code blocks with syntax highlighting
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    let highlighted: string;
    try { highlighted = lang ? hljs.highlight(code.trim(), { language: lang }).value : hljs.highlightAuto(code.trim()).value; }
    catch { highlighted = code.trim(); }
    return `<pre><code class="hljs">${lang ? `<span style="color:var(--muted);font-size:11px">${lang}</span>\n` : ""}${highlighted}</code></pre>`;
  });
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
  s = s.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid var(--purple);padding-left:12px;color:var(--muted)">$1</div>');
  s = s.replace(/\n/g, "<br>");
  return s;
}

// ── Conversation ──
function saveConvo() {
  if (messages.length < 2) return;
  const title = summarizeConversation(messages);
  if (currentConvoId) { const i = conversations.findIndex(c => c.id === currentConvoId); if (i >= 0) { conversations[i].messages = [...messages]; conversations[i].title = title; } }
  else { currentConvoId = uid(); conversations.unshift({ id: currentConvoId, title, created: new Date().toISOString(), messages: [...messages] }); }
  save("lens-convos", conversations.slice(0, 50));
}

function loadConvo(id: string) { saveConvo(); const c = conversations.find(c => c.id === id); if (c) { messages = [...c.messages]; currentConvoId = id; currentTab = "chat"; render(); } }
function newChat() { saveConvo(); messages = []; currentConvoId = ""; currentTab = "chat"; render(); }
function deleteConvo(id: string) { conversations = conversations.filter(c => c.id !== id); save("lens-convos", conversations); render(); }
function togglePin(id: string) { const c = conversations.find(c => c.id === id); if (c) { c.pinned = !c.pinned; save("lens-convos", conversations); render(); } }
function exportChat() { const m = messages.map(m => `**${m.role === "user" ? "You" : "Lens"}:**\n${m.content}`).join("\n\n---\n\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([m], { type: "text/markdown" })); a.download = `lens-${Date.now()}.md`; a.click(); }
function addMemory(f: string) { f = f.trim(); if (f && !memories.includes(f)) { memories.push(f); save("lens-memories", memories.slice(0, 20)); } }
function removeMemory(i: number) { memories.splice(i, 1); save("lens-memories", memories); render(); }
function extractMemories(t: string) { const re = /\[REMEMBER\](.*?)\[\/REMEMBER\]/gs; let m; while ((m = re.exec(t)) !== null) addMemory(m[1]); }

// ── Branch from message ──
function branchFrom(msgId: string) {
  const idx = messages.findIndex(m => m.id === msgId);
  if (idx < 0) return;
  saveConvo();
  messages = messages.slice(0, idx + 1);
  currentConvoId = "";
  currentTab = "chat";
  render();
  const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
  if (ta) ta.focus();
}

// ── Retry last response ──
async function retryLast() {
  if (messages.length < 2 || isLoading) return;
  // Remove last assistant message
  if (messages[messages.length - 1].role === "assistant") messages.pop();
  // Clear cache for this query
  const cacheKey = messages.slice(-1)[0]?.content?.slice(0, 100) || "";
  delete responseCache[cacheKey];
  isLoading = true; render();
  const response = await callLLM(tok => updateStreamingUI(tok));
  extractMemories(response);
  const tools = parseToolCalls(response);
  let final = response;
  if (tools.length > 0) {
    const results: string[] = [];
    for (const c of tools) results.push(`[${c.name}]: ${(await runTool(c.name, c.args)).slice(0, 500)}`);
    messages.push({ role: "assistant", content: response, id: uid(), internal: true });
    messages.push({ role: "user", content: `[results] ${results.join("\n").slice(0, 1000)}\nSummarize.`, id: uid(), internal: true });
    final = await callLLM();
  }
  messages.push({ role: "assistant", content: stripToolTokens(final) || final, id: uid() });
  isLoading = false; saveConvo(); render();
}

// ── Streaming UI update ──
let streamBuffer = "";
function updateStreamingUI(token: string) {
  streamBuffer += token;
  const ca = document.querySelector(".chat-area");
  document.querySelector(".thinking")?.remove();
  let sm = document.getElementById("streaming-msg");
  if (!sm) { sm = document.createElement("div"); sm.id = "streaming-msg"; sm.className = "message lens anim-in"; sm.innerHTML = '<div class="role">LENS</div><div class="body"></div>'; ca?.appendChild(sm); }
  // Live markdown render
  const body = sm.querySelector(".body");
  if (body) body.innerHTML = md(streamBuffer);
  if (ca) ca.scrollTop = ca.scrollHeight;
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const result = await invoke<string>("run_command", { command: "curl -s -m 2 http://localhost:11434/api/tags" });
    return result.includes("models");
  } catch { return false; }
}

// ── Render ──
let sidebarOpen = true;

async function render() {
  const app = document.getElementById("app")!;
  if (!CONFIG.apiKey && !CONFIG.ollamaUrl && !await isOllamaRunning()) { renderSetup(app); return; }
  if (!CONFIG.apiKey && !CONFIG.ollamaUrl && await isOllamaRunning()) { CONFIG.ollamaUrl = "http://localhost:11434"; CONFIG.model = "llama3.2"; save("lens-config", CONFIG); }

  const sorted = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.created.localeCompare(a.created));
  const tabs = ["Chat", "Notes", "Memory", "Tools", "Settings"];

  app.innerHTML = `
    <div class="sidebar ${sidebarOpen ? "" : "collapsed"}">
      <div class="sidebar-header">
        <span class="sidebar-logo">Lens</span>
        <button class="sidebar-btn" id="btn-collapse">✕</button>
      </div>
      <div class="new-chat-btn" id="btn-new-chat">+ New Chat</div>
      <div class="sidebar-section-title">Conversations</div>
      <div class="convo-list">
        ${sorted.map(c => `<div class="convo-item ${c.id === currentConvoId ? "active" : ""}" data-convo="${c.id}">
          ${c.pinned ? '<span class="pin">📌</span> ' : ""}${c.title}
        </div>`).join("") || '<div style="padding:12px 18px;color:var(--muted);font-size:12px">No conversations yet</div>'}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-item" data-tab="notes"><span class="icon">📝</span> Notes</div>
        <div class="sidebar-item" data-tab="memory"><span class="icon">🧠</span> Memory</div>
        <div class="sidebar-item" data-tab="tools"><span class="icon">🔧</span> Tools</div>
        <div class="sidebar-item" data-tab="settings"><span class="icon">⚙️</span> Settings</div>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <button class="topbar-toggle" id="btn-sidebar">${sidebarOpen ? "◀" : "☰"}</button>
        <div class="topbar-nav">
          ${tabs.map(t => `<button class="topbar-tab ${currentTab === t.toLowerCase() ? "active" : ""}" data-tab="${t.toLowerCase()}">${t}</button>`).join("")}
        </div>
        <div class="topbar-model">${CONFIG.model.split("/").pop()?.replace(":free", "") || CONFIG.model}${isLoading ? " • streaming..." : ""}</div>
      </div>
      ${renderTabContent()}
      ${currentTab === "chat" ? `<div class="input-wrapper">${renderInputBar()}</div>` : ""}
    </div>`;

  attachListeners();
  const ca = document.querySelector(".chat-area"); if (ca) ca.scrollTop = ca.scrollHeight;
  const ta = document.getElementById("chat-input") as HTMLTextAreaElement; if (ta && !isLoading) ta.focus();
}

function renderSetup(app: HTMLElement) {
  app.innerHTML = `<div class="welcome"><div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-logo">Lens</div><div class="welcome-sub">Enter your OpenRouter API key</div>
    <div style="z-index:1;display:flex;gap:10px;margin-top:16px;flex-direction:column;align-items:center">
    <input type="password" id="api-key-input" placeholder="sk-or-v1-..." style="width:380px;padding:14px 20px;border-radius:14px;border:2px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;outline:none">
    <input id="ollama-input" placeholder="Ollama URL (optional)" style="width:380px;padding:12px 18px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;outline:none">
    <button id="btn-save-key" style="padding:14px 32px;border-radius:14px;border:none;background:var(--gradient-1);color:white;font-weight:700;font-size:15px;cursor:pointer">Start</button></div></div>`;
  document.getElementById("btn-save-key")?.addEventListener("click", () => {
    CONFIG.apiKey = (document.getElementById("api-key-input") as HTMLInputElement)?.value?.trim() || "";
    CONFIG.ollamaUrl = (document.getElementById("ollama-input") as HTMLInputElement)?.value?.trim() || "";
    if (CONFIG.apiKey || CONFIG.ollamaUrl) { save("lens-config", CONFIG); render(); }
  });
  document.getElementById("api-key-input")?.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-save-key")?.click(); });
}

function renderTabContent(): string {
  if (currentTab === "chat") return `<div class="tab-content active">${messages.length === 0 ? renderWelcome() : renderChat()}</div>`;
  if (currentTab === "notes") return `<div class="tab-content active">${renderNotes()}</div>`;
  if (currentTab === "memory") return `<div class="tab-content active">${renderMemory()}</div>`;
  if (currentTab === "tools") return `<div class="tab-content active">${renderTools()}</div>`;
  if (currentTab === "history") return `<div class="tab-content active">${renderHistory()}</div>`;
  if (currentTab === "settings") return `<div class="tab-content active">${renderSettings()}</div>`;
  return "";
}

function renderWelcome(): string {
  return `<div class="welcome"><div class="welcome-orb"></div><div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-logo">Lens</div><div class="welcome-sub">Hey, what are we building today?</div>
    <div class="suggestions">${["What can you do?", "Build something cool", "Search the web", "Help me with code"].map(s => `<div class="suggestion" data-suggestion="${s}">${s}</div>`).join("")}</div></div>`;
}

function renderChat(): string {
  const msgs = messages.filter(m => m.role !== "system" && !m.internal).map(m => {
    const cls = m.role === "user" ? "user" : "lens";
    const label = m.role === "user" ? "YOU" : "LENS";
    const c = m.role === "user" ? m.content : stripToolTokens(m.content);
    const body = m.role === "user" ? c.replace(/</g, "&lt;").replace(/\n/g, "<br>") : md(c);
    const img = m.image ? `<img src="data:image/png;base64,${m.image}" class="msg-img">` : "";
    const actions = `<div class="msg-actions">
      <button class="msg-btn has-tooltip" data-copy="${m.id}">📋<span class="tooltip">Copy</span></button>
      ${m.role === "user" ? `<button class="msg-btn has-tooltip" data-branch="${m.id}">🔀<span class="tooltip">Branch</span></button>` : ""}
      ${m.role === "assistant" ? `<button class="msg-btn has-tooltip" data-retry>🔄<span class="tooltip">Retry</span></button>` : ""}
    </div>`;
    return `<div class="message ${cls} anim-in">${actions}<div class="role">${label}</div>${img}<div class="body">${body}</div></div>`;
  }).join("");
  return `<div class="chat-area">${msgs}${isLoading ? '<div class="thinking"><div class="skeleton"></div><div class="skeleton short"></div></div>' : ''}</div>`;
}

function renderInputBar(): string {
  const templateOptions = promptTemplates.map(t => `<div class="dropdown-item" data-template="${t.prompt}">${t.name}</div>`).join("");
  return `<div class="input-bar">
    <div class="dropdown" id="template-dropdown">
      <button class="btn-icon btn-templates" id="btn-templates">Templates ▾</button>
      <div class="dropdown-menu" id="template-menu">${templateOptions}</div>
    </div>
    <button class="btn-icon btn-voice ${voiceMode ? "active" : ""}" id="btn-voice">${voiceMode ? "Voice ON" : "Voice"}</button>
    <button class="btn-icon btn-upload" id="btn-upload">Upload</button>
    <input type="file" id="file-input" style="display:none" accept="image/*,.txt,.py,.js,.ts,.json,.md,.csv,.html,.css">
    <div style="flex:1;display:flex;flex-direction:column;gap:4px">
      ${pendingImage ? `<div style="position:relative;display:inline-block"><img src="data:image/png;base64,${pendingImage}" class="pending-img"><button id="btn-remove-img" class="remove-img">×</button></div>` : ""}
      <textarea id="chat-input" placeholder="Message Lens... (Ctrl+V to paste images)" ${isLoading ? "disabled" : ""}></textarea>
    </div>
    <button class="btn-send" id="btn-send" ${isLoading ? "disabled" : ""}>Send</button>
  </div>`;
}

async function loadVaultNotes() {
  try { const r = await invoke<string>("list_vault_notes"); vaultNotes = r.split("\n").filter(Boolean); } catch { vaultNotes = []; }
}

async function openNote(path: string) {
  activeNote = path;
  try { activeNoteContent = await invoke<string>("read_file", { path: `/home/dylan/Documents/vault/${path}` }); } catch (e) { activeNoteContent = `Error: ${e}`; }
  render();
}

async function saveNote() {
  if (!activeNote) return;
  const ta = document.getElementById("note-editor") as HTMLTextAreaElement;
  if (!ta) return;
  try {
    await invoke("write_vault_note", { path: activeNote, content: ta.value });
    activeNoteContent = ta.value;
  } catch {}
}

async function createNote() {
  const name = prompt("Note name (e.g. Ideas/new-idea.md):");
  if (!name) return;
  const path = name.endsWith(".md") ? name : name + ".md";
  try {
    await invoke("write_vault_note", { path, content: `# ${path.replace(/\.md$/, "").split("/").pop()}\n\n` });
    await loadVaultNotes();
    openNote(path);
  } catch {}
}

async function searchVault() {
  if (!vaultSearch.trim()) return;
  try {
    const results = await invoke<string>("search_vault", { query: vaultSearch });
    activeNote = "";
    activeNoteContent = results;
    render();
  } catch {}
}

function renderNotes(): string {
  // Split view: file list on left, content on right
  const filtered = vaultSearch
    ? vaultNotes.filter(n => n.toLowerCase().includes(vaultSearch.toLowerCase()))
    : vaultNotes;

  const folders: Record<string, string[]> = {};
  for (const note of filtered) {
    const parts = note.split("/");
    const folder = parts.length > 1 ? parts[0] : "Root";
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(note);
  }

  const fileList = Object.entries(folders).map(([folder, notes]) =>
    `<div class="sidebar-section-title" style="padding:4px 0">${folder}</div>
     ${notes.map(n => `<div class="convo-item ${n === activeNote ? "active" : ""}" data-note="${n}" style="font-size:12px;padding:5px 8px">${n.split("/").pop()?.replace(".md","")}</div>`).join("")}`
  ).join("");

  const content = activeNote
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="card-title" style="color:var(--purple)">${activeNote}</div>
        <div style="display:flex;gap:6px">
          <button class="btn-small" id="btn-save-note">Save</button>
          <button class="btn-small" id="btn-ask-note">Ask Lens about this</button>
        </div>
      </div>
      <textarea id="note-editor" class="panel-input" style="flex:1;min-height:300px;font-family:'JetBrains Mono',monospace;font-size:13px;line-height:1.6;resize:none">${activeNoteContent.replace(/</g, "&lt;")}</textarea>`
    : activeNoteContent
      ? `<div class="card-title" style="color:var(--purple);margin-bottom:8px">Search Results</div><div style="white-space:pre-wrap;font-size:13px;line-height:1.6">${md(activeNoteContent)}</div>`
      : `<div class="panel-empty">Select a note or search your vault</div>`;

  return `<div style="display:flex;flex:1;overflow:hidden">
    <div style="width:200px;min-width:200px;border-right:1px solid var(--border);overflow-y:auto;padding:8px 0">
      <div style="padding:4px 8px"><input id="vault-search" class="panel-input" placeholder="Search notes..." value="${vaultSearch}" style="font-size:12px;padding:6px 10px"></div>
      <div style="padding:4px 8px;margin-bottom:4px"><button class="btn-small" id="btn-new-note" style="width:100%">+ New Note</button></div>
      ${fileList}
    </div>
    <div style="flex:1;padding:16px;display:flex;flex-direction:column;overflow-y:auto">${content}</div>
  </div>`;
}

function renderMemory(): string {
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:var(--orange)">Memory</div><div class="panel-count">${memories.length}</div></div>
    ${memories.length === 0 ? '<div class="panel-empty">Memories appear as you chat.</div>' : memories.map((m, i) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span>${m}</span><button class="btn-delete" data-mem-del="${i}">×</button></div>`).join("")}
    <div class="input-row"><input id="memory-input" placeholder="Add a memory..." class="panel-input"><button id="btn-add-memory" class="btn-small">Add</button></div></div>`;
}

function renderTools(): string {
  const tools = ["run_command","read_file","write_file","list_files","web_search","speak","screenshot","git","clipboard","notify","calc","datetime","search_files","download_file","diff","processes"];
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:var(--green)">Tools</div><div class="panel-count">${tools.length}</div></div>
    ${tools.map(t => `<div class="card"><div class="card-title" style="color:var(--green)">${t}</div></div>`).join("")}</div>`;
}

function renderHistory(): string {
  const sorted = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.created.localeCompare(a.created));
  const filtered = searchQuery ? sorted.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))) : sorted;
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:var(--pink)">History</div><div class="panel-count">${conversations.length}</div></div>
    <input id="search-input" placeholder="Search conversations..." class="panel-input" value="${searchQuery}" style="margin-bottom:12px">
    ${filtered.length === 0 ? '<div class="panel-empty">No conversations.</div>' : filtered.map(c => `<div class="card" style="cursor:pointer" data-convo="${c.id}">
    <div style="display:flex;justify-content:space-between"><div><div class="card-title">${c.pinned ? "📌 " : ""}${c.title}</div><div class="card-meta">${new Date(c.created).toLocaleDateString()} • ${c.messages.length} msgs</div></div>
    <div style="display:flex;gap:4px"><button class="btn-small" data-pin="${c.id}">${c.pinned ? "Unpin" : "Pin"}</button><button class="btn-delete" data-convo-del="${c.id}">×</button></div></div></div>`).join("")}</div>`;
}

function renderSettings(): string {
  return `<div class="panel"><div class="panel-header"><div class="panel-title" style="color:var(--purple)">Settings</div></div>
    <div class="card"><div class="card-title">OpenRouter API Key</div><input id="set-api-key" type="password" class="panel-input" value="${CONFIG.apiKey}" placeholder="sk-or-v1-... (optional if using Ollama)" style="margin-top:8px"></div>
    <div class="card"><div class="card-title" style="color:var(--cyan)">Gemini API Key (for image analysis)</div><input id="set-gemini-key" type="password" class="panel-input" value="${CONFIG.geminiKey || ""}" placeholder="Get free at aistudio.google.com/apikey" style="margin-top:8px"></div>
    <div class="card"><div class="card-title">Model</div><select id="set-model" class="panel-input" style="margin-top:8px">${MODELS.map(m => `<option value="${m}" ${m === CONFIG.model ? "selected" : ""}>${m}</option>`).join("")}</select></div>
    <div class="card"><div class="card-title">Ollama URL</div><input id="set-ollama" class="panel-input" value="${CONFIG.ollamaUrl || ""}" placeholder="http://localhost:11434" style="margin-top:8px"></div>
    <div class="card"><div class="card-title">Theme</div><div style="display:flex;gap:8px;margin-top:8px">${["void","daylight","ocean"].map(t => `<button class="btn-small ${t === theme ? "active" : ""}" data-theme="${t}">${t}</button>`).join("")}</div></div>
    <div class="card"><div class="card-title">System Prompt</div><textarea id="set-prompt" class="panel-input" style="margin-top:8px;min-height:80px">${CONFIG.systemPrompt}</textarea></div>
    <div class="card"><div class="card-title">Prompt Templates</div><div style="margin-top:8px">${promptTemplates.map((t, i) => `<div style="display:flex;gap:6px;margin-bottom:4px"><input class="panel-input" value="${t.name}" data-tpl-name="${i}" style="width:120px"><input class="panel-input" value="${t.prompt}" data-tpl-prompt="${i}"><button class="btn-delete" data-tpl-del="${i}">×</button></div>`).join("")}
    <button id="btn-add-template" class="btn-small" style="margin-top:4px">+ Add Template</button></div></div>
    <button id="btn-save-settings" class="btn-send" style="margin-top:12px;width:100%">Save Settings</button>
    <button id="btn-export" class="btn-small" style="margin-top:8px;width:100%">Export Chat (.md)</button>
    <button id="btn-clear-cache" class="btn-small" style="margin-top:4px;width:100%">Clear Response Cache (${Object.keys(responseCache).length} entries)</button></div>`;
}

// ── Event Listeners ──
function attachListeners() {
  // Sidebar + tabs
  document.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => { currentTab = (el as HTMLElement).dataset.tab || "chat"; render(); }));
  document.getElementById("btn-new-chat")?.addEventListener("click", newChat);
  document.getElementById("btn-collapse")?.addEventListener("click", () => { sidebarOpen = false; render(); });
  document.getElementById("btn-sidebar")?.addEventListener("click", () => { sidebarOpen = !sidebarOpen; render(); });
  document.querySelectorAll(".convo-item[data-convo]").forEach(el => el.addEventListener("click", () => loadConvo((el as HTMLElement).dataset.convo || "")));
  document.querySelectorAll(".suggestion").forEach(el => el.addEventListener("click", () => sendAndRender((el as HTMLElement).dataset.suggestion || "")));
  // (templates handled by dropdown above)
  document.getElementById("btn-send")?.addEventListener("click", doSend);
  document.getElementById("chat-input")?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
  document.getElementById("chat-input")?.addEventListener("input", e => { const ta = e.target as HTMLTextAreaElement; ta.style.height = "48px"; ta.style.height = ta.scrollHeight + "px"; });
  document.getElementById("btn-voice")?.addEventListener("click", () => { voiceMode = !voiceMode; render(); });
  // Templates dropdown
  document.getElementById("btn-templates")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("template-menu")?.classList.toggle("show");
  });
  document.querySelectorAll(".dropdown-item[data-template]").forEach(el => el.addEventListener("click", () => {
    const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
    if (ta) { ta.value = (el as HTMLElement).dataset.template + " " + ta.value; ta.focus(); }
    document.getElementById("template-menu")?.classList.remove("show");
  }));
  document.addEventListener("click", () => document.getElementById("template-menu")?.classList.remove("show"));

  // Notes
  document.querySelectorAll("[data-note]").forEach(el => el.addEventListener("click", () => openNote((el as HTMLElement).dataset.note || "")));
  document.getElementById("btn-new-note")?.addEventListener("click", () => createNote());
  document.getElementById("btn-save-note")?.addEventListener("click", () => saveNote());
  document.getElementById("btn-ask-note")?.addEventListener("click", () => {
    if (activeNoteContent) { currentTab = "chat"; sendAndRender(`Here's my note "${activeNote}":\n\n${activeNoteContent.slice(0, 1000)}\n\nSummarize the key points.`); }
  });
  document.getElementById("vault-search")?.addEventListener("input", e => { vaultSearch = (e.target as HTMLInputElement).value; render(); setTimeout(() => { const si = document.getElementById("vault-search") as HTMLInputElement; if (si) { si.focus(); si.setSelectionRange(vaultSearch.length, vaultSearch.length); } }, 0); });
  document.getElementById("vault-search")?.addEventListener("keydown", e => { if (e.key === "Enter") searchVault(); });

  document.getElementById("btn-upload")?.addEventListener("click", () => document.getElementById("file-input")?.click());
  document.getElementById("file-input")?.addEventListener("change", handleFileUpload);
  document.getElementById("btn-remove-img")?.addEventListener("click", () => { pendingImage = null; render(); });
  document.getElementById("chat-input")?.addEventListener("paste", handlePaste as any);
  const ci = document.getElementById("chat-input"); if (ci) { ci.addEventListener("dragover", e => { e.preventDefault(); ci.style.borderColor = "var(--purple)"; }); ci.addEventListener("dragleave", () => ci.style.borderColor = "var(--border)"); ci.addEventListener("drop", handleDrop as any); }

  // Message actions
  document.querySelectorAll("[data-copy]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); const m = messages.find(m => m.id === (el as HTMLElement).dataset.copy); if (m) navigator.clipboard.writeText(m.content); }));
  document.querySelectorAll("[data-branch]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); branchFrom((el as HTMLElement).dataset.branch || ""); }));
  document.querySelectorAll("[data-retry]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); retryLast(); }));

  // Memory
  document.getElementById("btn-add-memory")?.addEventListener("click", () => { const i = document.getElementById("memory-input") as HTMLInputElement; if (i?.value?.trim()) { addMemory(i.value.trim()); render(); } });
  document.querySelectorAll("[data-mem-del]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); removeMemory(parseInt((el as HTMLElement).dataset.memDel || "0")); }));

  // History
  document.getElementById("search-input")?.addEventListener("input", e => { searchQuery = (e.target as HTMLInputElement).value; render(); setTimeout(() => { const si = document.getElementById("search-input") as HTMLInputElement; if (si) { si.focus(); si.setSelectionRange(searchQuery.length, searchQuery.length); } }, 0); });
  document.querySelectorAll("[data-convo]").forEach(el => el.addEventListener("click", () => loadConvo((el as HTMLElement).dataset.convo || "")));
  document.querySelectorAll("[data-convo-del]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); deleteConvo((el as HTMLElement).dataset.convoDel || ""); }));
  document.querySelectorAll("[data-pin]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); togglePin((el as HTMLElement).dataset.pin || ""); }));

  // Settings
  document.querySelectorAll("[data-theme]").forEach(el => el.addEventListener("click", () => { theme = (el as HTMLElement).dataset.theme || "void"; localStorage.setItem("lens-theme", theme); applyTheme(); render(); }));
  document.getElementById("btn-save-settings")?.addEventListener("click", () => {
    CONFIG.apiKey = (document.getElementById("set-api-key") as HTMLInputElement)?.value || "";
    CONFIG.geminiKey = (document.getElementById("set-gemini-key") as HTMLInputElement)?.value || "";
    CONFIG.model = (document.getElementById("set-model") as HTMLSelectElement)?.value || CONFIG.model;
    CONFIG.ollamaUrl = (document.getElementById("set-ollama") as HTMLInputElement)?.value || "";
    CONFIG.systemPrompt = (document.getElementById("set-prompt") as HTMLTextAreaElement)?.value || CONFIG.systemPrompt;
    // Save templates
    document.querySelectorAll("[data-tpl-name]").forEach(el => { const i = parseInt((el as HTMLElement).dataset.tplName || "0"); if (promptTemplates[i]) promptTemplates[i].name = (el as HTMLInputElement).value; });
    document.querySelectorAll("[data-tpl-prompt]").forEach(el => { const i = parseInt((el as HTMLElement).dataset.tplPrompt || "0"); if (promptTemplates[i]) promptTemplates[i].prompt = (el as HTMLInputElement).value; });
    save("lens-config", CONFIG); save("lens-templates", promptTemplates); render();
  });
  document.getElementById("btn-export")?.addEventListener("click", exportChat);
  document.getElementById("btn-clear-cache")?.addEventListener("click", () => { responseCache = {}; save("lens-cache", {}); render(); });
  document.getElementById("btn-add-template")?.addEventListener("click", () => { promptTemplates.push({ name: "New", prompt: "" }); render(); });
  document.querySelectorAll("[data-tpl-del]").forEach(el => el.addEventListener("click", () => { promptTemplates.splice(parseInt((el as HTMLElement).dataset.tplDel || "0"), 1); save("lens-templates", promptTemplates); render(); }));

  // Global keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key === "n") { e.preventDefault(); newChat(); }
    if (e.ctrlKey && e.key === "k") { e.preventDefault(); currentTab = "history"; searchQuery = ""; render(); setTimeout(() => document.getElementById("search-input")?.focus(), 0); }
    if (e.ctrlKey && e.key === "/") { e.preventDefault(); voiceMode = !voiceMode; render(); }
    if (e.ctrlKey && e.key === "u") { e.preventDefault(); document.getElementById("file-input")?.click(); }
    if (e.ctrlKey && e.key === "e") { e.preventDefault(); exportChat(); }
  });
}

// ── File handlers ──
function fileToBase64(file: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(file); }); }
async function handleFileUpload(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; if (f.type.startsWith("image/")) { pendingImage = await fileToBase64(f); render(); } else { const t = await f.text(); const ta = document.getElementById("chat-input") as HTMLTextAreaElement; if (ta) ta.value += `\n--- ${f.name} ---\n${t.slice(0, 3000)}`; } (e.target as HTMLInputElement).value = ""; }
async function handlePaste(e: ClipboardEvent) { for (const item of e.clipboardData?.items || []) { if (item.type.startsWith("image/")) { e.preventDefault(); const f = item.getAsFile(); if (f) { pendingImage = await fileToBase64(f); render(); } return; } } }
async function handleDrop(e: DragEvent) { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (!f) return; if (f.type.startsWith("image/")) { pendingImage = await fileToBase64(f); render(); } else { const t = await f.text(); const ta = document.getElementById("chat-input") as HTMLTextAreaElement; if (ta) ta.value += `\n--- ${f.name} ---\n${t.slice(0, 3000)}`; } }

function doSend() {
  const ta = document.getElementById("chat-input") as HTMLTextAreaElement;
  let text = ta?.value?.trim(); if (!text && !pendingImage) return; if (isLoading) return;
  if (pendingImage) {
    text = text || "What's in this image?";
    const imgData = pendingImage; // Capture before clearing
    messages.push({ role: "user", content: text, image: imgData, id: uid() });
    pendingImage = null;
    ta.value = "";
    isLoading = true;
    render();
    sendImageMessage(text, imgData); // Pass directly, not from messages
    return;
  }
  ta.value = ""; sendAndRender(text);
}

async function sendAndRender(text: string) {
  if (isLoading) return;

  // Brain: instant response for simple stuff (0ms)
  const instant = tryInstantResponse(text);
  if (instant) { messages.push({ role: "user", content: text, id: uid() }); messages.push({ role: "assistant", content: instant, id: uid() }); saveConvo(); render(); return; }

  // Brain: extract memories from user message
  for (const mem of extractMemoriesFromText(text)) addMemory(mem);

  messages.push({ role: "user", content: text, id: uid() }); isLoading = true; streamBuffer = ""; render();

  const response = await callLLM(tok => updateStreamingUI(tok));
  extractMemories(response);
  const tools = parseToolCalls(response);
  let final = response;
  if (tools.length > 0) {
    const results: string[] = [];
    for (const c of tools) results.push(`[${c.name}]: ${(await runTool(c.name, c.args)).slice(0, 500)}`);
    messages.push({ role: "assistant", content: response, id: uid(), internal: true });
    messages.push({ role: "user", content: `[results] ${results.join("\n").slice(0, 1000)}\nSummarize.`, id: uid(), internal: true });
    final = await callLLM();
  }
  messages.push({ role: "assistant", content: stripToolTokens(final) || final, id: uid() });
  isLoading = false; saveConvo(); render();
  if (document.hidden) { try { new Notification("Lens", { body: stripToolTokens(final).slice(0, 100) }); } catch {} }
}

async function sendImageMessage(text: string, img: string) {
  // Show loading in chat
  const ca = document.querySelector(".chat-area");
  if (ca) {
    ca.innerHTML += '<div class="thinking"><div class="skeleton"></div><div class="skeleton short"></div><div style="color:var(--muted);font-size:12px;margin-top:4px">Analyzing image (this may take a moment)...</div></div>';
    ca.scrollTop = ca.scrollHeight;
  }

  let response = "";
  try {
    response = await invoke<string>("analyze_image", { prompt: text, imageBase64: img, geminiKey: CONFIG.geminiKey || "" });
  } catch (e) {
    response = `Error analyzing image: ${e}`;
  }

  messages.push({ role: "assistant", content: response || "Couldn't analyze the image.", id: uid() });
  isLoading = false; saveConvo(); render();
}

// ── Init ──
init();
loadVaultNotes();
Notification.requestPermission().catch(() => {});
render();
