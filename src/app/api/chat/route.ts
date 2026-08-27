import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  streamText,
  type UIMessage,
} from "ai";
import { eq } from "drizzle-orm";
import { getChatModel } from "@/lib/ai/models";
import { needsDocumentRetrieval } from "@/lib/ai/intent";
import {
  formatContextForPrompt,
  retrieveRelevantChunks,
  type RetrievedChunk,
} from "@/lib/ai/retrieve";
import { getDb } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";

export const maxDuration = 60;

type UploadedDocMeta = {
  documentId?: string;
  filename: string;
  status?: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chatId = String(body.chatId ?? "");
    const incomingMessages = (body.messages ?? []) as UIMessage[];

    if (!chatId) {
      return Response.json({ error: "chatId is required" }, { status: 400 });
    }

    const db = getDb();
    const [chat] = await db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);

    if (!chat) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }

    const lastUser = [...incomingMessages]
      .reverse()
      .find((m) => m.role === "user");
    const lastUserText =
      lastUser?.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim() ?? "";

    const uploadedDoc = extractUploadedDoc(lastUser);

    // Persist user turn in the background - don't block first token.
    if (lastUser && (lastUserText || uploadedDoc)) {
      void db
        .insert(messages)
        .values({
          id: lastUser.id || generateId(),
          chatId,
          role: "user",
          parts: lastUser.parts,
        })
        .onConflictDoNothing()
        .catch((error) => {
          console.error("[api/chat] failed to persist user message", error);
        });
    }

    const justUploaded = Boolean(uploadedDoc?.filename);
    const shouldRetrieve =
      !justUploaded &&
      Boolean(lastUserText) &&
      needsDocumentRetrieval(lastUserText);

    // Overlap model-message conversion with embedding + vector search.
    const [modelMessages, retrieved] = await Promise.all([
      convertToModelMessages(incomingMessages),
      shouldRetrieve
        ? retrieveRelevantChunks(chatId, lastUserText, 4)
        : Promise.resolve([] as RetrievedChunk[]),
    ]);

    const evidenceCards = shouldRetrieve
      ? cardsFromChunks(retrieved)
      : [];

    const contextBlock =
      retrieved.length > 0
        ? formatContextForPrompt(retrieved)
        : "No document excerpts were retrieved for this turn.";

    let system: string;
    if (justUploaded && uploadedDoc) {
      system = `You are a document chat assistant.
The user just uploaded "${uploadedDoc.filename}" and it is indexed/ready.
Acknowledge briefly, confirm ready, invite a question. Never ask them to re-upload.`;
    } else if (shouldRetrieve) {
      system = `You are a document Q&A assistant. Use only the excerpts below.
If they are insufficient, say so. Cite as [1], [2]. Keep answers concise.

Excerpts:
${contextBlock}`;
    } else {
      system = `Friendly document-chat assistant. Reply briefly to small talk.
Do not invent document facts. Invite a document question if useful.`;
    }

    const stream = createUIMessageStream({
      originalMessages: incomingMessages,
      generateId,
      execute: ({ writer }) => {
        // Evidence cards come from retrieval (no second LLM/tool round-trip).
        if (evidenceCards.length > 0) {
          writer.write({
            type: "data-evidence-cards",
            id: "evidence-1",
            data: { cards: evidenceCards },
          });
        }

        const result = streamText({
          model: getChatModel(),
          system,
          messages: modelMessages,
          // Single generation step - much faster than tool loops.
          maxOutputTokens: shouldRetrieve ? 700 : 180,
          temperature: shouldRetrieve ? 0.2 : 0.5,
        });

        writer.merge(result.toUIMessageStream());
      },
      onFinish: async ({ responseMessage }) => {
        try {
          const id = responseMessage.id?.trim() || generateId();
          await db
            .insert(messages)
            .values({
              id,
              chatId,
              role: "assistant",
              parts: responseMessage.parts,
            })
            .onConflictDoNothing();

          await db
            .update(chats)
            .set({ updatedAt: new Date() })
            .where(eq(chats.id, chatId));
        } catch (error) {
          console.error(
            "[api/chat] failed to persist assistant message",
            error,
          );
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    const message = formatError(error);
    console.error("[api/chat]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

function cardsFromChunks(chunks: RetrievedChunk[]) {
  return chunks.slice(0, 3).map((chunk, index) => {
    const excerpt =
      chunk.content.length > 280
        ? `${chunk.content.slice(0, 280).trim()}…`
        : chunk.content;

    return {
      citationIndex: index + 1,
      filename: chunk.filename,
      page: chunk.pageNumber,
      section: chunk.section,
      excerpt,
      relevance:
        chunk.similarity >= 0.45
          ? ("high" as const)
          : chunk.similarity >= 0.3
            ? ("medium" as const)
            : ("low" as const),
      similarity: chunk.similarity,
    };
  });
}

function extractUploadedDoc(message?: UIMessage): UploadedDocMeta | null {
  if (!message?.parts) return null;
  for (const part of message.parts) {
    if (part.type !== "data-document-upload") continue;
    const data = (part as { data?: UploadedDocMeta }).data;
    if (data?.filename) return data;
  }
  return null;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return "Chat request failed";
  const cause =
    error.cause instanceof Error
      ? error.cause.message
      : typeof error.cause === "string"
        ? error.cause
        : null;
  return cause ? `${error.message} (${cause})` : error.message;
}
