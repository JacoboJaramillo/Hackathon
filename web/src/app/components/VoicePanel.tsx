"use client";

import { useEffect, useRef, useState } from "react";

// Protocol: docs/api/websocket-protocol.md. Microphone goes up as 16 kHz PCM,
// agent audio comes down as 24 kHz PCM.
const IN_RATE = 16000;
const OUT_RATE = 24000;

type Status = "idle" | "connecting" | "listening" | "thinking" | "speaking";
type Line = { role: "user" | "assistant"; content: string; at: number };

export type Sede = {
  sede: string | null;
  prestador: string | null;
  direccion: string | null;
  telefono: string | null;
  naturaleza: string | null;
  nivel: number | null;
  capacidades: { tipo: string; cantidad: number }[];
};
export type SedesResult = {
  alcance?: "municipio" | "departamento";
  municipio?: string;
  departamento?: string;
  necesidad?: string;
  total_sedes?: number;
  sedes?: Sede[];
  error?: string;
  sugerencias?: string[];
};

const STATUS_TEXT: Record<Status, string> = {
  idle: "Listo para hablar",
  connecting: "Conectando...",
  listening: "Te escucho",
  thinking: "Pensando...",
  speaking: "Hablando",
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function VoicePanel({
  documentId,
  onSedes,
}: {
  documentId: string | null;
  onSedes: (result: SedesResult) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  async function start() {
    setError(null);
    setLines([]);
    setStatus("connecting");
    // Both contexts are created inside the click so the browser lets them play.
    // ponytail: a 16 kHz context fed by the mic works in Chrome and Edge; Firefox
    // needs an in-worklet resampler if it must be supported.
    const mic = new AudioContext({ sampleRate: IN_RATE });
    const out = new AudioContext({ sampleRate: OUT_RATE });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      await mic.audioWorklet.addModule("/pcm-capture.js");
    } catch {
      void mic.close();
      void out.close();
      setStatus("idle");
      setError("Necesito permiso para usar tu micrófono. Actívalo en el navegador e intenta de nuevo.");
      return;
    }

    const node = new AudioWorkletNode(mic, "pcm-capture");
    mic.createMediaStreamSource(stream).connect(node);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const query = documentId ? `?doc=${encodeURIComponent(documentId)}` : "";
    const ws = new WebSocket(`${proto}://${location.host}/ws/agent${query}`);
    ws.binaryType = "arraybuffer";

    const started = Date.now();
    const playing = new Set<AudioBufferSourceNode>();
    let nextAt = 0;
    let opened = false;
    let userStopped = false;

    // Barge-in: drop whatever agent audio is still queued.
    const flush = () => {
      for (const s of playing) s.stop();
      playing.clear();
      nextAt = 0;
    };

    const play = (data: ArrayBuffer) => {
      const pcm = new Int16Array(data, 0, data.byteLength >> 1);
      if (!pcm.length) return;
      const buffer = out.createBuffer(1, pcm.length, OUT_RATE);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
      const src = out.createBufferSource();
      src.buffer = buffer;
      src.connect(out.destination);
      nextAt = Math.max(nextAt, out.currentTime + 0.05);
      src.start(nextAt);
      nextAt += buffer.duration;
      playing.add(src);
      src.onended = () => {
        playing.delete(src);
        if (!playing.size) setStatus((s) => (s === "speaking" ? "listening" : s));
      };
    };

    const release = () => {
      flush();
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void mic.close();
      void out.close();
      stopRef.current = null;
    };

    stopRef.current = () => {
      userStopped = true;
      ws.close(1000);
      release();
      setStatus("idle");
    };

    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    ws.onopen = () => {
      opened = true;
      setStatus("listening");
    };

    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (typeof e.data !== "string") return play(e.data);
      let m: { type?: string; role?: string; content?: string; message?: string; result?: SedesResult };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (m.type) {
        case "ConversationText":
          if ((m.role === "user" || m.role === "assistant") && m.content) {
            const line = { role: m.role, content: m.content, at: Date.now() - started } as Line;
            setLines((l) => [...l, line]);
          }
          break;
        case "UserStartedSpeaking":
          flush();
          setStatus("listening");
          break;
        case "AgentThinking":
          setStatus("thinking");
          break;
        case "AgentStartedSpeaking":
          setStatus("speaking");
          break;
        case "ToolResult":
          if (m.result) onSedes(m.result);
          break;
        case "Error":
          setError(m.message || "El servicio de voz tuvo un problema. Intenta de nuevo.");
          break;
      }
    };

    ws.onclose = (e) => {
      if (userStopped) return;
      release();
      setStatus("idle");
      if (!opened) {
        setError(
          documentId
            ? "No pude conectar. Si subiste el documento hace más de 30 minutos, súbelo de nuevo; si no, espera un minuto e intenta otra vez."
            : "No pude conectar. Espera un minuto e intenta otra vez.",
        );
      } else if (e.code === 4000) {
        setError("La conversación llegó a su límite de 10 minutos. Puedes empezar otra.");
      } else {
        setError("Se cortó la conversación. Pulsa Hablar para reconectar.");
      }
    };
  }

  const active = status !== "idle";

  return (
    <section aria-labelledby="voice-title" className="flex flex-col rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="voice-title" className="text-lg font-semibold">
          Conversación
        </h2>
        <span
          aria-live="polite"
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            active ? "bg-accent/15 text-accent" : "text-muted"
          }`}
        >
          {STATUS_TEXT[status]}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {documentId
          ? "Pregúntame por tu documento o dime qué necesitas y en qué municipio estás."
          : "Dime qué necesitas y en qué municipio estás. También puedes subir un documento."}
      </p>

      <button
        type="button"
        onClick={() => (active ? stopRef.current?.() : void start())}
        disabled={status === "connecting"}
        className={`mt-4 rounded-xl px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
          active ? "bg-danger" : "bg-accent"
        }`}
      >
        {active ? "Terminar" : "Hablar"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <h3 className="mt-5 text-sm font-semibold">Transcripción</h3>
      <ol ref={logRef} aria-live="polite" className="mt-2 max-h-80 min-h-24 space-y-2 overflow-y-auto text-sm">
        {lines.length === 0 && <li className="text-muted">Aquí aparece lo que digamos.</li>}
        {lines.map((l, i) => (
          <li key={i} className={l.role === "user" ? "text-foreground" : "text-accent"}>
            <span className="font-mono text-xs text-muted">{clock(l.at)}</span>{" "}
            <span className="font-semibold">{l.role === "user" ? "Tú" : "Agente"}:</span> {l.content}
          </li>
        ))}
      </ol>
    </section>
  );
}
