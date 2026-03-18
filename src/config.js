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

export const DEFAULT_LIMIT = Number(process.env.DEFAULT_LIMIT || 5);
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemma:7b";
export const DEFAULT_AGENT_MODEL =
  process.env.DEFAULT_AGENT_MODEL || process.env.AGENT_MODEL || DEFAULT_MODEL;
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
{"isConversational":boolean,"needsTopic":boolean,"needsTime":boolean,"isNewTopic":boolean,"searchQuery":string,"entities":{"persone":[],"luoghi":[],"enti":[]},"reply":string,"confidence":number}

Regole:
- isConversational=true se e' un saluto, ringraziamento, domanda su chi sei, apprezzamento o qualsiasi cosa NON sia una richiesta di ricerca documentale; in questo caso rispondi in modo naturale e cordiale, senza chiedere argomento o periodo
- needsTopic=true solo se e' chiaramente una richiesta di ricerca ma troppo vaga (es: "voglio sapere", "dimmi qualcosa", "racconta"); se isConversational=true, needsTopic=false
- needsTime=true solo se strictTemporal=true E non c'e' alcun riferimento temporale nella domanda ne' nello storico; se isConversational=true, needsTime=false
- isNewTopic=true se la domanda introduce un argomento completamente diverso rispetto alle domande precedenti
- searchQuery: keyword sintetiche in minuscolo (es: "nomine vescovi gennaio 2000"); se isConversational=true, lascia stringa vuota
- entities: nomi propri di persone, luoghi, enti menzionati esplicitamente
- reply: risposta naturale in italiano (1-3 frasi)
  - se isConversational=true: rispondi in modo naturale e colloquiale; presentati brevemente se chiedono chi sei
  - se needsTopic=true: chiedi quale argomento vuole cercare
  - se needsTime=true: chiedi il periodo temporale
  - se pronto: conferma che avvii la ricerca
- confidence: 0-1
- niente testo extra fuori dal JSON

strictTemporal: {{strictTemporal}}
Storico:
{{history}}
Fonti recenti:
{{previousSources}}
Domanda:
{{question}}`;
