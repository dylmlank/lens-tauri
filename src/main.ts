// Lens v2 — Tauri + Bun rewrite
import { invoke } from "@tauri-apps/api/core";

// ── State ──
let messages: { role: string; content: string }[] = [];
let voiceMode = false;
let currentTab = "chat";

// ── Config ──
const CONFIG = {
  apiKey: "",
  model: "minimax/minimax-m2.5:free",
  systemPrompt:
    "You are Lens, a witty AI assistant. Be concise. Use emoji. Use markdown.\n" +
    "Tools: [TOOL:run_command command=...] [TOOL:speak text=...] [TOOL:read_file path=...]\n" +
    "Never ask permission. Just do it.",
};

// Load config from localStorage
function loadConfig() {
  const saved = localStorage.getItem("lens-config");
  if (saved) Object.assign(CONFIG, JSON.parse(saved));
}

function saveConfig() {
  localStorage.setItem("lens-config", JSON.stringify(CONFIG));
}

// ── API ──
async function chat(userMessage: string): Promise<string> {
  messages.push({ role: "user", content: userMessage });

  const body = {
    model: CONFIG.model,
    messages: [
      { role: "system", content: CONFIG.systemPrompt },
      ...messages.slice(-20),
    ],
    stream: false,
  };

  const fallbackModels = [
    CONFIG.model,
    "minimax/minimax-m2.5:free",
    "tencent/hy3-preview:free",
    "google/gemma-4-26b-a4b-it:free",
    "inclusionai/ling-2.6-flash:free",
  ];

  for (const model of fallbackModels) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CONFIG.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, model }),
        signal: AbortSignal.timeout(12000),
      });

      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text) {
        messages.push({ role: "assistant", content: text });
        return text;
      }
    } catch {
      continue;
    }
  }

  return "All models are busy right now. Try again in a moment.";
}

// ── Markdown ──
function md(text: string): string {
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${lang ? `<span class="lang">${lang}</span>\n` : ""}${code.trim()}</code></pre>`
  );

  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold + italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");

  // Headings
  s = s.replace(/^#### (.+)$/gm, '<strong style="font-size:14px">$1</strong>');
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<strong style="font-size:16px">$1</strong>');
  s = s.replace(/^# (.+)$/gm, '<strong style="font-size:18px">$1</strong>');

  // Lists
  s = s.replace(/^[-*] (.+)$/gm, "&nbsp;&nbsp;• $1");
  s = s.replace(/^(\d+)\. (.+)$/gm, "&nbsp;&nbsp;$1. $2");

  // Line breaks
  s = s.replace(/\n/g, "<br>");

  return s;
}

// ── Render ──
function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="tab-bar">
      ${["Chat", "Memory", "Tools", "History"].map(
        (t) =>
          `<div class="tab ${currentTab === t.toLowerCase() ? "active" : ""}"
               onclick="window.switchTab('${t.toLowerCase()}')">${t}</div>`
      ).join("")}
    </div>

    <div class="tab-content ${currentTab === "chat" ? "active" : ""}" id="tab-chat">
      ${messages.length === 0 ? renderWelcome() : renderChat()}
    </div>

    <div class="tab-content ${currentTab === "memory" ? "active" : ""}" id="tab-memory">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #fbbf24">Memory</div>
        </div>
        <div class="panel-empty">Memories will appear here as you chat.</div>
      </div>
    </div>

    <div class="tab-content ${currentTab === "tools" ? "active" : ""}" id="tab-tools">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #22c55e">Tools</div>
        </div>
        ${renderTools()}
      </div>
    </div>

    <div class="tab-content ${currentTab === "history" ? "active" : ""}" id="tab-history">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #ec4899">History</div>
        </div>
        <div class="panel-empty">Past conversations will appear here.</div>
      </div>
    </div>

    ${currentTab === "chat" ? renderInputBar() : ""}
    <div class="model-bar">${CONFIG.model}</div>
  `;

  // Scroll chat to bottom
  const chatArea = document.querySelector(".chat-area");
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

  // Focus input
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  if (textarea) textarea.focus();
}

function renderWelcome(): string {
  return `
    <div class="welcome">
      <div class="welcome-orb"></div>
      <div class="welcome-orb"></div>
      <div class="welcome-orb"></div>
      <div class="welcome-logo">Lens</div>
      <div class="welcome-sub">Hey, what are we building today?</div>
      <div class="suggestions">
        <div class="suggestion" onclick="window.sendSuggestion('What\\'s on my screen?')">What's on my screen?</div>
        <div class="suggestion" onclick="window.sendSuggestion('Build something cool')">Build something cool</div>
        <div class="suggestion" onclick="window.sendSuggestion('Search the web for me')">Search the web</div>
        <div class="suggestion" onclick="window.sendSuggestion('Help me with code')">Help me with code</div>
      </div>
    </div>
  `;
}

function renderChat(): string {
  const msgs = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const role = m.role === "user" ? "user" : "lens";
      const label = m.role === "user" ? "YOU" : "LENS";
      const body = m.role === "user" ? m.content.replace(/</g, "&lt;") : md(m.content);
      return `<div class="message ${role}"><div class="role">${label}</div><div class="body">${body}</div></div>`;
    })
    .join("");

  return `<div class="chat-area">${msgs}</div>`;
}

function renderInputBar(): string {
  return `
    <div class="input-bar">
      <button class="btn-icon btn-capture" onclick="window.capture()">Capture</button>
      <button class="btn-icon btn-voice ${voiceMode ? "active" : ""}"
              onclick="window.toggleVoice()">${voiceMode ? "Voice ON" : "Voice"}</button>
      <textarea placeholder="Message Lens..."
                onkeydown="window.handleKey(event)"
                oninput="this.style.height='48px';this.style.height=this.scrollHeight+'px'"></textarea>
      <button class="btn-send" onclick="window.sendMessage()">Send</button>
    </div>
  `;
}

function renderTools(): string {
  const tools = [
    "run_command", "read_file", "write_file", "list_files", "web_search",
    "web_fetch", "speak", "voice_input", "screenshot", "git",
    "clipboard", "notify", "calc", "datetime", "search_files",
  ];
  return tools
    .map((t) => `<div class="card"><div class="card-title" style="color:#22c55e">${t}</div></div>`)
    .join("");
}

// ── Actions ──
(window as any).switchTab = (tab: string) => {
  currentTab = tab;
  render();
};

(window as any).sendSuggestion = async (text: string) => {
  await sendAndRender(text);
};

(window as any).sendMessage = async () => {
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  const text = textarea?.value?.trim();
  if (!text) return;
  textarea.value = "";
  await sendAndRender(text);
};

(window as any).handleKey = (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    (window as any).sendMessage();
  }
};

(window as any).toggleVoice = () => {
  voiceMode = !voiceMode;
  render();
};

(window as any).capture = () => {
  sendAndRender("What's on my screen?");
};

async function sendAndRender(text: string) {
  messages.push({ role: "user", content: text });
  render();

  // Show thinking
  const chatArea = document.querySelector(".chat-area");
  if (chatArea) {
    chatArea.innerHTML += '<div class="thinking">Working on it...</div>';
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  const response = await chat(text);
  // Remove the user message we added (chat() adds it again)
  messages.pop();
  messages.pop();
  messages.push({ role: "user", content: text });
  messages.push({ role: "assistant", content: response });

  render();
}

// ── Init ──
loadConfig();

// First-run: ask for API key
if (!CONFIG.apiKey) {
  const key = prompt("Enter your OpenRouter API key (get one free at openrouter.ai/keys):");
  if (key) {
    CONFIG.apiKey = key;
    saveConfig();
  }
}

render();
