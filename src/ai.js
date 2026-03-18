// src/ai.js — Comunicazione con Ollama e logica decisionale dell'agente

import {
  OLLAMA_BASE_URL,
  OLLAMA_NON_STREAM_TIMEOUT_MS,
  AI_AGENT_TIMEOUT_MS,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_PROMPT_TEMPLATE,
} from "./config.js";

// Chiama Ollama e aspetta la risposta completa (non streaming)
export async function askOllama(prompt, model, timeoutMs = OLLAMA_NON_STREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return String(data?.response || "");
  } finally {
    clearTimeout(timer);
  }
}

// Chiama Ollama in streaming, invoca onToken per ogni token ricevuto
export async function askOllamaStream(prompt, model, onToken) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true, options: { temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("Stream Ollama non disponibile");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        if (chunk?.response) onToken(String(chunk.response));
        if (chunk?.done) return;
      } catch {
        // Ignora chunk malformati
      }
    }
  }
}

// Messaggi puramente conversazionali gestiti localmente — risposta immediata senza chiamata AI
const CONVERSAZIONE_LOCALE = [
  { re: /^(ciao|salve|hey|hello|hi|buongiorno|buonasera|buonanotte)[!.,?\s]*$/i,
    reply: "Ciao! Sono qui per aiutarti a cercare documenti vaticani. Dimmi di cosa vuoi sapere (argomento + periodo)." },
  { re: /^(grazie|grazie mille|perfetto|ottimo|benissimo|bravo|esatto|giusto|capito|ok|okay|bene|bene grazie)[!.,?\s]*$/i,
    reply: "Prego! Hai altre domande o vuoi cercare qualcos'altro?" },
  { re: /^(chi sei|cosa sei|cosa fai|come funzioni|a cosa servi|presentati)[?!.,\s]*$/i,
    reply: "Sono un assistente per la ricerca documentale sul Vaticano e la Chiesa Cattolica. Dimmi un argomento e un periodo e cerco tra i documenti disponibili." },
  { re: /^(come stai|come va|tutto bene)[?!.,\s]*$/i,
    reply: "Sto bene, grazie! Dimmi pure di cosa hai bisogno." },
];

function salutoLocale(q) {
  const match = CONVERSAZIONE_LOCALE.find((c) => c.re.test(q.trim()));
  return match ? match.reply : null;
}
// Keyword del dominio ecclesiastico: se la domanda ne contiene almeno una, è pertinente al RAG
const DOMINI_KEYWORDS = [
  "papa", "vescovo", "vescovi", "cardinale", "cardinali", "vaticano", "chiesa", "diocesi",
  "parrocchia", "sacerdote", "prete", "messa", "sinodo", "concilio", "enciclic",
  "nomina", "nomine", "ordinazione", "ordinazioni", "pontifice", "pontificato",
  "apostolico", "santa sede", "curia", "nunzio", "vescovato", "arcivescovo",
  "religioso", "religiosa", "teologia", "fede", "liturgia", "dogma", "canone",
  "diocesano", "episcopale", "episcopato", "monsignore", "prelato", "abate",
  "congregazione", "dicastero", "segreteria", "stato vaticano", "pio", "giovanni paolo",
  "benedetto", "francesco", "leone", "clemente", "gregorio", "innocenzo",
];

function isInDomain(q) {
  const lower = q.toLowerCase();
  return DOMINI_KEYWORDS.some((kw) => lower.includes(kw));
}

// Estrae il primo oggetto JSON valido da una stringa di testo
function parseJson(text) {
  const s = String(text || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Normalizza un array di stringhe (rimuove vuoti e spazi)
function toStringArray(val) {
  if (!Array.isArray(val)) return [];
  return val.map((v) => String(v || "").trim()).filter(Boolean);
}

// Normalizza il payload entities restituito dall'AI
function normalizeEntities(raw) {
  if (!raw || typeof raw !== "object") return { persone: [], luoghi: [], enti: [] };
  return {
    persone: toStringArray(raw.persone),
    luoghi: toStringArray(raw.luoghi),
    enti: toStringArray(raw.enti),
  };
}

// Costruisce il filterExpression per Meilisearch dalle entità estratte
function buildFilterExpression(entities) {
  const parts = [];
  if (entities.persone.length > 0)
    parts.push(`persone IN [${entities.persone.map((v) => `"${v}"`).join(", ")}]`);
  if (entities.luoghi.length > 0)
    parts.push(`luoghi IN [${entities.luoghi.map((v) => `"${v}"`).join(", ")}]`);
  if (entities.enti.length > 0)
    parts.push(`enti IN [${entities.enti.map((v) => `"${v}"`).join(", ")}]`);
  return parts.join(" AND ");
}

/**
 * Decisione agente: una singola chiamata LLM analizza la domanda e decide:
 * - se mancano informazioni (tema o periodo temporale)
 * - quali entità nominali sono presenti nella domanda
 * - quale query usare per Meilisearch
 * - quale risposta conversazionale dare all'utente
 *
 * Restituisce: { readyToSearch, answer, proposedSearchQuery, missingFields, stage, searchPlan, entities }
 */
export async function buildIntakeDecision({
  question,
  history,
  previousSources,
  profile,
  agentPromptTemplate,
  agentModel,
}) {
  const q = String(question || "").trim();
  const model = String(agentModel || "").trim() || DEFAULT_AGENT_MODEL;
  const strictTemporal = Boolean(profile?.strictTemporalDisambiguation);

  // Ultimi 6 messaggi della conversazione
  const historyText =
    Array.isArray(history) && history.length > 0
      ? history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Utente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(nessuno)";

  // Fonti usate nella risposta precedente
  const sourcesText =
    Array.isArray(previousSources) && previousSources.length > 0
      ? previousSources
          .slice(0, 5)
          .map((s) =>
            typeof s === "string" ? `- ${s}` : `- ${s?.titolo || ""} (${s?.fonte || ""})`
          )
          .join("\n")
      : "(nessuna)";

  // Costruisce il prompt dall'agentPromptTemplate
  const template = String(agentPromptTemplate || DEFAULT_AGENT_PROMPT_TEMPLATE);
  const prompt = template
    .replaceAll("{{strictTemporal}}", strictTemporal ? "true" : "false")
    .replaceAll("{{history}}", historyText)
    .replaceAll("{{previousSources}}", sourcesText)
    .replaceAll("{{question}}", q);

  // Risposta immediata ai saluti senza chiamare l'AI
  const saluto = salutoLocale(q);
  if (saluto) {
    return {
      readyToSearch: false,
      answer: saluto,
      proposedSearchQuery: "",
      missingFields: ["topic"],
      stage: "need-topic",
      searchPlan: null,
      entities: { persone: [], luoghi: [], enti: [] },
    };
  }

  // Chiama l'AI con timeout dedicato all'agente
  let ai = null;
  try {
    const raw = await askOllama(prompt, model, AI_AGENT_TIMEOUT_MS);
    ai = parseJson(raw);
  } catch {
    // Fallback basato su regole se l'AI non risponde
  }

  // Determina cosa manca per poter cercare
  const isConversational = ai ? Boolean(ai.isConversational) : false;
  const isOffTopic = ai ? Boolean(ai.isOffTopic) : false;
  const notSearchable = isConversational || isOffTopic;

  // Fallback senza AI: pertinente solo se contiene keyword del dominio ecclesiastico
  const inDomain = isInDomain(q);
  const needsTopic = !notSearchable && (ai ? Boolean(ai.needsTopic) : !inDomain);
  const needsTime = !notSearchable && strictTemporal && (ai ? Boolean(ai.needsTime) : false);
  const missingFields = [];
  if (needsTopic) missingFields.push("topic");
  if (needsTime) missingFields.push("time");

  const searchQuery = String(ai?.searchQuery || q).trim();
  const entities = normalizeEntities(ai?.entities);
  const reply = String(ai?.reply || "").trim();
  const ready = missingFields.length === 0 && Boolean(searchQuery);

  // Costruisce il searchPlan con query e filtri per Meilisearch
  const searchPlan = ready
    ? {
        textQuery: searchQuery,
        filterExpression: buildFilterExpression(entities),
        filters: {
          persone: entities.persone,
          luoghi: entities.luoghi,
          enti: entities.enti,
        },
      }
    : null;

  // Stage per il debug e la UI
  const stage = ready
    ? "ready"
    : missingFields.length === 2
      ? "need-topic-and-time"
      : missingFields.includes("topic")
        ? "need-topic"
        : "need-time";

  // Risposte di fallback se l'AI non ne fornisce una
  const fallbackReplies = {
    "need-topic-and-time":
      "Per partire mi servono tema e periodo. Esempio: 'ordinazioni vescovi nel 2025'.",
    "need-topic": "Quale argomento vuoi cercare?",
    "need-time": "Per quale periodo? Indica anno o mese.",
    ready: "Perfetto, avvio la ricerca.",
  };

  return {
    readyToSearch: ready,
    answer: reply || fallbackReplies[stage],
    proposedSearchQuery: ready ? searchQuery : "",
    missingFields,
    stage,
    searchPlan,
    entities,
  };
}
