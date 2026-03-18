import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
export const OLLAMA_NON_STREAM_TIMEOUT_MS = Number(process.env.OLLAMA_NON_STREAM_TIMEOUT_MS || 90_000);

export const SEARCH_INDEX_URL =
  process.env.SEARCH_INDEX_URL ||
  "https://search.appnativeitalia.com/indexes/testi_ecclesiali/search";
export const DEFAULT_SEARCH_INDEX = process.env.DEFAULT_SEARCH_INDEX || "testi_ecclesiali";
export const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
export const SEARCH_API_KEY_BOLLETTINO = process.env.SEARCH_API_KEY_BOLLETTINO || "";

export const DEFAULT_SEARCH_QUERY = process.env.DEFAULT_SEARCH_QUERY || "papa leone";
export const DEFAULT_LIMIT = Number(process.env.DEFAULT_LIMIT || 5);
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemma:7b";
export const DEFAULT_AGENT_MODEL =
  process.env.DEFAULT_AGENT_MODEL || process.env.AGENT_MODEL || DEFAULT_MODEL;
export const MAX_TEXT_EXCERPT_CHARS = Number(process.env.MAX_TEXT_EXCERPT_CHARS || 1800);
export const MAX_CONTEXT_DOCS = Number(process.env.MAX_CONTEXT_DOCS || 3);
export const SEARCH_CANDIDATE_MULTIPLIER = Number(process.env.SEARCH_CANDIDATE_MULTIPLIER || 3);
export const SEARCH_CACHE_TTL_MS = 30_000;
export const UI_STATE_SCOPE_DEFAULT = "default";

export const SEARCH_PROFILES = {
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

export const AI_ENTITY_FALLBACK_ENABLED = process.env.AI_ENTITY_FALLBACK_ENABLED !== "false";
export const AI_ENTITY_MIN_LOCAL_TERMS = Number(process.env.AI_ENTITY_MIN_LOCAL_TERMS || 3);
export const AI_ENTITY_TIMEOUT_MS = Number(process.env.AI_ENTITY_TIMEOUT_MS || 1800);
export const AI_ENTITY_MODEL = process.env.AI_ENTITY_MODEL || DEFAULT_AGENT_MODEL;
export const AI_ENTITY_CACHE_TTL_MS = 60_000;

// Timeout per la singola call unificata dell'agente (sostituisce 5 call separate)
export const AI_AGENT_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT_MS || 5000);
export const AI_AGENT_CACHE_TTL_MS = Number(process.env.AI_AGENT_CACHE_TTL_MS || 45_000);

export const TEMPORAL_MONTH_TERMS = [
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

export const MONTH_TO_NUMBER = {
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

export const TEMPORAL_REFERENCE_TERMS = [
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

export const UI_STATE_FILE = path.join(__dirname, "..", "storage", "ui-state.json");

export const DEFAULT_PROMPT_TEMPLATE = `Usa solo il contesto seguente.

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

export const BOLLETTINO_PROMPT_TEMPLATE = `Sei un esperto in notizie che riguardano il Vaticano e la Chiesa
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

// Prompt unificato per l'agente: sostituisce 5 chiamate LLM separate con una sola.
// Raccoglie in un'unica risposta JSON: classificazione intento, entità, query riscritta, risposta conversazionale.
export const DEFAULT_AGENT_PROMPT_TEMPLATE = `Sei un assistente per ricerca documentale sul Vaticano e la Chiesa Cattolica.
Analizza la richiesta utente e restituisci SOLO JSON valido con questo schema:
{"needsTopic":boolean,"needsTime":boolean,"isNewTopic":boolean,"searchQuery":string,"entities":{"persone":[],"luoghi":[],"enti":[]},"reply":string,"confidence":number}

Regole:
- needsTopic=true solo se la domanda e' troppo vaga per cercare (es: "voglio sapere", "dimmi qualcosa", "racconta")
- needsTime=true solo se strictTemporal=true E non c'e' alcun riferimento temporale (anno, mese, periodo) nella domanda ne' nello storico recente
- isNewTopic=true se la domanda introduce un argomento completamente diverso rispetto alle domande precedenti
- searchQuery: keyword sintetiche in minuscolo (es: "nomine vescovi gennaio 2000"); normalizza "Giovanni Paolo II" -> "giovanni paolo 2"; rimuovi stopword; se la domanda e' un follow-up temporale, eredita il tema dallo storico
- entities: nomi propri di persone, luoghi, enti menzionati esplicitamente nella domanda
- reply: risposta naturale e cordiale in italiano (2-3 frasi)
  - se needsTopic=true: chiedi gentilmente quale argomento vuole cercare
  - se needsTime=true: chiedi il periodo temporale (anno o intervallo)
  - se entrambi mancano: chiedi entrambi con un esempio concreto (es: "ordinazioni vescovi nel 2025")
  - se pronto: conferma che stai avviando la ricerca
- confidence: 0-1
- niente testo extra fuori dal JSON

strictTemporal: {{strictTemporal}}
Storico:
{{history}}
Fonti recenti:
{{previousSources}}
Domanda:
{{question}}`;
