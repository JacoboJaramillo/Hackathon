"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Status } from "./useVoiceSession";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Lista para hablar",
  permission: "Esperando el micrófono",
  connecting: "Conectando...",
  listening: "Te escucho",
  thinking: "Pensando...",
  speaking: "Hablando",
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
  const orbRef = useRef<HTMLDivElement>(null);
  // The server-rendered button is inert until React hydrates; a click before
  // that would be lost silently, so it stays disabled until then.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Drives the orb from the live audio level without re-rendering React.
  useEffect(() => {
    let frame = 0;
    let level = 0;
    const tick = () => {
      const target = levelRef.current?.() ?? 0;
      level += (target - level) * (target > level ? 0.5 : 0.12);
      orbRef.current?.style.setProperty("--level", level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [levelRef]);

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
      className="stage relative flex h-full flex-col items-center overflow-hidden rounded-3xl border border-border bg-card px-5 pb-6 pt-8 text-center sm:px-8"
    >
      <div ref={orbRef} className="orb" data-state={status} aria-hidden="true">
        <div className="orb-glow" />
        <div className="orb-body">
          <div className="orb-blob orb-blob-a" />
          <div className="orb-blob orb-blob-b" />
          <div className="orb-blob orb-blob-c" />
        </div>
        <div className="orb-shine" />
      </div>

      <h2 id="gabriela-title" className="mt-6 text-2xl font-semibold tracking-tight">
        Gabriela
      </h2>
      <p aria-live="polite" className="mt-1 text-sm font-medium text-accent">
        {STATUS_TEXT[status]}
      </p>
      <p className="mt-3 max-w-sm text-sm text-muted">
        {hasDocument
          ? "Pregúntame por tu documento o dime qué necesitas y en qué municipio estás."
          : "Dime qué necesitas y en qué municipio estás. Si tienes un documento, súbelo y te lo explico."}
      </p>

      <button
        type="button"
        onClick={() => (active ? onStop() : onStart())}
        disabled={!hydrated}
        className={`mt-5 w-full max-w-xs rounded-full px-6 py-3 font-semibold text-white shadow-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
          active ? "bg-danger" : "bg-accent hover:brightness-110"
        }`}
      >
        {label}
      </button>

      {status === "permission" && (
        <p className="mt-3 max-w-sm text-sm font-medium">
          Tu navegador te pide permiso para usar el micrófono: pulsa Permitir en el aviso junto a la barra de direcciones.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 max-w-sm text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">Usa audífonos para que Gabriela no se escuche a sí misma.</p>
    </section>
  );
}
