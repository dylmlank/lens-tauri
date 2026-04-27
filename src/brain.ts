// Lens Brain — intelligent routing, thinking, and learning

// ── Intent Detection (no LLM needed) ──
const INSTANT_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(?:what(?:'s| is) the )?time[\s?!.]*$/i, () => `It's **${new Date().toLocaleTimeString()}** 🕐`],
  [/^(?:what(?:'s| is) )?(?:the )?date|today[\s?!.]*$/i, () => `**${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}** 📅`],
  [/^(?:hi|hello|hey|sup|yo|waddup|what'?s up)[\s!?.]*$/i, () => ["Hey! What's good? 🚀", "Yo! What can I do? 😎", "Hey! What are we building? 🔥", "What's up! 💪"][Math.floor(Math.random() * 4)]],
  [/^(?:thanks|thank you|thx|ty)[\s!?.]*$/i, () => ["Anytime! 🤙", "You got it! ✌️", "No problem! 💪"][Math.floor(Math.random() * 3)]],
  [/^(?:bye|goodbye|see ya|later|cya)[\s!?.]*$/i, () => ["Later! ✌️", "See ya! 👋", "Peace out! 🤙"][Math.floor(Math.random() * 3)]],
  [/^(?:who are you|what are you)[\s?!.]*$/i, () => "I'm **Lens** — your AI assistant. I can chat, run commands, search the web, read files, write code, and more. Built with Tauri + Rust. 🔮"],
  [/^(?:calculate|calc|what'?s|compute)\s+(.+)/i, (m) => {
    try { const r = Function(`"use strict"; return (${m[1].replace(/x/g, "*").replace(/÷/g, "/")})`)(); return typeof r === "number" ? `**${m[1]}** = **${r}** 🔢` : null as any; } catch { return null as any; }
  }],
  [/^flip a coin/i, () => Math.random() < 0.5 ? "**Heads!** 🪙" : "**Tails!** 🪙"],
  [/^roll (?:a )?dice?/i, () => `You rolled a **${Math.floor(Math.random() * 6) + 1}** 🎲`],
];

export function tryInstantResponse(text: string): string | null {
  for (const [re, fn] of INSTANT_PATTERNS) {
    const m = text.match(re);
    if (m) { const r = fn(m); if (r) return r; }
  }
  return null;
}

// ── Smart Model Selection ──
export function pickModel(text: string, hasImage: boolean): string[] {
  // Vision tasks need vision model
  if (hasImage) return ["llama3.2-vision", "google/gemma-4-26b-a4b-it:free"];

  // Short casual messages → fast small model
  if (text.length < 30 && !/code|write|build|create|explain|how|why/i.test(text)) {
    return ["llama3.2"]; // Local 3B is perfect for casual chat
  }

  // Coding/technical → needs a smarter model
  if (/code|function|class|import|def |const |let |var |bug|error|fix|debug/i.test(text)) {
    return ["llama3.2", "minimax/minimax-m2.5:free", "google/gemma-4-26b-a4b-it:free"];
  }

  // Default — try local first, then cloud
  return ["llama3.2", "minimax/minimax-m2.5:free", "tencent/hy3-preview:free"];
}

// ── Conversation Summarizer ──
export function summarizeConversation(messages: { role: string; content: string }[]): string {
  const userMsgs = messages.filter(m => m.role === "user").map(m => m.content);
  if (userMsgs.length === 0) return "Empty conversation";
  if (userMsgs.length === 1) return userMsgs[0].slice(0, 60);

  // Extract key topics
  const topics = new Set<string>();
  for (const msg of userMsgs) {
    // Extract nouns/topics from questions
    const words = msg.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    words.slice(0, 3).forEach(w => topics.add(w));
  }

  return `${userMsgs[0].slice(0, 30)}... (${userMsgs.length} messages${topics.size > 0 ? ` about ${[...topics].slice(0, 3).join(", ")}` : ""})`;
}

// ── Memory Extraction (client-side, no LLM) ──
const MEMORY_PATTERNS = [
  /my name is (\w+)/i,
  /i(?:'m| am) (?:a |an )?([\w\s]+?)(?:\.|,|!|\?|$)/i,
  /i work (?:at|for|on) ([\w\s]+?)(?:\.|,|!|\?|$)/i,
  /i (?:like|love|prefer|enjoy) ([\w\s]+?)(?:\.|,|!|\?|$)/i,
  /i(?:'m| am) learning ([\w\s]+?)(?:\.|,|!|\?|$)/i,
  /i(?:'m| am) building ([\w\s]+?)(?:\.|,|!|\?|$)/i,
];

export function extractMemoriesFromText(text: string): string[] {
  const found: string[] = [];
  for (const re of MEMORY_PATTERNS) {
    const m = text.match(re);
    if (m && m[1] && m[1].length > 2 && m[1].length < 50) {
      found.push(m[0].slice(0, 60));
    }
  }
  return found;
}

// ── Response Quality Check ──
export function isGoodResponse(question: string, answer: string): boolean {
  if (!answer || answer.length < 5) return false;
  if (answer.includes("I cannot") || answer.includes("I'm sorry, but") || answer.includes("As an AI")) return false;
  if (answer.includes("All models busy")) return false;
  // Check if answer is relevant (shares words with question)
  const qWords = new Set(question.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const aWords = new Set(answer.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const overlap = [...qWords].filter(w => aWords.has(w)).length;
  if (qWords.size > 3 && overlap === 0) return false; // No word overlap at all
  return true;
}

// ── Obsidian Vault Integration ──
export const VAULT_PATH = "/home/dylan/Documents/vault";

export function getVaultContext(): string {
  // This runs in the Tauri context — we'll call it via invoke
  return VAULT_PATH;
}
