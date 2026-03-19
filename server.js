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
    const limit      = Math.min(Math.max(Number(req.body?.limit  ?? 20), 1), 100);
    const offset     = Math.max(Number(req.body?.offset ?? 0), 0);
    const embedModel = String(req.body?.embedModel ?? QDRANT_EMBED_MODEL).trim() || QDRANT_EMBED_MODEL;

    if (!collection) return res.status(400).json({ error: "Collection obbligatoria" });
    const colPath = encodeURIComponent(collection);

    let points = [];
    let searchMode = "scroll";

    if (query) {
      // Tenta ricerca vettoriale con embedding Ollama
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
        // Fallback: scroll senza filtro
        const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/scroll`, {
          method: "POST",
          headers: qdrantHeaders(),
          body: JSON.stringify({ limit, offset, with_payload: true, with_vectors: false }),
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Qdrant scroll HTTP ${r.status}: ${text}`);
        }
        const data = await r.json();
        points = (data.result?.points ?? []).map((p) => ({ id: p.id, payload: p.payload, score: null }));
      }
    } else {
      // Nessuna query: scroll senza filtro
      const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/scroll`, {
        method: "POST",
        headers: qdrantHeaders(),
        body: JSON.stringify({ limit, offset, with_payload: true, with_vectors: false }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Qdrant scroll HTTP ${r.status}: ${text}`);
      }
      const data = await r.json();
      points = (data.result?.points ?? []).map((p) => ({ id: p.id, payload: p.payload, score: null }));
    }

    res.json({ points, total: points.length, searchMode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search + stream Ollama per Qdrant
app.post("/api/qdrant/search-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    const query      = String(req.body?.query      ?? "").trim();
    const collection = String(req.body?.collection ?? "").trim();
    const limit      = Math.min(Math.max(Number(req.body?.limit ?? 10), 1), 50);
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
        const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/search`, {
          method: "POST",
          headers: qdrantHeaders(),
          body: JSON.stringify({ vector, limit, with_payload: true, with_vectors: false, score_threshold: 0.0 }),
        });
        if (!r.ok) throw new Error(`Qdrant search HTTP ${r.status}`);
        const data = await r.json();
        points = data.result ?? [];
        searchMode = "vector";
      } catch {
        const r = await fetch(`${QDRANT_BASE_URL}/collections/${colPath}/points/scroll`, {
          method: "POST",
          headers: qdrantHeaders(),
          body: JSON.stringify({ limit, with_payload: true, with_vectors: false }),
        });
        if (!r.ok) { const t = await r.text(); throw new Error(`Qdrant scroll: ${t}`); }
        const data = await r.json();
        points = (data.result?.points ?? []).map((p) => ({ id: p.id, payload: p.payload, score: null }));
      }
    }

    emit({ type: "hits", hits: points, total: points.length, searchMode });

    if (!generateAnswer) {
      emit({ type: "done", answer: "" });
      return res.end();
    }

    let fullAnswer = "";

    if (points.length === 0) {
      const convPrompt =
        `Sei un esperto di documenti cristiani e vaticani.\n` +
        `Non hai trovato documenti pertinenti per: "${query}".\n` +
        `Rispondi brevemente e in modo cordiale in italiano.`;
      await askOllamaStream(convPrompt, model, (tok) => {
        fullAnswer += tok;
        emit({ type: "token", text: tok });
      });
    } else {
      const MAX_CTX = Math.min(points.length, 5);
      const contextBlocks = points.slice(0, MAX_CTX).map((p, i) => {
        const pl = p.payload ?? {};
        const titolo = String(pl.titolo ?? pl.title ?? pl.nome ?? "");
        const testo  = String(pl.testo  ?? pl.text  ?? pl.content ?? pl.body ?? "").slice(0, 800);
        const fonte  = String(pl.fonte  ?? pl.source ?? pl.autore ?? "");
        const abstr  = String(pl.abstract ?? pl.summary ?? "");
        return `[${i + 1}] ${titolo ? `Titolo: ${titolo}\n` : ""}${fonte ? `Fonte: ${fonte}\n` : ""}${abstr ? `Abstract: ${abstr}\n` : ""}${testo ? `Testo: ${testo}` : ""}`.trim();
      }).join("\n\n---\n\n");

      let ragPrompt;
      if (customSystemPrompt) {
        ragPrompt = customSystemPrompt
          .replace(/\{\{query\}\}/g, query)
          .replace(/\{\{context\}\}/g, contextBlocks);
      } else {
        ragPrompt =
          `Sei un esperto di documenti cristiani e vaticani.\n` +
          `Rispondi in italiano alla domanda usando SOLO le fonti sotto.\n` +
          `Cita le fonti con [1], [2] ecc. nel testo della risposta.\n` +
          `Sii preciso, sintetico e chiaro.\n\n` +
          `DOMANDA: ${query}\n\n` +
          `FONTI:\n${contextBlocks}`;
      }

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
