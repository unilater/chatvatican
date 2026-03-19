// qdrant-app.js — Archivio Cristiano · Chat semantica su Qdrant

// ─── Costanti ─────────────────────────────────────────────────────────────────

const DEFAULT_PROMPT = `Sei un esperto di documenti cristiani e vaticani.
Rispondi in italiano alla domanda usando SOLO le fonti sotto.
Cita le fonti con [1], [2] ecc. nel testo della risposta.
Sii preciso, sintetico e chiaro.

DOMANDA: {{query}}

FONTI:
{{context}}`;

// ─── Stato ────────────────────────────────────────────────────────────────────

let uiMode         = "user";
let isStreaming    = false;
let abortCtrl      = null;
let msgCounter     = 0;

// ─── Utilità ─────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("it-IT", { year: "numeric", month: "short" });
}

function renderMarkdown(raw) {
  const tokenized = String(raw || "").replace(/\[(\d+)\]/g, (_, n) => `@@CIT_${n}@@`);
  let html = window.marked?.parse
    ? window.marked.parse(tokenized, { gfm: true, breaks: true, mangle: false, headerIds: false })
    : escHtml(tokenized).replace(/\n/g, "<br>");
  if (window.DOMPurify?.sanitize)
    html = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return html.replace(/@@CIT_(\d+)@@/g,
    (_, n) => `<button class="citation" data-n="${n}" aria-label="Fonte ${n}">[${n}]</button>`);
}

function getPayloadFields(payload = {}) {
  return {
    titolo : String(payload.titolo  ?? payload.title   ?? payload.nome    ?? payload.heading ?? "").trim(),
    testo  : String(payload.testo   ?? payload.text    ?? payload.content ?? payload.body    ?? payload.descrizione ?? "").trim(),
    fonte  : String(payload.fonte   ?? payload.source  ?? payload.autore  ?? payload.author  ?? "").trim(),
    data   : String(payload.data    ?? payload.date    ?? payload.anno    ?? "").trim(),
    tipo   : String(payload.tipo_documento ?? payload.type ?? payload.categoria ?? "").trim(),
    link   : String(payload.link    ?? payload.url     ?? payload.href    ?? "").trim(),
    abstr  : String(payload.abstract ?? payload.summary ?? payload.sintesi ?? "").trim(),
  };
}

function scoreClass(score) {
  if (score === null || score === undefined) return "mid";
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}

// ─── Render sources ───────────────────────────────────────────────────────────

function renderSources(hits, container, isAdmin) {
  if (!container || !hits?.length) return;

  const toggle = container.querySelector(".sources-toggle");
  const list   = container.querySelector(".sources-list");
  if (!toggle || !list) return;

  const n = Math.min(hits.length, 10);
  toggle.innerHTML = `<span>${n} fonte${n !== 1 ? "i" : ""} trovata${n !== 1 ? "e" : ""}</span><span class="chevron">▾</span>`;
  toggle.classList.add("open");
  list.innerHTML = "";

  hits.slice(0, 10).forEach((hit, i) => {
    const pl = hit.payload ?? {};
    const { titolo, fonte, data, link, abstr, testo } = getPayloadFields(pl);
    const score  = typeof hit.score === "number" ? hit.score : null;
    const pct    = score !== null ? Math.round(score * 100) : null;
    const safeLink = /^https?:\/\//i.test(link) ? link : "";
    const snip   = (abstr || testo).slice(0, 120);

    const card = document.createElement(safeLink ? "a" : "div");
    card.className = "source-card";
    card.dataset.sourceIndex = i + 1;
    if (safeLink) { card.href = escHtml(safeLink); card.target = "_blank"; card.rel = "noopener noreferrer"; }

    card.innerHTML = `
      <span class="source-rank">${i + 1}</span>
      <div class="source-info">
        <div class="source-title">${escHtml(titolo || "(senza titolo)")}</div>
        <div class="source-meta">${[fonte, formatDate(data)].filter(Boolean).map(escHtml).join(" · ")}</div>
        ${snip ? `<div class="source-meta" style="margin-top:2px">${escHtml(snip)}…</div>` : ""}
      </div>
      ${isAdmin && pct !== null ? `
        <div class="source-score">
          <span class="score-label">${pct}%</span>
          <div class="score-bar-track"><div class="score-bar-fill ${scoreClass(score)}" style="width:${pct}%"></div></div>
        </div>` : ""}`;

    list.appendChild(card);
  });

  container.classList.remove("hidden");
}

// ─── Scroll ───────────────────────────────────────────────────────────────────

function scrollToBottom() {
  const area = $("chat-area");
  if (area) area.scrollTop = area.scrollHeight;
}

// ─── Crea messaggi nel DOM ────────────────────────────────────────────────────

function appendUserMsg(query) {
  $("welcome")?.classList.add("hidden");
  const id = ++msgCounter;
  const div = document.createElement("div");
  div.className = "msg-user";
  div.id = `msg-${id}`;
  div.innerHTML = `<div class="msg-user-bubble">${escHtml(query)}</div>`;
  $("messages").appendChild(div);
  scrollToBottom();
  return id;
}

function appendAssistantMsg() {
  $("welcome")?.classList.add("hidden");
  const id = ++msgCounter;
  const div = document.createElement("div");
  div.className = "msg-assistant";
  div.id = `msg-${id}`;
  div.innerHTML = `
    <div class="msg-avatar" aria-hidden="true">AC</div>
    <div class="msg-body">
      <div class="msg-answer" id="answer-${id}">
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>
      <div class="msg-sources hidden" id="sources-${id}">
        <button class="sources-toggle" type="button" aria-expanded="true"></button>
        <div class="sources-list"></div>
      </div>
    </div>`;
  $("messages").appendChild(div);
  scrollToBottom();
  return id;
}

function updateAnswer(id, rawText) {
  const el = $(`answer-${id}`);
  if (!el) return;
  el.textContent = rawText;   // testo grezzo durante streaming
  scrollToBottom();
}

function finalizeAnswer(id, rawText, hits) {
  const el = $(`answer-${id}`);
  if (el) {
    el.innerHTML = renderMarkdown(rawText);
    el.querySelectorAll("a").forEach((a) => {
      a.target = "_blank"; a.rel = "noopener noreferrer";
    });
    el.querySelectorAll(".citation").forEach((btn) => {
      btn.addEventListener("click", () => highlightSource(id, Number(btn.dataset.n)));
    });
  }
  const sourcesEl = $(`sources-${id}`);
  if (sourcesEl && hits?.length) {
    renderSources(hits, sourcesEl, uiMode === "admin");

    // Toggle show/hide sources
    const toggle = sourcesEl.querySelector(".sources-toggle");
    const list   = sourcesEl.querySelector(".sources-list");
    toggle?.addEventListener("click", () => {
      const open = toggle.classList.toggle("open");
      if (list) list.style.display = open ? "" : "none";
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  scrollToBottom();
}

function showError(id, msg) {
  const el = $(`answer-${id}`);
  if (el) el.innerHTML = `<span style="color:var(--accent)">Errore: ${escHtml(msg)}</span>`;
}

function highlightSource(msgId, n) {
  const sourcesEl = $(`sources-${msgId}`);
  sourcesEl?.querySelectorAll(".source-card").forEach((c) => c.classList.remove("active"));
  sourcesEl?.querySelector(`.source-card[data-source-index="${n}"]`)?.classList.add("active");
}

// ─── Invio query ──────────────────────────────────────────────────────────────

async function sendQuery(query) {
  if (isStreaming || !query.trim()) return;

  const collection = $("collection-select")?.value || "";
  if (!collection) {
    alert("Seleziona una collection Qdrant prima di cercare.");
    return;
  }

  appendUserMsg(query);
  const assistantId = appendAssistantMsg();

  isStreaming = true;
  updateSendBtn();

  const model        = $("model-select")?.value || "";
  const customPrompt = $("system-prompt")?.value?.trim() || "";

  abortCtrl = new AbortController();

  try {
    const res = await fetch("/api/qdrant/search-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortCtrl.signal,
      body: JSON.stringify({
        query,
        collection,
        limit: 10,
        model,
        generateAnswer: true,
        systemPrompt: customPrompt,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullAnswer = "";
    let hits = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }

        if (evt.type === "hits") hits = evt.hits ?? [];
        if (evt.type === "token") { fullAnswer += evt.text; updateAnswer(assistantId, fullAnswer); }
        if (evt.type === "done")  { finalizeAnswer(assistantId, fullAnswer, hits); }
        if (evt.type === "error") { showError(assistantId, evt.error); }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") showError(assistantId, e.message);
  } finally {
    isStreaming = false;
    abortCtrl   = null;
    updateSendBtn();
  }
}

// ─── Send btn ─────────────────────────────────────────────────────────────────

function updateSendBtn() {
  const btn = $("send-btn");
  if (!btn) return;
  btn.disabled = isStreaming;
}

// ─── Carica collection Qdrant ─────────────────────────────────────────────────

async function loadCollections() {
  const sel = $("collection-select");
  if (!sel) return;
  try {
    const res  = await fetch("/api/qdrant/collections");
    const data = await res.json();
    if (data.error) { sel.innerHTML = `<option value="">Errore Qdrant</option>`; return; }
    const cols = data.result?.collections ?? [];
    sel.innerHTML = cols.length
      ? cols.map((c) => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`).join("")
      : `<option value="">Nessuna collection</option>`;
  } catch {
    sel.innerHTML = `<option value="">Qdrant non raggiungibile</option>`;
  }
}

// ─── Carica modelli Ollama ────────────────────────────────────────────────────

async function loadModels() {
  const sel = $("model-select");
  if (!sel) return;
  try {
    const res  = await fetch("/api/discover/models");
    const data = await res.json();
    const models = data.models ?? [];
    sel.innerHTML = models.length
      ? models.map((m) => `<option value="${escHtml(m.name)}">${escHtml(m.name)}</option>`).join("")
      : `<option value="">Nessun modello trovato</option>`;
  } catch {
    sel.innerHTML = `<option value="">Ollama non disponibile</option>`;
  }
}

// ─── UI mode ──────────────────────────────────────────────────────────────────

function setUiMode(mode, save = true) {
  uiMode = mode === "admin" ? "admin" : "user";
  document.body.dataset.uiMode = uiMode;
  $("admin-panel")?.classList.toggle("hidden", uiMode !== "admin");
  $("model-wrap")?.classList.toggle("hidden",  uiMode !== "admin");
  $("userModeBtn")?.setAttribute("aria-pressed",  String(uiMode === "user"));
  $("adminModeBtn")?.setAttribute("aria-pressed", String(uiMode === "admin"));
  if (save) saveState();
}

// ─── State ────────────────────────────────────────────────────────────────────

async function loadState() {
  try {
    const res  = await fetch("/api/ui-state");
    const data = await res.json();
    if (data.uiMode) setUiMode(data.uiMode, false);

    const ta = $("system-prompt");
    if (ta && data.promptTemplate !== undefined) ta.value = data.promptTemplate;

    if (data.ragModel) {
      const sel = $("model-select");
      if (sel) {
        for (let i = 0; i < 20; i++) {
          if (sel.querySelector(`option[value="${data.ragModel}"]`)) {
            sel.value = data.ragModel; break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    }
  } catch { /* ignora */ }
}

async function saveState() {
  const statusEl = $("save-status");
  if (statusEl) { statusEl.textContent = "Salvataggio…"; statusEl.className = "save-status"; }
  try {
    await fetch("/api/ui-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uiMode,
        promptTemplate: $("system-prompt")?.value ?? "",
        ragModel: $("model-select")?.value ?? "",
      }),
    });
    if (statusEl) {
      statusEl.textContent = "Salvato ✓"; statusEl.className = "save-status ok";
      setTimeout(() => { if (statusEl) { statusEl.textContent = ""; statusEl.className = "save-status"; } }, 2500);
    }
  } catch {
    if (statusEl) { statusEl.textContent = "Errore"; statusEl.className = "save-status err"; }
  }
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // Role switch
  $("userModeBtn")?.addEventListener("click",  () => setUiMode("user"));
  $("adminModeBtn")?.addEventListener("click", () => setUiMode("admin"));

  // Admin prompt
  $("save-prompt-btn")?.addEventListener("click",  saveState);
  $("reset-prompt-btn")?.addEventListener("click", () => {
    const ta = $("system-prompt");
    if (ta) ta.value = "";
    saveState();
  });

  // Input textarea
  const input = $("query-input");
  if (input) {
    input.addEventListener("input", () => autoResize(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const q = input.value.trim();
        if (q) { sendQuery(q); input.value = ""; autoResize(input); }
      }
    });
  }

  // Send button
  $("send-btn")?.addEventListener("click", () => {
    const q = input?.value?.trim();
    if (q) { sendQuery(q); input.value = ""; autoResize(input); }
  });

  // Carica dati
  loadCollections();
  loadModels().then(() => loadState());
}

init();
