import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { embedQuery } from "@/lib/ai/embeddings";

export type RetrievedChunk = {
  id: string;
  content: string;
  filename: string;
  pageNumber: number | null;
  section: string | null;
  similarity: number;
};

export async function retrieveRelevantChunks(
  chatId: string,
  query: string,
  limit = 6,
): Promise<RetrievedChunk[]> {
  const db = getDb();
  const queryEmbedding = await embedQuery(query);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const result = await db.execute(sql`
    SELECT
      c.id,
      c.content,
      c.page_number AS "pageNumber",
      c.section,
      d.filename,
      1 - (c.embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM chunks c
    INNER JOIN documents d ON d.id = c.document_id
    WHERE c.chat_id = ${chatId}::uuid
      AND d.status = 'ready'
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  const rows = (
    Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    content: String(row.content),
    filename: String(row.filename),
    pageNumber:
      row.pageNumber === null || row.pageNumber === undefined
        ? null
        : Number(row.pageNumber),
    section:
      row.section === null || row.section === undefined
        ? null
        : String(row.section),
    similarity: Number(row.similarity),
  }));
}

export function formatContextForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "No document excerpts were retrieved for this question.";
  }

  return chunks
    .map((chunk, index) => {
      const location = [
        chunk.filename,
        chunk.pageNumber ? `page ${chunk.pageNumber}` : null,
        chunk.section ? `section "${chunk.section}"` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return `[${index + 1}] (${location})\n${chunk.content}`;
    })
    .join("\n\n");
}
