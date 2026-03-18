// server.js — Server Express: routing API per il RAG ecclesiale

import express from "express";
import { buildIntakeDecision, askOllama, askOllamaStream } from "./src/ai.js";
import {
  fetchContextCached,
  normalizeSearchIndex,
  getSearchProfile,
  buildPrompt,
  appendSourceLinks,
} from "./src/search.js";
import { readUiState, writeUiState, normalizeUiScope } from "./src/state.js";
import {
  DEFAULT_LIMIT,
  DEFAULT_MODEL,
  DEFAULT_AGENT_MODEL,
  DEFAULT_SEARCH_QUERY,
} from "./src/config.js";

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

// ─── Agente: analizza la domanda, decide query e filtri ──────────────────────

app.post("/api/intake-chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "La domanda è obbligatoria." });

    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const state = await readUiState(profile.key);
    const agentModel =
      String(req.body?.agentModel || state.agentModel || "").trim() || DEFAULT_AGENT_MODEL;

    const result = await buildIntakeDecision({
      question,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      previousSources: Array.isArray(req.body?.previousSources)
        ? req.body.previousSources
        : [],
      profile,
      agentPromptTemplate: state.agentPromptTemplate,
      agentModel,
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Anteprima ricerca (uso debug/admin) ─────────────────────────────────────

app.post("/api/search-preview", async (req, res) => {
  try {
    const searchQuery = String(req.body?.searchQuery || "").trim();
    if (!searchQuery) return res.json({ hits: [], context: "", metadata: {} });

    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchPlan = req.body?.searchPlan || null;

    const result = await fetchContextCached(searchQuery, limit, searchIndex, { searchPlan });

    res.json({
      hits: result.hits,
      context: result.context,
      metadata: {
        searchQuery: result.searchQuery,
        limit,
        searchIndex,
        cached: result.cached,
        candidateCount: result.candidateCount,
        retrievalQuery: result.searchQuery,
        activeFilter: result.filter || "",
        searchPlan,
        queryTerms: [],
        detectedEntities: searchPlan?.filters || { persone: [], luoghi: [], enti: [] },
        entityKeywordTerms: [],
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── RAG non streaming ───────────────────────────────────────────────────────

app.post("/api/rag", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "La domanda è obbligatoria." });

    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const state = await readUiState(profile.key);
    const model = String(req.body?.model || state.ragModel || "").trim() || DEFAULT_MODEL;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchQuery =
      String(req.body?.searchQuery || question).trim() || DEFAULT_SEARCH_QUERY;
    const searchPlan = req.body?.searchPlan || null;
    const promptTemplate = String(req.body?.promptTemplate || state.promptTemplate || "");

    // Salva le preferenze UI aggiornate
    await writeUiState({ ...state, limit, ragModel: model }, profile.key);

    const { hits, context, searchQuery: usedQuery, filter, cached } =
      await fetchContextCached(searchQuery, limit, searchIndex, { searchPlan });

    if (!context) {
      return res.json({
        answer: "Nessun documento trovato per la query indicata.",
        hits,
        context,
        metadata: { model, searchQuery: usedQuery, limit, searchIndex, cached },
      });
    }

    const prompt = buildPrompt(question, context, promptTemplate);
    const rawAnswer = await askOllama(prompt, model);
    const answer = appendSourceLinks(rawAnswer, hits);

    res.json({
      answer,
      hits,
      context,
      metadata: {
        model,
        searchQuery: usedQuery,
        limit,
        searchIndex,
        cached,
        activeFilter: filter || "",
        searchPlan,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── RAG streaming ───────────────────────────────────────────────────────────

app.post("/api/rag-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  try {
    const question = String(req.body?.question || "").trim();
    if (!question) {
      sendEvent(res, { type: "error", error: "La domanda è obbligatoria." });
      return res.end();
    }

    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const state = await readUiState(profile.key);
    const model = String(req.body?.model || state.ragModel || "").trim() || DEFAULT_MODEL;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchQuery =
      String(req.body?.searchQuery || question).trim() || DEFAULT_SEARCH_QUERY;
    const searchPlan = req.body?.searchPlan || null;
    const promptTemplate = String(req.body?.promptTemplate || state.promptTemplate || "");

    // Salva le preferenze UI aggiornate
    await writeUiState({ ...state, limit, ragModel: model }, profile.key);

    const { hits, context, searchQuery: usedQuery, filter, cached } =
      await fetchContextCached(searchQuery, limit, searchIndex, { searchPlan });

    // Invia subito i risultati di ricerca (la UI aggiorna il debug panel)
    sendEvent(res, {
      type: "meta",
      hits,
      context,
      metadata: {
        model,
        searchQuery: usedQuery,
        limit,
        searchIndex,
        cached,
        candidateCount: hits.length,
        retrievalQuery: usedQuery,
        activeFilter: filter || "",
        searchPlan,
        queryTerms: [],
        detectedEntities: searchPlan?.filters || { persone: [], luoghi: [], enti: [] },
        entityKeywordTerms: [],
      },
    });

    if (!context) {
      sendEvent(res, { type: "done", answer: "Nessun documento trovato." });
      return res.end();
    }

    const prompt = buildPrompt(question, context, promptTemplate);
    let fullAnswer = "";

    await askOllamaStream(prompt, model, (token) => {
      fullAnswer += token;
      sendEvent(res, { type: "token", text: token });
    });

    const answer = appendSourceLinks(fullAnswer, hits);
    sendEvent(res, { type: "done", answer });
  } catch (e) {
    sendEvent(res, { type: "error", error: e.message });
  }

  res.end();
});

// ─── Avvio ───────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Server avviato su http://localhost:${port}`));
