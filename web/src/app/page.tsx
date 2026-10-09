"use client";

import { useState } from "react";
import DocumentUpload, { type ReadyDocument } from "./components/DocumentUpload";
import VoicePanel, { type SedesResult } from "./components/VoicePanel";
import SedesPanel from "./components/SedesPanel";

export default function Home() {
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [sedes, setSedes] = useState<SedesResult | null>(null);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">¿Dónde me atienden?</h1>
        <p className="mt-2 text-lg text-muted">
          Te digo dónde atenderte en tu municipio y te explico tu documento.
        </p>
        <p className="mt-3 inline-block rounded-lg border border-danger px-3 py-1 text-sm font-medium text-danger">
          Si es una emergencia, llama al 123.
        </p>
      </header>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <DocumentUpload onReady={setDoc} />

        <VoicePanel documentId={doc?.documentId ?? null} onSedes={setSedes} />
      </div>

      {sedes && <SedesPanel result={sedes} />}
    </main>
  );
}
