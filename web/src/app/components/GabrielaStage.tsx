"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Status } from "./useVoiceSession";
import Waveform from "./Waveform";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Disponible",
  permission: "Esperando el micrófono",
  connecting: "Conectando",
  listening: "Te escucho",
  thinking: "Buscando",
  speaking: "Gabriela habla",
};

export default function GabrielaStage({
  status,
  error,
  hasDocument,
  levelRef,
  onStart,
  onStop,
}: {
  status: Status;
  error: string | null;
  hasDocument: boolean;
  levelRef: RefObject<() => number>;
  onStart: () => void;
  onStop: () => void;
}) {
  // The server-rendered button is inert until React hydrates; a click before
  // that would be lost silently, so it stays disabled until then.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const active = status !== "idle";
  const label = !hydrated
    ? "Cargando..."
    : status === "permission"
      ? "Cancelar"
      : active
        ? "Terminar conversación"
        : "Hablar con Gabriela";

  return (
    <section
      aria-labelledby="gabriela-title"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="gabriela-title" className="text-lg font-semibold tracking-tight">
          Gabriela
        </h2>
        <p
          aria-live="polite"
          className={`text-sm font-medium ${active ? "text-accent-ink" : "text-muted"}`}
        >
          {STATUS_TEXT[status]}
        </p>
      </div>

      <div className="mt-5">
        <Waveform status={status} levelRef={levelRef} />
      </div>

      <p className="mt-5 text-[15px] leading-relaxed text-foreground">
        {hasDocument
          ? "Pregúntame por tu documento, o dime qué atención necesitas y en qué municipio estás."
          : "Dime qué atención necesitas y en qué municipio estás. Te digo qué sedes hay cerca."}
      </p>

      <button
        type="button"
        onClick={() => (active ? onStop() : onStart())}
        disabled={!hydrated}
        className={`mt-5 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[var(--radius-control)] px-5 text-[15px] font-semibold transition-colors duration-150 disabled:cursor-wait disabled:opacity-60 ${
          active
            ? "border border-line-strong bg-surface-2 text-foreground hover:border-danger hover:text-danger"
            : "bg-accent text-on-accent hover:brightness-105 active:brightness-95"
        }`}
      >
        {active && status !== "permission" ? <StopIcon /> : status === "permission" ? null : <MicIcon />}
        {label}
      </button>

      {status === "permission" && (
        <p className="mt-3 text-sm leading-relaxed">
          Tu navegador te pide permiso para usar el micrófono. Pulsa Permitir en el aviso junto a la barra de direcciones.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">
          {error}
        </p>
      )}

      <p className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-muted">
        <HeadphonesIcon />
        Usa audífonos para que Gabriela no se escuche a sí misma.
      </p>
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg className="mt-px shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="7" rx="1.5" />
      <rect x="17" y="14" width="4" height="7" rx="1.5" />
    </svg>
  );
}
