import { useState } from "react";
import { descarrega } from "../api/client";
import { useMensual, useRepartimentCategories, useRepartimentComercos } from "../api/hooks";
import { Grafic, PALETA, eixos, useColors } from "../components/Grafic";
import { Boto, Estat, Import, Targeta, Xifra } from "../components/ui";
import { diesEnrere, euros, mesLlegible, nombre } from "../lib/format";
import { useAmbitLlibres } from "../lib/llibres";

export function Informes() {
  const { filtre } = useAmbitLlibres();
  const [desDe, setDesDe] = useState(diesEnrere(365));
  const [finsA, setFinsA] = useState("");
  const [mesos, setMesos] = useState(12);

  const mensual = useMensual(filtre, mesos);
  const despeses = useRepartimentCategories(filtre, desDe, finsA || undefined, true);
  const ingressos = useRepartimentCategories(filtre, desDe, finsA || undefined, false);
  const comercos = useRepartimentComercos(filtre, desDe, finsA || undefined);
  const colors = useColors();
  const eix = eixos(colors);

  const totalIngressos = mensual.data?.reduce((suma, punt) => suma + nombre(punt.income), 0) ?? 0;
  const totalDespeses = mensual.data?.reduce((suma, punt) => suma + nombre(punt.expenses), 0) ?? 0;

  const parametres = { ledger_ids: filtre, date_from: desDe, date_to: finsA || undefined };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Informes</h1>
          <p className="text-suau text-sm">
            Els traspassos entre comptes propis no compten com a ingrés ni com a despesa.
          </p>
        </div>
        <div className="flex gap-2">
          <Boto onClick={() => descarrega("/export/report.xlsx", { ledger_ids: filtre, months: mesos })}>
            Excel
          </Boto>
          <Boto onClick={() => descarrega("/export/report.pdf", parametres)}>PDF</Boto>
        </div>
      </header>

      <Targeta>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="text-suau block text-xs">Des de</span>
            <input
              type="date"
              value={desDe}
              onChange={(event) => setDesDe(event.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-sm">
            <span className="text-suau block text-xs">Fins a</span>
            <input
              type="date"
              value={finsA}
              onChange={(event) => setFinsA(event.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-sm">
            <span className="text-suau block text-xs">Mesos a comparar</span>
            <select
              value={mesos}
              onChange={(event) => setMesos(Number(event.target.value))}
              className="mt-1"
            >
              {[6, 12, 24, 36].map((valor) => (
                <option key={valor} value={valor}>
                  {valor} mesos
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-6">
            <Xifra etiqueta="Ingressos" valor={euros(totalIngressos)} color="var(--positiu)" />
            <Xifra etiqueta="Despeses" valor={euros(totalDespeses)} color="var(--negatiu)" />
            <Xifra etiqueta="Resultat" valor={euros(totalIngressos - totalDespeses)} />
          </div>
        </div>
      </Targeta>

      <Targeta titol="Resultat mes a mes">
        <Estat
          carregant={mensual.isLoading}
          error={mensual.error}
          buit={!mensual.data?.length}
          missatgeBuit="Encara no hi ha moviments en aquest període."
        >
          <Grafic
            alçada={300}
            opcions={{
              tooltip: { trigger: "axis" },
              legend: { textStyle: { color: colors.suau }, top: 0 },
              xAxis: {
                type: "category",
                data: mensual.data?.map((punt) => mesLlegible(punt.period)),
                ...eix.categoria,
              },
              yAxis: { type: "value", ...eix.valor },
              series: [
                {
                  name: "Ingressos",
                  type: "bar",
                  stack: undefined,
                  data: mensual.data?.map((punt) => nombre(punt.income)),
                  itemStyle: { color: colors.positiu, borderRadius: [3, 3, 0, 0] },
                },
                {
                  name: "Despeses",
                  type: "bar",
                  data: mensual.data?.map((punt) => nombre(punt.expenses)),
                  itemStyle: { color: colors.negatiu, borderRadius: [3, 3, 0, 0] },
                },
                {
                  name: "Resultat",
                  type: "line",
                  smooth: true,
                  data: mensual.data?.map((punt) => nombre(punt.net)),
                  lineStyle: { color: colors.accent, width: 2 },
                  itemStyle: { color: colors.accent },
                },
              ],
            }}
          />
        </Estat>
      </Targeta>

      <div className="grid gap-4 lg:grid-cols-2">
        <Targeta titol="Despeses per categoria">
          <Estat
            carregant={despeses.isLoading}
            error={despeses.error}
            buit={!despeses.data?.length}
            missatgeBuit="Cap despesa en aquest període."
          >
            <table className="dades">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="text-right">Import</th>
                  <th className="text-right">Pes</th>
                  <th className="text-right">Mov.</th>
                </tr>
              </thead>
              <tbody>
                {despeses.data?.map((item, index) => (
                  <tr key={item.category_id ?? `sense-${index}`}>
                    <td className="text-sm">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ background: item.color || PALETA[index % PALETA.length] }}
                        aria-hidden
                      />
                      {item.category_name}
                    </td>
                    <td className="text-right tabular-nums">{euros(item.amount)}</td>
                    <td className="text-suau text-right text-sm tabular-nums">
                      {(item.share * 100).toFixed(1)} %
                    </td>
                    <td className="text-suau text-right text-sm tabular-nums">
                      {item.transactions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Estat>
        </Targeta>

        <div className="flex flex-col gap-4">
          <Targeta titol="On es va el diner">
            <Estat
              carregant={comercos.isLoading}
              error={comercos.error}
              buit={!comercos.data?.length}
              missatgeBuit="Encara no hi ha comerços identificats."
            >
              <Grafic
                alçada={280}
                opcions={{
                  tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
                  xAxis: { type: "value", ...eix.valor },
                  yAxis: {
                    type: "category",
                    inverse: true,
                    data: comercos.data?.slice(0, 10).map((item) => item.merchant_name),
                    ...eix.categoria,
                  },
                  series: [
                    {
                      type: "bar",
                      data: comercos.data?.slice(0, 10).map((item) => nombre(item.amount)),
                      itemStyle: { color: colors.accent, borderRadius: [0, 3, 3, 0] },
                    },
                  ],
                }}
              />
            </Estat>
          </Targeta>

          <Targeta titol="Ingressos per categoria">
            <Estat
              carregant={ingressos.isLoading}
              error={ingressos.error}
              buit={!ingressos.data?.length}
              missatgeBuit="Cap ingrés en aquest període."
            >
              <table className="dades">
                <tbody>
                  {ingressos.data?.map((item, index) => (
                    <tr key={item.category_id ?? `sense-${index}`}>
                      <td className="text-sm">{item.category_name}</td>
                      <td className="text-right">
                        <Import valor={item.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Estat>
          </Targeta>
        </div>
      </div>
    </div>
  );
}
