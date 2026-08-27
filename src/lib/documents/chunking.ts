export type TextChunk = {
  content: string;
  pageNumber?: number;
  section?: string;
};

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 200;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function detectSection(text: string): string | undefined {
  const heading = text.match(/^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 ,/&\-]{3,80})$/m);
  return heading?.[1]?.replace(/^#+\s*/, "").trim();
}

export function chunkText(
  text: string,
  options?: { pageNumber?: number },
): TextChunk[] {
  const paragraphs = splitParagraphs(text);
  const chunks: TextChunk[] = [];
  let buffer = "";
  let section: string | undefined;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({
      content,
      pageNumber: options?.pageNumber,
      section: section ?? detectSection(content),
    });
  };

  for (const paragraph of paragraphs) {
    const maybeHeading = detectSection(paragraph);
    if (maybeHeading && paragraph.length < 120) {
      section = maybeHeading;
    }

    if ((buffer + "\n\n" + paragraph).length > TARGET_CHARS && buffer) {
      flush();
      buffer = buffer.slice(-OVERLAP_CHARS) + "\n\n" + paragraph;
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }

  flush();
  return chunks;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
