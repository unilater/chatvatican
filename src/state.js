import { promises as fs } from "node:fs";
import path from "node:path";
import {
  UI_STATE_FILE,
  UI_STATE_SCOPE_DEFAULT,
  DEFAULT_LIMIT,
  DEFAULT_MODEL,
  DEFAULT_AGENT_MODEL,
  DEFAULT_PROMPT_TEMPLATE,
  BOLLETTINO_PROMPT_TEMPLATE,
  DEFAULT_AGENT_PROMPT_TEMPLATE,
  SEARCH_PROFILES,
} from "./config.js";

export function normalizeUiScope(scope) {
  const candidate = String(scope || "").trim().toLowerCase();
  if (candidate === "notizie" || candidate === "bollettini" || candidate === "search") {
    return candidate;
  }
  return UI_STATE_SCOPE_DEFAULT;
}

export function getDefaultUiState(scope = UI_STATE_SCOPE_DEFAULT) {
  const profile =
    scope === "bollettini" ? SEARCH_PROFILES.bollettino : SEARCH_PROFILES.testi_ecclesiali;
  return {
    uiMode: "user",
    limit: DEFAULT_LIMIT,
    ragModel: DEFAULT_MODEL,
    agentModel: DEFAULT_AGENT_MODEL,
    chatMode: scope === "search" ? "rag" : profile.defaultChatMode,
    promptTemplate:
      scope === "bollettini" ? BOLLETTINO_PROMPT_TEMPLATE : DEFAULT_PROMPT_TEMPLATE,
    agentPromptTemplate: DEFAULT_AGENT_PROMPT_TEMPLATE,
    questionDraft: "",
  };
}

export function sanitizeUiState(rawState, scope = UI_STATE_SCOPE_DEFAULT) {
  const defaults = getDefaultUiState(scope);
  const parsedLimit = Number(rawState?.limit ?? defaults.limit);
  const parsedUiMode = String(rawState?.uiMode || defaults.uiMode)
    .trim()
    .toLowerCase();
  const parsedChatMode = String(rawState?.chatMode || defaults.chatMode)
    .trim()
    .toLowerCase();
  const uiMode = parsedUiMode === "admin" ? "admin" : "user";
  const chatMode = parsedChatMode === "rag" ? "rag" : "agent";

  return {
    uiMode,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : defaults.limit,
    ragModel:
      String(rawState?.ragModel || rawState?.model || defaults.ragModel).trim() ||
      defaults.ragModel,
    agentModel:
      String(rawState?.agentModel || rawState?.model || defaults.agentModel).trim() ||
      defaults.agentModel,
    chatMode,
    promptTemplate:
      String(rawState?.promptTemplate || defaults.promptTemplate) || defaults.promptTemplate,
    agentPromptTemplate:
      String(rawState?.agentPromptTemplate || defaults.agentPromptTemplate) ||
      defaults.agentPromptTemplate,
    questionDraft: String(rawState?.questionDraft || ""),
  };
}

function normalizeUiStateStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { scopes: {} };
  }

  if (raw.scopes && typeof raw.scopes === "object" && !Array.isArray(raw.scopes)) {
    return { scopes: raw.scopes };
  }

  // Compatibilità con il formato flat legacy
  return {
    scopes: {
      [UI_STATE_SCOPE_DEFAULT]: raw,
    },
  };
}

async function ensureStorageDir() {
  await fs.mkdir(path.dirname(UI_STATE_FILE), { recursive: true });
}

export async function readUiState(scope = UI_STATE_SCOPE_DEFAULT) {
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

export async function writeUiState(nextState, scope = UI_STATE_SCOPE_DEFAULT) {
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

  await fs.writeFile(
    UI_STATE_FILE,
    `${JSON.stringify(nextStore, null, 2)}\n`,
    "utf8"
  );
  return state;
}
