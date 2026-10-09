"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "./useVoiceSession";
import { EMOTION_TEXT, speakerName, toneClass } from "./labels";

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const SPEAKER_COLORS = ["text-sky-600 dark:text-sky-400", "text-amber-600 dark:text-amber-400", "text-emerald-600 dark:text-emerald-400"];

export default function TranscriptPanel({ turns }: { turns: Turn[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  return (
    <section aria-labelledby="transcript-title" className="flex h-full min-h-72 flex-col rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 id="transcript-title" className="text-lg font-semibold">
        Transcripción
      </h2>
      <p className="text-sm text-muted">En vivo, separada por quién habla.</p>
      <ol ref={listRef} aria-live="polite" className="mt-4 max-h-96 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
        {turns.length === 0 && <li className="text-muted">Aquí aparece lo que digamos.</li>}
        {turns.map((t) => (
          <li key={t.id} className={t.speaker === null ? "rounded-2xl bg-accent/10 p-3" : "p-3"}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`font-semibold ${
                  t.speaker === null ? "text-accent" : SPEAKER_COLORS[t.speaker % SPEAKER_COLORS.length]
                }`}
              >
                {speakerName(t.speaker)}
              </span>
              <span className="font-mono text-xs text-muted">{clock(t.at)}</span>
              {t.sentiment && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass(t.sentiment.sentimiento)}`}>
                  {EMOTION_TEXT[t.sentiment.emocion] ?? t.sentiment.emocion}
                </span>
              )}
            </div>
            <p className="mt-1 leading-relaxed">{t.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
