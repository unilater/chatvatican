const chatForm = document.getElementById("chatForm");
const messages = document.getElementById("messages");
const questionInput = document.getElementById("question");
const limitInput = document.getElementById("limit");
const modelInput = document.getElementById("model");
const promptTemplateInput = document.getElementById("promptTemplate");
const stateStatus = document.getElementById("stateStatus");
const searchStatus = document.getElementById("searchStatus");
const sendBtn = document.getElementById("sendBtn");
const messageTemplate = document.getElementById("messageTemplate");
const debugPanel = document.getElementById("debugPanel");
const debugSummaryText = document.getElementById("debugSummaryText");
const debugContent = document.getElementById("debugContent");

let saveTimer;
let previewTimer;
let previewSequence = 0;
let prefetchAbortController;
const LIVE_PREFETCH_DEBOUNCE_MS = 120;

function setStateStatus(text) {
  stateStatus.textContent = text;
}

function setSearchStatus(text) {
  searchStatus.textContent = text;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const canRenderMarkdown =
  typeof window.marked?.parse === "function" &&
  typeof window.DOMPurify?.sanitize === "function";

if (typeof window.marked?.setOptions === "function") {
  window.marked.setOptions({
    gfm: true,
    breaks: true,
  });
}

function setAssistantContent(contentEl, text) {
  const value = String(text || "");

  if (!canRenderMarkdown) {
    contentEl.textContent = value;
    return;
  }

  const rendered = window.marked.parse(value);
  contentEl.innerHTML = window.DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
  });
}

function updateDebugPanel(metadata, hits) {
  const terms = metadata?.queryTerms || [];
  const entityKeywordTerms = metadata?.entityKeywordTerms || [];
  const retrieval = metadata?.retrievalQuery || "";
  const candidates = metadata?.candidateCount ?? "?";
  const cached = metadata?.cached;
  const entities = metadata?.detectedEntities || { persone: [], luoghi: [], enti: [] };
  const usedAiEntityFallback = Boolean(metadata?.usedAiEntityFallback);

  const cacheLabel = cached ? " · cache calda" : " · query fresca";
  debugSummaryText.textContent =
    `Debug ricerca — ${hits.length} doc selezionati su ${candidates} candidati${cacheLabel}`;

  const kwHtml =
    terms.length > 0
      ? terms.map((t) => `<span class="kw-tag">${escapeHtml(t)}</span>`).join("")
      : `<span style="color:var(--muted);font-style:italic">nessuna keyword estratta</span>`;

  const entityKwHtml =
    entityKeywordTerms.length > 0
      ? entityKeywordTerms.map((t) => `<span class="kw-tag">${escapeHtml(t)}</span>`).join("")
      : `<span style="color:var(--muted);font-style:italic">nessuna keyword da entity candidate</span>`;

  const entityGroups = [
    { label: "Persone", values: entities.persone || [] },
    { label: "Luoghi", values: entities.luoghi || [] },
    { label: "Enti", values: entities.enti || [] },
  ];

  const entitiesHtml = entityGroups
    .map((group) => {
      const values = group.values.length
        ? group.values.map((value) => `<span class="kw-tag">${escapeHtml(value)}</span>`).join("")
        : `<span style="color:var(--muted);font-style:italic">nessuna</span>`;

      return [
        `<div class="debug-row">`,
        `<span class="debug-label">${group.label}:</span>`,
        values,
        `</div>`,
      ].join("\n");
    })
    .join("\n");

  const articlesHtml =
    hits.length > 0
      ? hits
          .map((hit, i) => {
            const titolo = hit?.titolo || "(senza titolo)";
            const fonte = hit?.fonte || "";
            const data = hit?.data || "";
            const abstract = hit?.abstract || "";
            const meta = [fonte, data].filter(Boolean).join(" · ");
            return [
              `<div class="debug-article">`,
              `<span class="debug-article-num">${i + 1}</span>`,
              `<span class="debug-article-title">${escapeHtml(titolo)}</span>`,
              meta ? `<span class="debug-article-meta">${escapeHtml(meta)}</span>` : "",
              abstract
                ? `<span class="debug-article-abstract">${escapeHtml(abstract)}</span>`
                : "",
              `</div>`,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("")
      : `<p style="color:var(--muted);font-style:italic;margin:0">Nessun articolo trovato nel contesto.</p>`;

  debugContent.innerHTML = [
    `<div class="debug-row">`,
    `<span class="debug-label">Keyword estratte:</span>`,
    kwHtml,
    `</div>`,
    `<div class="debug-row">`,
    `<span class="debug-label">Keyword da entity (live):</span>`,
    entityKwHtml,
    `</div>`,
    `<div class="debug-row">`,
    `<span class="debug-label">Query Meilisearch:</span>`,
    `<span class="debug-query-val">${escapeHtml(retrieval)}</span>`,
    `</div>`,
    `<div class="debug-row">`,
    `<span class="debug-label">Entity extraction AI:</span>`,
    `<span class="debug-query-val">${usedAiEntityFallback ? "attiva (fallback usato)" : "non usata"}</span>`,
    `</div>`,
    entitiesHtml,
    `<div>`,
    `<span class="debug-label">Articoli nel pre-contesto (${hits.length} su ${candidates} candidati):</span>`,
    `<div class="debug-articles">${articlesHtml}</div>`,
    `</div>`,
  ].join("\n");

  debugPanel.style.display = "";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || "Errore richiesta server");
  }

  return data;
}

function collectUiState() {
  return {
    questionDraft: questionInput.value,
    limit: Number(limitInput.value || 5),
    model: modelInput.value.trim(),
    promptTemplate: promptTemplateInput.value,
  };
}

async function saveUiState() {
  setStateStatus("Stato locale: salvataggio...");

  const state = await fetchJson("/api/ui-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectUiState()),
  });

  setStateStatus("Stato locale: salvato sul server");
  return state;
}

function scheduleUiStateSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveUiState().catch((error) => {
      setStateStatus(
        error instanceof Error ? `Stato locale: errore (${error.message})` : "Stato locale: errore"
      );
    });
  }, 350);
}

async function loadUiState() {
  const state = await fetchJson("/api/ui-state");
  questionInput.value = state.questionDraft || "";
  limitInput.value = String(state.limit || 5);
  modelInput.value = state.model || "gemma:7b";
  if (state.promptTemplate) {
    promptTemplateInput.value = state.promptTemplate;
  }
  setStateStatus("Stato locale: caricato dal server");
}

async function prefetchSearch(question, limit, sequenceId) {
  if (!question) {
    setSearchStatus("Ricerca contesto: inattiva");
    return;
  }

  setSearchStatus("Ricerca contesto: recupero documenti in background...");

  const data = await fetchJson("/api/search-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: prefetchAbortController?.signal,
    body: JSON.stringify({
      searchQuery: question,
      limit,
    }),
  });

  if (sequenceId !== previewSequence) {
    return;
  }

  const mode = data?.metadata?.cached ? "cache calda" : "query fresca";
  setSearchStatus(`Ricerca contesto: ${data.hits.length} documenti pronti (${mode})`);
  updateDebugPanel(data.metadata, data.hits);
}

function scheduleSearchPrefetch() {
  clearTimeout(previewTimer);
  const question = questionInput.value.trim();
  const limit = Number(limitInput.value || 5);

  if (!question) {
    setSearchStatus("Ricerca contesto: inattiva");
    return;
  }

  previewSequence += 1;
  const currentSequence = previewSequence;
  setSearchStatus("Ricerca contesto: analisi live in corso...");

  previewTimer = setTimeout(() => {
    if (prefetchAbortController) {
      prefetchAbortController.abort();
    }
    prefetchAbortController = new AbortController();

    prefetchSearch(question, limit, currentSequence).catch((error) => {
      if (currentSequence !== previewSequence) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setSearchStatus(
        error instanceof Error
          ? `Ricerca contesto: errore (${error.message})`
          : "Ricerca contesto: errore"
      );
    });
  }, LIVE_PREFETCH_DEBOUNCE_MS);
}

function appendMessage(role, text) {
  const node = messageTemplate.content.cloneNode(true);
  const article = node.querySelector(".message");
  const roleEl = node.querySelector(".role");
  const contentEl = node.querySelector(".content");

  article.classList.add(role);
  roleEl.textContent = role === "user" ? "Tu" : "Assistente";

  if (role === "assistant") {
    contentEl.classList.add("markdown");
    setAssistantContent(contentEl, text);
  } else {
    contentEl.textContent = text;
  }

  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return messages.lastElementChild;
}

async function sendQuestion(payload) {
  return fetchJson("/api/rag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendQuestionStream(payload, handlers) {
  const response = await fetch("/api/rag-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "Errore richiesta server");
  }

  if (!response.body) {
    throw new Error("Risposta streaming non disponibile");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          event = null;
        }

        if (event?.type === "meta") {
          handlers.onMeta?.(event);
        }

        if (event?.type === "token") {
          handlers.onToken?.(String(event.text || ""));
        }

        if (event?.type === "error") {
          throw new Error(event.error || "Errore streaming");
        }

        if (event?.type === "done") {
          return;
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  const limit = Number(limitInput.value || 5);
  const model = modelInput.value.trim();
  const promptTemplate = promptTemplateInput.value;

  if (!question) {
    return;
  }

  await saveUiState();

  questionInput.value = "";
  scheduleUiStateSave();
  scheduleSearchPrefetch();

  appendMessage("user", question);
  sendBtn.disabled = true;

  const assistantMsg = appendMessage("assistant", "");
  const lastAssistant = assistantMsg.querySelector(".content");

  // Thinking indicator with elapsed-seconds timer
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking-indicator";
  thinkingEl.innerHTML =
    `<div class="thinking-dots"><span></span><span></span><span></span></div>` +
    `<span>in elaborazione</span>` +
    `<span class="thinking-timer">0s</span>`;
  assistantMsg.insertBefore(thinkingEl, lastAssistant);

  let elapsedSecs = 0;
  const thinkingTimer = setInterval(() => {
    elapsedSecs++;
    const timerEl = thinkingEl.querySelector(".thinking-timer");
    if (timerEl) timerEl.textContent = `${elapsedSecs}s`;
  }, 1000);

  let streamStarted = false;

  function stopThinking() {
    if (!streamStarted) {
      streamStarted = true;
      clearInterval(thinkingTimer);
      thinkingEl.remove();
    }
  }

  let answerBuffer = "";

  try {
    await sendQuestionStream(
      {
      question,
      limit,
      model,
      promptTemplate,
      },
      {
        onMeta: (eventData) => {
          updateDebugPanel(eventData.metadata, eventData.hits || []);
          if (!eventData.context && lastAssistant) {
            stopThinking();
            setAssistantContent(lastAssistant, "Nessun contesto trovato per la query indicata.");
          }
        },
        onToken: (tokenText) => {
          if (!streamStarted) {
            stopThinking();
            lastAssistant.classList.add("is-typing");
          }
          answerBuffer += tokenText;
          if (lastAssistant) {
            setAssistantContent(lastAssistant, answerBuffer);
            messages.scrollTop = messages.scrollHeight;
          }
        },
      }
    );

    if (lastAssistant && !answerBuffer.trim()) {
      stopThinking();
      setAssistantContent(lastAssistant, "Risposta vuota dal modello.");
    }
  } catch (error) {
    stopThinking();
    if (lastAssistant) {
      setAssistantContent(
        lastAssistant,
        error instanceof Error ? `Errore: ${error.message}` : "Errore imprevisto"
      );
    }
  } finally {
    clearInterval(thinkingTimer);
    lastAssistant?.classList.remove("is-typing");
    sendBtn.disabled = false;
    questionInput.focus();
    scheduleUiStateSave();
    scheduleSearchPrefetch();
  }
});

questionInput.addEventListener("input", () => {
  scheduleUiStateSave();
  scheduleSearchPrefetch();
});

limitInput.addEventListener("input", () => {
  scheduleUiStateSave();
  scheduleSearchPrefetch();
});

modelInput.addEventListener("input", scheduleUiStateSave);
promptTemplateInput.addEventListener("input", scheduleUiStateSave);

loadUiState()
  .then(() => {
    scheduleSearchPrefetch();
  })
  .catch((error) => {
    setStateStatus(
      error instanceof Error ? `Stato locale: errore (${error.message})` : "Stato locale: errore"
    );
  });

appendMessage(
  "assistant",
  "Pronto. Inserisci una domanda e premi Invia. Il sistema usera' solo il contesto recuperato dalla search API."
);
