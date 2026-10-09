"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Protocol: docs/api/websocket-protocol.md. Microphone goes up as 16 kHz PCM,
// agent audio comes down as 24 kHz PCM.
const IN_RATE = 16000;
const OUT_RATE = 24000;

export type Status = "idle" | "permission" | "connecting" | "listening" | "thinking" | "speaking";

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

export type Sentiment = {
  sentimiento: "positivo" | "neutral" | "negativo";
  emocion: string;
  intensidad: number;
};

// speaker: Deepgram speaker index for people, null for Gabriela.
export type Turn = {
  id: string;
  speaker: number | null;
  text: string;
  at: number;
  sentiment?: Sentiment;
};

type Message = {
  type?: string;
  role?: string;
  content?: string;
  message?: string;
  result?: SedesResult;
  id?: string;
  speaker?: number;
  text?: string;
  start?: number;
} & Partial<Sentiment>;

function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function useVoiceSession(documentId: string | null, onSedes: (r: SedesResult) => void) {
  const [status, setStatus] = useState<Status>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  // Read by the orb animation every frame; returns 0..1.
  const levelRef = useRef<() => number>(() => 0);
  const askRef = useRef<((text: string) => void) | null>(null);
  // A question tapped before the session is ready waits for SettingsApplied.
  const pendingAskRef = useRef<string | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(async () => {
    setError(null);
    setTurns([]);
    setStatus("permission");
    cancelledRef.current = false;
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
    } catch (e) {
      void mic.close();
      void out.close();
      pendingAskRef.current = null;
      if (cancelledRef.current) return;
      setStatus("idle");
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "El micrófono está bloqueado para esta página. Pulsa el ícono a la izquierda de la dirección, en Micrófono elige Permitir y vuelve a pulsar Hablar."
          : name === "NotFoundError"
            ? "No encontré un micrófono conectado."
            : "No pude abrir el micrófono. Intenta de nuevo.",
      );
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      void mic.close();
      void out.close();
      return;
    }
    setStatus("connecting");

    const node = new AudioWorkletNode(mic, "pcm-capture");
    const source = mic.createMediaStreamSource(stream);
    source.connect(node);
    const micAnalyser = mic.createAnalyser();
    micAnalyser.fftSize = 512;
    source.connect(micAnalyser);
    const outAnalyser = out.createAnalyser();
    outAnalyser.fftSize = 512;
    outAnalyser.connect(out.destination);
    const micBuf = new Float32Array(micAnalyser.fftSize);
    const outBuf = new Float32Array(outAnalyser.fftSize);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const query = documentId ? `?doc=${encodeURIComponent(documentId)}` : "";
    const ws = new WebSocket(`${proto}://${location.host}/ws/agent${query}`);
    ws.binaryType = "arraybuffer";
    let ready = false;
    const askedTexts = new Set<string>();
    const sendAsk = (text: string) => {
      ws.send(JSON.stringify({ type: "AskText", text }));
      askedTexts.add(text);
      const turn: Turn = { id: `q${Date.now()}`, speaker: -1, text, at: (Date.now() - started) / 1000 };
      setTurns((t) => [...t, turn]);
    };
    askRef.current = (text) => {
      if (ws.readyState === WebSocket.OPEN && ready) sendAsk(text);
      else pendingAskRef.current = text;
    };

    const started = Date.now();
    const playing = new Set<AudioBufferSourceNode>();
    let nextAt = 0;
    let opened = false;
    let userStopped = false;
    let diarized = false;
    let agentTurns = 0;

    levelRef.current = () =>
      Math.min(1, (playing.size ? rms(outAnalyser, outBuf) : rms(micAnalyser, micBuf)) * 4);

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
      src.connect(outAnalyser);
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
      levelRef.current = () => 0;
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void mic.close();
      void out.close();
      stopRef.current = null;
      askRef.current = null;
      pendingAskRef.current = null;
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
      let m: Message;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      const at = (Date.now() - started) / 1000;
      switch (m.type) {
        case "ConversationText":
          if (!m.content) break;
          if (m.role === "assistant") {
            const turn: Turn = { id: `a${agentTurns++}`, speaker: null, text: m.content, at };
            setTurns((t) => [...t, turn]);
          } else if (m.role === "user" && !diarized && !askedTexts.delete(m.content)) {
            // Fallback until the diarized stream delivers its first turn.
            const turn: Turn = { id: `u${at}`, speaker: 0, text: m.content, at };
            setTurns((t) => [...t, turn]);
          }
          break;
        case "Transcript":
          if (m.id && m.text && typeof m.speaker === "number") {
            const turn: Turn = { id: m.id, speaker: m.speaker, text: m.text, at: m.start ?? at };
            const first = !diarized;
            diarized = true;
            setTurns((t) => [...(first ? t.filter((x) => !x.id.startsWith("u")) : t), turn].sort((a, b) => a.at - b.at));
          }
          break;
        case "Sentiment":
          if (m.id && m.sentimiento && m.emocion && typeof m.intensidad === "number") {
            const sentiment: Sentiment = { sentimiento: m.sentimiento, emocion: m.emocion, intensidad: m.intensidad };
            setTurns((t) => t.map((x) => (x.id === m.id ? { ...x, sentiment } : x)));
          }
          break;
        case "SettingsApplied":
          ready = true;
          if (pendingAskRef.current) {
            sendAsk(pendingAskRef.current);
            pendingAskRef.current = null;
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
  }, [documentId, onSedes]);

  const ask = useCallback(
    (text: string) => {
      if (askRef.current) return askRef.current(text);
      pendingAskRef.current = text;
      void start();
    },
    [start],
  );

  const stop = useCallback(() => {
    if (stopRef.current) return stopRef.current();
    // Still waiting for the permission prompt: abandon this attempt.
    cancelledRef.current = true;
    setStatus("idle");
  }, []);

  return { status, turns, error, start, stop, ask, levelRef };
}
