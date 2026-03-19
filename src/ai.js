// src/ai.js — Comunicazione con Ollama

import { OLLAMA_BASE_URL, OLLAMA_NON_STREAM_TIMEOUT_MS } from "./config.js";


// Chiama Ollama e aspetta la risposta completa (non streaming)
export async function askOllama(prompt, model, timeoutMs = OLLAMA_NON_STREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.7 } }),
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
