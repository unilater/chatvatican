# chatvatican

Interfaccia chat per un flusso RAG con:
- ricerca su indice documentale via API
- costruzione prompt con regole rigide di grounding
- generazione risposta tramite Ollama

## Requisiti

- Node.js 18+
- Ollama in esecuzione locale
- una chiave valida per la search API

## Setup

1. Installa dipendenze:

```bash
npm install
```

2. Crea il file ambiente:

```bash
cp .env.example .env
```

3. Inserisci in `.env` la tua `SEARCH_API_KEY`.
	Per la pagina bollettini puoi usare una chiave dedicata con `SEARCH_API_KEY_BOLLETTINO`.

4. Avvia l'app:

```bash
npm start
```

Apri `http://localhost:3000`.

## Configurazione

Variabili disponibili in `.env`:

- `PORT`: porta server web (default 3000)
- `SEARCH_INDEX_URL`: endpoint search
- `SEARCH_API_KEY`: token Bearer per search
- `SEARCH_API_KEY_BOLLETTINO`: token Bearer specifico per indice `bollettino` (fallback su `SEARCH_API_KEY`)
- `OLLAMA_BASE_URL`: endpoint Ollama (default `http://127.0.0.1:11434`)
- `DEFAULT_SEARCH_QUERY`: query iniziale UI
- `DEFAULT_LIMIT`: limite risultati predefinito
- `DEFAULT_MODEL`: modello Ollama predefinito

## API locale

Endpoint principale:

- `POST /api/rag`

Body JSON esempio:

```json
{
	"question": "Che cosa emerge da questi articoli su Papa Leone XIV?",
	"limit": 5,
	"model": "gemma:7b"
}
```

`searchQuery` e' opzionale: se non viene inviata, il backend usa automaticamente il testo di `question` come query documentale.

Il backend:
- recupera i documenti da search API
- compone il contesto con campi titolo/fonte/data/abstract
- costruisce il prompt nel formato da te indicato
- interroga Ollama e restituisce la risposta