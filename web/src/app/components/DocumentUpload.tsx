"use client";

import { useState } from "react";

export type Brief = { resumen: string; preguntas: string[] };
export type ReadyDocument = {
  documentId: string;
  tipo: string;
  brief: Brief | null;
};
type Created = ReadyDocument & { caracteres: number; truncado: boolean };
type ErrorBody = { error: string; mensaje: string };

const MAX_BYTES = 20 * 1024 * 1024;
const GENERIC_ERROR = "No pude leer tu documento. Intenta de nuevo en un momento.";

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "ready"; doc: Created }
  | { kind: "error"; message: string };

export default function DocumentUpload({
  onReady,
  onAsk,
}: {
  onReady: (doc: ReadyDocument) => void;
  onAsk: (question: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "El archivo supera los 20 MB. Prueba con uno más liviano." });
      return;
    }
    setState({ kind: "uploading" });
    try {
      const res = await fetch("/api/document", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok && body) {
        const doc = body as Created;
        setState({ kind: "ready", doc });
        onReady({ documentId: doc.documentId, tipo: doc.tipo, brief: doc.brief });
        return;
      }
      const mensaje = (body as Partial<ErrorBody> | null)?.mensaje;
      const fallback =
        res.status === 429 ? "Has enviado muchos documentos. Espera un minuto e intenta de nuevo." : GENERIC_ERROR;
      setState({ kind: "error", message: mensaje || fallback });
    } catch {
      setState({ kind: "error", message: "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo." });
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
  }

  const busy = state.kind === "uploading";

  return (
    <section aria-labelledby="upload-title" className="border-t border-line pt-5">
      <h2 id="upload-title" className="text-base font-semibold tracking-tight">
        Tu documento
      </h2>
      <p className="mt-1 text-sm text-muted">¿Te dieron una orden, un resultado o una carta? Súbela y Gabriela te la explica en palabras simples.</p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pick(e.dataTransfer.files);
        }}
        className={`mt-4 flex min-h-24 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-dashed px-4 py-3 text-sm transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ink ${
          dragging ? "border-accent-ink bg-accent/10" : "border-line-strong hover:border-accent-ink"
        } ${busy ? "cursor-wait opacity-70" : ""}`}
      >
        <input
          type="file"
          accept=".pdf,.docx,.txt"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <FileIcon />
        <span className="flex flex-col">
          <span className="font-medium">
            {state.kind === "ready" ? "Cambiar documento" : "Elige un archivo o arrástralo aquí"}
          </span>
          <span className="mt-0.5 text-muted">PDF, DOCX o TXT, hasta 20 MB</span>
        </span>
      </label>

      <div aria-live="polite" className="mt-4 text-sm">
        {state.kind === "uploading" && <p className="text-muted">Leyendo tu documento...</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger/50 px-3 py-2.5 text-danger">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && <Result doc={state.doc} onAsk={onAsk} />}
      </div>
    </section>
  );
}

function Result({ doc, onAsk }: { doc: Created; onAsk: (question: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-muted">
        Documento leído ({doc.tipo.toUpperCase()}).
        {doc.truncado && " Tu documento es largo; el agente solo leerá la primera parte."}
      </p>
      {doc.brief ? (
        <>
          <div>
            <h3 className="font-semibold">Resumen</h3>
            <p className="mt-1 leading-relaxed">{doc.brief.resumen}</p>
          </div>
          <div>
            <h3 className="font-semibold">Pregúntale a Gabriela</h3>
            <p className="text-xs text-muted">Toca una pregunta o dila en voz alta.</p>
            <ul className="mt-2 flex flex-col gap-2">
              {doc.brief.preguntas.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => onAsk(q)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-left transition-colors duration-150 hover:border-accent-ink hover:text-accent-ink"
                  >
                    <span>{q}</span>
                    <AskIcon />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p>No pude preparar el resumen, pero ya puedes preguntarme por tu documento.</p>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg className="shrink-0 text-muted" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg className="shrink-0 opacity-60" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
