/**
 * Skip embedding + pgvector retrieval for small talk / non-document turns.
 * Document questions still go through full RAG.
 */
export function needsDocumentRetrieval(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[!.?]+$/g, "");

  if (!normalized) return false;

  // Very short greetings / thanks
  const chitchatExact = new Set([
    "hi",
    "hello",
    "hey",
    "hiya",
    "yo",
    "sup",
    "thanks",
    "thank you",
    "thx",
    "ty",
    "ok",
    "okay",
    "cool",
    "great",
    "nice",
    "bye",
    "goodbye",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "how're you",
    "how's it going",
    "whats up",
    "what's up",
    "who are you",
    "what can you do",
    "help",
  ]);

  if (chitchatExact.has(normalized)) return false;

  // Short phrases that are clearly conversational
  if (
    /^(hi|hello|hey)\b.{0,40}$/.test(normalized) &&
    !/\b(document|file|pdf|letter|resume|page|section|content)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  return true;
}
