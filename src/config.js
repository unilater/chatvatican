import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
export const OLLAMA_NON_STREAM_TIMEOUT_MS = Number(process.env.OLLAMA_NON_STREAM_TIMEOUT_MS || 90_000);

export const DEFAULT_AGENT_MODEL = process.env.DEFAULT_AGENT_MODEL || "gemma:7b";

export const QDRANT_BASE_URL   = process.env.QDRANT_BASE_URL   || "https://qdrant.appnativeitalia.com";
export const QDRANT_API_KEY    = process.env.QDRANT_API_KEY    || "";
export const QDRANT_EMBED_MODEL = process.env.QDRANT_EMBED_MODEL || "nomic-embed-text";

export const APP_STATE_FILE = path.join(__dirname, "..", "storage", "app-state.json");
