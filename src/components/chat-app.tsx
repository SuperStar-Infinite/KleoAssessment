"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { EvidenceCards, type EvidenceCard } from "@/components/evidence-cards";

type ChatDoc = {
  id: string;
  filename: string;
  status: string;
  errorMessage: string | null;
};

type ChatSummary = {
  id: string;
  title: string;
};

type CachedChat = {
  messages: UIMessage[];
  documents: ChatDoc[];
};

export function ChatApp() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [documents, setDocuments] = useState<ChatDoc[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [switchingChat, setSwitchingChat] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, CachedChat>>(new Map());
  const statusRef = useRef<string>("ready");
  chatIdRef.current = chatId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id, body }) => ({
          body: {
            ...(body ?? {}),
            id,
            messages,
            chatId: chatIdRef.current,
          },
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: chatId ?? "pending",
    transport,
  });
  statusRef.current = status;

  const isStreaming = status === "streaming" || status === "submitted";
  const busy = isStreaming || uploading || switchingChat;

  const applyChatState = useCallback(
    (id: string, nextMessages: UIMessage[], nextDocuments: ChatDoc[]) => {
      cacheRef.current.set(id, {
        messages: nextMessages,
        documents: nextDocuments,
      });
      setChatId(id);
      setDocuments(nextDocuments);
      setMessages(nextMessages);
      setPendingFile(null);
      setUploadError(null);
      setNavError(null);
      setInput("");
    },
    [setMessages],
  );

  const refreshChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load chats");
    setChats(data.chats ?? []);
    return data.chats as ChatSummary[];
  }, []);

  const loadChat = useCallback(
    async (id: string, options?: { force?: boolean }) => {
      if (!options?.force && id === chatIdRef.current) return;

      const currentStatus = statusRef.current;
      if (currentStatus === "streaming" || currentStatus === "submitted") {
        stop();
      }

      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;

      // Instant selection feedback.
      setChatId(id);
      setPendingFile(null);
      setUploadError(null);
      setNavError(null);
      setInput("");

      const cached = cacheRef.current.get(id);
      if (cached && !options?.force) {
        startTransition(() => {
          setMessages(cached.messages);
          setDocuments(cached.documents);
        });
        setSwitchingChat(false);
      } else {
        setSwitchingChat(true);
        setMessages([]);
        setDocuments([]);
      }

      try {
        const res = await fetch(`/api/chats/${id}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load chat");
        if (controller.signal.aborted || chatIdRef.current !== id) return;

        applyChatState(
          id,
          (data.messages ?? []).map(toUiMessage),
          data.documents ?? [],
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNavError(
          err instanceof Error ? err.message : "Failed to switch chat",
        );
      } finally {
        if (!controller.signal.aborted && chatIdRef.current === id) {
          setSwitchingChat(false);
        }
      }
    },
    [applyChatState, setMessages, stop],
  );

  const createChat = useCallback(async () => {
    const currentStatus = statusRef.current;
    if (currentStatus === "streaming" || currentStatus === "submitted") {
      stop();
    }
    setSwitchingChat(true);
    setNavError(null);
    try {
      const res = await fetch("/api/chats", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create chat");

      const created = data.chat as ChatSummary;
      cacheRef.current.set(created.id, { messages: [], documents: [] });
      setChats((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      applyChatState(created.id, [], []);
      return created.id;
    } catch (err) {
      setNavError(err instanceof Error ? err.message : "Failed to create chat");
      return null;
    } finally {
      setSwitchingChat(false);
    }
  }, [applyChatState, stop]);

  const deleteChat = useCallback(
    async (id: string) => {
      const target = chats.find((c) => c.id === id);
      const label = target?.title || "this chat";
      if (
        !window.confirm(
          `Delete "${label}"?\nMessages and documents in this chat will be removed.`,
        )
      ) {
        return;
      }

      setDeletingId(id);
      setNavError(null);
      try {
        const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete chat");

        cacheRef.current.delete(id);
        const remaining = chats.filter((c) => c.id !== id);
        setChats(remaining);

        if (chatIdRef.current === id) {
          if (remaining.length > 0) {
            await loadChat(remaining[0].id, { force: true });
          } else {
            await createChat();
          }
        }
      } catch (err) {
        setNavError(
          err instanceof Error ? err.message : "Failed to delete chat",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [chats, createChat, loadChat],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBooting(true);
        setBootError(null);
        const list = await refreshChats();
        if (cancelled) return;
        if (list.length > 0) {
          await loadChat(list[0].id, { force: true });
        } else {
          await createChat();
        }
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof Error
              ? err.message
              : "Could not start the app. Check DATABASE_URL.",
          );
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      loadAbortRef.current?.abort();
    };
    // Boot once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep cache fresh while chatting in the active session.
  useEffect(() => {
    if (!chatId) return;
    cacheRef.current.set(chatId, { messages, documents });
  }, [chatId, messages, documents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, uploading]);

  function onPickFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setPendingFile(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadFile(file: File): Promise<ChatDoc> {
    if (!chatId) throw new Error("No active chat");
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Upload failed");
    }
    setDocuments((prev) => {
      const without = prev.filter((d) => d.id !== data.document.id);
      return [...without, data.document];
    });
    await refreshChats();
    return data.document as ChatDoc;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && !pendingFile) || !chatId || busy) return;

    setUploadError(null);
    const fileToSend = pendingFile;
    setInput("");
    setPendingFile(null);

    try {
      if (fileToSend) {
        setUploading(true);
        const doc = await uploadFile(fileToSend);
        setUploading(false);

        const messageText =
          text ||
          `I've uploaded "${doc.filename}". Please confirm it's ready and summarize what you can help with.`;

        await sendMessage({
          parts: [
            {
              type: "data-document-upload",
              data: {
                documentId: doc.id,
                filename: doc.filename,
                status: doc.status,
              },
            },
            { type: "text", text: messageText },
          ],
        });
      } else {
        await sendMessage({ text });
      }
    } catch (err) {
      setUploading(false);
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      if (fileToSend) setPendingFile(fileToSend);
      if (text) setInput(text);
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1e8] text-stone-700">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-700" />
          <p>Starting workspace…</p>
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1e8] px-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-stone-800 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-700">Setup needed</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            {bootError}
          </p>
          <p className="mt-3 text-sm text-stone-500">
            Set <code className="rounded bg-stone-100 px-1">DATABASE_URL</code>{" "}
            and{" "}
            <code className="rounded bg-stone-100 px-1">OPENAI_API_KEY</code>{" "}
            in <code className="rounded bg-stone-100 px-1">.env.local</code>,
            then run the SQL in{" "}
            <code className="rounded bg-stone-100 px-1">scripts/schema.sql</code>.
          </p>
        </div>
      </div>
    );
  }

  const readyDocs = documents.filter((d) => d.status === "ready");
  const processingDocs = documents.filter((d) => d.status === "processing");

  return (
    <div className="h-dvh overflow-hidden bg-[#f6f1e8] text-stone-900">
      <div className="flex h-full w-full">
        <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-stone-200/80 bg-[#efe8dc] p-4 md:flex">
          <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
            <h1 className="font-[family-name:var(--font-display)] text-xl tracking-tight text-teal-900">
              Kleo Docs
            </h1>
            <button
              type="button"
              onClick={() => void createChat()}
              disabled={switchingChat}
              className="rounded-lg bg-teal-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              New
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <ul className="space-y-1">
              {chats.map((c) => {
                const active = c.id === chatId;
                const deleting = deletingId === c.id;
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => void loadChat(c.id)}
                      disabled={deleting}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-9 text-left text-sm transition ${
                        active
                          ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-800/10"
                          : "text-stone-600 hover:bg-white/70 hover:text-stone-900"
                      } ${deleting ? "opacity-50" : ""}`}
                    >
                      {active && switchingChat ? (
                        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-teal-700" />
                      ) : (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            active ? "bg-teal-700" : "bg-transparent"
                          }`}
                        />
                      )}
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      title="Delete chat"
                      aria-label={`Delete ${c.title}`}
                      disabled={deleting}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteChat(c.id);
                      }}
                      className={`absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 transition hover:bg-rose-50 hover:text-rose-700 ${
                        active || deleting
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-stone-200/80 bg-[#f6f1e8]/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-[family-name:var(--font-display)] text-2xl text-teal-950">
                  Document chat
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  Attach a PDF, TXT, or Markdown file in the composer, then ask
                  grounded questions with citations.
                </p>
              </div>
              <div className="flex items-center gap-2 md:hidden">
                <label className="sr-only" htmlFor="mobile-chat-select">
                  Switch chat
                </label>
                <select
                  id="mobile-chat-select"
                  value={chatId ?? ""}
                  onChange={(e) => void loadChat(e.target.value)}
                  className="max-w-[10rem] truncate rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm"
                >
                  {chats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  onClick={() => void createChat()}
                >
                  New
                </button>
                {chatId ? (
                  <button
                    type="button"
                    className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700"
                    onClick={() => void deleteChat(chatId)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {documents.length === 0 ? (
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-stone-500">
                  No documents yet - attach one below
                </span>
              ) : null}
              {documents.map((doc) => (
                <span
                  key={doc.id}
                  className={`rounded-full px-3 py-1 text-xs ${
                    doc.status === "ready"
                      ? "bg-emerald-100 text-emerald-800"
                      : doc.status === "error"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                  title={doc.errorMessage ?? undefined}
                >
                  {doc.filename}
                  {doc.status !== "ready" ? ` · ${doc.status}` : ""}
                </span>
              ))}
            </div>
            {navError ? (
              <p className="mt-2 text-sm text-rose-700">{navError}</p>
            ) : null}
          </header>

          <div
            className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-6 transition-opacity md:px-8 ${
              switchingChat ? "opacity-60" : "opacity-100"
            }`}
          >
            {switchingChat && messages.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-teal-700" />
                Loading chat…
              </div>
            ) : null}

            {!switchingChat && messages.length === 0 ? (
              <EmptyState
                hasDocs={readyDocs.length > 0}
                processing={processingDocs.length > 0 || uploading}
              />
            ) : null}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {uploading ? (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" />
                Uploading and indexing document…
              </div>
            ) : null}

            {isStreaming ? (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-teal-700" />
                Thinking…
                <button
                  type="button"
                  onClick={() => stop()}
                  className="ml-2 underline"
                >
                  Stop
                </button>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error.message || "Something went wrong generating a reply."}
              </div>
            ) : null}

            {uploadError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {uploadError}
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={onSubmit}
            className="shrink-0 border-t border-stone-200/80 bg-[#f6f1e8] px-4 py-4 md:px-8"
          >
            <div className="mx-auto w-full max-w-4xl rounded-2xl border border-stone-300 bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-teal-700/30">
              {pendingFile ? (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  <span className="truncate font-medium">{pendingFile.name}</span>
                  <span className="shrink-0 text-xs text-stone-400">
                    {(pendingFile.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    className="ml-auto shrink-0 text-xs text-stone-500 underline hover:text-stone-800"
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  disabled={!chatId || busy}
                  onClick={() => fileRef.current?.click()}
                  title="Attach PDF, TXT, or Markdown"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-teal-800 disabled:opacity-40"
                  aria-label="Attach file"
                >
                  <PaperclipIcon />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSubmit(e);
                    }
                  }}
                  rows={1}
                  placeholder={
                    pendingFile
                      ? "Add a message about this file (optional)…"
                      : readyDocs.length === 0
                        ? "Attach a document or ask anything…"
                        : "Ask a question about your document…"
                  }
                  className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm outline-none"
                  disabled={!chatId || busy}
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !pendingFile) || !chatId || busy}
                  className="rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Send"}
                </button>
              </div>
            </div>
            <p className="mx-auto mt-2 w-full max-w-4xl text-center text-xs text-stone-500">
              Attach from the composer · PDF / TXT / Markdown · max 8MB
            </p>
          </form>
        </main>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileChipIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function EmptyState({
  hasDocs,
  processing,
}: {
  hasDocs: boolean;
  processing: boolean;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-stone-300 bg-white/70 px-6 py-10 text-center">
      <p className="font-[family-name:var(--font-display)] text-xl text-teal-950">
        {processing
          ? "Processing your document…"
          : hasDocs
            ? "Ask anything about the uploaded document"
            : "Attach a document in the chat input"}
      </p>
      <p className="mt-2 text-sm text-stone-600">
        Use the paperclip next to the message box - same flow as ChatGPT /
        Claude. Answers stream with citations and evidence cards.
      </p>
    </div>
  );
}

type DocumentUploadData = {
  documentId?: string;
  filename: string;
  status?: string;
};

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-800 text-white"
            : "border border-stone-200 bg-white text-stone-800 shadow-sm"
        }`}
      >
        {message.parts.map((part, index) => {
          if (part.type === "data-document-upload") {
            const data = (part as { data?: DocumentUploadData }).data;
            if (!data?.filename) return null;
            return (
              <div
                key={`${message.id}-file-${index}`}
                className={`mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  isUser
                    ? "bg-teal-950/40 text-teal-50"
                    : "border border-stone-200 bg-stone-50 text-stone-700"
                }`}
              >
                <span className="opacity-80" aria-hidden>
                  <FileChipIcon />
                </span>
                <span className="truncate font-medium">{data.filename}</span>
                {data.status === "ready" ? (
                  <span className="shrink-0 opacity-70">ready</span>
                ) : null}
              </div>
            );
          }

          if (part.type === "text") {
            return (
              <p
                key={`${message.id}-text-${index}`}
                className="whitespace-pre-wrap"
              >
                {part.text}
              </p>
            );
          }

          if (part.type === "data-evidence-cards") {
            const data = (part as { data?: { cards?: EvidenceCard[] } }).data;
            if (data?.cards?.length) {
              return (
                <EvidenceCards
                  key={`${message.id}-evidence-data-${index}`}
                  cards={data.cards}
                />
              );
            }
            return null;
          }

          if (part.type === "tool-showEvidenceCards") {
            const toolPart = part as unknown as {
              type: "tool-showEvidenceCards";
              state?: string;
              output?: { cards?: EvidenceCard[] };
            };
            if (
              toolPart.state === "output-available" &&
              toolPart.output?.cards?.length
            ) {
              return (
                <EvidenceCards
                  key={`${message.id}-evidence-${index}`}
                  cards={toolPart.output.cards}
                />
              );
            }
            return (
              <p
                key={`${message.id}-evidence-loading-${index}`}
                className="mt-2 text-xs text-stone-500"
              >
                Gathering evidence…
              </p>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

function toUiMessage(row: {
  id: string;
  role: string;
  parts: unknown;
}): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: (Array.isArray(row.parts) ? row.parts : []) as UIMessage["parts"],
  };
}
