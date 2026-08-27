import { openai } from "@ai-sdk/openai";

export function getChatModel() {
  return openai(process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini");
}
