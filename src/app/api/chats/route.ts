import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chats } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(chats)
      .orderBy(desc(chats.updatedAt))
      .limit(50);
    return NextResponse.json({ chats: rows });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list chats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const db = getDb();
    const [chat] = await db
      .insert(chats)
      .values({ title: "New chat" })
      .returning();
    return NextResponse.json({ chat });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create chat";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
