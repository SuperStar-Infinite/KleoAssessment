import { extractText, getDocumentProxy } from "unpdf";
import { chunkText, type TextChunk } from "./chunking";

export async function extractFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<TextChunk[]> {
  const lower = filename.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdf(buffer);
  }

  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    return chunkText(buffer.toString("utf8"));
  }

  throw new Error(
    "Unsupported file type. Please upload a PDF, TXT, or Markdown file.",
  );
}

async function extractPdf(buffer: Buffer): Promise<TextChunk[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];
  const chunks: TextChunk[] = [];

  pages.forEach((pageText, index) => {
    const cleaned = pageText.trim();
    if (!cleaned) return;
    chunks.push(
      ...chunkText(cleaned, {
        pageNumber: index + 1,
      }),
    );
  });

  if (chunks.length === 0) {
    throw new Error("No extractable text found in this PDF.");
  }

  // totalPages retained for future metadata; silence unused in strict builds
  void totalPages;
  return chunks;
}
