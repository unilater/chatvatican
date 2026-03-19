// server.js — Server Express: RAG ecclesiale su Qdrant

import express from "express";
import { askOllama, askOllamaStream } from "./src/ai.js";
import { readState, writeState } from "./src/state.js";
import { DEFAULT_AGENT_MODEL, OLLAMA_BASE_URL, QDRANT_BASE_URL, QDRANT_API_KEY, QDRANT_EMBED_MODEL } from "./src/config.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// ─── Stato UI ────────────────────────────────────────────────────────────────

app.get("/api/ui-state", async (req, res) => {
  try { res.json(await readState()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ui-state", async (req, res) => {
  try { res.json(await writeState(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── Lista modelli Ollama disponibili ───────────────────────────────────────

app.get("/api/discover/models", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!r.ok) return res.json({ models: [] });
    const data = await r.json();
    const models = (data?.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
});

// ─── Qdrant proxy ───────────────────────────────────────────────────────────

function qdrantHeaders() {
  const h = { "Content-Type": "application/json" };
  if (QDRANT_API_KEY) h["api-key"] = QDRANT_API_KEY;
  return h;
}

// Genera embedding via Ollama (modello nomic-embed-text o configurato)
async function generateEmbedding(text, model) {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Ollama embedding HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data.embedding)) throw new Error("Embedding non restituito");
  return data.embedding;
}

// Lista collection Qdrant
app.get("/api/qdrant/collections", async (req, res) => {
  try {
    const r = await fetch(`${QDRANT_BASE_URL}/collections`, { headers: qdrantHeaders() });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Info su una singola collection (per scoprire vettori disponibili)
app.get("/api/qdrant/collections/:name", async (req, res) => {
  const name = String(req.params.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Nome collection mancante" });
  try {
    const r = await fetch(`${QDRANT_BASE_URL}/collections/${encodeURIComponent(name)}`, {
      headers: qdrantHeaders(),
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ricerca Qdrant: prima tenta vettoriale (Ollama embeddings), poi scroll
app.post("/api/qdrant/search", async (req, res) => {
  try {
    const query      = String(req.body?.query      ?? "").trim();
    const collection = String(req.body?.collection ?? "").trim();
    const limit      = Math.min(Math.max(Number(req.body?.limit  ?? 1_000_000), 1), 1_000_000);
    const embedModel = String(req.body?.embedModel ?? QDRANT_EMBED_MODEL).trim() || QDRANT_EMBED_MODEL;

    if (!collection) return res.status(400).json({ error: "Collection obbligatoria" });
    const colPath = encodeURIComponent(collection);

    let points = [];
    let searchMode = "scroll";

    if (query) {
      // Tenta ricerca vettoriale con embedding Ollama — limit altissimo: restituisce tutta la collection
      try {
        const vector = await generateEmbedding(query, embedModel);
        const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/search`, {
          method: "POST",
          headers: qdrantHeaders(),
          body: JSON.stringify({
            vector,
            limit,
            with_payload: true,
            with_vectors: false,
            score_threshold: 0.0,
          }),
        });
        if (!r.ok) throw new Error(`Qdrant search HTTP ${r.status}`);
        const data = await r.json();
        points = data.result ?? [];
        searchMode = "vector";
      } catch {
        // Fallback: scroll paginato senza filtro (tutti i documenti)
        points = await scrollAll(colPath);
      }
    } else {
      // Nessuna query: scroll paginato (tutti i documenti)
      points = await scrollAll(colPath);
    }

    res.json({ points, total: points.length, searchMode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Scroll paginato: recupera TUTTI i punti di una collection ───────────────

async function scrollAll(colPath) {
  const all = [];
  let nextOffset = null;
  do {
    const body = { limit: 10_000, with_payload: true, with_vectors: false };
    if (nextOffset !== null) body.offset = nextOffset;
    const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/scroll`, {
      method: "POST",
      headers: qdrantHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(`Qdrant scroll: ${t}`); }
    const data = await r.json();
    for (const p of (data.result?.points ?? [])) {
      all.push({ id: p.id, payload: p.payload, score: null });
    }
    nextOffset = data.result?.next_page_offset ?? null;
  } while (nextOffset !== null);
  return all;
}

// ─── Hybrid rerank ───────────────────────────────────────────────────────────

/**
 * Boost dei documenti il cui payload contiene le parole chiave della query.
 * Utile per nomi propri, luoghi, enti che il vettore semantico non cattura bene
 * (specie se i vettori sono stati costruiti su testi brevi/titoli).
 *
 * Strategia RRF-like semplificata:
 *   finalScore = vectorScore * 0.7 + keywordBoost * 0.3
 * dove keywordBoost = frazione di token della query trovati nel payload (0-1).
 */
function hybridRerank(points, query) {
  if (!points.length) return points;

  // Tokenizza query: parole di almeno 3 lettere, normalizzate
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\sàáâãäèéêëìíîïòóôõöùúûü]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3);

  if (!tokens.length) return points;

  return points
    .map(p => {
      const pl = p.payload ?? {};
      // Campi da cercare (più specifici prima: nomi, enti, luoghi, poi testo)
      const searchTarget = [
        ...(Array.isArray(pl.persone) ? pl.persone : []),
        ...(Array.isArray(pl.enti)    ? pl.enti    : []),
        ...(Array.isArray(pl.luoghi)  ? pl.luoghi  : []),
        pl.titolo ?? "", pl.fonte ?? "",
        (pl.testo_originale ?? pl.testo ?? pl.text ?? ""),
      ].join(" ").toLowerCase();

      const matches = tokens.filter(t => searchTarget.includes(t)).length;
      const keywordBoost = matches / tokens.length;

      const vectorScore = typeof p.score === "number" ? p.score : 0;
      // Se tutti i token matchano (es. nome proprio esatto), peso keyword più alto
      const kw = matches === tokens.length ? 0.5 : 0.3;
      const hybridScore = vectorScore * (1 - kw) + keywordBoost * kw;

      return { ...p, score: hybridScore, _vectorScore: vectorScore, _keywordBoost: keywordBoost };
    })
    .sort((a, b) => b.score - a.score);
}

// Search + stream Ollama per Qdrant
app.post("/api/qdrant/search-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    const query      = String(req.body?.query      ?? "").trim();
    const collection = String(req.body?.collection ?? "").trim();
    // ctxLimit: quanti documenti top-ranked passare a Ollama come contesto (configurato dall'admin)
    const ctxLimit   = Math.min(Math.max(Number(req.body?.limit ?? 10), 1), 100);
    // Nessun limite: la ricerca vettoriale Qdrant esamina già tutti i punti (HNSW su tutta la collection);
    // restituiamo al più tutti i documenti esistenti.
    const qdrantLimit = 1_000_000;
    const embedModel = String(req.body?.embedModel ?? QDRANT_EMBED_MODEL).trim() || QDRANT_EMBED_MODEL;
    const model      = String(req.body?.model ?? DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
    const generateAnswer = req.body?.generateAnswer !== false;
    const customSystemPrompt = String(req.body?.systemPrompt ?? "").trim();
    const preloadedHits = Array.isArray(req.body?.hits) ? req.body.hits : null;

    if (!query) {
      emit({ type: "error", error: "Query obbligatoria." });
      return res.end();
    }
    if (!collection) {
      emit({ type: "error", error: "Collection obbligatoria." });
      return res.end();
    }

    let points;
    let searchMode = "scroll";

    if (preloadedHits) {
      points = preloadedHits;
    } else {
      const colPath = encodeURIComponent(collection);
      try {
        const vector = await generateEmbedding(query, embedModel);
        // Cerca su tutta la collection (qdrantLimit alto), risultati già ordinati per score desc
        const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/search`, {
          method: "POST",
          headers: qdrantHeaders(),
          body: JSON.stringify({ vector, limit: qdrantLimit, with_payload: true, with_vectors: false, score_threshold: 0.0 }),
        });
        if (!r.ok) throw new Error(`Qdrant search HTTP ${r.status}`);
        const data = await r.json();
        points = data.result ?? [];
        searchMode = "vector";

        // Ricerca ibrida: boost dei documenti il cui payload contiene parole chiave della query
        // (cattura nomi propri, luoghi, enti che il modello vettoriale potrebbe non rankare bene)
        points = hybridRerank(points, query);
      } catch {
        // Fallback scroll paginato: recupera TUTTI i punti, nessun limite artificiale
        points = await scrollAll(colPath);
      }
    }

    // Invia al client tutti i risultati trovati (per mostrare rank e score)
    emit({ type: "hits", hits: points, total: points.length, searchMode });

    if (!generateAnswer) {
      emit({ type: "done", answer: "" });
      return res.end();
    }

    let fullAnswer = "";

    if (points.length === 0) {
      const convPrompt = customSystemPrompt
        ? customSystemPrompt.replace(/\{\{query\}\}/g, query).replace(/\{\{context\}\}/g, "")
        : query;
      await askOllamaStream(convPrompt, model, (tok) => {
        fullAnswer += tok;
        emit({ type: "token", text: tok });
      });
    } else {
      // Passa a Ollama solo i top-ctxLimit per score (i più rilevanti semanticamente)
      const MAX_CTX = Math.min(points.length, ctxLimit);
      const contextBlocks = points.slice(0, MAX_CTX).map((p, i) => {
        const pl = p.payload ?? {};
        const titolo  = String(pl.titolo ?? pl.title ?? pl.nome ?? "");
        const testo   = String(pl.testo_originale ?? pl.testo ?? pl.text ?? pl.content ?? pl.body ?? "");
        const fonte   = String(pl.fonte  ?? pl.source ?? pl.autore ?? "");
        const abstr   = String(pl.abstract ?? pl.summary ?? "");
        const persone = Array.isArray(pl.persone) ? pl.persone.join(", ") : (pl.persone ?? "");
        const enti    = Array.isArray(pl.enti)    ? pl.enti.join(", ")    : (pl.enti    ?? "");
        const luoghi  = Array.isArray(pl.luoghi)  ? pl.luoghi.join(", ")  : (pl.luoghi  ?? "");
        return [
          `[${i + 1}]`,
          titolo  ? `Titolo: ${titolo}`    : "",
          fonte   ? `Fonte: ${fonte}`      : "",
          abstr   ? `Abstract: ${abstr}`   : "",
          persone ? `Persone: ${persone}`  : "",
          enti    ? `Enti: ${enti}`        : "",
          luoghi  ? `Luoghi: ${luoghi}`    : "",
          testo   ? `Testo: ${testo}`      : "",
        ].filter(Boolean).join("\n");
      }).join("\n\n---\n\n");

      const ragPrompt = customSystemPrompt
        ? customSystemPrompt
            .replace(/\{\{query\}\}/g, query)
            .replace(/\{\{question\}\}/g, query)
            .replace(/\{\{context\}\}/g, contextBlocks)
        : `${query}\n\nContesto:\n${contextBlocks}`;

      await askOllamaStream(ragPrompt, model, (tok) => {
        fullAnswer += tok;
        emit({ type: "token", text: tok });
      });
    }

    emit({ type: "done", answer: fullAnswer });
  } catch (e) {
    emit({ type: "error", error: e.message });
  }

  res.end();
});

// ─── Avvio ───────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server avviato su http://localhost:${port}`);
  // Warm-up: carica il modello in memoria subito all'avvio così il primo utente non aspetta
  askOllama(".", DEFAULT_AGENT_MODEL, 120_000)
    .then(() => console.log(`Modello "${DEFAULT_AGENT_MODEL}" caricato in memoria.`))
    .catch((e) => console.warn(`Warm-up modello fallito: ${e.message}`));
});
