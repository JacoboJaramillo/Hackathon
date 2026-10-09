"use client";

import { useState } from "react";
import DocumentUpload, { type ReadyDocument } from "./components/DocumentUpload";
import GabrielaStage from "./components/GabrielaStage";
import TranscriptPanel from "./components/TranscriptPanel";
import SentimentPanel from "./components/SentimentPanel";
import SedesPanel, { PhoneIcon } from "./components/SedesPanel";
import { useVoiceSession, type SedesResult } from "./components/useVoiceSession";

export default function Home() {
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [sedes, setSedes] = useState<SedesResult | null>(null);
  const voice = useVoiceSession(doc?.documentId ?? null, setSedes);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Mark />
            <div>
              <h1 className="text-[17px] font-bold leading-tight tracking-tight">¿Dónde me atienden?</h1>
              <p className="text-[13px] leading-tight text-muted">Sedes de salud de tu municipio, según el registro oficial</p>
            </div>
          </div>
          <a
            href="tel:123"
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-danger/60 px-3.5 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger/10"
          >
            <PhoneIcon />
            Si es una emergencia, llama al 123
          </a>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8">
        <div className="lg:col-start-1 lg:row-start-1">
          <GabrielaStage
            status={voice.status}
            error={voice.error}
            hasDocument={!!doc}
            levelRef={voice.levelRef}
            onStart={() => void voice.start()}
            onStop={voice.stop}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <TranscriptPanel turns={voice.turns} />
          <SedesPanel result={sedes} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <DocumentUpload onReady={setDoc} onAsk={voice.ask} />
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <SentimentPanel turns={voice.turns} />
        </div>
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-[13px] leading-relaxed text-muted sm:px-6">
          Las sedes vienen del Registro Especial de Prestadores de Servicios de Salud, consultado en vivo en datos.gov.co.
          Gabriela orienta, no da diagnósticos ni confirma cobertura de tu EPS. Ante una emergencia, llama al 123.
        </p>
      </footer>
    </div>
  );
}

// Brand mark: three level bars, echoing the voice waveform.
function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <rect x="9" y="12" width="3" height="8" rx="1.5" className="fill-on-accent" />
      <rect x="14.5" y="8" width="3" height="16" rx="1.5" className="fill-on-accent" />
      <rect x="20" y="11" width="3" height="10" rx="1.5" className="fill-on-accent" />
    </svg>
  );
}
