import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { extractFromBuffer } from "@/lib/documents/extract";
import { estimateTokens } from "@/lib/documents/chunking";
import { embedTexts } from "@/lib/ai/embeddings";

export async function processDocument(documentId: string, buffer: Buffer) {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new Error("Document not found");
  }

  try {
    const textChunks = await extractFromBuffer(
      buffer,
      doc.filename,
      doc.mimeType,
    );

    if (textChunks.length === 0) {
      throw new Error("No extractable text found in this file.");
    }

    const embeddings = await embedTexts(textChunks.map((c) => c.content));

    await db.insert(chunks).values(
      textChunks.map((chunk, index) => ({
        documentId: doc.id,
        chatId: doc.chatId,
        content: chunk.content,
        chunkIndex: index,
        pageNumber: chunk.pageNumber ?? null,
        section: chunk.section ?? null,
        tokenEstimate: estimateTokens(chunk.content),
        embedding: embeddings[index],
      })),
    );

    await db
      .update(documents)
      .set({ status: "ready", errorMessage: null })
      .where(eq(documents.id, documentId));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process document";
    await db
      .update(documents)
      .set({ status: "error", errorMessage: message })
      .where(eq(documents.id, documentId));
    throw error;
  }
}
