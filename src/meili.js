// src/meili.js — Servizio Meilisearch avanzato
// Facets, highlighting sicuro, paginazione, filtri dinamici, ordinamento

import {
  SEARCH_INDEX_URL,
  SEARCH_API_KEY,
  SEARCH_API_KEY_BOLLETTINO,
  DEFAULT_SEARCH_INDEX,
} from "./config.js";

// Delimitatori per l'highlighting sicuro (caratteri di controllo che non appaiono nei testi)
// Il frontend li riceve e li converte in <mark> dopo aver escaped l'HTML
const HIGHLIGHT_PRE = "\x02";
const HIGHLIGHT_POST = "\x03";

// Campi su cui richiedere highlight e snippet
const HIGHLIGHT_FIELDS = ["titolo", "abstract", "testo_originale"];
const CROP_FIELDS      = ["testo_originale:150", "abstract:100"];

// Facets di default da richiedere a Meilisearch
export const DEFAULT_FACETS = ["fonte", "tipo_documento", "autore"];

function getBaseUrl() {
  const url = new URL(SEARCH_INDEX_URL);
  return `${url.protocol}//${url.host}`;
}

function getSearchUrl(index) {
  return `${getBaseUrl()}/indexes/${encodeURIComponent(index)}/search`;
}

function getApiKey(index) {
  return index === "bollettino"
    ? SEARCH_API_KEY_BOLLETTINO || SEARCH_API_KEY
    : SEARCH_API_KEY;
}

/**
 * Ricerca avanzata su Meilisearch.
 * Restituisce il body completo della risposta (hits, facetDistribution,
 * estimatedTotalHits, processingTimeMs, ecc.)
 *
 * @param {object} opts
 * @param {string}   opts.query
 * @param {string}   opts.index
 * @param {number}   opts.limit       max risultati per pagina (default 20)
 * @param {number}   opts.offset      offset per la paginazione (default 0)
 * @param {string[]} opts.facets      campi per cui calcolare la distribuzione
 * @param {string}   opts.filter      espressione filtro Meilisearch
 * @param {string[]} opts.sort        ordinamento es. ["data:desc"]
 */
export async function searchDocuments({
  query = "",
  index = DEFAULT_SEARCH_INDEX,
  limit = 20,
  offset = 0,
  facets = DEFAULT_FACETS,
  filter = "",
  sort = [],
} = {}) {
  const apiKey = getApiKey(index);
  if (!apiKey) throw new Error("SEARCH_API_KEY non configurata");

  const body = {
    q: String(query).trim(),
    limit,
    offset,
    attributesToHighlight: HIGHLIGHT_FIELDS,
    attributesToCrop: CROP_FIELDS,
    cropMarker: "…",
    highlightPreTag: HIGHLIGHT_PRE,
    highlightPostTag: HIGHLIGHT_POST,
    matchingStrategy: "last",
  };

  if (facets.length > 0) body.facets = facets;
  if (filter) body.filter = filter;
  if (sort.length > 0) body.sort = sort;

  const res = await fetch(getSearchUrl(index), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // Facet/campo non configurato come filtrable → riprova senza facets
    if (res.status === 400 && /not filterable|facet/i.test(text) && facets.length > 0) {
      return searchDocuments({ query, index, limit, offset, facets: [], filter, sort });
    }
    // Attributo non ordinabile → riprova senza sort
    if (res.status === 400 && /not sortable/i.test(text) && sort.length > 0) {
      return searchDocuments({ query, index, limit, offset, facets, filter, sort: [] });
    }
    throw new Error(`Meilisearch ${res.status}: ${text}`);
  }

  return res.json();
}

