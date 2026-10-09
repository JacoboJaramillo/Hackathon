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

export default function SedesPanel({ result }: { result: SedesResult }) {
  if (result.error) {
    return (
      <section aria-labelledby="sedes-title" className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 id="sedes-title" className="text-lg font-semibold">
          Sedes
        </h2>
        <p className="mt-2 text-sm">{ERRORS[result.error] ?? "No pude completar la búsqueda."}</p>
        {result.sugerencias && result.sugerencias.length > 0 && (
          <p className="mt-1 text-sm text-muted">¿Quisiste decir {result.sugerencias.join(", ")}?</p>
        )}
      </section>
    );
  }

  const sedes = result.sedes ?? [];
  const lugar = result.alcance === "departamento" ? result.departamento : result.municipio;

  return (
    <section aria-labelledby="sedes-title" className="mt-6">
      <h2 id="sedes-title" className="text-lg font-semibold">
        {sedes.length} {sedes.length === 1 ? "sede" : "sedes"} en {lugar}
        {result.total_sedes && result.total_sedes > sedes.length ? ` (de ${result.total_sedes})` : ""}
      </h2>
      {result.alcance === "departamento" && (
        <p className="mt-1 text-sm text-muted">
          No hay sedes de este tipo en {result.municipio}; estas son las del departamento.
        </p>
      )}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sedes.map((s, i) => (
          <li key={i} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">{s.sede ?? s.prestador}</p>
            {s.prestador && s.prestador !== s.sede && <p className="text-muted">{s.prestador}</p>}
            {s.direccion && <p className="mt-2">{s.direccion}</p>}
            {s.direccion && (
              <p className="mt-1">
                <a
                  className="font-medium text-accent underline"
                  href={mapsUrl(s, result)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cómo llegar
                </a>
              </p>
            )}
            {s.telefono && (
              <p>
                <a className="text-accent underline" href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`}>
                  {s.telefono}
                </a>
              </p>
            )}
            <p className="mt-2 text-muted">
              {[s.naturaleza, s.nivel ? `Nivel ${s.nivel}` : null].filter(Boolean).join(" - ")}
            </p>
            {s.capacidades.length > 0 && (
              <p className="mt-1 text-muted">
                {s.capacidades.map((c) => `${c.tipo}${c.cantidad ? ` (${c.cantidad})` : ""}`).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
