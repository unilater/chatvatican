import { promises as fs } from "node:fs";
import path from "node:path";
import { APP_STATE_FILE, DEFAULT_AGENT_MODEL } from "./config.js";

export function getDefaultState() {
  return { uiMode: "user", ragModel: DEFAULT_AGENT_MODEL, promptTemplate: "", sourceLimit: 10 };
}

function sanitize(raw) {
  const d = getDefaultState();
  return {
    uiMode:         String(raw?.uiMode || "").toLowerCase() === "admin" ? "admin" : "user",
    ragModel:       String(raw?.ragModel       || d.ragModel).trim() || d.ragModel,
    promptTemplate: String(raw?.promptTemplate ?? ""),
    sourceLimit:    Math.min(Math.max(Number(raw?.sourceLimit) || d.sourceLimit, 1), 50),
  };
}

export async function readState() {
  try {
    return sanitize(JSON.parse(await fs.readFile(APP_STATE_FILE, "utf8")));
  } catch (e) {
    if (e.code === "ENOENT") return getDefaultState();
    throw e;
  }
}

export async function writeState(next) {
  const state = sanitize({ ...await readState(), ...next });
  await fs.mkdir(path.dirname(APP_STATE_FILE), { recursive: true });
  await fs.writeFile(APP_STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  return state;
}
