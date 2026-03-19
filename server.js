// server.js — Server Express: routing API per il RAG ecclesiale

import express from "express";
import { askOllama, askOllamaStream } from "./src/ai.js";
import { rewriteQueryForSearch } from "./src/query-rewrite.js";
import { searchDocuments, DEFAULT_FACETS } from "./src/meili.js";
import { readUiState, writeUiState, normalizeUiScope } from "./src/state.js";
import { DEFAULT_AGENT_MODEL, OLLAMA_BASE_URL, DEFAULT_SEARCH_INDEX } from "./src/config.js";

// Valida e normalizza il nome dell'indice Meilisearch
function normalizeSearchIndex(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return DEFAULT_SEARCH_INDEX;
  if (!/^[a-z0-9_-]+$/.test(n)) throw new Error("Nome indice non valido");
  return n;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// Helper: scrive un evento NDJSON sulla risposta streaming
function sendEvent(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

// ─── Stato UI ────────────────────────────────────────────────────────────────

app.get("/api/ui-state", async (req, res) => {
  try {
    res.json(await readUiState(normalizeUiScope(req.query?.scope)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ui-state", async (req, res) => {
  try {
    const scope = normalizeUiScope(req.body?.scope || req.query?.scope);
    const current = await readUiState(scope);
    res.json(await writeUiState({ ...current, ...req.body }, scope));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─── Motore di ricerca avanzato ─────────────────────────────────────────────

app.post("/api/search/query", async (req, res) => {
  try {
    const rawQuery = String(req.body?.query  ?? "").trim();
    const index  = normalizeSearchIndex(req.body?.index);
    const limit  = Math.min(Math.max(Number(req.body?.limit  ?? 20), 1), 100);
    const offset = Math.max(Number(req.body?.offset ?? 0), 0);
    const filter = String(req.body?.filter ?? "");
    const sort   = Array.isArray(req.body?.sort)   ? req.body.sort   : [];
    const facets = Array.isArray(req.body?.facets) ? req.body.facets : DEFAULT_FACETS;
    const model  = String(req.body?.model ?? DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;

    // Query rewriting: solo per frasi lunghe (≥4 parole)
    const query = rawQuery.split(/\s+/).length >= 4
      ? await rewriteQueryForSearch(rawQuery, model)
      : rawQuery;

    const result = await searchDocuments({ query, index, limit, offset, filter, sort, facets });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// ─── Search+Stream unificato (Meilisearch + Ollama) ──────────────────────────
// Protocollo NDJSON:
//   {"type":"hits", hits:[...], estimatedTotalHits:N, processingTimeMs:N}
//   {"type":"token", text:"..."}          ← streaming Ollama
//   {"type":"done", answer:"..."}
//   {"type":"error", error:"..."}

app.post("/api/search-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    const query  = String(req.body?.query  ?? "").trim();
    const index  = normalizeSearchIndex(req.body?.index);
    const limit  = Math.min(Math.max(Number(req.body?.limit  ?? 20), 1), 100);
    const offset = Math.max(Number(req.body?.offset ?? 0), 0);
    const filter = String(req.body?.filter ?? "");
    const sort   = Array.isArray(req.body?.sort)   ? req.body.sort   : [];
    const facets = Array.isArray(req.body?.facets) ? req.body.facets : DEFAULT_FACETS;
    const model  = String(req.body?.model  ?? DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
    const generateAnswer = req.body?.generateAnswer !== false;
    // Prompt personalizzato dall'admin (opzionale). Variabili: {{query}}, {{context}}
    const customSystemPrompt = String(req.body?.systemPrompt ?? "").trim();
    // hits precaricati dal client (stessi della colonna risultati)
    const preloadedHits = Array.isArray(req.body?.hits) ? req.body.hits : null;

    if (!query) {
      emit({ type: "error", error: "Query obbligatoria." });
      return res.end();
    }

    // 1. Meilisearch — usa hits precaricati se disponibili (evita doppia ricerca)
    let meiliResult;
    if (preloadedHits) {
      meiliResult = { hits: preloadedHits, estimatedTotalHits: preloadedHits.length, processingTimeMs: 0 };
    } else {
      meiliResult = await searchDocuments({ query, index, limit, offset, filter, sort, facets });
    }
    emit({
      type: "hits",
      hits: meiliResult.hits ?? [],
      estimatedTotalHits: meiliResult.estimatedTotalHits ?? meiliResult.totalHits ?? 0,
      processingTimeMs: meiliResult.processingTimeMs ?? 0,
      facetDistribution: meiliResult.facetDistribution ?? {},
    });

    if (!generateAnswer) {
      emit({ type: "done", answer: "" });
      return res.end();
    }

    // 2. Costruisce contesto per Ollama dalle hits
    const hits = meiliResult.hits ?? [];
    let fullAnswer = "";

    if (hits.length === 0) {
      // Nessun risultato: risposta conversazionale
      const convPrompt =
        `Sei un esperto di documenti cristiani e vaticani.\n` +
        `Non hai trovato documenti pertinenti per: "${query}".\n` +
        `Rispondi brevemente e in modo cordiale in italiano.`;
      await askOllamaStream(convPrompt, model, (tok) => {
        fullAnswer += tok;
        emit({ type: "token", text: tok });
      });
    } else {
      // RAG con citazioni numerate [1][2]...
      const MAX_HITS_FOR_CONTEXT = Math.min(hits.length, 5);
      const contextBlocks = hits.slice(0, MAX_HITS_FOR_CONTEXT).map((h, i) => {
        const testo = String(h.testo_originale ?? "").slice(0, 800);
        const abstr = String(h.abstract ?? "");
        return `[${i + 1}] Titolo: ${h.titolo ?? ""}\nFonte: ${h.fonte ?? ""}\n${abstr ? `Abstract: ${abstr}\n` : ""}${testo ? `Testo: ${testo}` : ""}`;
      }).join("\n\n---\n\n");

      let ragPrompt;
      if (customSystemPrompt) {
        // Usa il template personalizzato con sostituzione variabili
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
