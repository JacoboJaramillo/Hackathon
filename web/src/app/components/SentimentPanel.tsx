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
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label="Tendencia del sentimiento">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="stroke-border" strokeDasharray="4 4" />
      <polyline points={xy.join(" ")} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinejoin="round" />
      {xy.map((p, i) => {
        const [x, y] = p.split(",");
        return <circle key={i} cx={x} cy={y} r="3.5" className="fill-accent" />;
      })}
    </svg>
  );
}

export default function SentimentPanel({ turns }: { turns: Turn[] }) {
  const scored = turns.filter((t): t is Turn & { sentiment: Sentiment } => t.speaker !== null && !!t.sentiment);
  const latest = new Map<number, Sentiment>();
  for (const t of scored) latest.set(t.speaker as number, t.sentiment);

  return (
    <section aria-labelledby="sentiment-title" className="h-full rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 id="sentiment-title" className="text-lg font-semibold">
        Sentimiento y emociones
      </h2>
      <p className="text-sm text-muted">Se actualiza con cada intervención de las personas.</p>

      {scored.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Aún no hay intervenciones analizadas.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {[...latest].map(([speaker, s]) => (
              <li key={speaker} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{speakerName(speaker)}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass(s.sentimiento)}`}>
                    {EMOTION_TEXT[s.emocion] ?? s.emocion}
                  </span>
                  <span className="h-2 w-20 overflow-hidden rounded-full bg-border/40" aria-label={`Intensidad ${Math.round(s.intensidad * 100)} %`}>
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(s.intensidad * 100)}%` }} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-semibold">Tendencia</h3>
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
