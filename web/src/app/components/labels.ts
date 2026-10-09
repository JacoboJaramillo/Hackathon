import type { Sentiment } from "./useVoiceSession";

// null is Gabriela; -1 is a question the person tapped instead of saying it.
export const speakerName = (speaker: number | null) =>
  speaker === null ? "Gabriela" : speaker < 0 ? "Tú (pregunta tocada)" : `Hablante ${speaker + 1}`;

export const EMOTION_TEXT: Record<string, string> = {
  calma: "Calma",
  alegria: "Alegría",
  preocupacion: "Preocupación",
  miedo: "Miedo",
  enojo: "Enojo",
  tristeza: "Tristeza",
  frustracion: "Frustración",
  urgencia: "Urgencia",
  confusion: "Confusión",
};

export const toneClass = (s: Sentiment["sentimiento"]) =>
  s === "positivo"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : s === "negativo"
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : "bg-slate-500/15 text-slate-700 dark:text-slate-300";
