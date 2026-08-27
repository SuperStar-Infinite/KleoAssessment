"use client";

import { useState } from "react";

export type EvidenceCard = {
  citationIndex: number;
  filename: string;
  page?: number | null;
  section?: string | null;
  excerpt: string;
  relevance: "high" | "medium" | "low";
  similarity?: number | null;
};

const relevanceTone: Record<EvidenceCard["relevance"], string> = {
  high: "bg-emerald-50 text-emerald-800 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-stone-50 text-stone-600 border-stone-200",
};

export function EvidenceCards({ cards }: { cards: EvidenceCard[] }) {
  const [openId, setOpenId] = useState<number | null>(cards[0]?.citationIndex ?? null);

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        Evidence
      </p>
      {cards.map((card) => {
        const open = openId === card.citationIndex;
        const location = [
          card.filename,
          card.page ? `p.${card.page}` : null,
          card.section ? card.section : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            key={card.citationIndex}
            className="overflow-hidden rounded-lg border border-stone-200 bg-white"
          >
            <button
              type="button"
              onClick={() =>
                setOpenId(open ? null : card.citationIndex)
              }
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-stone-900">
                  [{card.citationIndex}] {location}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${relevanceTone[card.relevance]}`}
              >
                {card.relevance}
              </span>
            </button>
            {open ? (
              <div className="border-t border-stone-100 bg-stone-50 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                  {card.excerpt}
                </p>
                {typeof card.similarity === "number" ? (
                  <p className="mt-2 text-xs text-stone-500">
                    Retrieval score: {(card.similarity * 100).toFixed(1)}%
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
