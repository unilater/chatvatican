#!/usr/bin/env node
// scripts/configure-stopwords.js
// Script da eseguire UNA SOLA VOLTA per configurare le stopword italiane
// direttamente sull'indice Meilisearch.
//
// Con le stopword native, Meilisearch le ignora automaticamente sia in
// indicizzazione che in ricerca: "cosa ha detto papa leone" → cerca "papa leone".
//
// Utilizzo:
//   MEILI_MASTER_KEY=<chiave_master> node scripts/configure-stopwords.js
//
// Opzionalmente puoi specificare un indice diverso:
//   MEILI_MASTER_KEY=xxx MEILI_INDEX=bollettino node scripts/configure-stopwords.js

import dotenv from "dotenv";
dotenv.config();

// ─── Configurazione ───────────────────────────────────────────────────────────

const MASTER_KEY = process.env.MEILI_MASTER_KEY;
if (!MASTER_KEY) {
  console.error("Errore: imposta la variabile d'ambiente MEILI_MASTER_KEY");
  process.exit(1);
}

// Ricava il base URL dalla variabile già presente nel .env
const RAW_URL = process.env.SEARCH_INDEX_URL || "https://search.appnativeitalia.com/indexes/testi_ecclesiali/search";
const BASE_URL = (() => {
  const u = new URL(RAW_URL);
  return `${u.protocol}//${u.host}`;
})();

const INDEX = process.env.MEILI_INDEX || process.env.DEFAULT_SEARCH_INDEX || "testi_ecclesiali";

// ─── Stopword italiane ────────────────────────────────────────────────────────
// Lista Snowball italiana (~280 voci) — la stessa usata da Elasticsearch,
// Lucene e Solr. Copre articoli, preposizioni, pronomi, tutte le forme
// flesse degli ausiliari essere/avere, congiunzioni, avverbi grammaticali.
// Fonte: https://snowballstem.org/algorithms/italian/stop.txt (dominio pubblico)

const STOP_WORDS = [
  // Preposizioni articolate e semplici
  "ad","al","allo","ai","agli","all","agl","alla","alle",
  "con","col","coi",
  "da","dal","dallo","dai","dagli","dall","dagl","dalla","dalle",
  "di","del","dello","dei","degli","dell","degl","della","delle",
  "in","nel","nello","nei","negli","nell","negl","nella","nelle",
  "su","sul","sullo","sui","sugli","sull","sugl","sulla","sulle",
  "per","tra","contro","fra",
  // Pronomi personali soggetto
  "io","tu","lui","lei","noi","voi","loro",
  // Pronomi possessivi
  "mio","mia","miei","mie",
  "tuo","tua","tuoi","tue",
  "suo","sua","suoi","sue",
  "nostro","nostra","nostri","nostre",
  "vostro","vostra","vostri","vostre",
  // Pronomi oggetto / particelle
  "mi","ti","ci","vi","lo","la","li","le","gli","ne","si","se","me","te",
  // Articoli
  "il","i","un","uno","una",
  // Congiunzioni e avverbi grammaticali
  "ma","ed","se","perché","anche","come","dov","dove","che","chi",
  "cui","non","più","quale","quanto","quanti","quante",
  "quello","quella","quelli","quelle",
  "stesso","stessa","stessi","stesse",
  "altro","altra","altri","altre",
  "tanto","tanta","tanti","tante",
  "così","tutto","tutta","tutti","tutte",
  "volta","volte","caso","però","poi","ora","allora","già","ancora",
  "sempre","mai","solo","soltanto","solamente","molto","poco",
  "meno","quasi","proprio","insieme","mentre","quando","dove",
  "quindi","dunque","anzi","pure","anche","forse","almeno","inoltre",
  // Essere — tutte le forme flesse
  "sono","sei","siamo","siete",
  "era","eri","eravamo","eravate","erano",
  "sarò","sarai","sarà","saremo","sarete","saranno",
  "sia","siate","siano",
  "sarei","saresti","sarebbe","saremmo","sareste","sarebbero",
  "fu","fui","fosti","fummo","foste","furono",
  "fossi","fosse","fossimo","foste","fossero",
  "stato","stata","stati","state","essere",
  // Avere — tutte le forme flesse
  "ho","hai","ha","abbiamo","avete","hanno",
  "aveva","avevi","avevamo","avevate","avevano",
  "avrò","avrai","avrà","avremo","avrete","avranno",
  "avrei","avresti","avrebbe","avremmo","avreste","avrebbero",
  "abbia","abbiate","abbiano",
  "avessi","avesse","avessimo","aveste","avessero",
  "avuto","avuta","avuti","avute","avere",
  // Verbi modali e ausiliari comuni
  "fare","fatto","fatta","fatti","fatte",
  "dire","detto","detta","detti","dette",
  "stare","venire","andare","potere","volere","dovere","sapere",
];

// ─── Chiama l'API settings di Meilisearch ─────────────────────────────────────

const url = `${BASE_URL}/indexes/${encodeURIComponent(INDEX)}/settings/stop-words`;

console.log(`Indice  : ${INDEX}`);
console.log(`Endpoint: ${url}`);
console.log(`Stopword: ${STOP_WORDS.length} voci`);

const res = await fetch(url, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${MASTER_KEY}`,
  },
  body: JSON.stringify(STOP_WORDS),
});

const data = await res.json();

if (!res.ok) {
  console.error(`Errore ${res.status}:`, JSON.stringify(data, null, 2));
  process.exit(1);
}

const taskUid = data.taskUid ?? data.uid ?? "n/a";
console.log(`\nOK — taskUid: ${taskUid}`);
console.log("Meilisearch re-indicizza in background (di solito pochi secondi).");
if (taskUid !== "n/a") {
  console.log(`\nStato task: GET ${BASE_URL}/tasks/${taskUid}  (header Authorization: Bearer <master_key>)`);
}
