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
    ? "bg-pos/12 text-pos ring-1 ring-inset ring-pos/25"
    : s === "negativo"
      ? "bg-neg/12 text-neg ring-1 ring-inset ring-neg/25"
      : "bg-neu/12 text-neu ring-1 ring-inset ring-neu/25";
