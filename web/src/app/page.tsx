"use client";

import { useState } from "react";
import DocumentUpload, { type ReadyDocument } from "./components/DocumentUpload";

export default function Home() {
  // The voice step will read documentId to open /ws/agent?doc=<documentId>.
  const [doc, setDoc] = useState<ReadyDocument | null>(null);

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

        {/* Voice panel goes here in the next step; it receives doc?.documentId. */}
        <section
          aria-labelledby="voice-title"
          className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center"
        >
          <h2 id="voice-title" className="font-medium text-muted">
            La conversación por voz aparece aquí
          </h2>
          {doc && <p className="mt-2 text-sm text-muted">Tu documento está listo.</p>}
        </section>
      </div>
    </main>
  );
}
