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

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemma:7b";
export const DEFAULT_AGENT_MODEL =
  process.env.DEFAULT_AGENT_MODEL || process.env.AGENT_MODEL || DEFAULT_MODEL;

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




