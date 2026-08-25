import { useState } from "react";
import { useActualitzaSerie, useRecurrents, useResumSubscripcions } from "../api/hooks";
import { Estat, Etiqueta, Import, Targeta, Xifra } from "../components/ui";
import { data, euros } from "../lib/format";
import { useAmbitLlibres } from "../lib/llibres";

const CADENCIES: Record<string, string> = {
  weekly: "setmanal",
  biweekly: "quinzenal",
  monthly: "mensual",
  bimonthly: "bimestral",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
};

export function Recurrents() {
  const { filtre } = useAmbitLlibres();
  const [nomesSubscripcions, setNomesSubscripcions] = useState(false);
  const series = useRecurrents(filtre, nomesSubscripcions);
  const resum = useResumSubscripcions(filtre);
  const actualitza = useActualitzaSerie();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Recurrents</h1>
          <p className="text-suau text-sm">
            Rebuts i subscripcions detectats pel patró de dates i imports.
          </p>
        </div>
        <div className="flex gap-6">
          <Xifra etiqueta="Cost mensual" valor={euros(resum.data?.mensual ?? 0)} />
          <Xifra etiqueta="Cost anual" valor={euros(resum.data?.anual ?? 0)} />
        </div>
      </header>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={nomesSubscripcions}
          onChange={(event) => setNomesSubscripcions(event.target.checked)}
        />
        Només subscripcions mensuals
      </label>

      <Targeta className="overflow-x-auto">
        <Estat
          carregant={series.isLoading}
          error={series.error}
          buit={!series.data?.length}
          missatgeBuit="Encara no s'ha detectat cap sèrie. Calen tres aparicions regulars."
        >
          <table className="dades">
            <thead>
              <tr>
                <th>Concepte</th>
                <th>Cadència</th>
                <th>Categoria</th>
                <th>Vist per última vegada</th>
                <th>Proper</th>
                <th className="text-right">Import</th>
                <th className="text-right">Al mes</th>
                <th>A la previsió</th>
              </tr>
            </thead>
            <tbody>
              {series.data?.map((serie) => (
                <tr key={serie.id}>
                  <td>
                    <div className="font-medium">{serie.label}</div>
                    <Etiqueta to={serie.confidence >= 0.8 ? "positiu" : "neutre"}>
                      {Math.round(serie.confidence * 100)}% · {serie.occurrences_count} cops
                    </Etiqueta>
                  </td>
                  <td className="text-sm">{CADENCIES[serie.cadence] ?? serie.cadence}</td>
                  <td className="text-sm">{serie.category_name ?? "—"}</td>
                  <td className="text-sm">{data(serie.last_seen_date)}</td>
                  <td className="text-sm">{data(serie.next_expected_date)}</td>
                  <td className="text-right">
                    <Import valor={serie.expected_amount} />
                  </td>
                  <td className="text-suau text-right text-sm tabular-nums">
                    {euros(serie.monthly_cost)}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={serie.include_in_forecast}
                      onChange={(event) =>
                        actualitza.mutate({
                          id: serie.id,
                          include_in_forecast: event.target.checked,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estat>
      </Targeta>
    </div>
  );
}
