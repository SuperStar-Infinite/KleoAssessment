import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chats, documents } from "@/lib/db/schema";
import { processDocument } from "@/lib/documents/process";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".txt", ".md", ".markdown"];

function isAllowed(filename: string, mimeType: string) {
  const lower = filename.toLowerCase();
  const byExt = ALLOWED_EXT.some((ext) => lower.endsWith(ext));
  const byMime = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/octet-stream",
  ].includes(mimeType);
  return byExt && byMime;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const chatId = String(form.get("chatId") ?? "");
    const file = form.get("file");

    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max size is 8MB." },
        { status: 400 },
      );
    }
    if (!isAllowed(file.name, file.type || "application/octet-stream")) {
      return NextResponse.json(
        { error: "Only PDF, TXT, and Markdown files are supported." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [chat] = await db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || guessMime(file.name);

    const [doc] = await db
      .insert(documents)
      .values({
        chatId,
        filename: file.name,
        mimeType,
        byteSize: file.size,
        status: "processing",
      })
      .returning();

    // Process inline for Hobby simplicity (keeps state consistent without a queue).
    try {
      await processDocument(doc.id, buffer);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Processing failed";
      return NextResponse.json(
        {
          document: { ...doc, status: "error", errorMessage: message },
          error: message,
        },
        { status: 422 },
      );
    }

    const [ready] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    await db
      .update(chats)
      .set({
        title:
          chat.title === "New chat"
            ? `Chat: ${file.name}`
            : chat.title,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId));

    return NextResponse.json({ document: ready });
  } catch (error) {
    const message = formatError(error, "Upload failed");
    console.error("[api/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  return "text/plain";
}

function formatError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const cause =
    error.cause instanceof Error
      ? error.cause.message
      : typeof error.cause === "string"
        ? error.cause
        : null;
  return cause ? `${error.message} (${cause})` : error.message;
}
