// public/search-app.js — Archivio Cristiano
// InstantSearch.js (via proxy backend) + Ollama streaming nella colonna destra

// ─── Costanti ─────────────────────────────────────────────────────────────────

const HINTS = [
  "Encicliche di Giovanni Paolo II",
  "Concilio Vaticano II",
  "Laudato Si",
  "Nomine episcopali 2024",
  "Sinodo sulla sinodalità",
  "Lettera apostolica Rosarium Virginis Mariae",
];

// Highlight markers usati dal backend (characteri di controllo)
const HL_PRE  = "\x02";
const HL_POST = "\x03";

// Tempo di debounce prima di lanciare la generazione AI (ms)
// Aspetta che l'utente abbia finito di scrivere
const AI_DEBOUNCE_MS = 800;

// ─── Stato ────────────────────────────────────────────────────────────────────

let currentHits    = [];
let currentQuery   = "";
let aiAbortCtrl    = null;   // AbortController per cancellare lo stream AI in corso
let aiDebounceTimer = null;
let activeFilters = {};

// ─── Utilità ─────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converte il testo con marker highlight (\x02/\x03) in HTML sicuro con <mark>.
 * Escape HTML prima, poi sostituisce i marker.
 */
function safeHighlight(text) {
  if (!text) return "";
  return escHtml(text)
    .replace(/\x02/g, "<mark>")
    .replace(/\x03/g, "</mark>");
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (!isNaN(dt.getTime()))
    return dt.toLocaleDateString("it-IT", { year: "numeric", month: "short", day: "numeric" });
  return String(d);
}

function $(id) { return document.getElementById(id); }

function renderMarkdown(rawText) {
  const citationTokenized = String(rawText || "").replace(/\[(\d+)\]/g, (_, n) => `@@CIT_${n}@@`);

  let html;
  if (window.marked?.parse) {
    html = window.marked.parse(citationTokenized, {
      gfm: true,
      breaks: true,
      mangle: false,
      headerIds: false,
    });
  } else {
    html = escHtml(citationTokenized).replace(/\n/g, "<br>");
  }

  if (window.DOMPurify?.sanitize) {
    html = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  return html.replace(
    /@@CIT_(\d+)@@/g,
    (_, n) => `<button class="citation" data-n="${n}" aria-label="Fonte ${n}">[${n}]</button>`
  );
}

function hasActiveFilters() {
  return Object.values(activeFilters).some((values) => Array.isArray(values) && values.length > 0);
}

function humanizeFacetName(name) {
  return String(name || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeFacetValue(value) {
  return String(value ?? "").trim();
}

function buildFilterExpression(filters) {
  const clauses = [];
  for (const [field, values] of Object.entries(filters)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const ors = values
      .map((v) => `${field} = "${normalizeFacetValue(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(" OR ");
    clauses.push(values.length > 1 ? `(${ors})` : ors);
  }
  return clauses.join(" AND ");
}

function triggerSearchRefresh() {
  const input = document.querySelector(".ais-SearchBox-input");
  if (!input) return;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggleDynamicFilter(field, value) {
  const next = { ...activeFilters };
  const current = new Set(next[field] || []);
  if (current.has(value)) current.delete(value);
  else current.add(value);
  const values = Array.from(current);
  if (values.length === 0) delete next[field];
  else next[field] = values;
  activeFilters = next;
  triggerSearchRefresh();
}

function renderDynamicFilters(facetDistribution = {}, query = "") {
  const box = $("dynamic-filters");
  const groupsRoot = $("filter-groups");
  const clearBtn = $("clear-filters-btn");
  if (!box || !groupsRoot || !clearBtn) return;

  groupsRoot.innerHTML = "";

  if (!query || query.trim().length < 2) {
    box.classList.add("hidden");
    clearBtn.classList.add("hidden");
    return;
  }

  const fields = Object.keys(facetDistribution || {}).filter(
    (field) => facetDistribution[field] && Object.keys(facetDistribution[field]).length > 0
  );

  if (fields.length === 0) {
    box.classList.add("hidden");
    clearBtn.classList.add("hidden");
    return;
  }

  fields.sort((a, b) => a.localeCompare(b, "it"));
  fields.forEach((field) => {
    const valuesMap = facetDistribution[field] || {};
    const values = Object.entries(valuesMap)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 10);
    if (values.length === 0) return;

    const group = document.createElement("div");
    group.className = "filter-group";

    const label = document.createElement("div");
    label.className = "filter-group-label";
    label.textContent = humanizeFacetName(field);
    group.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "filter-chips";
    values.forEach(([rawValue, count]) => {
      const value = normalizeFacetValue(rawValue);
      if (!value) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      if ((activeFilters[field] || []).includes(value)) chip.classList.add("is-active");
      chip.textContent = `${value} (${count})`;
      chip.addEventListener("click", () => toggleDynamicFilter(field, value));
      chips.appendChild(chip);
    });
    if (chips.childElementCount === 0) return;
    group.appendChild(chips);
    groupsRoot.appendChild(group);
  });

  clearBtn.classList.toggle("hidden", !hasActiveFilters());
  box.classList.toggle("hidden", groupsRoot.childElementCount === 0);
}

// ─── Render hit card ──────────────────────────────────────────────────────────

function renderHitCard(hit, index) {
  const fmt     = hit._formatted ?? {};
  const titolo  = safeHighlight(fmt.titolo  || hit.titolo  || "(senza titolo)");
  const snippet = safeHighlight(fmt.testo_originale || fmt.abstract || hit.abstract || "");
  const fonte   = escHtml(hit.fonte         ?? "");
  const data    = escHtml(formatDate(hit.data ?? ""));
  const tipo    = escHtml(hit.tipo_documento ?? "");
  const rawLink = String(hit.link ?? "").trim();
  const safeLink = /^https:\/\//i.test(rawLink) ? rawLink : "";
  const num = index + 1;

  const card = document.createElement("article");
  card.className = "hit-card";
  card.dataset.index = num;

  card.innerHTML = `
    <span class="hit-num">[${num}]</span>
    <h3 class="hit-title">${titolo}</h3>
    ${snippet ? `<p class="hit-snippet">${snippet}</p>` : ""}
    <div class="hit-footer">
      <div class="hit-meta">
        ${fonte ? `<span class="meta-tag meta-fonte">${fonte}</span>` : ""}
        ${tipo  ? `<span class="meta-tag">${tipo}</span>`             : ""}
        ${data  ? `<span class="meta-date">${data}</span>`            : ""}
      </div>
      ${safeLink ? `<a href="${escHtml(safeLink)}" target="_blank" rel="noopener noreferrer" class="hit-link">Leggi →</a>` : ""}
    </div>`;

  return card;
}

function renderSkeleton() {
  const list = document.createElement("div");
  list.className = "skeleton-list";
  for (let i = 0; i < 5; i++) {
    list.innerHTML += `
      <div class="skeleton-card">
        <div class="skel-line" style="width:40%;height:10px"></div>
        <div class="skel-line" style="width:90%"></div>
        <div class="skel-line" style="width:75%"></div>
        <div class="skel-line" style="width:55%;height:10px"></div>
      </div>`;
  }
  return list;
}

// ─── Highlight card (da click citazione) ─────────────────────────────────────

function highlightCard(num) {
  document.querySelectorAll(".hit-card").forEach((c) => c.classList.remove("active"));
  const target = document.querySelector(`.hit-card[data-index="${num}"]`);
  if (target) {
    target.classList.add("active");
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// ─── Chat: genera risposta AI ─────────────────────────────────────────────────

async function generateAiAnswer(query, hits) {
  // Cancella eventuale stream precedente
  if (aiAbortCtrl) { aiAbortCtrl.abort(); aiAbortCtrl = null; }

  const welcomeEl  = $("chat-welcome");
  const panelEl    = $("chat-panel");
  const queryLabel = $("chat-query-label");
  const answerEl   = $("chat-answer");
  const loadingEl  = $("chat-loading");
  const sourcesEl  = $("chat-sources");
  const sourcesListEl = $("sources-list");

  // Mostra il panel
  welcomeEl?.classList.add("hidden");
  panelEl?.classList.remove("hidden");

  // Label query
  if (queryLabel) queryLabel.innerHTML = `<span class="chip-query">${escHtml(query)}</span>`;

  // Reset
  if (answerEl) answerEl.textContent = "";
  sourcesEl?.classList.add("hidden");
  loadingEl?.classList.remove("hidden");

  const model = $("model-select")?.value || "";
  const index = $("index-select")?.value || "testi_ecclesiali";
  const customPrompt = $("system-prompt")?.value?.trim() || "";

  aiAbortCtrl = new AbortController();

  try {
    const body = {
      query,
      index,
      limit: 5,
      model,
      generateAnswer: true,
    };
    if (customPrompt) body.systemPrompt = customPrompt;

    const res = await fetch("/api/search-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: aiAbortCtrl.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let answerHits = hits; // hits che useremo per le fonti

    loadingEl?.classList.add("hidden");

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

        if (evt.type === "hits") {
          // Aggiorna le fonti con dati freschi dal backend
          answerHits = evt.hits ?? hits;
        }

        if (evt.type === "token" && answerEl) {
          // Append del testo grezzo
          answerEl.textContent += evt.text;
        }

        if (evt.type === "done" && answerEl) {
          // Post-process: markdown + citazioni [n] cliccabili
          const raw = answerEl.textContent;
          answerEl.innerHTML = renderMarkdown(raw);

          // Link markdown: apri sempre in nuova tab
          answerEl.querySelectorAll("a").forEach((a) => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
          });

          // Collega click citazioni
          answerEl.querySelectorAll(".citation").forEach((btn) => {
            btn.addEventListener("click", () => highlightCard(Number(btn.dataset.n)));
          });
          // Render fonti
          renderSources(answerHits.slice(0, 5), sourcesEl, sourcesListEl);
        }

        if (evt.type === "error") {
          loadingEl?.classList.add("hidden");
          if (answerEl) answerEl.textContent = `Errore: ${evt.error}`;
          break;
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    loadingEl?.classList.add("hidden");
    if (answerEl) answerEl.textContent = `Impossibile generare la risposta: ${e.message}`;
  } finally {
    loadingEl?.classList.add("hidden");
  }
}

// ─── Render fonti ─────────────────────────────────────────────────────────────

function renderSources(hits, container, listEl) {
  if (!container || !listEl || hits.length === 0) return;
  listEl.innerHTML = "";
  hits.forEach((h, i) => {
    const num      = i + 1;
    const titolo   = escHtml(String(h.titolo   ?? "(senza titolo)").slice(0, 80));
    const fonte    = escHtml(String(h.fonte    ?? "").slice(0, 60));
    const rawLink  = String(h.link ?? "").trim();
    const safeLink = /^https:\/\//i.test(rawLink) ? rawLink : "#";

    const item = document.createElement("a");
    item.className = "source-item";
    item.href      = escHtml(safeLink);
    if (safeLink !== "#") { item.target = "_blank"; item.rel = "noopener noreferrer"; }
    item.setAttribute("data-source-num", num);
    item.innerHTML = `
      <span class="source-num">[${num}]</span>
      <div class="source-text">
        <div class="source-title">${titolo}</div>
        ${fonte ? `<div class="source-sub">${fonte}</div>` : ""}
      </div>`;

    item.addEventListener("click", (e) => {
      if (safeLink === "#") e.preventDefault();
      highlightCard(num);
    });

    listEl.appendChild(item);
  });
  container.classList.remove("hidden");
}

// ─── InstantSearch custom client (proxy al nostro backend) ───────────────────

function createBackendSearchClient() {
  return {
    clearCache() {},
    search(requests) {
      const req = requests[0];
      const query  = req.params.query ?? "";
      const index  = $("index-select")?.value || "testi_ecclesiali";
      const limit  = req.params.hitsPerPage ?? 20;
      const offset = (req.params.page ?? 0) * limit;
      const filter = buildFilterExpression(activeFilters);

      // Skeleton mentre carica
      const hitsList = $("hits");
      if (hitsList && query) {
        hitsList.innerHTML = "";
        hitsList.appendChild(renderSkeleton());
      }

      return fetch("/api/search/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          index,
          limit,
          offset,
          filter,
          facets: ["*"],
        }),
      })
      .then((r) => r.json())
      .then((data) => {
        currentHits  = data.hits ?? [];
        currentQuery = query;
        renderDynamicFilters(data.facetDistribution ?? {}, query);
        return {
          results: [{
            hits:               currentHits,
            nbHits:             data.estimatedTotalHits ?? data.totalHits ?? 0,
            page:               req.params.page ?? 0,
            nbPages:            Math.ceil((data.estimatedTotalHits ?? 0) / limit),
            hitsPerPage:        limit,
            processingTimeMS:   data.processingTimeMs ?? 0,
            query:              query,
            params:             "",
            exhaustiveNbHits:   false,
          }],
        };
      });
    },
  };
}

// ─── Render hits per InstantSearch ───────────────────────────────────────────

function mountHitsWidget(searchInstance) {
  const hitsList = $("hits");
  if (!hitsList) return;

  // Usiamo il lifecycle di IS per intercettare i risultati
  searchInstance.addWidgets([
    {
      $$type: "ais.custom",
      init() {},
      render({ results }) {
        hitsList.innerHTML = "";

        const resultsBar = $("results-bar");
        const statsEl    = $("stats");

        if (!results || results.query === "") {
          if (resultsBar) resultsBar.classList.add("hidden");
          return;
        }

        // Stats
        if (resultsBar) resultsBar.classList.remove("hidden");
        if (statsEl) {
          const n = (results.nbHits ?? 0).toLocaleString("it-IT");
          const q = escHtml(results.query);
          const ms = results.processingTimeMS ?? 0;
          statsEl.innerHTML = `<strong>${n}</strong> risultati per "<em>${q}</em>" &ndash; ${ms}ms`;
        }

        if (results.hits.length === 0) {
          hitsList.innerHTML = `<div class="hits-empty"><p>∅</p><p>Nessun risultato per "<strong>${escHtml(results.query)}</strong>".</p></div>`;
          return;
        }

        results.hits.forEach((hit, i) =>
          hitsList.appendChild(renderHitCard(hit, i))
        );

        // Avvia debounce per generazione AI
        clearTimeout(aiDebounceTimer);
        aiDebounceTimer = setTimeout(() => {
          generateAiAnswer(results.query, results.hits);
        }, AI_DEBOUNCE_MS);
      },
      dispose() {},
    },
  ]);
}

// ─── Carica modelli Ollama ────────────────────────────────────────────────────

async function loadModels() {
  const sel = $("model-select");
  if (!sel) return;
  try {
    const res  = await fetch("/api/discover/models");
    const data = await res.json();
    const models = data.models ?? [];
    if (models.length === 0) {
      sel.innerHTML = `<option value="">Nessun modello trovato</option>`;
      return;
    }
    sel.innerHTML = models.map((m) =>
      `<option value="${escHtml(m.name)}">${escHtml(m.name)}</option>`
    ).join("");
  } catch {
    sel.innerHTML = `<option value="">Ollama non disponibile</option>`;
  }
}

// ─── Admin / Utente mode ──────────────────────────────────────────────────────

const DEFAULT_RAG_PROMPT =
`Sei un esperto di documenti cristiani e vaticani.
Rispondi in italiano alla domanda usando SOLO le fonti sotto.
Cita le fonti con [1], [2] ecc. nel testo della risposta.
Sii preciso, sintetico e chiaro.

DOMANDA: {{query}}

FONTI:
{{context}}`;

let uiMode = "user";

function setUiMode(mode) {
  uiMode = mode === "admin" ? "admin" : "user";
  document.body.dataset.uiMode = uiMode;
  const adminBar = $("admin-bar");
  if (uiMode === "admin") {
    adminBar?.classList.remove("hidden");
  } else {
    adminBar?.classList.add("hidden");
  }
  const userBtn  = $("userModeBtn");
  const adminBtn = $("adminModeBtn");
  if (userBtn)  userBtn.setAttribute("aria-pressed",  String(uiMode === "user"));
  if (adminBtn) adminBtn.setAttribute("aria-pressed", String(uiMode === "admin"));
}

async function loadAdminState() {
  try {
    const res  = await fetch("/api/ui-state?scope=search");
    const data = await res.json();
    if (data.uiMode) setUiMode(data.uiMode);
    if (data.promptTemplate !== undefined) {
      const ta = $("system-prompt");
      if (ta) ta.value = data.promptTemplate;
    }
    if (data.ragModel) {
      const sel = $("model-select");
      if (sel && data.ragModel) {
        // Attendi che i modelli siano caricati
        for (let i = 0; i < 20; i++) {
          const opt = sel.querySelector(`option[value="${data.ragModel}"]`);
          if (opt) { sel.value = data.ragModel; break; }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    }
  } catch { /* ignora */ }
}

async function saveAdminState(status = "") {
  const statusEl = $("save-prompt-status");
  if (statusEl) { statusEl.textContent = "Salvataggio…"; statusEl.className = "save-status"; }
  try {
    await fetch("/api/ui-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "search",
        uiMode,
        promptTemplate: $("system-prompt")?.value ?? "",
        ragModel: $("model-select")?.value ?? "",
      }),
    });
    if (statusEl) {
      statusEl.textContent = "Salvato ✓";
      statusEl.className = "save-status ok";
      setTimeout(() => { if (statusEl) { statusEl.textContent = ""; statusEl.className = "save-status"; } }, 2500);
    }
  } catch {
    if (statusEl) { statusEl.textContent = "Errore"; statusEl.className = "save-status err"; }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // Role switch
  $("userModeBtn")?.addEventListener("click", () => { setUiMode("user"); saveAdminState(); });
  $("adminModeBtn")?.addEventListener("click", () => { setUiMode("admin"); saveAdminState(); });

  // Admin bar: salva prompt
  $("save-prompt-btn")?.addEventListener("click", saveAdminState);

  // Admin bar: reset al default
  $("reset-prompt-btn")?.addEventListener("click", () => {
    const ta = $("system-prompt");
    if (ta) ta.value = "";
    saveAdminState();
  });

  // Carica stato salvato (uiMode, systemPrompt, model)
  loadAdminState().then(() => loadModels());

  // Hint chips welcome
  const hintContainer = $("hint-chips");
  if (hintContainer) {
    HINTS.forEach((q) => {
      const btn = document.createElement("button");
      btn.className = "hint-chip";
      btn.textContent = q;
      btn.addEventListener("click", () => {
        // Imposta il valore nell'input di InstantSearch e triggera
        const input = document.querySelector(".ais-SearchBox-input");
        if (input) {
          input.value = q;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
      });
      hintContainer.appendChild(btn);
    });
  }

  // Cambio archivio → re-trigger search
  $("index-select")?.addEventListener("change", () => {
    activeFilters = {};
    renderDynamicFilters({}, "");
    const input = document.querySelector(".ais-SearchBox-input");
    if (input && input.value) {
      const q = input.value;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => {
        input.value = q;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 50);
    }
  });

  // Sort
  $("sort-select")?.addEventListener("change", () => {
    const input = document.querySelector(".ais-SearchBox-input");
    if (input?.value) input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Modelli Ollama — caricati dopo loadAdminState() via then()

  $("clear-filters-btn")?.addEventListener("click", () => {
    activeFilters = {};
    triggerSearchRefresh();
  });

  // InstantSearch
  const searchInstance = instantsearch({
    indexName:    "testi_ecclesiali",
    searchClient: createBackendSearchClient(),
    searchFunction(helper) {
      // Non cercare con meno di 2 caratteri
      if (helper.state.query.trim().length < 2) {
        $("hits")?.replaceChildren();
        $("results-bar")?.classList.add("hidden");
        renderDynamicFilters({}, "");
        return;
      }
      helper.search();
    },
  });

  searchInstance.addWidgets([
    instantsearch.widgets.searchBox({
      container:   "#searchbox",
      placeholder: "Cerca encicliche, discorsi, lettere apostoliche...",
      showLoadingIndicator: true,
      showReset:   true,
      showSubmit:  false,
    }),
    instantsearch.widgets.pagination({
      container: "#pagination",
      padding: 2,
      showFirst: false,
      showLast:  false,
    }),
  ]);

  mountHitsWidget(searchInstance);

  searchInstance.start();
}

document.addEventListener("DOMContentLoaded", init);
