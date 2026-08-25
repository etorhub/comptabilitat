import { useEffect, useState } from "react";
import { usePrevisio } from "../api/hooks";
import { Grafic, eixos, useColors } from "../components/Grafic";
import { Estat, Import, Targeta, Xifra } from "../components/ui";
import { data, euros, nombre } from "../lib/format";
import { useAmbitLlibres } from "../lib/llibres";

export function Previsio() {
  const { llibres } = useAmbitLlibres();
  const [llibreId, setLlibreId] = useState<number | undefined>();
  const [dies, setDies] = useState(90);
  const colors = useColors();
  const eix = eixos(colors);

  useEffect(() => {
    if (!llibreId && llibres.length) setLlibreId(llibres[0].id);
  }, [llibres, llibreId]);

  const previsio = usePrevisio(llibreId, dies);
  const resultat = previsio.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Previsió</h1>
          <p className="text-suau text-sm">
            Saldo actual, més els rebuts recurrents previstos, menys la despesa variable habitual.
          </p>
        </div>
        <div className="flex gap-3">
          <label className="text-sm">
            <span className="text-suau block text-xs">Llibre</span>
            <select
              value={llibreId ?? ""}
              onChange={(event) => setLlibreId(Number(event.target.value))}
              className="mt-1"
            >
              {llibres.map((llibre) => (
                <option key={llibre.id} value={llibre.id}>
                  {llibre.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-suau block text-xs">Horitzó</span>
            <select
              value={dies}
              onChange={(event) => setDies(Number(event.target.value))}
              className="mt-1"
            >
              {[30, 60, 90, 180].map((valor) => (
                <option key={valor} value={valor}>
                  {valor} dies
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <Estat carregant={previsio.isLoading} error={previsio.error} buit={!resultat}>
        {resultat && (
          <>
            {resultat.first_breach_day && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: "color-mix(in srgb, var(--negatiu) 10%, transparent)",
                  border: "1px solid var(--negatiu)",
                  color: "var(--negatiu)",
                }}
              >
                Amb aquest ritme, <strong>{resultat.ledger_name}</strong> baixaria a{" "}
                {euros(resultat.first_breach_amount)} el{" "}
                <strong>{data(resultat.first_breach_day, true)}</strong>.
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Targeta>
                <Xifra
                  etiqueta="Saldo actual"
                  valor={<Import valor={resultat.starting_balance} gran />}
                />
              </Targeta>
              <Targeta>
                <Xifra
                  etiqueta="Despesa variable"
                  valor={`${euros(resultat.daily_discretionary)}/dia`}
                  detall="mitjana dels últims 90 dies, sense els imports extrems"
                />
              </Targeta>
              <Targeta>
                <Xifra
                  etiqueta="Rebuts previstos"
                  valor={resultat.events.length}
                  detall={`en ${resultat.horizon_days} dies`}
                />
              </Targeta>
            </div>

            <Targeta titol="Projecció del saldo">
              <Grafic
                alçada={320}
                opcions={{
                  tooltip: { trigger: "axis" },
                  legend: { textStyle: { color: colors.suau }, top: 0 },
                  xAxis: {
                    type: "category",
                    data: resultat.points.map((punt) => punt.day),
                    axisLabel: {
                      color: colors.suau,
                      fontSize: 11,
                      formatter: (valor: string) => data(valor),
                    },
                    axisLine: eix.categoria.axisLine,
                    axisTick: eix.categoria.axisTick,
                  },
                  yAxis: { type: "value", scale: true, ...eix.valor },
                  series: [
                    {
                      name: "Optimista",
                      type: "line",
                      showSymbol: false,
                      smooth: true,
                      lineStyle: { color: colors.positiu, width: 1, type: "dashed" },
                      itemStyle: { color: colors.positiu },
                      data: resultat.points.map((punt) => nombre(punt.optimistic)),
                    },
                    {
                      name: "Esperada",
                      type: "line",
                      showSymbol: false,
                      smooth: true,
                      lineStyle: { color: colors.accent, width: 2.5 },
                      itemStyle: { color: colors.accent },
                      areaStyle: { color: colors.accent, opacity: 0.1 },
                      data: resultat.points.map((punt) => nombre(punt.expected)),
                      markLine: {
                        silent: true,
                        symbol: "none",
                        lineStyle: { color: colors.negatiu, type: "dotted" },
                        data: [{ yAxis: nombre(resultat.threshold), name: "Llindar" }],
                      },
                    },
                    {
                      name: "Pessimista",
                      type: "line",
                      showSymbol: false,
                      smooth: true,
                      lineStyle: { color: colors.avis, width: 1, type: "dashed" },
                      itemStyle: { color: colors.avis },
                      data: resultat.points.map((punt) => nombre(punt.pessimistic)),
                    },
                  ],
                }}
              />
            </Targeta>

            <Targeta titol="Rebuts previstos">
              <Estat buit={!resultat.events.length} missatgeBuit="Cap rebut recurrent previst.">
                <table className="dades">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Concepte</th>
                      <th className="text-right">Import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultat.events.map((esdeveniment, index) => (
                      <tr key={`${esdeveniment.series_id}-${esdeveniment.day}-${index}`}>
                        <td className="text-sm">{data(esdeveniment.day)}</td>
                        <td className="text-sm">{esdeveniment.label}</td>
                        <td className="text-right">
                          <Import valor={esdeveniment.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Estat>
            </Targeta>
          </>
        )}
      </Estat>
    </div>
  );
}
