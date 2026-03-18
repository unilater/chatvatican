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
const DEFAULT_AGENT_MODEL = process.env.DEFAULT_AGENT_MODEL || process.env.AGENT_MODEL || DEFAULT_MODEL;
const MAX_TEXT_EXCERPT_CHARS = Number(process.env.MAX_TEXT_EXCERPT_CHARS || 1800);
const MAX_CONTEXT_DOCS = Number(process.env.MAX_CONTEXT_DOCS || 3);
const SEARCH_CANDIDATE_MULTIPLIER = Number(process.env.SEARCH_CANDIDATE_MULTIPLIER || 3);
const SEARCH_CACHE_TTL_MS = 30_000;
const UI_STATE_SCOPE_DEFAULT = "default";
const SEARCH_PROFILES = {
  testi_ecclesiali: {
    key: "notizie",
    strictTemporalDisambiguation: true,
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
const AI_ENTITY_MODEL = process.env.AI_ENTITY_MODEL || DEFAULT_AGENT_MODEL;
const AI_ENTITY_CACHE_TTL_MS = 60_000;
const AI_INTENT_ENABLED = process.env.AI_INTENT_ENABLED !== "false";
const AI_INTENT_MODEL = process.env.AI_INTENT_MODEL || DEFAULT_AGENT_MODEL;
const AI_INTENT_TIMEOUT_MS = Number(process.env.AI_INTENT_TIMEOUT_MS || 2200);
const AI_INTENT_CACHE_TTL_MS = Number(process.env.AI_INTENT_CACHE_TTL_MS || 45_000);
const AI_QUERY_REWRITE_ENABLED = process.env.AI_QUERY_REWRITE_ENABLED !== "false";
const AI_QUERY_REWRITE_MODEL = process.env.AI_QUERY_REWRITE_MODEL || DEFAULT_AGENT_MODEL;
const AI_QUERY_REWRITE_TIMEOUT_MS = Number(process.env.AI_QUERY_REWRITE_TIMEOUT_MS || 2600);
const AI_QUERY_REWRITE_CACHE_TTL_MS = Number(process.env.AI_QUERY_REWRITE_CACHE_TTL_MS || 60_000);
const AI_TOPIC_RELATION_ENABLED = process.env.AI_TOPIC_RELATION_ENABLED !== "false";
const AI_TOPIC_RELATION_MODEL = process.env.AI_TOPIC_RELATION_MODEL || DEFAULT_AGENT_MODEL;
const AI_TOPIC_RELATION_TIMEOUT_MS = Number(process.env.AI_TOPIC_RELATION_TIMEOUT_MS || 1800);
const AI_TOPIC_RELATION_CACHE_TTL_MS = Number(process.env.AI_TOPIC_RELATION_CACHE_TTL_MS || 60_000);
const AI_TOPIC_RELATION_CONFIDENCE_THRESHOLD = Number(
  process.env.AI_TOPIC_RELATION_CONFIDENCE_THRESHOLD || 0.72
);
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
const MONTH_TO_NUMBER = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};
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
const BOLLETTINO_PROMPT_TEMPLATE = `Sei un esperto in notizie che riguardano il Vaticano e la Chiesa
Usa solo il contesto seguente.

Contesto:
{{context}}

Domanda:
{{question}}

Offri una risposta completa, esauriente, dettagliata, offrendo quante piu' informazioni possibili in maniera ordinata.
La risposta deve essere lunga e articolata.
Rispondi solo sull'argomento richiesto da utente, anche se hai altre notizie nel contesto.
Alla fine della risposta inserisci il link alla pagina da cui e' stata estratta la notizia. Il link deve essere completo.
Se i dati non sono sufficienti afferma chiaramente che non puoi rispondere in modo fondato.

Regole:
- non usare conoscenze esterne
- non inventare fatti
- usa solo il contesto fornito
- se il modello produce tag <think>, mostra comunque i passaggi in chiaro come testo normale`;
const DEFAULT_AGENT_PROMPT_TEMPLATE = `Classifica l'intento di una richiesta utente per preparare ricerca documentale.
Restituisci SOLO JSON valido con schema:
{"needsTopic":boolean,"needsTime":boolean,"confidence":number}

Regole:
- needsTopic=true se il tema richiesto e' troppo vago
- needsTime=true se manca un riferimento temporale essenziale
- confidence tra 0 e 1
- niente testo extra

Modalita' strictTemporal: {{strictTemporal}}
Storico utente:
{{history}}

Ultima domanda utente:
{{question}}`;
const DEFAULT_QUERY_REWRITE_TEMPLATE = `Riscrivi una query utente per ricerca documentale nel database.
Restituisci SOLO JSON valido con schema:
{"searchQuery":string,"confidence":number}

Regole:
- usa solo keyword utili alla ricerca (niente frasi complete)
- mantieni le entita' principali (persone, eventi, luoghi, enti)
- se c'e' un papa con numero ordinale, normalizzalo in forma araba (esempio: "Giovanni Paolo II" -> "giovanni paolo 2")
- se compare "giovanni paolo" senza numero, usa "giovanni paolo 2"
- conserva e normalizza il riferimento temporale in forma leggibile per ricerca (esempio: "gennaio 2000", "marzo 2000", "2000")
- se la nuova domanda e' un follow-up temporale, eredita il tema dallo storico recente
- se la nuova domanda contiene un nuovo riferimento temporale, sostituisci il vecchio riferimento temporale (non sommare mesi o anni diversi)
- usa nella query finale il riferimento temporale piu' recente espresso nell'ultima domanda utente
- rimuovi stopword e preposizioni (esempio: "all", "nel", "del", "di", "cosa", "vorrei", "sapere")
- output in minuscolo
- confidence tra 0 e 1
- niente testo extra

Storico utente:
{{history}}

Ultima domanda utente:
{{question}}`;
const DEFAULT_TOPIC_RELATION_TEMPLATE = `Valuta se l'ultima domanda utente e' una continuazione dello stesso argomento della domanda precedente.
Restituisci SOLO JSON valido con schema:
{"relation":"same-topic"|"new-topic"|"unclear","confidence":number}

Regole:
- same-topic: richiesta di approfondimento/chiarimento sullo stesso tema
- new-topic: cambio argomento netto
- unclear: dubbio o ambiguita'
- confidence tra 0 e 1
- niente testo extra

Domanda utente precedente:
{{lastQuestion}}

Fonti recenti dell'ultima risposta (se disponibili):
{{previousSources}}

Ultima domanda utente:
{{question}}`;
const DEFAULT_PREVIOUS_ANSWER_FOLLOWUP_TEMPLATE = `Valuta se l'ultima domanda utente e' un follow-up della risposta precedente dell'assistente.
Restituisci SOLO JSON valido con schema:
{"isFollowUp":boolean,"confidence":number}

Regole:
- isFollowUp=true se la nuova domanda chiede dettagli/chiarimenti su contenuti gia' presenti nella risposta precedente
- isFollowUp=false se la nuova domanda apre un argomento diverso
- confidence tra 0 e 1
- niente testo extra

Risposta precedente dell'assistente:
{{previousAnswer}}

Fonti recenti della risposta precedente (se disponibili):
{{previousSources}}

Ultima domanda utente:
{{question}}`;
const searchCache = new Map();
const questionAnalysisCache = new Map();
const intentAnalysisCache = new Map();
const queryRewriteCache = new Map();
const topicRelationCache = new Map();
const followUpFromAnswerCache = new Map();
const dataFilterabilityCache = new Map();
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

function escapeFilterValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .trim();
}

function buildFieldFilterExpression(fieldName, values) {
  const items = normalizeEntityValues(values);
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return `${fieldName} = "${escapeFilterValue(items[0])}"`;
  }

  return `(${items.map((value) => `${fieldName} = "${escapeFilterValue(value)}"`).join(" OR ")})`;
}

function normalizeTemporalRangePayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const start = String(value.start || "").trim();
  const end = String(value.end || "").trim();
  const precision = String(value.precision || "").trim() || "custom";

  if (!start || !end || !isIsoDateString(start) || !isIsoDateString(end)) {
    return null;
  }

  return { start, end, precision };
}

function normalizeSearchPlanPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload;
  const filters = source.filters && typeof source.filters === "object" ? source.filters : {};
  const temporalRange = normalizeTemporalRangePayload(filters.data || source.temporalRange);
  const persone = normalizeEntityValues(filters.persone);
  const luoghi = normalizeEntityValues(filters.luoghi);
  const enti = normalizeEntityValues(filters.enti);
  const filterClauses = [
    temporalRange ? buildTemporalFilter(temporalRange) : "",
    buildFieldFilterExpression("persone", persone),
    buildFieldFilterExpression("luoghi", luoghi),
    buildFieldFilterExpression("enti", enti),
  ].filter(Boolean);

  return {
    question: String(source.question || "").trim(),
    textQuery: String(source.textQuery || source.searchQuery || "").trim(),
    filters: {
      data: temporalRange,
      persone,
      luoghi,
      enti,
    },
    filterExpression: filterClauses.join(" AND "),
    debug: source.debug && typeof source.debug === "object" ? source.debug : {},
  };
}

function buildSearchPlan({ question, searchQuery, analysis, debug = {} }) {
  const textQuery = String(searchQuery || "").trim();
  const temporalRange = parseTemporalRange(question);
  const entities = normalizeEntityPayload(analysis?.entities);
  const filterClauses = [
    temporalRange ? buildTemporalFilter(temporalRange) : "",
    buildFieldFilterExpression("persone", entities.persone),
    buildFieldFilterExpression("luoghi", entities.luoghi),
    buildFieldFilterExpression("enti", entities.enti),
  ].filter(Boolean);

  return {
    question: String(question || "").trim(),
    textQuery,
    filters: {
      data: temporalRange,
      persone: entities.persone,
      luoghi: entities.luoghi,
      enti: entities.enti,
    },
    filterExpression: filterClauses.join(" AND "),
    debug,
  };
}

function hitMatchesFieldFilter(hit, fieldName, values) {
  const filterValues = normalizeEntityValues(values).map((value) => normalizeText(value));
  if (filterValues.length === 0) {
    return true;
  }

  const hitValues = (Array.isArray(hit?.[fieldName]) ? hit[fieldName] : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (hitValues.length === 0) {
    return false;
  }

  return filterValues.some((value) => hitValues.includes(value));
}

function hitMatchesSearchPlan(hit, searchPlan) {
  const plan = normalizeSearchPlanPayload(searchPlan);
  if (!plan) {
    return true;
  }

  if (plan.filters.data && !hitInTemporalRange(hit, plan.filters.data)) {
    return false;
  }

  if (!hitMatchesFieldFilter(hit, "persone", plan.filters.persone)) {
    return false;
  }

  if (!hitMatchesFieldFilter(hit, "luoghi", plan.filters.luoghi)) {
    return false;
  }

  if (!hitMatchesFieldFilter(hit, "enti", plan.filters.enti)) {
    return false;
  }

  return true;
}

function normalizeApostrophes(value) {
  return String(value || "").replace(/[’']/g, " ");
}

function extractCapitalizedPhrases(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }

  const matches = raw.match(/\b[A-ZÀ-ÖØ-Ý][\p{L}À-ÖØ-öø-ÿ.'’-]*(?:\s+(?:[A-ZÀ-ÖØ-Ý][\p{L}À-ÖØ-öø-ÿ.'’-]*|[IVXLCDM]+)){0,4}/gu) || [];
  return uniqueTerms(
    matches
      .map((value) => String(value || "").trim())
      .filter((value) => value.length >= 3)
      .filter((value) => !/^(Cosa|Che|Come|Quando|Dove|Quale|Quali|Nel|Nella|Nello|Nei|Negli|Nelle|Il|La|Lo|I|Gli|Le)$/u.test(value))
  );
}

function extractLocalEntities(question) {
  const phrases = extractCapitalizedPhrases(question);
  const entities = {
    persone: [],
    luoghi: [],
    enti: [],
  };

  for (const phrase of phrases) {
    if (/\b(Basilica|Citta|Città|Roma|Gerusalemme|Betlemme|Assisi|Vaticano)\b/u.test(phrase)) {
      entities.luoghi.push(phrase);
      continue;
    }

    if (/\b(Dicastero|Banco|Banca|Conferenza|Chiesa|Vaticano|Elemosineria|Pontificia|Santa Sede)\b/u.test(phrase)) {
      entities.enti.push(phrase);
      continue;
    }

    if (/\b([IVXLCDM]+)\b/u.test(phrase) || phrase.split(/\s+/).length >= 2) {
      entities.persone.push(phrase);
    }
  }

  return normalizeEntityPayload(entities);
}

function toIsoDate(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTemporalRange(text) {
  const raw = String(text || "").trim();
  const normalized = normalizeText(normalizeApostrophes(raw));
  if (!raw || !normalized) {
    return null;
  }

  const monthYearMatch = normalized.match(
    /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(?:del\s+)?((?:19|20)\d{2})\b/
  );
  if (monthYearMatch) {
    const month = MONTH_TO_NUMBER[monthYearMatch[1]];
    const year = Number(monthYearMatch[2]);
    const endDay = getLastDayOfMonth(year, month);
    return {
      start: toIsoDate(year, month, 1),
      end: toIsoDate(year, month, endDay),
      precision: "month",
    };
  }

  const slashDateMatch = raw.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-]((?:19|20)?\d{2})\b/);
  if (slashDateMatch) {
    const day = Number(slashDateMatch[1]);
    const month = Number(slashDateMatch[2]);
    let year = Number(slashDateMatch[3]);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }

    if (month >= 1 && month <= 12) {
      const maxDay = getLastDayOfMonth(year, month);
      if (day >= 1 && day <= maxDay) {
        const iso = toIsoDate(year, month, day);
        return { start: iso, end: iso, precision: "day" };
      }
    }
  }

  const yearMatch = raw.match(/\b((?:19|20)\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      start: toIsoDate(year, 1, 1),
      end: toIsoDate(year, 12, 31),
      precision: "year",
    };
  }

  return null;
}

function buildTemporalFilter(range) {
  if (!range?.start || !range?.end) {
    return "";
  }

  return `data >= \"${range.start}\" AND data <= \"${range.end}\"`;
}

function isIsoDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function hitInTemporalRange(hit, range) {
  if (!range?.start || !range?.end) {
    return true;
  }

  const hitDate = String(hit?.data || "").trim();
  if (!isIsoDateString(hitDate)) {
    return false;
  }

  return hitDate >= range.start && hitDate <= range.end;
}

function hasTemporalReference(question) {
  const raw = String(question || "").toLowerCase().trim();
  const normalized = normalizeText(normalizeApostrophes(question));
  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));

  if (!raw || !normalized) {
    return false;
  }

  if (/\b(19|20)\d{2}\b/.test(raw)) {
    return true;
  }

  if (/\b\d{1,2}[/.\-]\d{1,2}([/.\-]\d{2,4})?\b/.test(raw)) {
    return true;
  }

  if (TEMPORAL_MONTH_TERMS.some((month) => tokens.has(month))) {
    return true;
  }

  if (TEMPORAL_REFERENCE_TERMS.some((term) => tokens.has(term))) {
    return true;
  }

  return false;
}

function getSearchProfile(searchIndex) {
  const normalizedIndex = normalizeSearchIndex(searchIndex);
  return SEARCH_PROFILES[normalizedIndex] || SEARCH_PROFILES[DEFAULT_SEARCH_INDEX] || SEARCH_PROFILES.testi_ecclesiali;
}

async function inferIntentRequirementsWithAi({ question, history, strictTemporal, promptTemplate, model }) {
  if (!AI_INTENT_ENABLED) {
    return null;
  }

  const historyText = getUserHistoryText(history);
  const merged = [historyText, String(question || "").trim()].filter(Boolean).join(" ");
  const resolvedModel = String(model || AI_INTENT_MODEL || DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
  const cacheKey = `intent::${resolvedModel}::${strictTemporal ? "strict" : "relaxed"}::${normalizeText(merged)}`;
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
    const raw = await askOllamaWithTimeout(prompt, resolvedModel, AI_INTENT_TIMEOUT_MS);
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const payload = {
      needsTopic: Boolean(parsed.needsTopic),
      needsTime: Boolean(parsed.needsTime),
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

async function rewriteSearchQueryWithAi({ question, history, previousSources, promptTemplate, model }) {
  if (!AI_QUERY_REWRITE_ENABLED) {
    return null;
  }

  const resolvedModel = String(model || AI_QUERY_REWRITE_MODEL || DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
  const template = String(promptTemplate || DEFAULT_QUERY_REWRITE_TEMPLATE);
  const historyText = getUserHistoryText(history);
  const sourcesText = formatPreviousSourcesForPrompt(previousSources);
  const rewriteHistoryText = [
    historyText,
    `Fonti recenti:\n${sourcesText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const cacheSource = [historyText, sourcesText, String(question || "").trim()]
    .filter(Boolean)
    .join(" ");
  const cacheKey = `rewrite::${resolvedModel}::${normalizeText(template)}::${normalizeText(cacheSource)}`;
  const now = Date.now();
  const cached = queryRewriteCache.get(cacheKey);
  if (cached && now - cached.timestamp < AI_QUERY_REWRITE_CACHE_TTL_MS) {
    return cached.payload;
  }

  const prompt = template
    .replaceAll("{{history}}", rewriteHistoryText || "(vuoto)")
    .replaceAll("{{question}}", String(question || "").trim());

  try {
    const raw = await askOllamaWithTimeout(prompt, resolvedModel, AI_QUERY_REWRITE_TIMEOUT_MS);
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const searchQuery = String(parsed.searchQuery || "").trim();
    const confidence = Number(parsed.confidence || 0);
    const payload = {
      searchQuery,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };

    queryRewriteCache.set(cacheKey, {
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
    model: options.agentModel,
  });

  const ruleTimeSensitive =
    /ordinaz/.test(normalized)
    || /consacraz/.test(normalized)
    || (/nomin/.test(normalized) && /vescov/.test(normalized));

  const aiReliable = aiIntent && aiIntent.confidence >= 0.6;
  const isTimeSensitiveQuestion = aiReliable
    ? Boolean(aiIntent.needsTime)
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
  const localEntities = extractLocalEntities(question);
  const entityTerms = uniqueTerms(
    [...localEntities.persone, ...localEntities.luoghi, ...localEntities.enti].flatMap((value) =>
      tokenizeSignificant(normalizeApostrophes(value))
    )
  );
  const mergedTerms = uniqueTerms([...terms, ...entityTerms]);

  return {
    original: String(question || "").trim(),
    normalized: normalizedQuestion,
    terms: mergedTerms,
    entities: localEntities,
    usedAiEntityFallback: false,
    retrievalQuery: mergedTerms.length > 0 ? mergedTerms.join(" ") : String(question || "").trim(),
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

async function extractEntitiesWithAi(question, model) {
  if (!AI_ENTITY_FALLBACK_ENABLED) {
    return null;
  }

  const resolvedModel = String(model || AI_ENTITY_MODEL || DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
  const cacheKey = `${resolvedModel}::${normalizeText(question)}`;
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
    const raw = await askOllamaWithTimeout(extractionPrompt, resolvedModel, AI_ENTITY_TIMEOUT_MS);
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

async function analyzeQuestion(question, options = {}) {
  const local = buildLocalQuestionAnalysis(question);
  const shouldForceAiEntities = Boolean(options.forceAiEntities);
  if (local.terms.length >= AI_ENTITY_MIN_LOCAL_TERMS && !shouldForceAiEntities) {
    return local;
  }

  const aiEntities = await extractEntitiesWithAi(question, options.agentModel);
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
    entities: normalizeEntityPayload({
      persone: [...(local.entities?.persone || []), ...aiEntities.persone],
      luoghi: [...(local.entities?.luoghi || []), ...aiEntities.luoghi],
      enti: [...(local.entities?.enti || []), ...aiEntities.enti],
    }),
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

async function runSearchQuery(query, limit, searchIndex, options = {}) {
  const searchEndpoint = getSearchEndpoint(searchIndex);
  const apiKey = getSearchApiKey(searchIndex);
  const normalizedIndex = normalizeSearchIndex(searchIndex);
  const temporalFilter = buildTemporalFilter(options.temporalRange);
  const filterExpression = String(options.filterExpression || temporalFilter || "").trim();
  const indexDataFilterability = dataFilterabilityCache.get(normalizedIndex);
  const shouldAttemptServerDateFilter = Boolean(filterExpression) && indexDataFilterability !== false;

  if (!apiKey) {
    throw new Error("SEARCH_API_KEY non configurata per l'indice richiesto");
  }

  let searchResponse = await fetch(searchEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      q: query,
      limit,
      ...(shouldAttemptServerDateFilter ? { filter: filterExpression } : {}),
    }),
  });

  if (!searchResponse.ok) {
    const text = await searchResponse.text();
    const canFallbackToLocalDateFilter =
      shouldAttemptServerDateFilter
      && searchResponse.status === 400
      && /not filterable/i.test(text);

    if (canFallbackToLocalDateFilter) {
      dataFilterabilityCache.set(normalizedIndex, false);
      searchResponse = await fetch(searchEndpoint, {
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
        const fallbackText = await searchResponse.text();
        throw new Error(`Errore search API (${searchResponse.status}): ${fallbackText}`);
      }
    } else {
      throw new Error(`Errore search API (${searchResponse.status}): ${text}`);
    }
  } else if (shouldAttemptServerDateFilter) {
    dataFilterabilityCache.set(normalizedIndex, true);
  }

  const payload = await searchResponse.json();
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const qualityHits = hits.filter((hit) => !isLowQualityHit(hit));

  if (!options.temporalRange && !options.searchPlan) {
    return qualityHits;
  }

  return qualityHits.filter((hit) => {
    if (options.searchPlan) {
      return hitMatchesSearchPlan(hit, options.searchPlan);
    }

    return hitInTemporalRange(hit, options.temporalRange);
  });
}

async function runSeedSearchCandidates(searchQuery, analysis, candidateLimit, searchIndex, options = {}) {
  const rawQuery = String(searchQuery || "").trim();
  const phraseQuery = rawQuery || analysis.retrievalQuery || DEFAULT_SEARCH_QUERY;
  // Use intent tokens (stop-word filtered) so prepositions like "sulla" don't
  // fire useless/noisy stand-alone queries against the search index.
  const tokenQueries = uniqueTerms(tokenizeIntent(normalizeApostrophes(rawQuery)));
  const allQueries = uniqueTerms([phraseQuery, ...tokenQueries]);

  const queryLimit = Math.max(Math.ceil(candidateLimit / 2), 5);
  const queryResults = await Promise.all(
    allQueries.map((q) => runSearchQuery(q, queryLimit, searchIndex, options))
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
    uiMode: "user",
    limit: DEFAULT_LIMIT,
    ragModel: DEFAULT_MODEL,
    agentModel: DEFAULT_AGENT_MODEL,
    chatMode: profile.defaultChatMode,
    promptTemplate: scope === "bollettini" ? BOLLETTINO_PROMPT_TEMPLATE : DEFAULT_PROMPT_TEMPLATE,
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
  const parsedUiMode = String(rawState?.uiMode || defaults.uiMode).trim().toLowerCase();
  const parsedChatMode = String(rawState?.chatMode || defaults.chatMode).trim().toLowerCase();
  const uiMode = parsedUiMode === "admin" ? "admin" : "user";
  const chatMode = parsedChatMode === "rag" ? "rag" : "agent";

  return {
    uiMode,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : defaults.limit,
    ragModel:
      String(rawState?.ragModel || rawState?.model || defaults.ragModel).trim() || defaults.ragModel,
    agentModel:
      String(rawState?.agentModel || rawState?.model || defaults.agentModel).trim() || defaults.agentModel,
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
  const link = hit?.link || "";
  const data = hit?.data || "(data non disponibile)";
  const abstract = hit?.abstract || "(nessun abstract)";
  const tipoDocumento = hit?.tipo_documento ? `Tipo documento: ${hit.tipo_documento}` : "";
  const tipoFonte = hit?.tipo_fonte ? `Tipo fonte: ${hit.tipo_fonte}` : "";
  const persone = formatEntityList("Persone", pickRelevantEntities(hit?.persone, analysis));
  const luoghi = formatEntityList("Luoghi", pickRelevantEntities(hit?.luoghi, analysis));
  const enti = formatEntityList("Enti", pickRelevantEntities(hit?.enti, analysis));
  const testoEstratto = buildRelevantExcerpt(hit?.testo_originale, analysis);
  const testo = testoEstratto ? `Testo originale: ${testoEstratto}` : "";

  return [
    `Titolo: ${titolo}`,
    `Fonte: ${fonte}`,
    link ? `Link: ${link}` : "",
    `Data: ${data}`,
    tipoDocumento,
    tipoFonte,
    persone,
    luoghi,
    enti,
    `Abstract: ${abstract}`,
    testo,
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

function buildCanonicalSourceLinks(hits, maxItems = 5) {
  const urls = uniqueTerms(
    (Array.isArray(hits) ? hits : [])
      .map((hit) => String(hit?.link || "").trim())
      .filter((url) => /^https?:\/\//i.test(url))
  ).slice(0, maxItems);

  if (urls.length === 0) {
    return "";
  }

  return [
    "",
    "Fonti (link completi):",
    ...urls.map((url) => `- ${url}`),
  ].join("\n");
}

function appendCanonicalSourceLinks(answer, hits) {
  const suffix = buildCanonicalSourceLinks(hits);
  if (!suffix) {
    return answer;
  }

  return `${String(answer || "").trim()}\n${suffix}`.trim();
}

async function fetchContext(searchQuery, limit, searchIndex, options = {}) {
  if (!getSearchApiKey(searchIndex)) {
    throw new Error("SEARCH_API_KEY non configurata per l'indice richiesto");
  }

  const normalizedSearchPlan = normalizeSearchPlanPayload(options.searchPlan);
  const analysisSeedQuestion = String(options.analysisQuestion || searchQuery || "").trim();
  const effectiveSearchQuery = String(
    normalizedSearchPlan?.textQuery
    || searchQuery
    || analysisSeedQuestion
  ).trim();
  const analysis = await analyzeQuestion(analysisSeedQuestion || effectiveSearchQuery);
  const temporalRange = normalizedSearchPlan?.filters?.data || parseTemporalRange(analysisSeedQuestion || effectiveSearchQuery);
  const candidateLimit = Math.max(limit, Math.min(limit * SEARCH_CANDIDATE_MULTIPLIER, 15));

  // Pass 1: collect candidate documents to discover saved entities in the index.
  const seedCandidates = await runSeedSearchCandidates(
    effectiveSearchQuery,
    analysis,
    candidateLimit,
    searchIndex,
    {
      temporalRange,
      filterExpression: normalizedSearchPlan?.filterExpression,
      searchPlan: normalizedSearchPlan,
    }
  );
  const entitySignal = buildEntityAwareSignal(seedCandidates, analysisSeedQuestion || effectiveSearchQuery);
  const retrievalQuery = effectiveSearchQuery || entitySignal.retrievalTerms.join(" ");

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
    expandedQueries.map((q) => runSearchQuery(q, perQueryLimit, searchIndex, {
      temporalRange,
      filterExpression: normalizedSearchPlan?.filterExpression,
      searchPlan: normalizedSearchPlan,
    }))
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
    searchPlan: normalizedSearchPlan,
  };
}

function getCacheKey(searchQuery, limit, searchPlan) {
  const normalizedPlan = normalizeSearchPlanPayload(searchPlan);
  const serializedPlan = normalizedPlan ? JSON.stringify(normalizedPlan) : "";
  return `${limit}::${searchQuery.trim().toLowerCase()}::${serializedPlan}`;
}

async function fetchContextCached(searchQuery, limit, searchIndex, options = {}) {
  const normalizedIndex = normalizeSearchIndex(searchIndex);
  const cacheKey = `${normalizedIndex}::${getCacheKey(searchQuery, limit, options.searchPlan)}`;
  const now = Date.now();
  const cachedEntry = searchCache.get(cacheKey);

  if (cachedEntry && now - cachedEntry.timestamp < SEARCH_CACHE_TTL_MS) {
    return { ...cachedEntry.payload, cached: true };
  }

  const payload = await fetchContext(searchQuery, limit, normalizedIndex, options);
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

function getLastUserQuestion(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (String(item?.role || "").toLowerCase() !== "user") {
      continue;
    }

    const text = String(item?.content || "").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function getLastAssistantAnswer(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (String(item?.role || "").toLowerCase() !== "assistant") {
      continue;
    }

    const text = String(item?.content || "").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function formatPreviousSourcesForPrompt(previousSources) {
  if (!Array.isArray(previousSources) || previousSources.length === 0) {
    return "(nessuna fonte recente)";
  }

  const rows = previousSources
    .slice(0, 6)
    .map((item) => {
      const titolo = String(item?.titolo || "").trim();
      const fonte = String(item?.fonte || "").trim();
      const data = String(item?.data || "").trim();
      const link = String(item?.link || "").trim();

      const parts = [titolo, fonte, data, link].filter(Boolean);
      return parts.length > 0 ? `- ${parts.join(" | ")}` : "";
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return "(nessuna fonte recente)";
  }

  return rows.join("\n");
}

function buildSourcesContextText(previousSources) {
  if (!Array.isArray(previousSources) || previousSources.length === 0) {
    return "";
  }

  return previousSources
    .slice(0, 6)
    .map((item) => {
      const titolo = String(item?.titolo || "").trim();
      const fonte = String(item?.fonte || "").trim();
      const data = String(item?.data || "").trim();
      return [titolo, fonte, data].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function detectTopicSwitchDirective(question) {
  const normalized = normalizeText(normalizeApostrophes(question));
  if (!normalized) {
    return null;
  }

  if (/\b(cambio argomento|cambiare argomento|nuovo argomento|cercavo altro|altro argomento)\b/.test(normalized)) {
    return "new-topic";
  }

  if (/^(si|sì)\b/.test(normalized) && /\b(argomento|altro|nuovo)\b/.test(normalized)) {
    return "new-topic";
  }

  if (/\b(stesso argomento|continua sullo stesso|prosegui sullo stesso|resta sullo stesso)\b/.test(normalized)) {
    return "same-topic";
  }

  if (/^(no)\b/.test(normalized) && /\b(continua|stesso|prosegui)\b/.test(normalized)) {
    return "same-topic";
  }

  return null;
}

function stripTopicDirectivePhrases(question) {
  const normalized = normalizeText(normalizeApostrophes(question));
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/\b(si|sì)\s+cambio\s+argomento\b/g, "")
    .replace(/\b(cambio|cambiare)\s+argomento\b/g, "")
    .replace(/\bno\s+continua\s+sullo\s+stesso\s+argomento\b/g, "")
    .replace(/\bcontinua\s+sullo\s+stesso\s+argomento\b/g, "")
    .replace(/\bstesso\s+argomento\b/g, "")
    .replace(/\bcercavo\s+altro\b/g, "")
    .replace(/[,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTopicDirectivePhrasesPreserveCase(question) {
  const raw = String(question || "").trim();
  if (!raw) {
    return "";
  }

  return raw
    .replace(/\b(si|sì)\s+cambio\s+argomento\b/giu, "")
    .replace(/\b(cambio|cambiare)\s+argomento\b/giu, "")
    .replace(/\bno\s+continua\s+sullo\s+stesso\s+argomento\b/giu, "")
    .replace(/\bcontinua\s+sullo\s+stesso\s+argomento\b/giu, "")
    .replace(/\bstesso\s+argomento\b/giu, "")
    .replace(/\bcercavo\s+altro\b/giu, "")
    .replace(/[,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldAskTopicConfirmation(question, relationPayload, hasAnchor) {
  if (!hasAnchor || !relationPayload) {
    return false;
  }

  const normalized = normalizeText(normalizeApostrophes(question));
  const shortQuestion = tokenizeIntent(normalized).length <= 7;
  const vagueFollowUp = /^(e|oppure|allora|quindi|ok|va bene)\b/.test(normalized)
    || /\b(stesso|quello|quella|li|la|lo)\b/.test(normalized);
  const lowConfidence = relationPayload.confidence < AI_TOPIC_RELATION_CONFIDENCE_THRESHOLD;
  const unclear = relationPayload.relation === "unclear";

  return (unclear || lowConfidence) && shortQuestion && (vagueFollowUp || !hasTopicReference(question));
}

async function inferTopicRelationWithAi({ question, history, previousSources, model }) {
  if (!AI_TOPIC_RELATION_ENABLED) {
    return null;
  }

  const currentQuestion = String(question || "").trim();
  const lastQuestion = getLastUserQuestion(history);
  const previousSourcesText = formatPreviousSourcesForPrompt(previousSources);

  if (!currentQuestion) {
    return null;
  }

  const hasConversationAnchor = Boolean(lastQuestion) || previousSourcesText !== "(nessuna fonte recente)";
  if (!hasConversationAnchor) {
    return null;
  }

  const resolvedModel = String(model || AI_TOPIC_RELATION_MODEL || DEFAULT_AGENT_MODEL).trim() || DEFAULT_AGENT_MODEL;
  const cacheKey = `topic-relation::${resolvedModel}::${normalizeText(lastQuestion)}::${normalizeText(previousSourcesText)}::${normalizeText(currentQuestion)}`;
  const now = Date.now();
  const cached = topicRelationCache.get(cacheKey);
  if (cached && now - cached.timestamp < AI_TOPIC_RELATION_CACHE_TTL_MS) {
    return cached.payload;
  }

  const prompt = DEFAULT_TOPIC_RELATION_TEMPLATE
    .replaceAll("{{lastQuestion}}", lastQuestion || "(nessuna domanda precedente)")
    .replaceAll("{{previousSources}}", previousSourcesText)
    .replaceAll("{{question}}", currentQuestion);

  try {
    const raw = await askOllamaWithTimeout(
      prompt,
      resolvedModel,
      AI_TOPIC_RELATION_TIMEOUT_MS
    );
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const relation = String(parsed.relation || "").trim().toLowerCase();
    const normalizedRelation =
      relation === "same-topic" || relation === "new-topic" || relation === "unclear"
        ? relation
        : "unclear";

    const confidence = Number(parsed.confidence || 0);
    const payload = {
      relation: normalizedRelation,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };

    topicRelationCache.set(cacheKey, {
      timestamp: now,
      payload,
    });

    return payload;
  } catch {
    return null;
  }
}

async function inferFollowUpFromPreviousAnswerWithAi({ question, history, previousSources }) {
  const currentQuestion = String(question || "").trim();
  const previousAnswer = getLastAssistantAnswer(history);
  if (!currentQuestion || !previousAnswer) {
    return null;
  }

  const sourcesText = formatPreviousSourcesForPrompt(previousSources);
  const cacheKey = `followup-answer::${normalizeText(previousAnswer)}::${normalizeText(sourcesText)}::${normalizeText(currentQuestion)}`;
  const now = Date.now();
  const cached = followUpFromAnswerCache.get(cacheKey);
  if (cached && now - cached.timestamp < AI_TOPIC_RELATION_CACHE_TTL_MS) {
    return cached.payload;
  }

  const prompt = DEFAULT_PREVIOUS_ANSWER_FOLLOWUP_TEMPLATE
    .replaceAll("{{previousAnswer}}", previousAnswer)
    .replaceAll("{{previousSources}}", sourcesText)
    .replaceAll("{{question}}", currentQuestion);

  try {
    const raw = await askOllamaWithTimeout(
      prompt,
      AI_TOPIC_RELATION_MODEL,
      AI_TOPIC_RELATION_TIMEOUT_MS
    );
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const confidence = Number(parsed.confidence || 0);
    const payload = {
      isFollowUp: Boolean(parsed.isFollowUp),
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };

    followUpFromAnswerCache.set(cacheKey, {
      timestamp: now,
      payload,
    });

    return payload;
  } catch {
    return null;
  }
}

function inferFollowUpFromPreviousAnswerRules(question, history) {
  const currentQuestion = normalizeText(normalizeApostrophes(question));
  const previousAnswer = normalizeText(normalizeApostrophes(getLastAssistantAnswer(history)));
  if (!currentQuestion || !previousAnswer) {
    return false;
  }

  const questionTokens = uniqueTerms(tokenizeIntent(currentQuestion))
    .filter((token) => token.length >= 5)
    .filter((token) => !isTemporalIntentToken(token));

  if (questionTokens.length === 0) {
    return false;
  }

  return questionTokens.some((token) => previousAnswer.includes(token));
}

function hasTopicReference(text) {
  const intentTerms = uniqueTerms(tokenizeIntent(normalizeApostrophes(text)));
  if (intentTerms.length >= 2) {
    return true;
  }

  if (intentTerms.length === 1) {
    return intentTerms[0].length >= 6;
  }

  return false;
}

function isTemporalIntentToken(token) {
  if (!token) {
    return false;
  }

  if (/^(19|20)\d{2}$/.test(token)) {
    return true;
  }

  if (TEMPORAL_MONTH_TERMS.includes(token)) {
    return true;
  }

  if (TEMPORAL_REFERENCE_TERMS.includes(token)) {
    return true;
  }

  return false;
}

function hasNonTemporalTopicOverlap(textA, textB) {
  const tokensA = uniqueTerms(tokenizeIntent(normalizeApostrophes(textA))).filter(
    (token) => !isTemporalIntentToken(token)
  );
  const tokensB = uniqueTerms(tokenizeIntent(normalizeApostrophes(textB))).filter(
    (token) => !isTemporalIntentToken(token)
  );

  if (tokensA.length === 0 || tokensB.length === 0) {
    return false;
  }

  const tokenSetB = new Set(tokensB);
  return tokensA.some((token) => tokenSetB.has(token));
}

function buildQuestionSourceSupport(question, previousSources) {
  if (!Array.isArray(previousSources) || previousSources.length === 0) {
    return {
      hasSupport: false,
      matchedSources: [],
      sourceAnchorText: "",
    };
  }

  const sourceRows = previousSources
    .slice(0, 8)
    .map((item) => {
      const titolo = String(item?.titolo || "").trim();
      const fonte = String(item?.fonte || "").trim();
      const data = String(item?.data || "").trim();
      const link = String(item?.link || "").trim();
      const text = [titolo, fonte, data].filter(Boolean).join(" ");
      return {
        titolo,
        fonte,
        data,
        link,
        text,
      };
    })
    .filter((row) => row.text);

  if (sourceRows.length === 0) {
    return {
      hasSupport: false,
      matchedSources: [],
      sourceAnchorText: "",
    };
  }

  const matchedSources = sourceRows.filter((row) => hasNonTemporalTopicOverlap(question, row.text));

  return {
    hasSupport: matchedSources.length > 0,
    matchedSources: matchedSources.slice(0, 4),
    sourceAnchorText: sourceRows.map((row) => row.text).join(" "),
  };
}

function buildResearchJson({ question, searchQuery, analysis, sourceSupport, intentRelation, stage }) {
  const temporalRange = parseTemporalRange(question);
  const terms = Array.isArray(analysis?.terms) ? analysis.terms.slice(0, 18) : [];
  const entities = normalizeEntityPayload(analysis?.entities);
  const searchPlan = buildSearchPlan({
    question,
    searchQuery,
    analysis,
    debug: {
      relation: intentRelation?.relation || "unclear",
      relationConfidence: Number(intentRelation?.confidence || 0),
      sourceSupport: Boolean(sourceSupport?.hasSupport),
    },
  });
  const matchedSources = Array.isArray(sourceSupport?.matchedSources)
    ? sourceSupport.matchedSources.map((item) => ({
      titolo: item?.titolo || "",
      fonte: item?.fonte || "",
      data: item?.data || "",
      link: item?.link || "",
    }))
    : [];

  return {
    stage,
    question: String(question || "").trim(),
    searchQuery: String(searchQuery || "").trim(),
    entities,
    terms,
    temporalRange,
    searchPlan,
    intent: {
      relation: intentRelation?.relation || "unclear",
      confidence: Number(intentRelation?.confidence || 0),
    },
    sourceSupport: {
      hasSupport: Boolean(sourceSupport?.hasSupport),
      matchedSources,
      sourceCount: Array.isArray(sourceSupport?.matchedSources) ? sourceSupport.matchedSources.length : 0,
    },
  };
}

function hasOnlyTemporalIntent(text) {
  const tokens = uniqueTerms(tokenizeIntent(normalizeApostrophes(text)));
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => isTemporalIntentToken(token));
}

function pickAnswerSnippetsFromPreviousAnswer(question, previousAnswer) {
  const originalAnswer = String(previousAnswer || "").trim();
  if (!originalAnswer) {
    return [];
  }

  const questionTokens = uniqueTerms(tokenizeIntent(normalizeApostrophes(question)))
    .filter((token) => token.length >= 5)
    .filter((token) => !isTemporalIntentToken(token));

  if (questionTokens.length === 0) {
    return [];
  }

  const sentences = originalAnswer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const matches = sentences.filter((sentence) => {
    const normalizedSentence = normalizeText(normalizeApostrophes(sentence));
    const hasNegation = /\b(non|nessun|nessuna|nessuno|senza)\b/.test(normalizedSentence);
    if (hasNegation) {
      return false;
    }

    return questionTokens.some((token) => normalizedSentence.includes(token));
  });

  return matches.slice(0, 2);
}

function buildProposedSearchQuery(text) {
  const terms = uniqueTerms(tokenizeIntent(normalizeApostrophes(text))).slice(0, 16);
  return terms.join(" ");
}

async function buildIntakeDecision({ question, history, previousSources, profile, agentPromptTemplate, agentModel }) {
  const originalQuestionText = String(question || "").trim();
  const currentQuestionText = stripTopicDirectivePhrasesPreserveCase(originalQuestionText) || originalQuestionText;
  const explicitDirective = detectTopicSwitchDirective(originalQuestionText);
  const resolvedAgentModel = String(agentModel || "").trim() || DEFAULT_AGENT_MODEL;
  const relationPayload = await inferTopicRelationWithAi({
    question: currentQuestionText,
    history,
    previousSources,
    model: resolvedAgentModel,
  });
  const sourceSupport = buildQuestionSourceSupport(currentQuestionText, previousSources);

  const keepConversationContext = explicitDirective === "same-topic"
    ? true
    : explicitDirective === "new-topic"
      ? false
      : Boolean(
        relationPayload?.relation === "same-topic"
        && relationPayload?.confidence >= AI_TOPIC_RELATION_CONFIDENCE_THRESHOLD
      );

  const mustRestartCycle = keepConversationContext && !sourceSupport.hasSupport;

  const effectiveHistory = keepConversationContext && Array.isArray(history) ? history : [];
  const effectiveHistoryText = getUserHistoryText(effectiveHistory);
  const effectiveSourcesText = keepConversationContext ? buildSourcesContextText(previousSources) : "";
  const mergedText = [effectiveHistoryText, effectiveSourcesText, currentQuestionText]
    .filter(Boolean)
    .join(" ");

  const strictTemporal = Boolean(profile?.strictTemporalDisambiguation);
  const aiIntent = await inferIntentRequirementsWithAi({
    question,
    history: effectiveHistory,
    strictTemporal,
    promptTemplate: agentPromptTemplate,
    model: resolvedAgentModel,
  });

  const questionAnalysis = await analyzeQuestion(currentQuestionText, {
    agentModel: resolvedAgentModel,
    forceAiEntities: true,
  });

  const aiReliable = aiIntent && aiIntent.confidence >= 0.55;
  const ruleNeedsTopic = !hasTopicReference(mergedText);
  const hasTemporalInCurrentQuestion = hasTemporalReference(currentQuestionText);
  const hasTemporalInMergedContext = hasTemporalReference(mergedText);
  const ruleNeedsTime = strictTemporal && !hasTemporalInMergedContext;

  let needsTopic = ruleNeedsTopic;
  let needsTime = ruleNeedsTime;

  if (aiReliable) {
    needsTopic = Boolean(aiIntent.needsTopic);

    if (strictTemporal) {
      needsTime = Boolean(aiIntent.needsTime) && !hasTemporalInMergedContext;
    } else {
      needsTime = false;
    }

    if (ruleNeedsTopic) {
      needsTopic = true;
    } else {
      needsTopic = false;
    }

    if (ruleNeedsTime) {
      needsTime = true;
    }
  }

  const missingFields = [];
  if (needsTopic) {
    missingFields.push("topic");
  }
  if (needsTime) {
    missingFields.push("time");
  }

  if (mustRestartCycle) {
    const restartSearchQuery = buildProposedSearchQuery(currentQuestionText);
    return {
      readyToSearch: false,
      answer:
        "Nelle fonti dell'ultima risposta non trovo elementi utili per proseguire su questo follow-up. Riavvio il ciclo: indicami tema preciso e periodo.",
      proposedSearchQuery: "",
      missingFields: ["topic", ...(strictTemporal ? ["time"] : [])],
      stage: "restart-cycle",
      researchJson: buildResearchJson({
        question: currentQuestionText,
        searchQuery: restartSearchQuery,
        analysis: questionAnalysis,
        sourceSupport,
        intentRelation: relationPayload,
        stage: "restart-cycle",
      }),
      searchPlan: buildSearchPlan({
        question: currentQuestionText,
        searchQuery: restartSearchQuery,
        analysis: questionAnalysis,
        debug: {
          resolvedTopicMode: keepConversationContext ? "same-topic" : "new-topic",
          relation: relationPayload?.relation || "unclear",
          relationConfidence: Number(relationPayload?.confidence || 0),
          sourceSupport: Boolean(sourceSupport?.hasSupport),
          restartCycle: true,
        },
      }),
      agentModel: resolvedAgentModel,
    };
  }

  if (missingFields.length === 0) {
    const querySeedText = currentQuestionText;
    const aiRewrittenQuery = await rewriteSearchQueryWithAi({
      question: currentQuestionText,
      history: effectiveHistory,
      previousSources: keepConversationContext ? previousSources : [],
      promptTemplate: DEFAULT_QUERY_REWRITE_TEMPLATE,
      model: resolvedAgentModel,
    });
    const canUseAiRewrite = Boolean(
      aiRewrittenQuery?.searchQuery
      && Number(aiRewrittenQuery?.confidence || 0) >= 0.6
      && hasTopicReference(aiRewrittenQuery.searchQuery)
    );
    const proposedSearchQuery =
      canUseAiRewrite
      ? aiRewrittenQuery.searchQuery
      : buildProposedSearchQuery(querySeedText);
    return {
      readyToSearch: Boolean(proposedSearchQuery),
      answer:
        "Perfetto, ora ho i dati necessari. Passo alla ricerca: puoi inviare subito, oppure affinare la query proposta.",
      proposedSearchQuery,
      missingFields: [],
      stage: "ready",
      researchJson: buildResearchJson({
        question: currentQuestionText,
        searchQuery: proposedSearchQuery,
        analysis: questionAnalysis,
        sourceSupport,
        intentRelation: relationPayload,
        stage: "ready",
      }),
      searchPlan: buildSearchPlan({
        question: currentQuestionText,
        searchQuery: proposedSearchQuery,
        analysis: questionAnalysis,
        debug: {
          resolvedTopicMode: keepConversationContext ? "same-topic" : "new-topic",
          relation: relationPayload?.relation || "unclear",
          relationConfidence: Number(relationPayload?.confidence || 0),
          sourceSupport: Boolean(sourceSupport?.hasSupport),
          restartCycle: false,
        },
      }),
      agentModel: resolvedAgentModel,
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
      researchJson: buildResearchJson({
        question: currentQuestionText,
        searchQuery: buildProposedSearchQuery(currentQuestionText),
        analysis: questionAnalysis,
        sourceSupport,
        intentRelation: relationPayload,
        stage: "need-topic-and-time",
      }),
      searchPlan: buildSearchPlan({
        question: currentQuestionText,
        searchQuery: buildProposedSearchQuery(currentQuestionText),
        analysis: questionAnalysis,
        debug: {
          resolvedTopicMode: keepConversationContext ? "same-topic" : "new-topic",
          relation: relationPayload?.relation || "unclear",
          relationConfidence: Number(relationPayload?.confidence || 0),
          sourceSupport: Boolean(sourceSupport?.hasSupport),
          restartCycle: false,
        },
      }),
      agentModel: resolvedAgentModel,
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
      researchJson: buildResearchJson({
        question: currentQuestionText,
        searchQuery: buildProposedSearchQuery(currentQuestionText),
        analysis: questionAnalysis,
        sourceSupport,
        intentRelation: relationPayload,
        stage: "need-topic",
      }),
      searchPlan: buildSearchPlan({
        question: currentQuestionText,
        searchQuery: buildProposedSearchQuery(currentQuestionText),
        analysis: questionAnalysis,
        debug: {
          resolvedTopicMode: keepConversationContext ? "same-topic" : "new-topic",
          relation: relationPayload?.relation || "unclear",
          relationConfidence: Number(relationPayload?.confidence || 0),
          sourceSupport: Boolean(sourceSupport?.hasSupport),
          restartCycle: false,
        },
      }),
      agentModel: resolvedAgentModel,
    };
  }

  return {
    readyToSearch: false,
    answer:
      "Mi manca solo il periodo temporale. Indica anno o intervallo (es: 'gennaio 2000', '2025', 'ultimi 12 mesi').",
    proposedSearchQuery: "",
    missingFields,
    stage: "need-time",
    researchJson: buildResearchJson({
      question: currentQuestionText,
      searchQuery: buildProposedSearchQuery(currentQuestionText),
      analysis: questionAnalysis,
      sourceSupport,
      intentRelation: relationPayload,
      stage: "need-time",
    }),
    searchPlan: buildSearchPlan({
      question: currentQuestionText,
      searchQuery: buildProposedSearchQuery(currentQuestionText),
      analysis: questionAnalysis,
      debug: {
        resolvedTopicMode: keepConversationContext ? "same-topic" : "new-topic",
        relation: relationPayload?.relation || "unclear",
        relationConfidence: Number(relationPayload?.confidence || 0),
        sourceSupport: Boolean(sourceSupport?.hasSupport),
        restartCycle: false,
      },
    }),
    agentModel: resolvedAgentModel,
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
      uiMode: req.body?.uiMode,
      limit: req.body?.limit,
      ragModel: req.body?.ragModel,
      agentModel: req.body?.agentModel,
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
    const previousSources = Array.isArray(req.body?.previousSources) ? req.body.previousSources : [];
    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);
    const agentModel = String(req.body?.agentModel || currentState.agentModel || "").trim() || DEFAULT_AGENT_MODEL;

    if (!question) {
      return res.status(400).json({ error: "La domanda e' obbligatoria." });
    }

    const decision = await buildIntakeDecision({
      question,
      history,
      previousSources,
      profile,
      agentPromptTemplate: currentState.agentPromptTemplate,
      agentModel,
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
    const searchPlan = normalizeSearchPlanPayload(req.body?.searchPlan);
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
      searchIndex,
      {
        searchPlan,
        analysisQuestion: String(req.body?.question || searchQuery || "").trim(),
      }
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
        searchPlan,
        activeFilter: searchPlan?.filterExpression || "",
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
    const searchPlan = normalizeSearchPlanPayload(req.body?.searchPlan);
    const searchQuery = providedSearchQuery || question || DEFAULT_SEARCH_QUERY;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);
    const model = String(req.body?.model || currentState.ragModel || "").trim() || DEFAULT_MODEL;
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

    await writeUiState({
      ...currentState,
      limit,
      ragModel: model,
      promptTemplate: promptTemplate || currentState.promptTemplate,
      questionDraft: question,
    }, uiScope);

    const { hits, context, cached, candidateCount, analysis, detectedEntities, entityKeywordTerms } =
      await fetchContextCached(
      searchQuery,
      limit,
      searchIndex,
      {
        searchPlan,
        analysisQuestion: question,
      }
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
          searchPlan,
          activeFilter: searchPlan?.filterExpression || "",
          queryTerms: analysis?.terms || [],
          detectedEntities: detectedEntities || { persone: [], luoghi: [], enti: [] },
          entityKeywordTerms: entityKeywordTerms || [],
          usedAiEntityFallback: Boolean(analysis?.usedAiEntityFallback),
          temporalPromptRequired: false,
        },
      });
    }

    const prompt = buildPrompt(question, context, promptTemplate);
    const rawAnswer = await askOllama(prompt, model);
    const answer = appendCanonicalSourceLinks(rawAnswer, hits);

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
        searchPlan,
        activeFilter: searchPlan?.filterExpression || "",
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
    const searchPlan = normalizeSearchPlanPayload(req.body?.searchPlan);
    const searchQuery = providedSearchQuery || question || DEFAULT_SEARCH_QUERY;
    const limit = Number(req.body?.limit || DEFAULT_LIMIT);
    const searchIndex = normalizeSearchIndex(req.body?.searchIndex);
    const profile = getSearchProfile(searchIndex);
    const uiScope = profile.key;
    const currentState = await readUiState(uiScope);
    const model = String(req.body?.model || currentState.ragModel || "").trim() || DEFAULT_MODEL;
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

    await writeUiState({
      ...currentState,
      limit,
      ragModel: model,
      promptTemplate: promptTemplate || currentState.promptTemplate,
      questionDraft: question,
    }, uiScope);

    const { hits, context, cached, candidateCount, analysis, detectedEntities, entityKeywordTerms } =
      await fetchContextCached(searchQuery, limit, searchIndex, {
        searchPlan,
        analysisQuestion: question,
      });

    const metadata = {
      model,
      searchQuery,
      limit,
      searchIndex,
      cached,
      candidateCount,
      retrievalQuery: analysis?.retrievalQuery || searchQuery,
      searchPlan,
      activeFilter: searchPlan?.filterExpression || "",
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

    const sourceLinksSuffix = buildCanonicalSourceLinks(hits);
    if (sourceLinksSuffix) {
      writeNdjsonEvent(res, { type: "token", text: `\n${sourceLinksSuffix}` });
    }

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
