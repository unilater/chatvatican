// src/query-rewrite.js — Riscrittura query in keywords tramite Ollama

import { OLLAMA_BASE_URL } from "./config.js";

// Cache in memoria: evita chiamate Ollama duplicate per query già viste
// TTL 10 minuti, max 200 voci
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map(); // key → { result, ts }

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.result;
}

function cacheSet(key, result) {
  if (cache.size >= CACHE_MAX) {
    // Rimuove la voce più vecchia
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { result, ts: Date.now() });
}

// In-flight map: se stessa query è già in corso, aspetta la stessa Promise
const inFlight = new Map();

/**
 * Riscrive una query in linguaggio naturale in parole chiave per Meilisearch.
 * Attiva solo per query ≥ 4 parole. Fallback automatico alla query originale
 * se Ollama supera il timeout o restituisce una risposta vuota.
 *
 * @param {string} query
 * @param {string} model
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
export async function rewriteQueryForSearch(query, model, timeoutMs = 4500) {
  const words = query.trim().split(/\s+/);
  if (words.length < 4) return query;

  const cacheKey = `${model}:${query.toLowerCase()}`;

  // Cache hit
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  // In-flight dedup: restituisce la stessa Promise se già in corso
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = _doRewrite(query, model, timeoutMs).then((result) => {
    cacheSet(cacheKey, result);
    inFlight.delete(cacheKey);
    return result;
  }).catch(() => {
    inFlight.delete(cacheKey);
    return query;
  });

  inFlight.set(cacheKey, promise);
  return promise;
}

async function _doRewrite(query, model, timeoutMs) {
  const prompt =
    `Estrai le parole chiave di ricerca dalla frase italiana. ` +
    `Rispondi con SOLE le parole chiave, separate da spazio, senza punteggiatura, senza spiegazioni.\n` +
    `Frase: "${query}"\n` +
    `Parole chiave:`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0, num_predict: 30 },
      }),
    });
    if (!res.ok) return query;
    const data = await res.json();
    const rewritten = String(data?.response || "").trim().split("\n")[0].trim();
    return rewritten.length > 0 ? rewritten : query;
  } catch {
    return query;
  } finally {
    clearTimeout(timer);
  }
}

