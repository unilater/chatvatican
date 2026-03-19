// qdrant-app.js — Archivio Cristiano · Chat semantica su Qdrant

// ─── Costanti ─────────────────────────────────────────────────────────────────

// (nessun prompt di default nel codice — il prompt è gestito esclusivamente dall'admin via JSON)

// ─── Stato ────────────────────────────────────────────────────────────────────

let uiMode      = "user";
let isStreaming  = false;
let abortCtrl   = null;
let msgCounter  = 0;
let sourceLimit = 10;
let sidebarLimit = 10;
let lastQuery   = "";
let lastHits    = [];

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
    testo  : String(payload.testo   ?? payload.testo_originale ?? payload.text ?? payload.content ?? payload.body ?? payload.descrizione ?? "").trim(),
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

// ─── Parsing streaming think ─────────────────────────────────────────────────

/**
 * Estrae blocchi <think> completi e, se presente, uno aperto (in progress).
 * Restituisce { thinks: string[], thinkInProgress: string|null, text: string }
 */
function parseStream(raw) {
  // Normalizza entity HTML nel caso il modello o un layer intermedio le codifichi
  const normalized = raw
    .replace(/&lt;think&gt;/gi, "<think>")
    .replace(/&lt;\/think&gt;/gi, "</think>");

  const completeThinks = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let m;
  while ((m = re.exec(normalized)) !== null) completeThinks.push(m[1].trim());
  let cleaned = normalized.replace(/<think>[\s\S]*?<\/think>/gi, "");
  let thinkInProgress = null;
  // Ricerca case-insensitive del tag aperto
  const openMatch = cleaned.match(/<think>/i);
  const openIdx = openMatch ? cleaned.toLowerCase().indexOf("<think>") : -1;
  if (openIdx !== -1) {
    thinkInProgress = cleaned.slice(openIdx + 7).trim();
    cleaned = cleaned.slice(0, openIdx);
  }
  return { thinks: completeThinks, thinkInProgress, text: cleaned.trim() };
}

/**
 * Costruisce l'HTML di una risposta:
 * think inline (non collassabile) + markdown dell'answer.
 */
function buildAnswerHtml(thinks, thinkInProgress, text) {
  const allThinks = [...thinks];
  const hasInProgress = thinkInProgress !== null;
  if (hasInProgress) allThinks.push(thinkInProgress);

  let html = "";
  if (allThinks.length) {
    const items = allThinks.map((t, i) => {
      const progressCls = hasInProgress && i === allThinks.length - 1
        ? " think-in-progress" : "";
      return `<span class="think-text${progressCls}">${escHtml(t)}</span>`;
    }).join("");
    html += `<div class="think-block"><div class="think-label">Ragionamento</div>${items}</div>`;
  }
  html += renderMarkdown(text);
  return html;
}

// ─── Render sources ───────────────────────────────────────────────────────────

function renderSources(hits, container, isAdmin) {
  if (!container || !hits?.length) return;

  const toggle = container.querySelector(".sources-toggle");
  const list   = container.querySelector(".sources-list");
  if (!toggle || !list) return;

  const n = Math.min(hits.length, sourceLimit);
  toggle.innerHTML = `<span>${n} ${n !== 1 ? "fonti trovate" : "fonte trovata"}</span><span class="chevron">▾</span>`;
  toggle.classList.add("open");
  list.innerHTML = "";

  hits.slice(0, sourceLimit).forEach((hit, i) => {
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
        <div class="typing-dots" id="typing-${id}"><span></span><span></span><span></span><span class="typing-timer" id="timer-${id}">0s</span></div>
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
  const { thinks, thinkInProgress, text } = parseStream(rawText);
  el.innerHTML = buildAnswerHtml(thinks, thinkInProgress, text);
  scrollToBottom();
}

function finalizeAnswer(id, rawText, hits, isDeepDive = false) {
  const { thinks, text: answerText } = parseStream(rawText);

  const el = $(`answer-${id}`);
  if (el) {
    el.innerHTML = buildAnswerHtml(thinks, null, answerText);
    el.querySelectorAll("a").forEach((a) => {
      a.target = "_blank"; a.rel = "noopener noreferrer";
    });
    el.querySelectorAll(".citation").forEach((btn) => {
      btn.addEventListener("click", () => highlightSource(id, Number(btn.dataset.n)));
    });
  }

  const sourcesEl = $(`sources-${id}`);
  if (sourcesEl && hits?.length) {
    if (!isDeepDive) {
      lastHits = hits;
      populateSidebar(hits);
    }

  // Mostra sempre le top-sourceLimit fonti; in modalità admin anche i punteggi
    const displayHits = hits.slice(0, sourceLimit);

    if (displayHits.length) {
      renderSources(displayHits, sourcesEl, uiMode === "admin");
      const toggle = sourcesEl.querySelector(".sources-toggle");
      const list   = sourcesEl.querySelector(".sources-list");
      toggle?.addEventListener("click", () => {
        const open = toggle.classList.toggle("open");
        if (list) list.style.display = open ? "" : "none";
        toggle.setAttribute("aria-expanded", String(open));
      });
    }
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

async function sendQuery(query, preloadedHits = null) {
  if (isStreaming || !query.trim()) return;

  const collection = $("collection-select")?.value || "";
  if (!collection) {
    alert("Seleziona una collection Qdrant prima di cercare.");
    return;
  }

  if (!preloadedHits) lastQuery = query;

  appendUserMsg(query);
  const assistantId = appendAssistantMsg();

  isStreaming = true;
  updateSendBtn();

  // Avvia timer secondi nel cursore
  const timerEl = $(`timer-${assistantId}`);
  const t0 = Date.now();
  const timerInterval = setInterval(() => {
    if (timerEl) timerEl.textContent = Math.floor((Date.now() - t0) / 1000) + "s";
  }, 1000);

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
        limit: sourceLimit,
        model,
        generateAnswer: true,
        systemPrompt: customPrompt,
        ...(preloadedHits ? { hits: preloadedHits } : {}),
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
        if (evt.type === "done")  { finalizeAnswer(assistantId, fullAnswer, hits, !!preloadedHits); }
        if (evt.type === "error") { showError(assistantId, evt.error); }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") showError(assistantId, e.message);
  } finally {
    clearInterval(timerInterval);
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

    if (typeof data.sourceLimit === "number") {
      sourceLimit = data.sourceLimit;
      const limitSel = $("source-limit");
      if (limitSel) limitSel.value = String(sourceLimit);
    }

    if (typeof data.sidebarLimit === "number") {
      sidebarLimit = data.sidebarLimit;
      const sidebarSel = $("sidebar-limit");
      if (sidebarSel) sidebarSel.value = String(sidebarLimit);
    }

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
        sourceLimit: Number($("source-limit")?.value ?? sourceLimit),
        sidebarLimit: Number($("sidebar-limit")?.value ?? sidebarLimit),
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const sidebarActiveFilters = { persone: null, enti: null, luoghi: null };

function populateSidebar(hits) {
  const sidebar = $("sidebar");
  const filtersEl = $("sidebar-filters");
  if (!sidebar || !filtersEl || !hits?.length) return;

  // Reset filtri
  sidebarActiveFilters.persone = null;
  sidebarActiveFilters.enti    = null;
  sidebarActiveFilters.luoghi  = null;
  filtersEl.innerHTML = "";

  // Costruisce le mappe entity → conteggio
  const maps = { persone: new Map(), enti: new Map(), luoghi: new Map() };
  hits.forEach(h => {
    const pl = h.payload ?? {};
    ["persone", "enti", "luoghi"].forEach(k => {
      const arr = Array.isArray(pl[k]) ? pl[k] : (pl[k] ? [pl[k]] : []);
      arr.forEach(v => v && maps[k].set(v, (maps[k].get(v) || 0) + 1));
    });
  });

  const labels = { persone: "Persone", enti: "Enti", luoghi: "Luoghi" };
  Object.keys(maps).forEach(key => {
    if (!maps[key].size) return;
    const top = [...maps[key].entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const group = document.createElement("div");
    group.className = "filter-group";
    group.innerHTML = `<div class="filter-group-label">${labels[key]}</div><div class="filter-chips" id="chips-${key}"></div>`;
    const chipsEl = group.querySelector(".filter-chips");
    top.forEach(([name]) => {
      const chip = document.createElement("button");
      chip.className = "filter-chip";
      chip.type = "button";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        const isActive = chip.dataset.active === "1";
        // Reset tutti i chip del gruppo
        chipsEl.querySelectorAll(".filter-chip").forEach(c => {
          c.classList.remove("active");
          c.dataset.active = "0";
        });
        if (isActive) {
          // secondo click = deseleziona
          sidebarActiveFilters[key] = null;
        } else {
          // primo click = seleziona
          sidebarActiveFilters[key] = name;
          chip.classList.add("active");
          chip.dataset.active = "1";
        }
        renderSidebarSources(lastHits);
      });
      chipsEl.appendChild(chip);
    });
    filtersEl.appendChild(group);
  });

  renderSidebarSources(hits);
  sidebar.classList.remove("hidden");
}

function renderSidebarSources(hits) {
  const sourcesEl = $("sidebar-sources");
  if (!sourcesEl) return;

  // Filtra lato client in base ai chip attivi
  const filtered = hits.filter(h => {
    const pl = h.payload ?? {};
    return ["persone", "enti", "luoghi"].every(k => {
      if (!sidebarActiveFilters[k]) return true;
      const arr = Array.isArray(pl[k]) ? pl[k] : (pl[k] ? [pl[k]] : []);
      return arr.includes(sidebarActiveFilters[k]);
    });
  });

  sourcesEl.innerHTML = "";
  filtered.slice(0, sidebarLimit).forEach((hit, i) => {
    const pl  = hit.payload ?? {};
    const { titolo, fonte, data, link } = getPayloadFields(pl);
    const safeLink = /^https?:\/\//i.test(link) ? link : "";

    const card = document.createElement("div");
    card.className = "sidebar-source-card";

    const metaParts = [fonte, formatDate(data)].filter(Boolean).map(escHtml).join(" · ");
    card.innerHTML = `
      <div class="sidebar-source-rank">#${i + 1}</div>
      <div class="sidebar-source-title">${escHtml(titolo || "(senza titolo)")}</div>
      ${metaParts ? `<div class="sidebar-source-meta">${metaParts}</div>` : ""}
      ${safeLink ? `<div class="sidebar-source-meta"><a href="${escHtml(safeLink)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Apri documento →</a></div>` : ""}
      <button class="sidebar-source-ask" type="button">Chiedi a AI</button>`;

    card.querySelector(".sidebar-source-ask").addEventListener("click", () => {
      deepDiveDoc(hit, i + 1, titolo);
    });

    sourcesEl.appendChild(card);
  });

  if (!filtered.length) {
    sourcesEl.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:12px 4px">Nessuna fonte corrisponde ai filtri.</div>`;
  }
}

function deepDiveDoc(hit, rank, titolo) {
  const label = titolo ? `Approfondisci: "${titolo.slice(0, 60)}${titolo.length > 60 ? "…" : ""}"` : `Approfondisci documento #${rank}`;
  sendQuery(lastQuery || label, [hit]);
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

  // Selettore fonti
  $("source-limit")?.addEventListener("change", () => {
    sourceLimit = Number($("source-limit").value) || 10;
    saveState();
  });
  $("sidebar-limit")?.addEventListener("change", () => {
    sidebarLimit = Number($("sidebar-limit").value) || 10;
    saveState();
  });

  // Duplicati index
  $("find-dupes-btn")?.addEventListener("click", async () => {
    const collection = $("collection-select")?.value;
    if (!collection) return alert("Seleziona prima una collection.");
    const btn = $("find-dupes-btn");
    btn.disabled = true;
    btn.textContent = "Scansione…";
    try {
      const res  = await fetch(`/api/qdrant/duplicates/${encodeURIComponent(collection)}`);
      const data = await res.json();
      if (data.error) { alert("Errore: " + data.error); return; }
      if (!data.count) {
        alert(`✅ Nessun duplicato trovato su ${data.total} documenti.`);
        return;
      }
      const list = data.duplicates.map(d =>
        `• "${d.titolo || "(senza titolo)"}" (id: ${d.id}) — duplicato di id: ${d.duplicateDi}`
      ).join("\n");
      const ok = confirm(
        `Trovati ${data.count} duplicati su ${data.total} documenti:\n\n${list}\n\nEliminare i duplicati dall'index? (irreversibile)`
      );
      if (!ok) return;
      const del = await fetch(`/api/qdrant/duplicates/${encodeURIComponent(collection)}`, { method: "DELETE" });
      const delData = await del.json();
      if (delData.error) { alert("Errore eliminazione: " + delData.error); return; }
      alert(`✅ Eliminati ${delData.deleted} duplicati dall'index.`);
    } catch (e) {
      alert("Errore: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "🔍 Duplicati";
    }
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
