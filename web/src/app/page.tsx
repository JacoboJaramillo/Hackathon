"use client";

import { useState } from "react";
import DocumentUpload, { type ReadyDocument } from "./components/DocumentUpload";
import GabrielaStage from "./components/GabrielaStage";
import TranscriptPanel from "./components/TranscriptPanel";
import SentimentPanel from "./components/SentimentPanel";
import SedesPanel from "./components/SedesPanel";
import { useVoiceSession, type SedesResult } from "./components/useVoiceSession";

export default function Home() {
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [sedes, setSedes] = useState<SedesResult | null>(null);
  const voice = useVoiceSession(doc?.documentId ?? null, setSedes);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">¿Dónde me atienden?</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Habla con Gabriela y encuentra dónde atenderte
          </h1>
        </div>
        <p className="rounded-full border border-danger px-4 py-1.5 text-sm font-semibold text-danger">
          Si es una emergencia, llama al 123
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <GabrielaStage
            status={voice.status}
            error={voice.error}
            hasDocument={!!doc}
            levelRef={voice.levelRef}
            onStart={() => void voice.start()}
            onStop={voice.stop}
          />
        </div>
        <div className="lg:col-span-3">
          <TranscriptPanel turns={voice.turns} />
        </div>
        <div className="lg:col-span-2">
          <DocumentUpload onReady={setDoc} onAsk={voice.ask} />
        </div>
        <div className="lg:col-span-3">
          <SentimentPanel turns={voice.turns} />
        </div>
      </div>

      {sedes && <SedesPanel result={sedes} />}

      <footer className="mt-10 text-center text-xs text-muted">
        Sedes del Registro Especial de Prestadores de Servicios de Salud, consultado en vivo en datos.gov.co. Gabriela no
        da diagnósticos; ante una emergencia, llama al 123.
      </footer>
    </main>
  );
}
