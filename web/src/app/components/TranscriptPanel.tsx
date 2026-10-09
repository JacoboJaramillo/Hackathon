"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "./useVoiceSession";
import { EMOTION_TEXT, speakerName, toneClass } from "./labels";

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const EXAMPLES = [
  "Necesito vacunar a mi hija en Bello.",
  "¿Dónde hay urgencias en Soacha?",
  "Busco odontología en Pasto.",
];

export default function TranscriptPanel({ turns }: { turns: Turn[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  return (
    <section
      aria-labelledby="transcript-title"
      className="flex min-h-80 flex-col rounded-[var(--radius-panel)] border border-line bg-surface lg:min-h-[28rem]"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <h2 id="transcript-title" className="text-lg font-semibold tracking-tight">
          Conversación
        </h2>
        <p className="text-sm text-muted">Transcripción en vivo, por hablante</p>
      </div>

      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-5 py-8 sm:px-6">
          <p className="max-w-md text-[15px] leading-relaxed">
            Aquí verás lo que digamos, con la hora y quién habló. Puedes empezar con algo como:
          </p>
          <ul className="mt-4 space-y-2 border-l border-line-strong pl-4 text-[15px] text-muted">
            {EXAMPLES.map((e) => (
              <li key={e}>&laquo;{e}&raquo;</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol
        ref={listRef}
        aria-live="polite"
        className={`max-h-[32rem] overflow-y-auto px-5 sm:px-6 ${turns.length ? "flex-1 py-2" : ""}`}
      >
        {turns.map((t) => {
          const agent = t.speaker === null;
          return (
            <li
              key={t.id}
              className="rise-in grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 border-b border-line py-4 last:border-b-0"
            >
              <span className="pt-0.5 text-[13px] tabular-nums text-muted">{clock(t.at)}</span>
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-sm font-semibold ${agent ? "text-accent-ink" : "text-foreground"}`}>
                    {speakerName(t.speaker)}
                  </span>
                  {t.sentiment && (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${toneClass(t.sentiment.sentimiento)}`}>
                      {EMOTION_TEXT[t.sentiment.emocion] ?? t.sentiment.emocion}
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-[15px] leading-relaxed break-words ${agent ? "text-foreground" : "text-foreground/90"}`}>
                  {t.text}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
