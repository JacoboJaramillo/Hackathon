import type { Sede, SedesResult } from "./useVoiceSession";

const ERRORS: Record<string, string> = {
  municipio_no_encontrado: "No encontré ese municipio.",
  servicio_no_disponible: "El registro de sedes no respondió. Intenta de nuevo en un momento.",
  parametros_invalidos: "No entendí bien la búsqueda. Dímela de nuevo.",
};

// Opens Google Maps only when the person taps the link; nothing is sent before.
const mapsUrl = (s: Sede, r: SedesResult) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [s.sede, s.direccion, r.alcance === "municipio" ? r.municipio : null, r.departamento, "Colombia"]
      .filter(Boolean)
      .join(", "),
  )}`;

const actionClass =
  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3.5 text-sm font-medium text-foreground transition-colors duration-150 hover:border-accent-ink hover:text-accent-ink";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="sedes-title" className="rounded-[var(--radius-panel)] border border-line bg-surface">
      {children}
    </section>
  );
}

export default function SedesPanel({ result }: { result: SedesResult | null }) {
  if (!result) {
    return (
      <Shell>
        <div className="px-5 py-5 sm:px-6">
          <h2 id="sedes-title" className="text-lg font-semibold tracking-tight">
            Sedes
          </h2>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted">
            Cuando me digas qué necesitas y dónde, aquí aparecen las sedes del registro oficial con dirección, teléfono y
            cómo llegar.
          </p>
        </div>
      </Shell>
    );
  }

  if (result.error) {
    return (
      <Shell>
        <div className="rise-in px-5 py-5 sm:px-6">
          <h2 id="sedes-title" className="text-lg font-semibold tracking-tight">
            Sedes
          </h2>
          <p className="mt-2 text-[15px]">{ERRORS[result.error] ?? "No pude completar la búsqueda."}</p>
          {result.sugerencias && result.sugerencias.length > 0 && (
            <p className="mt-1 text-sm text-muted">¿Quisiste decir {result.sugerencias.join(", ")}?</p>
          )}
        </div>
      </Shell>
    );
  }

  const sedes = result.sedes ?? [];
  const lugar = result.alcance === "departamento" ? result.departamento : result.municipio;

  return (
    <Shell>
      <div className="rise-in border-b border-line px-5 py-4 sm:px-6">
        <h2 id="sedes-title" className="text-lg font-semibold tracking-tight">
          {sedes.length} {sedes.length === 1 ? "sede" : "sedes"} en {lugar}
          {result.total_sedes && result.total_sedes > sedes.length ? (
            <span className="font-normal text-muted"> (de {result.total_sedes})</span>
          ) : null}
        </h2>
        {result.alcance === "departamento" && (
          <p className="mt-1 text-sm text-muted">
            No hay sedes de este tipo en {result.municipio}; estas son las del departamento.
          </p>
        )}
      </div>
      <ul className="divide-y divide-line">
        {sedes.map((s, i) => {
          const meta = [s.naturaleza, s.nivel ? `Nivel ${s.nivel}` : null].filter(Boolean) as string[];
          return (
            <li
              key={i}
              className="rise-in px-5 py-5 sm:px-6"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[15px] font-semibold leading-snug">{s.sede ?? s.prestador}</h3>
                {meta.length > 0 && (
                  <p className="flex gap-2 text-xs font-medium text-muted">
                    {meta.map((m) => (
                      <span key={m} className="rounded-md bg-surface-2 px-1.5 py-0.5">
                        {m}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {s.prestador && s.prestador !== s.sede && <p className="mt-0.5 text-sm text-muted">{s.prestador}</p>}
              {s.direccion && <p className="mt-2 text-sm">{s.direccion}</p>}
              {s.capacidades.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  {s.capacidades.map((c) => `${c.tipo}${c.cantidad ? ` (${c.cantidad})` : ""}`).join(", ")}
                </p>
              )}
              {(s.direccion || s.telefono) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.direccion && (
                    <a className={actionClass} href={mapsUrl(s, result)} target="_blank" rel="noopener noreferrer">
                      <PinIcon />
                      Cómo llegar
                      <span className="sr-only"> (abre Google Maps en otra pestaña)</span>
                    </a>
                  )}
                  {s.telefono && (
                    <a className={actionClass} href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`}>
                      <PhoneIcon />
                      <span className="tabular-nums">{s.telefono}</span>
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 5.1 5.1l1.4-2.3L19 13.5V17a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
