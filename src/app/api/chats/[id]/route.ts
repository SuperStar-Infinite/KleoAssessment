import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chats, documents, messages } from "@/lib/db/schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const db = getDb();

    const [chat] = await db.select().from(chats).where(eq(chats.id, id)).limit(1);
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const chatMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, id))
      .orderBy(asc(messages.createdAt));

    const chatDocuments = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        status: documents.status,
        errorMessage: documents.errorMessage,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.chatId, id))
      .orderBy(asc(documents.createdAt));

    return NextResponse.json({
      chat,
      messages: chatMessages,
      documents: chatDocuments,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const db = getDb();

    const [deleted] = await db
      .delete(chats)
      .where(eq(chats.id, id))
      .returning({ id: chats.id });

    if (!deleted) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    // Cascades remove documents, chunks, and messages.
    return NextResponse.json({ ok: true, id: deleted.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete chat";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
