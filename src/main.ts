// Lens v2 — Tauri + Bun rewrite

// ── State ──
let messages: { role: string; content: string }[] = [];
let voiceMode = false;
let currentTab = "chat";
let isLoading = false;

// ── Config ──
const CONFIG = {
  apiKey: "",
  model: "minimax/minimax-m2.5:free",
  systemPrompt:
    "You are Lens, a witty AI assistant. Be concise. Use emoji. Use markdown.\n" +
    "Never ask permission. Just do it.",
};

function loadConfig() {
  try {
    const saved = localStorage.getItem("lens-config");
    if (saved) Object.assign(CONFIG, JSON.parse(saved));
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
  const apiMessages = [
    { role: "system", content: CONFIG.systemPrompt },
    ...messages.slice(-20),
  ];

  const models = [CONFIG.model, ...MODELS.filter(m => m !== CONFIG.model)];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CONFIG.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages: apiMessages, stream: false }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (resp.status === 401) {
        return "Invalid API key. Go to Settings to update it.";
      }
      if (!resp.ok) continue;

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text) return text;
    } catch {
      continue;
    }
  }

  return "All models are busy. Try again in a moment.";
}

// ── Markdown ──
function md(text: string): string {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${lang ? `<span style="color:var(--text-muted);font-size:11px">${lang}</span>\n` : ""}${code.trim()}</code></pre>`
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
  s = s.replace(/^#### (.+)$/gm, '<strong style="font-size:14px">$1</strong>');
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<strong style="font-size:16px">$1</strong>');
  s = s.replace(/^# (.+)$/gm, '<strong style="font-size:18px">$1</strong>');
  s = s.replace(/^[-*] (.+)$/gm, "&nbsp;&nbsp;• $1");
  s = s.replace(/^(\d+)\. (.+)$/gm, "&nbsp;&nbsp;$1. $2");
  s = s.replace(/\n/g, "<br>");

  return s;
}

// ── Render ──
function render() {
  const app = document.getElementById("app")!;

  // Show setup screen if no API key
  if (!CONFIG.apiKey) {
    app.innerHTML = renderSetup();
    return;
  }

  const tabs = ["Chat", "Memory", "Tools", "History"];

  app.innerHTML = `
    <div class="tab-bar">
      ${tabs.map(t =>
        `<div class="tab ${currentTab === t.toLowerCase() ? "active" : ""}"
             onclick="switchTab('${t.toLowerCase()}')">${t}</div>`
      ).join("")}
      <div style="flex:1"></div>
      <div class="tab" onclick="showSettings()">Settings</div>
    </div>

    <div class="tab-content ${currentTab === "chat" ? "active" : ""}" id="tab-chat">
      ${messages.length === 0 ? renderWelcome() : renderChat()}
    </div>

    <div class="tab-content ${currentTab === "memory" ? "active" : ""}" id="tab-memory">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#fbbf24">Memory</div></div>
      <div class="panel-empty">Memories will appear here as you chat.</div></div>
    </div>

    <div class="tab-content ${currentTab === "tools" ? "active" : ""}" id="tab-tools">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#22c55e">Tools</div></div>
      ${renderTools()}</div>
    </div>

    <div class="tab-content ${currentTab === "history" ? "active" : ""}" id="tab-history">
      <div class="panel"><div class="panel-header"><div class="panel-title" style="color:#ec4899">History</div></div>
      <div class="panel-empty">Past conversations will appear here.</div></div>
    </div>

    ${currentTab === "chat" ? renderInputBar() : ""}
    <div class="model-bar">${CONFIG.model}${isLoading ? " • Working on it..." : ""}</div>
  `;

  const chatArea = document.querySelector(".chat-area");
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  if (textarea && !isLoading) textarea.focus();
}

function renderSetup(): string {
  return `
    <div class="welcome">
      <div class="welcome-orb"></div>
      <div class="welcome-orb"></div>
      <div class="welcome-orb"></div>
      <div class="welcome-logo">Lens</div>
      <div class="welcome-sub">Enter your OpenRouter API key to get started</div>
      <div class="welcome-sub" style="font-size:12px;margin-top:-8px">
        <a href="https://openrouter.ai/keys" style="color:var(--purple)" target="_blank">Get a free key at openrouter.ai/keys</a>
      </div>
      <div style="z-index:1;display:flex;gap:10px;margin-top:16px">
        <input type="password" id="api-key-input" placeholder="sk-or-v1-..."
               style="width:350px;padding:12px 18px;border-radius:12px;border:2px solid var(--border);
                      background:var(--surface);color:var(--text);font-size:14px;outline:none"
               onkeydown="if(event.key==='Enter')saveApiKey()">
        <button onclick="saveApiKey()"
                style="padding:12px 24px;border-radius:12px;border:none;background:var(--gradient-1);
                       color:white;font-weight:700;font-size:14px;cursor:pointer">
          Start
        </button>
      </div>
    </div>
  `;
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
        <div class="suggestion" onclick="sendSuggestion('What can you do?')">What can you do?</div>
        <div class="suggestion" onclick="sendSuggestion('Build something cool')">Build something cool</div>
        <div class="suggestion" onclick="sendSuggestion('Search the web for me')">Search the web</div>
        <div class="suggestion" onclick="sendSuggestion('Help me with code')">Help me with code</div>
      </div>
    </div>
  `;
}

function renderChat(): string {
  const html = messages
    .filter(m => m.role !== "system")
    .map(m => {
      const cls = m.role === "user" ? "user" : "lens";
      const label = m.role === "user" ? "YOU" : "LENS";
      const body = m.role === "user" ? m.content.replace(/</g, "&lt;").replace(/\n/g, "<br>") : md(m.content);
      return `<div class="message ${cls}"><div class="role">${label}</div><div class="body">${body}</div></div>`;
    })
    .join("");

  return `<div class="chat-area">${html}${isLoading ? '<div class="thinking">Working on it...</div>' : ''}</div>`;
}

function renderInputBar(): string {
  return `
    <div class="input-bar">
      <button class="btn-icon btn-voice ${voiceMode ? "active" : ""}"
              onclick="toggleVoice()">${voiceMode ? "Voice ON" : "Voice"}</button>
      <textarea placeholder="Message Lens..." ${isLoading ? "disabled" : ""}
                onkeydown="handleKey(event)"></textarea>
      <button class="btn-send" onclick="sendMessage()" ${isLoading ? "disabled" : ""}>Send</button>
    </div>
  `;
}

function renderTools(): string {
  const tools = [
    "run_command", "read_file", "write_file", "list_files", "web_search",
    "speak", "voice_input", "screenshot", "git", "clipboard", "calc", "datetime",
  ];
  return tools.map(t => `<div class="card"><div class="card-title" style="color:#22c55e">${t}</div></div>`).join("");
}

// ── Global Actions ──
(window as any).switchTab = (tab: string) => { currentTab = tab; render(); };
(window as any).toggleVoice = () => { voiceMode = !voiceMode; render(); };

(window as any).saveApiKey = () => {
  const input = document.getElementById("api-key-input") as HTMLInputElement;
  const key = input?.value?.trim();
  if (key) {
    CONFIG.apiKey = key;
    saveConfig();
    render();
  }
};

(window as any).showSettings = () => {
  const key = prompt("OpenRouter API Key:", CONFIG.apiKey);
  if (key !== null) {
    CONFIG.apiKey = key;
    saveConfig();
    render();
  }
};

(window as any).sendSuggestion = (text: string) => sendAndRender(text);

(window as any).sendMessage = () => {
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  const text = textarea?.value?.trim();
  if (!text || isLoading) return;
  textarea.value = "";
  sendAndRender(text);
};

(window as any).handleKey = (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    (window as any).sendMessage();
  }
};

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
