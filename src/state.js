import { promises as fs } from "node:fs";
import path from "node:path";
import { UI_STATE_FILE, DEFAULT_MODEL, DEFAULT_PROMPT_TEMPLATE } from "./config.js";

const SCOPE = "search";

export function normalizeUiScope(_scope) {
  return SCOPE;
}

export function getDefaultUiState() {
  return {
    uiMode: "user",
    ragModel: DEFAULT_MODEL,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  };
}

export function sanitizeUiState(rawState) {
  const defaults = getDefaultUiState();
  const parsedUiMode = String(rawState?.uiMode || defaults.uiMode).trim().toLowerCase();
  return {
    uiMode: parsedUiMode === "admin" ? "admin" : "user",
    ragModel:
      String(rawState?.ragModel || defaults.ragModel).trim() || defaults.ragModel,
    promptTemplate:
      String(rawState?.promptTemplate || defaults.promptTemplate) || defaults.promptTemplate,
  };
}

function normalizeUiStateStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { scopes: {} };
  }
  if (raw.scopes && typeof raw.scopes === "object" && !Array.isArray(raw.scopes)) {
    return { scopes: raw.scopes };
  }
  return { scopes: { [SCOPE]: raw } };
}

async function ensureStorageDir() {
  await fs.mkdir(path.dirname(UI_STATE_FILE), { recursive: true });
}

export async function readUiState(_scope) {
  try {
    const fileContent = await fs.readFile(UI_STATE_FILE, "utf8");
    const store = normalizeUiStateStore(JSON.parse(fileContent));
    return sanitizeUiState(store.scopes[SCOPE]);
  } catch (error) {
    if (error?.code === "ENOENT") return getDefaultUiState();
    throw error;
  }
}

export async function writeUiState(nextState, _scope) {
  await ensureStorageDir();
  let currentStore = { scopes: {} };
  try {
    const fileContent = await fs.readFile(UI_STATE_FILE, "utf8");
    currentStore = normalizeUiStateStore(JSON.parse(fileContent));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const state = sanitizeUiState(nextState);
  const nextStore = {
    scopes: { ...currentStore.scopes, [SCOPE]: state },
  };
  await fs.writeFile(UI_STATE_FILE, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  return state;
}
