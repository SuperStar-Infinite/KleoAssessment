# Kleo Docs - Document Chat

Take-home: upload a PDF/TXT/Markdown file from the chat composer and ask grounded questions with streamed answers, citations, and expandable evidence cards. Conversations persist in Neon across reloads.

## Stack

- **Next.js App Router** + TypeScript + Tailwind
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **Neon Postgres** + **pgvector**
- **Drizzle ORM**
- **OpenAI** (`gpt-4o-mini` + `text-embedding-3-small`) - swap chat model via env
- **unpdf** for PDF text extraction (page-aware)

## Features

- Attach PDF / TXT / Markdown from the composer (ChatGPT/Claude-style paperclip)
- Uploaded files appear as chips inside the chat message history
- Streamed RAG answers with `[n]` citations + expandable evidence cards
- Multi-chat sidebar: create, switch (cached), delete sessions
- Independent scroll for sidebar vs message panel
- Fast path for greetings/small talk (skips embedding + vector search)
- Loading / empty / error states for boot, upload, and chat

## Setup

### 1. Neon

1. Create a free project at [neon.tech](https://neon.tech)
2. Run [`scripts/schema.sql`](scripts/schema.sql) in the Neon SQL Editor (enables `vector` + creates tables)
3. Copy the connection string

### 2. Environment

```bash
cp .env.example .env.local
```

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

1. Import this GitHub repo in Vercel (Hobby)
2. Add the same env vars (`DATABASE_URL`, `OPENAI_API_KEY`, optional `OPENAI_CHAT_MODEL`)
3. Deploy

## Architecture

```
Upload (PDF/TXT/MD) from composer
  -> extract text (unpdf / utf8)
  -> chunk (~1200 chars, overlap)
  -> embed (text-embedding-3-small)
  -> store documents + chunks + embeddings in Neon
  -> show file chip on that user message in chat history

Ask question
  -> if greeting / small talk: skip embeddings + retrieval (fast path)
  -> else: embed query -> cosine search (pgvector) -> stream grounded answer
  -> citations in prose + evidence cards built from retrieved chunks
  -> persist user/assistant messages in Neon
```

### Schema (summary)

| Table | Purpose |
|---|---|
| `chats` | Conversation threads |
| `documents` | Uploaded file metadata + processing status |
| `chunks` | Text chunks + `vector(1536)` embeddings |
| `messages` | UI message parts as JSONB (`id` is TEXT for AI SDK ids) |

## Key trade-offs

1. **Inline document processing** (no queue) - simpler for Hobby/demo; large PDFs block the upload request. Cap is **8MB**.
2. **Chat-scoped retrieval** - embeddings filtered by `chat_id`, so documents do not leak across chats.
3. **Evidence cards from retrieval** - built server-side from pgvector hits (no extra LLM tool round-trip) for lower latency while keeping structured citation UI.
4. **OpenAI embedding dim 1536** - matches `text-embedding-3-small`; changing embedding models needs a schema change.
5. **No auth** - as specified; anyone with the URL can use the deployed instance.
6. **Latency** - greetings skip RAG; document answers use one model call + parallel embed/search; user message persistence is non-blocking.
7. **Client chat cache** - switching chats feels instant for visited sessions; delete cascades documents/chunks/messages in Neon.

## Time spent

~5 hours (scaffolding, Neon/pgvector, RAG + citations, composer upload UX, chat nav/delete, latency pass, README).

## AI tools used

- Cursor Agent (Composer) for scaffolding, implementation, and debugging
- Vercel AI SDK docs / cookbook patterns for streaming chat UI

## Example: corrected / rejected AI output

Cursor initially suggested using `pdf-parse` with a deep `pdf-parse/lib/pdf-parse.js` import for Next.js. That package is brittle under App Router (test-file side effects / CJS edge cases), so that approach was **rejected** in favor of **`unpdf`**, which extracts per-page text cleanly and better supports citation "page N".

## Manual test checklist

- [ ] New chat; attach `.md` / `.txt` from composer; file chip appears in message history; status becomes `ready`
- [ ] Upload `.pdf`, ask a factual question; streamed answer + `[n]` citations + evidence cards
- [ ] Say `hi` - reply is fast (no retrieval delay)
- [ ] Switch between chats smoothly; delete a chat; confirm it disappears after reload
- [ ] Sidebar scroll and message scroll are independent
- [ ] Reload page - chat history and documents still present
- [ ] Empty / error states when env/DB missing or unsupported file type
