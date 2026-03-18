// src/search.js — Ricerca su Meilisearch e preparazione del contesto RAG

import {
  SEARCH_INDEX_URL,
  DEFAULT_SEARCH_INDEX,
  SEARCH_API_KEY,
  SEARCH_API_KEY_BOLLETTINO,
  DEFAULT_PROMPT_TEMPLATE,
  MAX_TEXT_EXCERPT_CHARS,
  MAX_CONTEXT_DOCS,
  SEARCH_CACHE_TTL_MS,
  SEARCH_PROFILES,
} from "./config.js";

// Cache in memoria per i risultati di ricerca
export const searchCache = new Map();

// Normalizza il nome indice (sicurezza: solo caratteri alfanumerici, trattini, underscore)
export function normalizeSearchIndex(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return DEFAULT_SEARCH_INDEX;
  if (!/^[a-z0-9_-]+$/.test(n)) throw new Error("Nome indice non valido");
  return n;
}

// Restituisce la API key corretta per l'indice
function getApiKey(index) {
  return index === "bollettino"
    ? SEARCH_API_KEY_BOLLETTINO || SEARCH_API_KEY
    : SEARCH_API_KEY;
}

// Costruisce l'URL di ricerca per l'indice specificato
function getEndpoint(index) {
  return SEARCH_INDEX_URL.replace(/\/indexes\/[^/]+\//, `/indexes/${index}/`);
}

// Profilo UI e configurazione per l'indice (chatMode, strictTemporal, ecc.)
export function getSearchProfile(index) {
  const n = normalizeSearchIndex(index);
  return SEARCH_PROFILES[n] || SEARCH_PROFILES[DEFAULT_SEARCH_INDEX];
}

// Esegue una ricerca su Meilisearch, restituisce array di hits
// Se il campo filtrato non esiste nell'indice, riprova senza filtro
export async function runSearch(query, limit, index, filterExpression = "") {
  const n = normalizeSearchIndex(index);
  const apiKey = getApiKey(n);
  if (!apiKey) throw new Error("SEARCH_API_KEY non configurata");

  const body = { q: String(query || "").trim(), limit };
  if (filterExpression) body.filter = filterExpression;

  const res = await fetch(getEndpoint(n), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // Campo non filtrabile: riprova senza filtro
    if (res.status === 400 && filterExpression && /not filterable/i.test(text)) {
      return runSearch(query, limit, index, "");
    }
    throw new Error(`Meilisearch ${res.status}: ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data?.hits) ? data.hits : [];
}

// Formatta un singolo hit in blocco testo per il contesto RAG
function hitToText(hit) {
  const testo = String(hit?.testo_originale || "").trim();
  const estratto =
    testo.length > MAX_TEXT_EXCERPT_CHARS
      ? `${testo.slice(0, MAX_TEXT_EXCERPT_CHARS)}...`
      : testo;

  return [
    `Titolo: ${hit?.titolo || "(senza titolo)"}`,
    `Fonte: ${hit?.fonte || "(fonte sconosciuta)"}`,
    hit?.link ? `Link: ${hit.link}` : "",
    `Data: ${hit?.data || "(data non disponibile)"}`,
    hit?.abstract ? `Abstract: ${hit.abstract}` : "",
    estratto ? `Testo: ${estratto}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");
}

// Costruisce il prompt da inviare al modello RAG
export function buildPrompt(question, context, template = "") {
  return (template || DEFAULT_PROMPT_TEMPLATE)
    .replaceAll("{{context}}", context)
    .replaceAll("{{question}}", question);
}

// Aggiunge i link alle fonti in fondo alla risposta generata
export function appendSourceLinks(answer, hits) {
  const links = [
    ...new Set(
      (hits || [])
        .map((h) => String(h?.link || "").trim())
        .filter((l) => /^https?:\/\//i.test(l))
    ),
  ].slice(0, 5);

  if (links.length === 0) return String(answer || "").trim();
  return `${String(answer || "").trim()}\n\nFonti:\n${links.map((l) => `- ${l}`).join("\n")}`;
}

// Cerca su Meilisearch e costruisce il contesto testuale per RAG
export async function fetchContext(searchQuery, limit, searchIndex, options = {}) {
  const index = normalizeSearchIndex(searchIndex);
  const query = String(options.searchPlan?.textQuery || searchQuery || "").trim();
  const filter = String(options.searchPlan?.filterExpression || "").trim();
  const hits = await runSearch(query, limit, index, filter);
  const context = hits.slice(0, MAX_CONTEXT_DOCS).map(hitToText).join("\n");

  return {
    hits,
    context,
    searchQuery: query,
    filter,
    candidateCount: hits.length,
  };
}

// Versione con cache in memoria di fetchContext (TTL configurabile)
export async function fetchContextCached(searchQuery, limit, searchIndex, options = {}) {
  const index = normalizeSearchIndex(searchIndex);
  const cacheKey = `${index}::${limit}::${searchQuery}::${JSON.stringify(options.searchPlan || {})}`;
  const now = Date.now();
  const cached = searchCache.get(cacheKey);

  if (cached && now - cached.ts < SEARCH_CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const data = await fetchContext(searchQuery, limit, index, options);
  searchCache.set(cacheKey, { ts: now, data });
  return { ...data, cached: false };
}
