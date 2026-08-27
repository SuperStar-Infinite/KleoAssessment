# Kleo Docs - Document Chat

Take-home: upload a PDF/TXT/Markdown file and ask grounded questions with streamed answers, citations, and expandable evidence cards.

## Stack

- **Next.js App Router** + TypeScript
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **Neon Postgres** + **pgvector**
- **Drizzle ORM**
- **OpenAI** (`gpt-4o-mini` + `text-embedding-3-small`) - swap models via env

## Setup

### 1. Neon

1. Create a free project at [neon.tech](https://neon.tech)
2. Enable the `vector` extension and create tables by running [`scripts/schema.sql`](scripts/schema.sql) in the Neon SQL Editor
3. Copy the connection string

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:

```env
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4o-mini
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Deploy (Vercel)

1. Push this repo to GitHub
2. Import the project in Vercel (Hobby)
3. Add the same env vars
4. Deploy

## Architecture

```
Upload (PDF/TXT/MD)
  -> extract text (unpdf / utf8)
  -> chunk (~1200 chars, overlap)
  -> embed (text-embedding-3-small)
  -> store documents + chunks + embeddings in Neon

Ask question
  -> if greeting / small talk: skip embeddings + retrieval (fast path)
  -> else: embed query -> cosine search (pgvector) -> grounded answer
  -> citations in prose + evidence cards from retrieved chunks
  -> persist user/assistant messages in Neon

Upload happens from the chat composer (paperclip), not a separate header action.
```

### Schema (summary)

| Table | Purpose |
|---|---|
| `chats` | Conversation threads |
| `documents` | Uploaded file metadata + processing status |
| `chunks` | Text chunks + `vector(1536)` embeddings |
| `messages` | UI message parts (text + tool results) as JSONB |

## Key trade-offs

1. **Inline document processing** (no queue) - simpler for Hobby/demo; large PDFs will block the upload request. Cap is 8MB.
2. **Chat-scoped retrieval only** - embeddings are filtered by `chat_id`, so documents never leak across chats.
3. **Evidence cards from retrieval** - built server-side from pgvector hits (no extra LLM tool round-trip), which keeps citation UI without doubling answer latency.
4. **OpenAI embeddings dimension 1536** - matches `text-embedding-3-small`; changing embedding models requires a schema/migration change.
5. **No auth** - as specified; anyone with the URL can use the deployed instance.
6. **Latency path** - greetings skip RAG; document answers use one model call + parallel embed/search; user message persistence is non-blocking.

## Time spent

~4.5 hours (scaffolding, Neon/pgvector path, RAG + citations, evidence-card UI, README).

## AI tools used

- Cursor Agent (Composer) for scaffolding, implementation, and debugging
- Vercel AI SDK docs / cookbook patterns for `streamText`, tools, and `useChat`

## Example: corrected / rejected AI output

Cursor initially suggested using `pdf-parse` with a deep `pdf-parse/lib/pdf-parse.js` import for Next.js. That package is brittle under App Router (test-file side effects / CJS edge cases), so I **rejected** that approach and switched to **`unpdf`**, which extracts per-page text cleanly and fits the citation "page N" requirement better.

## Manual test checklist

- [ ] Create chat, upload `.md` / `.txt`, status becomes `ready`
- [ ] Upload `.pdf`, ask a factual question, see streamed answer + `[n]` citations
- [ ] Expand evidence cards (filename / page / excerpt)
- [ ] Reload page - chat history and documents still present
- [ ] Empty state before upload; error state if env/DB missing; upload error for bad file type
