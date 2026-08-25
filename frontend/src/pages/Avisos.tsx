import { useAvisos, useDescartaAvis } from "../api/hooks";
import type { Avis } from "../api/types";
import { Boto, Estat, Etiqueta, Targeta } from "../components/ui";
import { data } from "../lib/format";

const GRAVETAT: Record<Avis["severity"], { text: string; color: string }> = {
  critical: { text: "Urgent", color: "var(--negatiu)" },
  warning: { text: "Atenció", color: "var(--avis)" },
  info: { text: "Informatiu", color: "var(--accent)" },
};

export function Avisos() {
  const avisos = useAvisos();
  const descarta = useDescartaAvis();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Avisos</h1>
        <p className="text-suau text-sm">
          Descobert previst, consentiment del banc a punt de caducar, rebuts amb import
          inesperat i sincronitzacions fallides.
        </p>
      </header>

      <Estat
        carregant={avisos.isLoading}
        error={avisos.error}
        buit={!avisos.data?.length}
        missatgeBuit="Cap avis. Tot en ordre."
      >
        <div className="flex flex-col gap-3">
          {avisos.data?.map((avis) => (
            <Targeta key={avis.id}>
              <div className="flex items-start justify-between gap-4">
                <div
                  className="w-1 self-stretch rounded-full"
                  style={{ background: GRAVETAT[avis.severity].color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiqueta
                      to={
                        avis.severity === "critical"
                          ? "negatiu"
                          : avis.severity === "warning"
                            ? "avis"
                            : "accent"
                      }
                    >
                      {GRAVETAT[avis.severity].text}
                    </Etiqueta>
                    <span className="font-medium">{avis.title}</span>
                    {avis.status === "new" && <Etiqueta to="accent">nou</Etiqueta>}
                  </div>
                  {avis.body && <p className="text-suau mt-1 text-sm">{avis.body}</p>}
                  <p className="text-suau mt-2 text-xs">
                    {data(avis.created_at)}
                    {avis.notified_at && " · enviat per correu"}
                  </p>
                </div>
                <Boto onClick={() => descarta.mutate(avis.id)}>Descarta</Boto>
              </div>
            </Targeta>
          ))}
        </div>
      </Estat>
    </div>
  );
}
