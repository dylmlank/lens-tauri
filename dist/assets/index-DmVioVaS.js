(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const n of s)if(n.type==="childList")for(const r of n.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&o(r)}).observe(document,{childList:!0,subtree:!0});function i(s){const n={};return s.integrity&&(n.integrity=s.integrity),s.referrerPolicy&&(n.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?n.credentials="include":s.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function o(s){if(s.ep)return;s.ep=!0;const n=i(s);fetch(s.href,n)}})();let a=[],p=!1,l="chat";const c={apiKey:"",model:"minimax/minimax-m2.5:free",systemPrompt:`You are Lens, a witty AI assistant. Be concise. Use emoji. Use markdown.
Tools: [TOOL:run_command command=...] [TOOL:speak text=...] [TOOL:read_file path=...]
Never ask permission. Just do it.`};function m(){const t=localStorage.getItem("lens-config");t&&Object.assign(c,JSON.parse(t))}function g(){localStorage.setItem("lens-config",JSON.stringify(c))}async function v(t){a.push({role:"user",content:t});const e={model:c.model,messages:[{role:"system",content:c.systemPrompt},...a.slice(-20)],stream:!1},i=[c.model,"minimax/minimax-m2.5:free","tencent/hy3-preview:free","google/gemma-4-26b-a4b-it:free","inclusionai/ling-2.6-flash:free"];for(const o of i)try{const s=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${c.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({...e,model:o}),signal:AbortSignal.timeout(12e3)});if(!s.ok)continue;const r=(await s.json()).choices?.[0]?.message?.content||"";if(r)return a.push({role:"assistant",content:r}),r}catch{continue}return"All models are busy right now. Try again in a moment."}function f(t){let e=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return e=e.replace(/```(\w*)\n([\s\S]*?)```/g,(i,o,s)=>`<pre><code>${o?`<span class="lang">${o}</span>
`:""}${s.trim()}</code></pre>`),e=e.replace(/`([^`]+)`/g,"<code>$1</code>"),e=e.replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>"),e=e.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>"),e=e.replace(/(?<!\w)\*(.+?)\*(?!\w)/g,"<em>$1</em>"),e=e.replace(/^#### (.+)$/gm,'<strong style="font-size:14px">$1</strong>'),e=e.replace(/^### (.+)$/gm,'<strong style="font-size:15px">$1</strong>'),e=e.replace(/^## (.+)$/gm,'<strong style="font-size:16px">$1</strong>'),e=e.replace(/^# (.+)$/gm,'<strong style="font-size:18px">$1</strong>'),e=e.replace(/^[-*] (.+)$/gm,"&nbsp;&nbsp;• $1"),e=e.replace(/^(\d+)\. (.+)$/gm,"&nbsp;&nbsp;$1. $2"),e=e.replace(/\n/g,"<br>"),e}function d(){const t=document.getElementById("app");t.innerHTML=`
    <div class="tab-bar">
      ${["Chat","Memory","Tools","History"].map(o=>`<div class="tab ${l===o.toLowerCase()?"active":""}"
               onclick="window.switchTab('${o.toLowerCase()}')">${o}</div>`).join("")}
    </div>

    <div class="tab-content ${l==="chat"?"active":""}" id="tab-chat">
      ${a.length===0?h():y()}
    </div>

    <div class="tab-content ${l==="memory"?"active":""}" id="tab-memory">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #fbbf24">Memory</div>
        </div>
        <div class="panel-empty">Memories will appear here as you chat.</div>
      </div>
    </div>

    <div class="tab-content ${l==="tools"?"active":""}" id="tab-tools">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #22c55e">Tools</div>
        </div>
        ${b()}
      </div>
    </div>

    <div class="tab-content ${l==="history"?"active":""}" id="tab-history">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="color: #ec4899">History</div>
        </div>
        <div class="panel-empty">Past conversations will appear here.</div>
      </div>
    </div>

    ${l==="chat"?w():""}
    <div class="model-bar">${c.model}</div>
  `;const e=document.querySelector(".chat-area");e&&(e.scrollTop=e.scrollHeight);const i=document.querySelector("textarea");i&&i.focus()}function h(){return`
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
  `}function y(){return`<div class="chat-area">${a.filter(e=>e.role!=="system").map(e=>{const i=e.role==="user"?"user":"lens",o=e.role==="user"?"YOU":"LENS",s=e.role==="user"?e.content.replace(/</g,"&lt;"):f(e.content);return`<div class="message ${i}"><div class="role">${o}</div><div class="body">${s}</div></div>`}).join("")}</div>`}function w(){return`
    <div class="input-bar">
      <button class="btn-icon btn-capture" onclick="window.capture()">Capture</button>
      <button class="btn-icon btn-voice ${p?"active":""}"
              onclick="window.toggleVoice()">${p?"Voice ON":"Voice"}</button>
      <textarea placeholder="Message Lens..."
                onkeydown="window.handleKey(event)"
                oninput="this.style.height='48px';this.style.height=this.scrollHeight+'px'"></textarea>
      <button class="btn-send" onclick="window.sendMessage()">Send</button>
    </div>
  `}function b(){return["run_command","read_file","write_file","list_files","web_search","web_fetch","speak","voice_input","screenshot","git","clipboard","notify","calc","datetime","search_files"].map(e=>`<div class="card"><div class="card-title" style="color:#22c55e">${e}</div></div>`).join("")}window.switchTab=t=>{l=t,d()};window.sendSuggestion=async t=>{await u(t)};window.sendMessage=async()=>{const t=document.querySelector("textarea"),e=t?.value?.trim();e&&(t.value="",await u(e))};window.handleKey=t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),window.sendMessage())};window.toggleVoice=()=>{p=!p,d()};window.capture=()=>{u("What's on my screen?")};async function u(t){a.push({role:"user",content:t}),d();const e=document.querySelector(".chat-area");e&&(e.innerHTML+='<div class="thinking">Working on it...</div>',e.scrollTop=e.scrollHeight);const i=await v(t);a.pop(),a.pop(),a.push({role:"user",content:t}),a.push({role:"assistant",content:i}),d()}m();if(!c.apiKey){const t=prompt("Enter your OpenRouter API key (get one free at openrouter.ai/keys):");t&&(c.apiKey=t,g())}d();
