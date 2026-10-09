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
}: {
  onReady: (doc: ReadyDocument) => void;
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
    <section aria-labelledby="upload-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id="upload-title" className="text-lg font-semibold">
        Tu documento
      </h2>
      <p className="mt-1 text-sm text-muted">Sube un PDF, DOCX o TXT de hasta 20 MB para que pueda explicártelo.</p>

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
        className={`mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
          dragging ? "border-accent bg-accent/10" : "border-border"
        }`}
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
        <span className="font-medium">
          {state.kind === "ready" ? "Cambiar documento" : "Elige un archivo o arrástralo aquí"}
        </span>
        <span className="mt-1 text-muted">.pdf, .docx o .txt</span>
      </label>

      <div aria-live="polite" className="mt-4 text-sm">
        {state.kind === "uploading" && <p>Leyendo tu documento...</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-danger p-3 text-danger">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && <Result doc={state.doc} />}
      </div>
    </section>
  );
}

function Result({ doc }: { doc: Created }) {
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
            <p className="mt-1">{doc.brief.resumen}</p>
          </div>
          <div>
            <h3 className="font-semibold">Puedes preguntarme</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {doc.brief.preguntas.map((q) => (
                <li key={q}>{q}</li>
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
