import type { Sentiment, Turn } from "./useVoiceSession";
import { EMOTION_TEXT, speakerName, toneClass } from "./labels";

const valence = (s: Sentiment) =>
  (s.sentimiento === "positivo" ? 1 : s.sentimiento === "negativo" ? -1 : 0) * Math.max(0.3, s.intensidad);

// Trend line from -1 (negative) to 1 (positive), one point per scored turn.
function Trend({ points }: { points: number[] }) {
  const w = 280;
  const h = 64;
  if (points.length < 2) {
    return <p className="text-sm text-muted">La tendencia aparece desde la segunda intervención.</p>;
  }
  const step = w / (points.length - 1);
  const xy = points.map((v, i) => `${(i * step).toFixed(1)},${((1 - (v + 1) / 2) * (h - 8) + 4).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full overflow-visible" role="img" aria-label="Tendencia del sentimiento">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="stroke-line-strong" strokeDasharray="2 4" />
      <polyline points={xy.join(" ")} fill="none" className="stroke-accent-ink" strokeWidth="2" strokeLinejoin="round" />
      {xy.map((p, i) => {
        const [x, y] = p.split(",");
        return <circle key={i} cx={x} cy={y} r="3" className="fill-surface stroke-accent-ink" strokeWidth="2" />;
      })}
    </svg>
  );
}

export default function SentimentPanel({ turns }: { turns: Turn[] }) {
  const scored = turns.filter((t): t is Turn & { sentiment: Sentiment } => t.speaker !== null && !!t.sentiment);
  const latest = new Map<number, Sentiment>();
  for (const t of scored) latest.set(t.speaker as number, t.sentiment);

  return (
    <section aria-labelledby="sentiment-title" className="border-t border-line pt-5">
      <h2 id="sentiment-title" className="text-base font-semibold tracking-tight">
        Cómo se siente la conversación
      </h2>
      <p className="mt-1 text-sm text-muted">Sentimiento y emoción de cada persona, turno a turno.</p>

      {scored.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Se llena en cuanto alguien hable.</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line">
            {[...latest].map(([speaker, s]) => (
              <li key={speaker} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                <span className="font-medium">{speakerName(speaker)}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${toneClass(s.sentimiento)}`}>
                    {EMOTION_TEXT[s.emocion] ?? s.emocion}
                  </span>
                  <span role="img" className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" aria-label={`Intensidad ${Math.round(s.intensidad * 100)} %`}>
                    <span className="block h-full rounded-full bg-accent-ink" style={{ width: `${Math.round(s.intensidad * 100)}%` }} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-medium text-muted">Tendencia</h3>
          <div className="mt-2">
            <Trend points={scored.map((t) => valence(t.sentiment))} />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>Inicio</span>
            <span>Ahora</span>
          </div>
        </>
      )}
    </section>
  );
}
