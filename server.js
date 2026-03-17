import express from "express";
import dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

const SEARCH_INDEX_URL =
  process.env.SEARCH_INDEX_URL ||
  "https://search.appnativeitalia.com/indexes/testi_ecclesiali/search";
const DEFAULT_SEARCH_INDEX = process.env.DEFAULT_SEARCH_INDEX || "testi_ecclesiali";
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const SEARCH_API_KEY_BOLLETTINO = process.env.SEARCH_API_KEY_BOLLETTINO || "";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_NON_STREAM_TIMEOUT_MS = Number(process.env.OLLAMA_NON_STREAM_TIMEOUT_MS || 90_000);

const DEFAULT_SEARCH_QUERY = process.env.DEFAULT_SEARCH_QUERY || "papa leone";
const DEFAULT_LIMIT = Number(process.env.DEFAULT_LIMIT || 5);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemma:7b";
const MAX_TEXT_EXCERPT_CHARS = Number(process.env.MAX_TEXT_EXCERPT_CHARS || 1800);
const MAX_CONTEXT_DOCS = Number(process.env.MAX_CONTEXT_DOCS || 3);
const SEARCH_CANDIDATE_MULTIPLIER = Number(process.env.SEARCH_CANDIDATE_MULTIPLIER || 3);
const SEARCH_CACHE_TTL_MS = 30_000;
const UI_STATE_SCOPE_DEFAULT = "default";
const SEARCH_PROFILES = {
  testi_ecclesiali: {
    key: "notizie",
    strictTemporalDisambiguation: false,
    defaultChatMode: "rag",
  },
  bollettino: {
    key: "bollettini",
    strictTemporalDisambiguation: true,
    defaultChatMode: "agent",
  },
};
const AI_ENTITY_FALLBACK_ENABLED = process.env.AI_ENTITY_FALLBACK_ENABLED !== "false";
const AI_ENTITY_MIN_LOCAL_TERMS = Number(process.env.AI_ENTITY_MIN_LOCAL_TERMS || 3);
const AI_ENTITY_TIMEOUT_MS = Number(process.env.AI_ENTITY_TIMEOUT_MS || 1800);
const AI_ENTITY_MODEL = process.env.AI_ENTITY_MODEL || DEFAULT_MODEL;
const AI_ENTITY_CACHE_TTL_MS = 60_000;
const AI_INTENT_ENABLED = process.env.AI_INTENT_ENABLED !== "false";
const AI_INTENT_MODEL = process.env.AI_INTENT_MODEL || AI_ENTITY_MODEL;
const AI_INTENT_TIMEOUT_MS = Number(process.env.AI_INTENT_TIMEOUT_MS || 2200);
const AI_INTENT_CACHE_TTL_MS = Number(process.env.AI_INTENT_CACHE_TTL_MS || 45_000);
const TEMPORAL_MONTH_TERMS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];
const TEMPORAL_REFERENCE_TERMS = [
  "oggi",
  "ieri",
  "domani",
  "settimana",
  "settimane",
  "mese",
  "mesi",
  "anno",
  "anni",
  "trimestre",
  "semestre",
  "ultimo",
  "ultimi",
  "ultima",
  "ultime",
  "scorso",
  "scorsi",
  "scorsa",
  "scorse",
  "precedente",
  "precedenti",
  "recente",
  "recenti",
  "recentemente",
  "attuale",
  "attuali",
  "pontificato",
];
const UI_STATE_FILE = path.join(__dirname, "storage", "ui-state.json");
const DEFAULT_PROMPT_TEMPLATE = `Usa solo il contesto seguente.

Contesto:
{{context}}

Domanda:
{{question}}

Scrivi la risposta con questa struttura:

Sintesi iniziale:
[3-4 frasi]

Passaggi logici:
1. ...
2. ...
3. ...

Temi principali:
- ...
- ...
- ...

Evidenze dal contesto:
- [fatto] (fonte, data)
- [fatto] (fonte, data)

Fonti:
- ...

Conclusione:
[2-3 frasi]

Regole:
- non usare conoscenze esterne
- non inventare fatti
- usa solo il contesto fornito`;
const DEFAULT_AGENT_PROMPT_TEMPLATE = `Classifica l'intento di una richiesta utente per preparare ricerca documentale.
Restituisci SOLO JSON valido con schema:
{"needsTopic":boolean,"needsTime":boolean,"isTimeSensitive":boolean,"confidence":number}

Regole:
- needsTopic=true se il tema richiesto e' troppo vago
- needsTime=true se manca un riferimento temporale essenziale
- isTimeSensitive=true se il tipo di domanda dipende dal tempo (eventi, nomine, ordinazioni, aggiornamenti)
- confidence tra 0 e 1
- niente testo extra

Modalita' strictTemporal: {{strictTemporal}}
Storico utente:
{{history}}

Ultima domanda utente:
{{question}}`;
const searchCache = new Map();
const questionAnalysisCache = new Map();
const intentAnalysisCache = new Map();
const ITALIAN_STOP_WORDS = new Set([
  "a",
  "ad",
  "ai",
  "al",
  "alla",
  "alle",
  "anche",
    "abbia",
    "abbiamo",
    "abbiano",
    "abbiate",
    "andare",
    "avere",
    "avuto",
    "aveva",
    "avevo",
    "avevamo",
    "avevano",
    "avrei",
    "avremmo",
    "avremo",
    "avrete",
    "avranno",
  "chi",
  "che",
  "cosa",
  "con",
    "capito",
    "capire",
    "cercare",
    "cerca",
  "da",
  "dal",
  "dalla",
  "dalle",
    "dammi",
  "dei",
  "del",
  "della",
  "delle",
  "di",
  "dove",
  "dice",
  "dici",
  "dimmi",
  "detto",
  "e",
  "ed",
  "emerge",
  "fare",
  "fatto",
  "fatti",
    "fammi",
    "forse",
    "fosse",
    "fossero",
  "gli",
  "ha",
  "hanno",
    "hai",
    "ho",
    "ho",
    "hanno",
    "aveva",
    "essere",
    "stato",
    "stata",
    "stati",
    "stare",
    "stai",
    "stiamo",
    "stanno",
  "i",
  "il",
  "in",
    "intorno",
  "l",
  "la",
  "le",
  "lo",
  "ma",
  "mi",
  "ne",
  "nel",
  "nella",
  "nelle",
    "non",
    "noi",
    "loro",
    "lui",
    "lei",
  "notizia",
  "notizie",
  "parlami",
  "parla",
  "parlato",
  "proposito",
  "raccontami",
  "riguardo",
  "rispetto",
  "spiegami",
    "puoi",
    "posso",
    "possiamo",
    "potrei",
    "potrebbe",
    "potremmo",
    "prego",
    "per",
    "poi",
    "piu",
    "quale",
    "quali",
    "quando",
    "quanto",
    "quanti",
    "quelli",
    "queste",
    "questi",
    "questo",
    "questa",
    "voglio",
    "vorrei",
    "vorresti",
    "volere",
    "venire",
    "viene",
    "vieni",
    "sapere",
    "sai",
    "sappiamo",
    "sapevo",
    "saprei",
    "vedere",
    "vedi",
    "vedo",
  "dell",
  "dello",
  "degli",
  "sull",
  "sullo",
  "sulla",
  "sulle",
  "se",
  "si",
  "sono",
  "su",
  "tra",
  "un",
  "una",
  "uno",
]);

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function formatEntityList(label, values) {
  const items = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (items.length === 0) {
    return "";
  }

  return `${label}: ${items.join(", ")}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSignificant(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

// Like tokenizeSignificant but also removes function words/prepositions so only
// "intent" tokens remain. Used when comparing a user question against entity values.
function tokenizeIntent(value) {
  return tokenizeSignificant(value).filter((token) => !ITALIAN_STOP_WORDS.has(token));
}

function uniqueTerms(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEntityValues(values) {
  return uniqueTerms(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function normalizeEntityPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    persone: normalizeEntityValues(source.persone),
    luoghi: normalizeEntityValues(source.luoghi),
    enti: normalizeEntityValues(source.enti),
  };
}

function normalizeApostrophes(value) {
  return String(value || "").replace(/[’']/g, " ");
}

function hasTemporalReference(question) {
  const raw = String(question || "").toLowerCase().trim();
  const normalized = normalizeText(normalizeApostrophes(question));

  if (!raw || !normalized) {
    return false;
  }

  if (/\b(19|20)\d{2}\b/.test(raw)) {
    return true;
  }

  if (/\b\d{1,2}[/.\-]\d{1,2}([/.\-]\d{2,4})?\b/.test(raw)) {
    return true;
  }

  if (TEMPORAL_MONTH_TERMS.some((month) => normalized.includes(month))) {
    return true;
  }

  if (TEMPORAL_REFERENCE_TERMS.some((term) => normalized.includes(term))) {
    return true;
  }

  return false;
}

function getSearchProfile(searchIndex) {
  const normalizedIndex = normalizeSearchIndex(searchIndex);
  return SEARCH_PROFILES[normalizedIndex] || SEARCH_PROFILES[DEFAULT_SEARCH_INDEX] || SEARCH_PROFILES.testi_ecclesiali;
}

async function inferIntentRequirementsWithAi({ question, history, strictTemporal, promptTemplate }) {
  if (!AI_INTENT_ENABLED) {
    return null;
  }

  const historyText = getUserHistoryText(history);
  const merged = [historyText, String(question || "").trim()].filter(Boolean).join(" ");
  const cacheKey = `intent::${strictTemporal ? "strict" : "relaxed"}::${normalizeText(merged)}`;
  const now = Date.now();
  const cached = intentAnalysisCache.get(cacheKey);
  if (cached && now - cached.timestamp < AI_INTENT_CACHE_TTL_MS) {
    return cached.payload;
  }

  const template = String(promptTemplate || DEFAULT_AGENT_PROMPT_TEMPLATE);
  const prompt = template
    .replaceAll("{{strictTemporal}}", strictTemporal ? "true" : "false")
    .replaceAll("{{history}}", historyText || "(vuoto)")
    .replaceAll("{{question}}", String(question || "").trim());

  try {
    const raw = await askOllamaWithTimeout(prompt, AI_INTENT_MODEL, AI_INTENT_TIMEOUT_MS);
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const payload = {
      needsTopic: Boolean(parsed.needsTopic),
      needsTime: Boolean(parsed.needsTime),
      isTimeSensitive: Boolean(parsed.isTimeSensitive),
      confidence: Number(parsed.confidence || 0),
    };

    if (!Number.isFinite(payload.confidence)) {
      payload.confidence = 0;
    }

    intentAnalysisCache.set(cacheKey, {
      timestamp: now,
      payload,
    });

    return payload;
  } catch {
    return null;
  }
}

async function getTemporalDisambiguation(question, options = {}) {
  if (!options.strict) {
    return null;
  }

  const normalized = normalizeText(normalizeApostrophes(question));
  if (!normalized) {
    return null;
  }

  const aiIntent = await inferIntentRequirementsWithAi({
    question,
    history: options.history || [],
    strictTemporal: true,
  });

  const ruleTimeSensitive =
    /ordinaz/.test(normalized)
    || /consacraz/.test(normalized)
    || (/nomin/.test(normalized) && /vescov/.test(normalized));

  const aiReliable = aiIntent && aiIntent.confidence >= 0.6;
  const isTimeSensitiveQuestion = aiReliable
    ? Boolean(aiIntent.needsTime || aiIntent.isTimeSensitive)
    : ruleTimeSensitive;

  if (!isTimeSensitiveQuestion) {
    return null;
  }

  if (hasTemporalReference(question)) {
    return null;
  }

  return {
    required: true,
    message:
      "Per questa ricerca serve un riferimento temporale. Specifica ad esempio: 'nel 2025', 'negli ultimi 12 mesi' oppure 'tra gennaio e marzo 2024'.",
  };
}

function buildLocalQuestionAnalysis(question) {
  const normalizedQuestion = normalizeText(question);
  const baseTerms = tokenizeSignificant(normalizeApostrophes(question));
  const terms = uniqueTerms(baseTerms);

  return {
    original: String(question || "").trim(),
    normalized: normalizedQuestion,
    terms,
    entities: { persone: [], luoghi: [], enti: [] },
    usedAiEntityFallback: false,
    retrievalQuery: terms.length > 0 ? terms.join(" ") : String(question || "").trim(),
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askOllamaWithTimeout(prompt, model, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const text = await ollamaResponse.text();
      throw new Error(`Errore Ollama (${ollamaResponse.status}): ${text}`);
    }

    const payload = await ollamaResponse.json();
    return payload?.response || "";
  } finally {
    clearTimeout(timer);
  }
}

async function extractEntitiesWithAi(question) {
  if (!AI_ENTITY_FALLBACK_ENABLED) {
    return null;
  }

  const cacheKey = normalizeText(question);
  const now = Date.now();
  const cached = questionAnalysisCache.get(cacheKey);
  if (cached && now - cached.timestamp < AI_ENTITY_CACHE_TTL_MS) {
    return cached.entities;
  }

  const extractionPrompt = `Estrai entita nominate da questa domanda in italiano.
Restituisci SOLO JSON valido con questo schema:
{"persone":[],"luoghi":[],"enti":[]}

Regole:
- niente spiegazioni
- mantieni i nomi come compaiono nella domanda
- usa array vuoti se non trovi nulla

Domanda: ${String(question || "").trim()}`;

  try {
    const raw = await askOllamaWithTimeout(extractionPrompt, AI_ENTITY_MODEL, AI_ENTITY_TIMEOUT_MS);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      return null;
    }

    const entities = normalizeEntityPayload(parsed);
    questionAnalysisCache.set(cacheKey, {
      timestamp: now,
      entities,
    });
    return entities;
  } catch {
    return null;
  }
}

async function analyzeQuestion(question) {
  const local = buildLocalQuestionAnalysis(question);
  if (local.terms.length >= AI_ENTITY_MIN_LOCAL_TERMS) {
    return local;
  }

  const aiEntities = await extractEntitiesWithAi(question);
  if (!aiEntities) {
    return local;
  }

  const entityTerms = uniqueTerms(
    [...aiEntities.persone, ...aiEntities.luoghi, ...aiEntities.enti].flatMap((value) =>
      tokenizeSignificant(normalizeApostrophes(value))
    )
  );
  const mergedTerms = uniqueTerms([...local.terms, ...entityTerms]);
  const retrievalQuery = mergedTerms.length > 0 ? mergedTerms.join(" ") : local.original;

  return {
    ...local,
    terms: mergedTerms,
    entities: aiEntities,
    usedAiEntityFallback: true,
    retrievalQuery,
  };
}

function countTermMatches(terms, text) {
  if (!text) {
    return 0;
  }

  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function countTokenMatches(tokens, text) {
  if (!text || !Array.isArray(tokens) || tokens.length === 0) {
    return 0;
  }

  return tokens.reduce((count, token) => (text.includes(token) ? count + 1 : count), 0);
}

function buildTextExcerpt(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "";
  }

  if (normalizedText.length <= MAX_TEXT_EXCERPT_CHARS) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, MAX_TEXT_EXCERPT_CHARS)}...`;
}

function buildRelevantExcerpt(text, analysis) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "";
  }

  const lowerText = normalizedText.toLowerCase();
  const matchedTerm = analysis.terms.find((term) => lowerText.includes(term));

  if (!matchedTerm) {
    return buildTextExcerpt(normalizedText);
  }

  const termIndex = lowerText.indexOf(matchedTerm);
  const windowSize = Math.min(MAX_TEXT_EXCERPT_CHARS, 700);
  const start = Math.max(0, termIndex - Math.floor(windowSize * 0.35));
  const end = Math.min(normalizedText.length, start + windowSize);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedText.length ? "..." : "";

  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`;
}

function pickRelevantEntities(values, analysis) {
  const items = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (items.length === 0) {
    return [];
  }

  const filteredItems = items.filter((value) => {
    const normalizedValue = normalizeText(value);
    return analysis.terms.some((term) => normalizedValue.includes(term));
  });

  return filteredItems.length > 0 ? filteredItems : items.slice(0, 4);
}

function isLowQualityHit(hit) {
  const id = String(hit?.id || "").trim().toLowerCase();
  const title = String(hit?.titolo || "").trim();
  const body = String(hit?.testo_originale || "").trim();
  const abstract = String(hit?.abstract || "").trim().toLowerCase();

  const emptyCoreContent = title.length === 0 && body.length === 0;
  const looksLikePlaceholderSummary =
    abstract.includes("non fornisce informazioni specifiche")
    || abstract.includes("poco informativo");
  const syntheticDocId = id.startsWith("documento-");

  if (emptyCoreContent) {
    return true;
  }

  if (syntheticDocId && looksLikePlaceholderSummary && title.length < 4) {
    return true;
  }

  return false;
}

function normalizeSearchIndex(indexName) {
  const candidate = String(indexName || "").trim().toLowerCase();
  if (!candidate) {
    return DEFAULT_SEARCH_INDEX;
  }

  if (!/^[a-z0-9_-]+$/.test(candidate)) {
    throw new Error("Nome indice non valido");
  }

  return candidate;
}

function getSearchEndpoint(indexName) {
  const normalizedIndex = normalizeSearchIndex(indexName);

  try {
    const baseUrl = new URL(SEARCH_INDEX_URL);
    const pathParts = baseUrl.pathname.split("/").filter(Boolean);
    const indexesPosition = pathParts.indexOf("indexes");

    if (indexesPosition >= 0 && pathParts.length >= indexesPosition + 3) {
      pathParts[indexesPosition + 1] = normalizedIndex;
      baseUrl.pathname = `/${pathParts.join("/")}`;
      return baseUrl.toString();
    }
  } catch {
    // Fallback below keeps compatibility with malformed env URLs.
  }

  const trimmed = String(SEARCH_INDEX_URL || "").trim();
  const replaced = trimmed.replace(/\/indexes\/[^/]+\/search(?:\?.*)?$/i, `/indexes/${normalizedIndex}/search`);
  return replaced || `https://search.appnativeitalia.com/indexes/${normalizedIndex}/search`;
}

function getSearchApiKey(indexName) {
  const normalizedIndex = normalizeSearchIndex(indexName);

  if (normalizedIndex === "bollettino") {
    return SEARCH_API_KEY_BOLLETTINO || SEARCH_API_KEY;
  }

  return SEARCH_API_KEY;
}

async function runSearchQuery(query, limit, searchIndex) {
  const searchEndpoint = getSearchEndpoint(searchIndex);
  const apiKey = getSearchApiKey(searchIndex);

  if (!apiKey) {
    throw new Error("SEARCH_API_KEY non configurata per l'indice richiesto");
  }

  const searchResponse = await fetch(searchEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      q: query,
      limit,
    }),
  });

  if (!searchResponse.ok) {
    const text = await searchResponse.text();
    throw new Error(`Errore search API (${searchResponse.status}): ${text}`);
  }

  const payload = await searchResponse.json();
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  return hits.filter((hit) => !isLowQualityHit(hit));
}

async function runSeedSearchCandidates(searchQuery, analysis, candidateLimit, searchIndex) {
  const rawQuery = String(searchQuery || "").trim();
  const phraseQuery = rawQuery || analysis.retrievalQuery || DEFAULT_SEARCH_QUERY;
  // Use intent tokens (stop-word filtered) so prepositions like "sulla" don't
  // fire useless/noisy stand-alone queries against the search index.
  const tokenQueries = uniqueTerms(tokenizeIntent(normalizeApostrophes(rawQuery)));
  const allQueries = uniqueTerms([phraseQuery, ...tokenQueries]);

  const queryLimit = Math.max(Math.ceil(candidateLimit / 2), 5);
  const queryResults = await Promise.all(
    allQueries.map((q) => runSearchQuery(q, queryLimit, searchIndex))
  );

  const merged = [];
  const seen = new Set();

  for (const resultSet of queryResults) {
    for (const hit of resultSet) {
      const dedupeKey = String(hit?.id || "").trim()
        || `${normalizeText(hit?.titolo)}|${normalizeText(hit?.data)}|${normalizeText(hit?.fonte)}`;

      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      merged.push(hit);

      if (merged.length >= Math.max(candidateLimit, 15)) {
        return merged;
      }
    }
  }

  return merged;
}

function dedupeHitsWithCap(hitGroups, cap) {
  const merged = [];
  const seen = new Set();

  for (const resultSet of hitGroups) {
    for (const hit of resultSet) {
      const dedupeKey = String(hit?.id || "").trim()
        || `${normalizeText(hit?.titolo)}|${normalizeText(hit?.data)}|${normalizeText(hit?.fonte)}`;

      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      merged.push(hit);

      if (merged.length >= cap) {
        return merged;
      }
    }
  }

  return merged;
}

function buildEntityAwareSignal(candidateHits, question) {
  const questionNormalized = normalizeText(normalizeApostrophes(question));
  // Use intent tokens (stop-word filtered) to avoid prepositions like "sulla"
  // being matched against entity values and creating false required-entity signals.
  const questionTerms = uniqueTerms(tokenizeIntent(questionNormalized));

  const groups = {
    persone: new Map(),
    luoghi: new Map(),
    enti: new Map(),
  };
  const requiredEntityCandidates = new Map();

  for (const hit of candidateHits) {
    const titoloNorm = normalizeText(hit?.titolo);
    const abstractNorm = normalizeText(hit?.abstract);

    for (const groupName of ["persone", "luoghi", "enti"]) {
      const values = Array.isArray(hit?.[groupName]) ? hit[groupName] : [];
      for (const rawValue of values) {
        const value = String(rawValue || "").trim();
        if (!value) {
          continue;
        }

        const normalizedValue = normalizeText(value);
        if (!normalizedValue) {
          continue;
        }

        const overlap = countTermMatches(questionTerms, normalizedValue);
        const phraseMatch = questionNormalized.includes(normalizedValue);
        if (overlap === 0 && !phraseMatch) {
          continue;
        }

        const requiredScore =
          (phraseMatch ? 30 : 0) +
          (overlap >= 2 ? 20 : 0) +
          overlap * 6 +
          Math.min(normalizedValue.split(" ").length, 5);

        if (requiredScore > 0) {
          const prev = requiredEntityCandidates.get(normalizedValue) || {
            value,
            normalized: normalizedValue,
            score: 0,
          };
          prev.score += requiredScore;
          requiredEntityCandidates.set(normalizedValue, prev);
        }

        const inTitolo = titoloNorm.includes(normalizedValue);
        const inAbstract = abstractNorm.includes(normalizedValue);

        const score =
          overlap * 12 +
          (phraseMatch ? 8 : 0) +
          (inTitolo ? 6 : 0) +
          (inAbstract ? 3 : 0) +
          1;

        const bucket = groups[groupName];
        const current = bucket.get(normalizedValue) || {
          value,
          score: 0,
          overlap: 0,
          count: 0,
        };
        current.score += score;
        current.overlap = Math.max(current.overlap, overlap + (phraseMatch ? 1 : 0));
        current.count += 1;
        bucket.set(normalizedValue, current);
      }
    }
  }

  const detectedEntities = { persone: [], luoghi: [], enti: [] };
  for (const groupName of ["persone", "luoghi", "enti"]) {
    const sorted = [...groups[groupName].values()].sort((a, b) => {
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.value.localeCompare(b.value, "it");
    });
    detectedEntities[groupName] = sorted.slice(0, 6).map((entry) => entry.value);
  }

  const requiredEntities = [...requiredEntityCandidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.value);

  const retrievalSource =
    requiredEntities.length > 0
      ? requiredEntities
      : [...detectedEntities.persone, ...detectedEntities.luoghi, ...detectedEntities.enti];

  const retrievalTerms = uniqueTerms([
    ...questionTerms,
    ...retrievalSource.flatMap((value) => tokenizeSignificant(normalizeApostrophes(value))),
  ]).slice(0, 18);

  const entityKeywordTerms = retrievalTerms.filter((term) => !questionTerms.includes(term));

  return {
    detectedEntities,
    requiredEntities,
    retrievalTerms,
    entityKeywordTerms,
  };
}

function buildEntityMatcher(value) {
  const normalized = normalizeText(normalizeApostrophes(value));
  return {
    value,
    normalized,
    tokens: tokenizeSignificant(normalized),
  };
}

function hitMatchesEntity(hit, matcher) {
  const values = [
    ...(Array.isArray(hit?.persone) ? hit.persone : []),
    ...(Array.isArray(hit?.luoghi) ? hit.luoghi : []),
    ...(Array.isArray(hit?.enti) ? hit.enti : []),
  ];

  const entityText = normalizeText(values.join(" "));
  const titleText = normalizeText(hit?.titolo);
  const abstractText = normalizeText(hit?.abstract);
  const mergedText = `${entityText} ${titleText} ${abstractText}`.trim();

  if (!mergedText || !matcher?.normalized) {
    return false;
  }

  if (mergedText.includes(matcher.normalized)) {
    return true;
  }

  if (matcher.tokens.length === 0) {
    return false;
  }

  const matchedTokens = countTokenMatches(matcher.tokens, mergedText);
  const requiredTokenMatches = Math.max(1, Math.ceil(matcher.tokens.length * 0.6));
  return matchedTokens >= requiredTokenMatches;
}

function filterHitsByRequiredEntities(hits, requiredEntities) {
  const matchers = uniqueTerms(requiredEntities)
    .map((value) => buildEntityMatcher(value))
    .filter((matcher) => matcher.normalized);

  if (matchers.length === 0) {
    return hits;
  }

  const matchedHits = hits.filter((hit) => matchers.some((matcher) => hitMatchesEntity(hit, matcher)));
  return matchedHits.length > 0 ? matchedHits : hits;
}

function buildLiveEntitySignal(candidateHits, analysis, selectedHitIds) {
  const groups = {
    persone: new Map(),
    luoghi: new Map(),
    enti: new Map(),
  };

  for (const hit of candidateHits) {
    const isSelected = selectedHitIds.has(hit?.id);
    const hitScore = scoreHit(hit, analysis);
    if (!isSelected && hitScore === 0) {
      continue;
    }

    const titoloNorm = normalizeText(hit?.titolo);
    const abstractNorm = normalizeText(hit?.abstract);
    const titoloTermHits = countTermMatches(analysis.terms, titoloNorm);
    const abstractTermHits = countTermMatches(analysis.terms, abstractNorm);
    const hitStrength = titoloTermHits * 3 + abstractTermHits * 2 + (isSelected ? 5 : 0);

    for (const groupName of ["persone", "luoghi", "enti"]) {
      const values = Array.isArray(hit?.[groupName]) ? hit[groupName] : [];
      for (const rawValue of values) {
        const value = String(rawValue || "").trim();
        if (!value) {
          continue;
        }

        const normalized = normalizeText(value);
        if (!normalized) {
          continue;
        }

        const queryOverlap = countTermMatches(analysis.terms, normalized);
        const inTitolo = titoloNorm.includes(normalized);
        const inAbstract = abstractNorm.includes(normalized);

        if (queryOverlap === 0 && !inTitolo && !inAbstract) {
          continue;
        }

        const score =
          queryOverlap * 10 +
          (inTitolo ? 8 : 0) +
          (inAbstract ? 3 : 0) +
          hitStrength;

        const bucket = groups[groupName];
        const current = bucket.get(normalized) || { value, score: 0, queryOverlap: 0 };
        current.score += score;
        current.queryOverlap = Math.max(current.queryOverlap, queryOverlap);
        bucket.set(normalized, current);
      }
    }
  }

  const detectedEntities = { persone: [], luoghi: [], enti: [] };
  for (const groupName of ["persone", "luoghi", "enti"]) {
    const sorted = [...groups[groupName].values()].sort((a, b) => {
      if (b.queryOverlap !== a.queryOverlap) {
        return b.queryOverlap - a.queryOverlap;
      }
      return b.score - a.score;
    });
    detectedEntities[groupName] = sorted.slice(0, 6).map((entry) => entry.value);
  }

  const entityKeywordTerms = uniqueTerms(
    [...detectedEntities.persone, ...detectedEntities.luoghi, ...detectedEntities.enti].flatMap((value) =>
      tokenizeSignificant(normalizeApostrophes(value))
    )
  ).filter((term) => !analysis.terms.includes(term));

  return {
    detectedEntities,
    entityKeywordTerms,
  };
}

function getDefaultUiState(scope = UI_STATE_SCOPE_DEFAULT) {
  const profile = scope === "bollettini" ? SEARCH_PROFILES.bollettino : SEARCH_PROFILES.testi_ecclesiali;
  return {
    limit: DEFAULT_LIMIT,
    model: DEFAULT_MODEL,
    chatMode: profile.defaultChatMode,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    agentPromptTemplate: DEFAULT_AGENT_PROMPT_TEMPLATE,
    questionDraft: "",
  };
}

async function ensureStorageDir() {
  await fs.mkdir(path.dirname(UI_STATE_FILE), { recursive: true });
}

function sanitizeUiState(rawState, scope = UI_STATE_SCOPE_DEFAULT) {
  const defaults = getDefaultUiState(scope);
  const parsedLimit = Number(rawState?.limit ?? defaults.limit);
  const parsedChatMode = String(rawState?.chatMode || defaults.chatMode).trim().toLowerCase();
  const chatMode = parsedChatMode === "rag" ? "rag" : "agent";

  return {
    limit: Number.isFinite(parsedLimit) ? parsedLimit : defaults.limit,
    model: String(rawState?.model || defaults.model).trim() || defaults.model,
    chatMode,
    promptTemplate:
      String(rawState?.promptTemplate || defaults.promptTemplate) || defaults.promptTemplate,
    agentPromptTemplate:
      String(rawState?.agentPromptTemplate || defaults.agentPromptTemplate)
      || defaults.agentPromptTemplate,
    questionDraft: String(rawState?.questionDraft || ""),
  };
}

function normalizeUiScope(scope) {
  const candidate = String(scope || "").trim().toLowerCase();
  if (candidate === "notizie" || candidate === "bollettini") {
    return candidate;
  }
  return UI_STATE_SCOPE_DEFAULT;
}

function normalizeUiStateStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { scopes: {} };
  }

  if (raw.scopes && typeof raw.scopes === "object" && !Array.isArray(raw.scopes)) {
    return { scopes: raw.scopes };
  }

  // Backward compatibility: legacy flat ui-state format.
  return {
    scopes: {
      [UI_STATE_SCOPE_DEFAULT]: raw,
    },
  };
}

async function readUiState(scope = UI_STATE_SCOPE_DEFAULT) {
  const normalizedScope = normalizeUiScope(scope);
  try {
    const fileContent = await fs.readFile(UI_STATE_FILE, "utf8");
    const store = normalizeUiStateStore(JSON.parse(fileContent));
    return sanitizeUiState(store.scopes[normalizedScope], normalizedScope);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return getDefaultUiState(normalizedScope);
    }

    throw error;
  }
}

async function writeUiState(nextState, scope = UI_STATE_SCOPE_DEFAULT) {
  const normalizedScope = normalizeUiScope(scope);
  await ensureStorageDir();
  let currentStore = { scopes: {} };

  try {
    const fileContent = await fs.readFile(UI_STATE_FILE, "utf8");
    currentStore = normalizeUiStateStore(JSON.parse(fileContent));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const state = sanitizeUiState(nextState, normalizedScope);
  const nextStore = {
    scopes: {
      ...currentStore.scopes,
      [normalizedScope]: state,
    },
  };

  await fs.writeFile(UI_STATE_FILE, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  return state;
}

function hitToBlock(hit, analysis) {
  const titolo = hit?.titolo || "(senza titolo)";
  const fonte = hit?.fonte || "(fonte sconosciuta)";
  const data = hit?.data || "(data non disponibile)";
  const abstract = hit?.abstract || "(nessun abstract)";
  const tipoDocumento = hit?.tipo_documento ? `Tipo documento: ${hit.tipo_documento}` : "";
  const tipoFonte = hit?.tipo_fonte ? `Tipo fonte: ${hit.tipo_fonte}` : "";
  const persone = formatEntityList("Persone", pickRelevantEntities(hit?.persone, analysis));
  const luoghi = formatEntityList("Luoghi", pickRelevantEntities(hit?.luoghi, analysis));
  const enti = formatEntityList("Enti", pickRelevantEntities(hit?.enti, analysis));
  const link = hit?.link ? `Link: ${hit.link}` : "";
  const testoEstratto = buildRelevantExcerpt(hit?.testo_originale, analysis);
  const testo = testoEstratto ? `Testo originale: ${testoEstratto}` : "";

  return [
    `Titolo: ${titolo}`,
    `Fonte: ${fonte}`,
    `Data: ${data}`,
    tipoDocumento,
    tipoFonte,
    persone,
    luoghi,
    enti,
    `Abstract: ${abstract}`,
    testo,
    link,
    "---",
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreHit(hit, analysis) {
  if (analysis.terms.length === 0) {
    return 0;
  }

  const titleText = normalizeText(hit?.titolo);
  const abstractText = normalizeText(hit?.abstract);
  const documentTypeText = normalizeText(hit?.tipo_documento);
  const sourceTypeText = normalizeText(hit?.tipo_fonte);
  const peopleText = normalizeText((hit?.persone || []).join(" "));
  const placesText = normalizeText((hit?.luoghi || []).join(" "));
  const entitiesText = normalizeText((hit?.enti || []).join(" "));
  const sourceText = normalizeText(hit?.fonte);
  const originalText = normalizeText(hit?.testo_originale).slice(0, 5000);

  const entityTokens = uniqueTerms(
    [...(hit?.persone || []), ...(hit?.luoghi || []), ...(hit?.enti || [])]
      .flatMap((value) => tokenizeSignificant(normalizeApostrophes(value)))
  );

  const entityCoverage = analysis.terms.length > 0
    ? countTokenMatches(analysis.terms, entityTokens.join(" ")) / analysis.terms.length
    : 0;
  const titleCoverage = analysis.terms.length > 0
    ? countTermMatches(analysis.terms, titleText) / analysis.terms.length
    : 0;
  const abstractCoverage = analysis.terms.length > 0
    ? countTermMatches(analysis.terms, abstractText) / analysis.terms.length
    : 0;

  let score = 0;
  // Hierarchy: entity match first, then title, then abstract/body.
  score += Math.round(entityCoverage * 100);
  score += Math.round(titleCoverage * 70);
  score += Math.round(abstractCoverage * 45);
  score += countTermMatches(analysis.terms, titleText) * 8;
  score += countTermMatches(analysis.terms, peopleText) * 7;
  score += countTermMatches(analysis.terms, placesText) * 7;
  score += countTermMatches(analysis.terms, entitiesText) * 6;
  score += countTermMatches(analysis.terms, abstractText) * 4;
  score += countTermMatches(analysis.terms, documentTypeText) * 3;
  score += countTermMatches(analysis.terms, sourceTypeText) * 2;
  score += countTermMatches(analysis.terms, sourceText) * 2;
  score += countTermMatches(analysis.terms, originalText) * 1;

  if (analysis.normalized && titleText.includes(analysis.normalized)) {
    score += 12;
  }

  if (analysis.normalized && abstractText.includes(analysis.normalized)) {
    score += 8;
  }

  return score;
}

function selectRelevantHits(hits, analysis, requestedLimit, options = {}) {
  const { strictPositive = false } = options;
  const rankedHits = hits
    .map((hit) => ({ hit, score: scoreHit(hit, analysis) }))
    .sort((left, right) => right.score - left.score);

  const positivelyRankedHits = rankedHits.filter((entry) => entry.score > 0);
  const sourceEntries =
    strictPositive || positivelyRankedHits.length > 0 ? positivelyRankedHits : rankedHits;
  const selectedEntries = sourceEntries.slice(0, requestedLimit);

  return {
    hits: selectedEntries.map((entry) => entry.hit),
    ranking: selectedEntries,
  };
}

function buildPrompt(question, context, promptTemplate) {
  const template = String(promptTemplate || DEFAULT_PROMPT_TEMPLATE);

  return template
    .replaceAll("{{context}}", context)
    .replaceAll("{{question}}", question);
}

async function fetchContext(searchQuery, limit, searchIndex) {
  if (!getSearchApiKey(searchIndex)) {
    throw new Error("SEARCH_API_KEY non configurata per l'indice richiesto");
  }

  const analysis = await analyzeQuestion(searchQuery);
  const candidateLimit = Math.max(limit, Math.min(limit * SEARCH_CANDIDATE_MULTIPLIER, 15));

  // Pass 1: collect candidate documents to discover saved entities in the index.
  const seedCandidates = await runSeedSearchCandidates(
    searchQuery,
    analysis,
    candidateLimit,
    searchIndex
  );
  const entitySignal = buildEntityAwareSignal(seedCandidates, searchQuery);
  const retrievalQuery = entitySignal.retrievalTerms.join(" ");

  // Pass 2: retrieval over composed query + focused term queries to avoid
  // losing multi-intent requests (e.g. "floreria" + "pizzaballa").
  const termQueries = uniqueTerms(
    [...entitySignal.retrievalTerms, ...analysis.terms]
      .map((term) => String(term || "").trim())
      .filter((term) => term.length >= 4)
  ).slice(0, 5);

  const expandedQueries = uniqueTerms([
    retrievalQuery,
    ...termQueries,
  ]).filter(Boolean);

  const perQueryLimit = Math.max(3, Math.ceil(candidateLimit / 2));
  const queryResults = await Promise.all(
    expandedQueries.map((q) => runSearchQuery(q, perQueryLimit, searchIndex))
  );

  const candidateHits = dedupeHitsWithCap(
    [
      // Keep seed candidates in the pool to preserve lexical intent coverage.
      seedCandidates,
      ...queryResults,
    ],
    Math.max(candidateLimit, 18)
  );

  const entityConstrainedHits = filterHitsByRequiredEntities(
    candidateHits,
    entitySignal.requiredEntities || []
  );

  const rankingAnalysis = {
    ...analysis,
    terms: (analysis.terms && analysis.terms.length > 0)
      ? analysis.terms
      : entitySignal.retrievalTerms,
    retrievalQuery,
  };

  const { hits, ranking } = selectRelevantHits(entityConstrainedHits, rankingAnalysis, limit, {
    strictPositive: true,
  });
  const selectedHitIds = new Set(hits.map((h) => h?.id).filter(Boolean));
  const liveEntitySignal = buildLiveEntitySignal(
    entityConstrainedHits,
    rankingAnalysis,
    selectedHitIds
  );
  const mergedEntities = {
    persone: normalizeEntityValues([
      ...(analysis?.entities?.persone || []),
      ...(entitySignal.detectedEntities.persone || []),
      ...(liveEntitySignal.detectedEntities.persone || []),
    ]),
    luoghi: normalizeEntityValues([
      ...(analysis?.entities?.luoghi || []),
      ...(entitySignal.detectedEntities.luoghi || []),
      ...(liveEntitySignal.detectedEntities.luoghi || []),
    ]),
    enti: normalizeEntityValues([
      ...(analysis?.entities?.enti || []),
      ...(entitySignal.detectedEntities.enti || []),
      ...(liveEntitySignal.detectedEntities.enti || []),
    ]),
  };
  const contextHits = hits.slice(0, MAX_CONTEXT_DOCS);
  const context = contextHits.map((hit) => hitToBlock(hit, rankingAnalysis)).join("\n");

  return {
    hits,
    context,
    analysis: rankingAnalysis,
    ranking,
    candidateCount: candidateHits.length,
    retrievalQuery,
    detectedEntities: mergedEntities,
    entityKeywordTerms: liveEntitySignal.entityKeywordTerms,
  };
}

function getCacheKey(searchQuery, limit) {
  return `${limit}::${searchQuery.trim().toLowerCase()}`;
}

async function fetchContextCached(searchQuery, limit, searchIndex) {
  const normalizedIndex = normalizeSearchIndex(searchIndex);
  const cacheKey = `${normalizedIndex}::${getCacheKey(searchQuery, limit)}`;
  const now = Date.now();
  const cachedEntry = searchCache.get(cacheKey);

  if (cachedEntry && now - cachedEntry.timestamp < SEARCH_CACHE_TTL_MS) {
    return { ...cachedEntry.payload, cached: true };
  }

  const payload = await fetchContext(searchQuery, limit, normalizedIndex);
  searchCache.set(cacheKey, {
    timestamp: now,
    payload,
  });

  return { ...payload, cached: false };
}

async function askOllama(prompt, model) {
  const response = await askOllamaWithTimeout(prompt, model, OLLAMA_NON_STREAM_TIMEOUT_MS);
  return response || "Nessuna risposta dal modello.";
}

function getUserHistoryText(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  return history
    .filter((item) => String(item?.role || "").toLowerCase() === "user")
    .map((item) => String(item?.content || "").trim())
    .filter(Boolean)
    .join(" ");
}

function isTimeSensitiveIntent(text) {
  const normalized = normalizeText(normalizeApostrophes(text));
  return /ordinaz/.test(normalized)
    || /consacraz/.test(normalized)
    || (/nomin/.test(normalized) && /vescov/.test(normalized));
}

function hasTopicReference(text) {
  const intentTerms = tokenizeIntent(normalizeApostrophes(text));
  return uniqueTerms(intentTerms).length >= 2;
}

function buildProposedSearchQuery(text) {
  const terms = uniqueTerms(tokenizeIntent(normalizeApostrophes(text))).slice(0, 16);
  return terms.join(" ");
}

async function buildIntakeDecision({ question, history, profile, agentPromptTemplate }) {
  const historyText = getUserHistoryText(history);
  const mergedText = [historyText, String(question || "").trim()].filter(Boolean).join(" ");
  const userTurns = (Array.isArray(history)
    ? history.filter((item) => String(item?.role || "").toLowerCase() === "user").length
    : 0) + 1;

  const strictTemporal = Boolean(profile?.strictTemporalDisambiguation);
  const aiIntent = await inferIntentRequirementsWithAi({
    question,
    history,
    strictTemporal,
    promptTemplate: agentPromptTemplate,
  });

  const aiReliable = aiIntent && aiIntent.confidence >= 0.55;
  const ruleNeedsTopic = !hasTopicReference(mergedText);
  const ruleNeedsTime = strictTemporal
    && isTimeSensitiveIntent(mergedText)
    && !hasTemporalReference(mergedText);

  let needsTopic = ruleNeedsTopic;
  let needsTime = ruleNeedsTime;

  if (aiReliable) {
    needsTopic = Boolean(aiIntent.needsTopic);

    if (strictTemporal) {
      needsTime = Boolean(aiIntent.needsTime || aiIntent.isTimeSensitive) && !hasTemporalReference(mergedText);
    } else {
      needsTime = false;
    }

    if (ruleNeedsTopic) {
      needsTopic = true;
    }
  }

  const missingFields = [];
  if (needsTopic) {
    missingFields.push("topic");
  }
  if (needsTime) {
    missingFields.push("time");
  }

  if (missingFields.length === 0) {
    const proposedSearchQuery = buildProposedSearchQuery(mergedText);
    return {
      readyToSearch: Boolean(proposedSearchQuery),
      answer:
        "Perfetto, ora ho i dati necessari. Passo alla ricerca: puoi inviare subito, oppure affinare la query proposta.",
      proposedSearchQuery,
      missingFields: [],
      stage: "ready",
    };
  }

  if (missingFields.length === 2) {
    return {
      readyToSearch: false,
      answer:
        "Per partire mi servono 2 dati: tema preciso e periodo temporale. Esempio: 'ordinazioni di vescovi nel 2025'.",
      proposedSearchQuery: "",
      missingFields,
      stage: "need-topic-and-time",
    };
  }

  if (missingFields.includes("topic")) {
    return {
      readyToSearch: false,
      answer:
        "Mi manca il tema preciso. Scrivi in una riga cosa vuoi cercare, ad esempio: 'ordinazioni di vescovi' oppure 'nomine episcopali'.",
      proposedSearchQuery: "",
      missingFields,
      stage: "need-topic",
    };
  }

  const strictTemplate =
    "Formato rapido: 'ordinazioni di vescovi nel 2025' oppure 'nomine episcopali negli ultimi 12 mesi'.";
  const softAsk = "Mi manca solo il periodo temporale. Indica anno o intervallo.";

  return {
    readyToSearch: false,
    answer: userTurns >= 3 ? strictTemplate : `${softAsk} ${strictTemplate}`,
    proposedSearchQuery: "",
    missingFields,
    stage: "need-time",
  };
}

async function askOllamaStream(prompt, model, onToken) {
  const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
      options: {
        temperature: 0,
      },
    }),
  });

  if (!ollamaResponse.ok) {
    const text = await ollamaResponse.text();
    throw new Error(`Errore Ollama (${ollamaResponse.status}): ${text}`);
  }

  if (!ollamaResponse.body) {
    throw new Error("Stream Ollama non disponibile");
  }

  const reader = ollamaResponse.body.getReader();
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
        try {
          const chunk = JSON.parse(line);
          if (chunk?.response) {
            onToken(String(chunk.response));
          }
          if (chunk?.done) {
            return;
          }
        } catch {
          // Ignore malformed chunks and continue streaming.
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  const rest = buffer.trim();
  if (rest) {
    try {
      const lastChunk = JSON.parse(rest);
      if (lastChunk?.response) {
        onToken(String(lastChunk.response));
      }
    } catch {
      // Ignore trailing non-JSON fragments.
    }
  }
}

function writeNdjsonEvent(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

app.get("/api/ui-state", async (_, res) => {
  try {
    const scope = normalizeUiScope(_.query?.scope);
    const state = await readUiState(scope);
    return res.json(state);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Errore nel caricamento stato UI",
    });
  }
});

app.post("/api/ui-state", async (req, res) => {
  try {
    const scope = normalizeUiScope(req.body?.scope || req.query?.scope);
    const currentState = await readUiState(scope);
    const nextState = {
      ...currentState,
      limit: req.body?.limit,
      model: req.body?.model,
      chatMode: req.body?.chatMode,
      promptTemplate: req.body?.promptTemplate,
      agentPromptTemplate: req.body?.agentPromptTemplate,
      questionDraft: req.body?.questionDraft,
    };

    const savedState = await writeUiState(nextState, scope);
    return res.json(savedState);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Errore nel salvataggio stato UI",
    });
  }
});

app.post("/api/intake-chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);

    if (!question) {
      return res.status(400).json({ error: "La domanda e' obbligatoria." });
    }

    const decision = await buildIntakeDecision({
      question,
      history,
      profile,
      agentPromptTemplate: currentState.agentPromptTemplate,
    });
    return res.json(decision);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Errore intake agente",
    });
  }
});

app.post("/api/search-preview", async (req, res) => {
  try {
    const searchQuery = String(req.body?.searchQuery || "").trim();
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const temporalDisambiguation = await getTemporalDisambiguation(searchQuery, {
      strict: profile.strictTemporalDisambiguation,
    });

    if (!searchQuery) {
      return res.json({
        hits: [],
        context: "",
        metadata: {
          searchQuery,
          limit,
          searchIndex,
          cached: false,
        },
      });
    }

    if (temporalDisambiguation?.required) {
      return res.json({
        hits: [],
        context: "",
        metadata: {
          searchQuery,
          limit,
          searchIndex,
          cached: false,
          temporalPromptRequired: true,
          temporalPromptMessage: temporalDisambiguation.message,
        },
      });
    }

    const { hits, context, cached, candidateCount, analysis, detectedEntities, entityKeywordTerms } =
      await fetchContextCached(
      searchQuery,
      limit,
      searchIndex
    );

    return res.json({
      hits,
      context,
      metadata: {
        searchQuery,
        limit,
        searchIndex,
        cached,
        candidateCount,
        retrievalQuery: analysis?.retrievalQuery || searchQuery,
        queryTerms: analysis?.terms || [],
        detectedEntities: detectedEntities || { persone: [], luoghi: [], enti: [] },
        entityKeywordTerms: entityKeywordTerms || [],
        usedAiEntityFallback: Boolean(analysis?.usedAiEntityFallback),
        temporalPromptRequired: false,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Errore nel prefetch search",
    });
  }
});

app.post("/api/rag", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const providedSearchQuery = String(req.body?.searchQuery || "").trim();
    const searchQuery = providedSearchQuery || question || DEFAULT_SEARCH_QUERY;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const model = String(req.body?.model || DEFAULT_MODEL).trim();
    const promptTemplate = String(req.body?.promptTemplate || "");
    const temporalDisambiguation = await getTemporalDisambiguation(question, {
      strict: profile.strictTemporalDisambiguation,
    });

    if (!question) {
      return res.status(400).json({ error: "La domanda e' obbligatoria." });
    }

    if (temporalDisambiguation?.required) {
      return res.status(200).json({
        answer: temporalDisambiguation.message,
        context: "",
        hits: [],
        metadata: {
          model,
          searchQuery,
          limit,
          searchIndex,
          cached: false,
          candidateCount: 0,
          retrievalQuery: "",
          queryTerms: [],
          detectedEntities: { persone: [], luoghi: [], enti: [] },
          entityKeywordTerms: [],
          usedAiEntityFallback: false,
          temporalPromptRequired: true,
          temporalPromptMessage: temporalDisambiguation.message,
        },
      });
    }

    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);
    await writeUiState({
      ...currentState,
      limit,
      model,
      promptTemplate: promptTemplate || currentState.promptTemplate,
      questionDraft: question,
    }, uiScope);

    const { hits, context, cached, candidateCount, analysis, detectedEntities, entityKeywordTerms } =
      await fetchContextCached(
      searchQuery,
      limit,
      searchIndex
    );

    if (!context) {
      return res.status(200).json({
        answer: "Nessun contesto trovato per la query indicata.",
        context,
        hits,
        metadata: {
          model,
          searchQuery,
          limit,
          searchIndex,
          cached,
          candidateCount,
          retrievalQuery: analysis?.retrievalQuery || searchQuery,
          queryTerms: analysis?.terms || [],
          detectedEntities: detectedEntities || { persone: [], luoghi: [], enti: [] },
          entityKeywordTerms: entityKeywordTerms || [],
          usedAiEntityFallback: Boolean(analysis?.usedAiEntityFallback),
          temporalPromptRequired: false,
        },
      });
    }

    const prompt = buildPrompt(question, context, promptTemplate);
    const answer = await askOllama(prompt, model);

    return res.json({
      answer,
      context,
      hits,
      metadata: {
        model,
        searchQuery,
        limit,
        searchIndex,
        cached,
        candidateCount,
        retrievalQuery: analysis?.retrievalQuery || searchQuery,
        queryTerms: analysis?.terms || [],
        detectedEntities: detectedEntities || { persone: [], luoghi: [], enti: [] },
        entityKeywordTerms: entityKeywordTerms || [],
        usedAiEntityFallback: Boolean(analysis?.usedAiEntityFallback),
        temporalPromptRequired: false,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Errore interno",
    });
  }
});

app.post("/api/rag-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  try {
    const question = String(req.body?.question || "").trim();
    const providedSearchQuery = String(req.body?.searchQuery || "").trim();
    const searchQuery = providedSearchQuery || question || DEFAULT_SEARCH_QUERY;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const model = String(req.body?.model || DEFAULT_MODEL).trim();
    const promptTemplate = String(req.body?.promptTemplate || "");
    const temporalDisambiguation = await getTemporalDisambiguation(question, {
      strict: profile.strictTemporalDisambiguation,
    });

    if (!question) {
      writeNdjsonEvent(res, { type: "error", error: "La domanda e' obbligatoria." });
      return res.end();
    }

    if (temporalDisambiguation?.required) {
      writeNdjsonEvent(res, {
        type: "meta",
        metadata: {
          model,
          searchQuery,
          limit,
          searchIndex,
          cached: false,
          candidateCount: 0,
          retrievalQuery: "",
          queryTerms: [],
          detectedEntities: { persone: [], luoghi: [], enti: [] },
          entityKeywordTerms: [],
          usedAiEntityFallback: false,
          temporalPromptRequired: true,
          temporalPromptMessage: temporalDisambiguation.message,
        },
        hits: [],
        context: "",
      });
      writeNdjsonEvent(res, { type: "token", text: temporalDisambiguation.message });
      writeNdjsonEvent(res, { type: "done" });
      return res.end();
    }

    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);
    await writeUiState({
      ...currentState,
      limit,
      model,
      promptTemplate: promptTemplate || currentState.promptTemplate,
      questionDraft: question,
    }, uiScope);

    const { hits, context, cached, candidateCount, analysis, detectedEntities, entityKeywordTerms } =
      await fetchContextCached(searchQuery, limit, searchIndex);

    const metadata = {
      model,
      searchQuery,
      limit,
      searchIndex,
      cached,
      candidateCount,
      retrievalQuery: analysis?.retrievalQuery || searchQuery,
      queryTerms: analysis?.terms || [],
      detectedEntities: detectedEntities || { persone: [], luoghi: [], enti: [] },
      entityKeywordTerms: entityKeywordTerms || [],
      usedAiEntityFallback: Boolean(analysis?.usedAiEntityFallback),
      temporalPromptRequired: false,
    };

    writeNdjsonEvent(res, { type: "meta", metadata, hits, context });

    if (!context) {
      writeNdjsonEvent(res, {
        type: "token",
        text: "Nessun contesto trovato per la query indicata.",
      });
      writeNdjsonEvent(res, { type: "done" });
      return res.end();
    }

    const prompt = buildPrompt(question, context, promptTemplate);
    await askOllamaStream(prompt, model, (textChunk) => {
      writeNdjsonEvent(res, { type: "token", text: textChunk });
    });

    writeNdjsonEvent(res, { type: "done" });
    return res.end();
  } catch (error) {
    writeNdjsonEvent(res, {
      type: "error",
      error: error instanceof Error ? error.message : "Errore interno",
    });
    return res.end();
  }
});

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  // Keep logs minimal: this app is intended as a local helper service.
  console.log(`ChatVatican in ascolto su http://localhost:${port}`);
});
