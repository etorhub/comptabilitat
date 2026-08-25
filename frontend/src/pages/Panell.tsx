import { Link } from "react-router-dom";
import { useMensual, usePanell, useRepartimentCategories, useSaldos } from "../api/hooks";
import { Grafic, PALETA, eixos, useColors } from "../components/Grafic";
import { Estat, Import, Targeta, Xifra } from "../components/ui";
import { data, euros, mesLlegible, nombre } from "../lib/format";
import { useAmbitLlibres } from "../lib/llibres";

export function Panell() {
  const { filtre } = useAmbitLlibres();
  const panell = usePanell(filtre);
  const mensual = useMensual(filtre, 12);
  const categories = useRepartimentCategories(filtre);
  const saldos = useSaldos(filtre, 180);
  const colors = useColors();
  const eix = eixos(colors);

  const resum = panell.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Panell</h1>
          <p className="text-suau text-sm">
            {resum ? `Actualitzat el ${data(resum.generated_at)}` : "Carregant…"}
          </p>
        </div>
        <div className="flex gap-6">
          <Xifra
            etiqueta="Saldo total"
            valor={euros(resum?.total_balance ?? 0)}
            color={nombre(resum?.total_balance) < 0 ? "var(--negatiu)" : undefined}
          />
          {resum && resum.pending_review > 0 && (
            <Xifra
              etiqueta="Per revisar"
              valor={<Link to="/revisio">{resum.pending_review}</Link>}
              detall="moviments"
            />
          )}
          {resum && resum.active_alerts > 0 && (
            <Xifra
              etiqueta="Avisos"
              valor={<Link to="/avisos">{resum.active_alerts}</Link>}
              color="var(--avis)"
            />
          )}
        </div>
      </header>

      <Estat carregant={panell.isLoading} error={panell.error}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {resum?.ledgers.map((llibre) => (
            <Targeta
              key={llibre.ledger_id}
              titol={
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: llibre.ledger_color }}
                    aria-hidden
                  />
                  {llibre.ledger_name}
                </span>
              }
              accio={
                <span className="text-suau text-xs">
                  {llibre.accounts} {llibre.accounts === 1 ? "compte" : "comptes"}
                </span>
              }
            >
              <div className="mb-3">
                <Import valor={llibre.current_balance} gran />
                <div className="text-suau text-xs">
                  {llibre.balance_date ? `a ${data(llibre.balance_date)}` : "sense saldo encara"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Xifra etiqueta="Ingressos" valor={euros(llibre.income_this_month, true)}
                       color="var(--positiu)" />
                <Xifra etiqueta="Despeses" valor={euros(llibre.expenses_this_month, true)}
                       color="var(--negatiu)" />
                <Xifra etiqueta="Resultat" valor={euros(llibre.net_this_month, true)} />
              </div>
              {llibre.uncategorized > 0 && (
                <p className="text-suau mt-3 text-xs">
                  {llibre.uncategorized} moviments sense classificar
                </p>
              )}
            </Targeta>
          ))}
        </div>
      </Estat>

      <div className="grid gap-4 lg:grid-cols-2">
        <Targeta titol="Ingressos i despeses per mes">
          <Estat
            carregant={mensual.isLoading}
            error={mensual.error}
            buit={!mensual.data?.length}
            missatgeBuit="Encara no hi ha prou moviments."
          >
            <Grafic
              opcions={{
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
                    data: mensual.data?.map((punt) => nombre(punt.income)),
                    itemStyle: { color: colors.positiu, borderRadius: [3, 3, 0, 0] },
                  },
                  {
                    name: "Despeses",
                    type: "bar",
                    data: mensual.data?.map((punt) => nombre(punt.expenses)),
                    itemStyle: { color: colors.negatiu, borderRadius: [3, 3, 0, 0] },
                  },
                ],
              }}
            />
          </Estat>
        </Targeta>

        <Targeta titol="Despeses per categoria (tot l'històric)">
          <Estat
            carregant={categories.isLoading}
            error={categories.error}
            buit={!categories.data?.length}
            missatgeBuit="Encara no hi ha despeses classificades."
          >
            <Grafic
              opcions={{
                tooltip: { trigger: "item", formatter: "{b}: {c} € ({d}%)" },
                series: [
                  {
                    type: "pie",
                    radius: ["45%", "72%"],
                    itemStyle: { borderColor: colors.superficie, borderWidth: 2 },
                    label: { color: colors.suau, fontSize: 11 },
                    data: categories.data?.slice(0, 9).map((item, index) => ({
                      name: item.category_name,
                      value: nombre(item.amount),
                      itemStyle: { color: item.color || PALETA[index % PALETA.length] },
                    })),
                  },
                ],
              }}
            />
          </Estat>
        </Targeta>
      </div>

      <Targeta titol="Evolució del saldo">
        <Estat
          carregant={saldos.isLoading}
          error={saldos.error}
          buit={!saldos.data?.length}
          missatgeBuit="Cal com a mínim un saldo importat."
        >
          <Grafic
            alçada={240}
            opcions={{
              tooltip: { trigger: "axis" },
              xAxis: {
                type: "category",
                data: saldos.data?.map((punt) => punt.day),
                axisLabel: {
                  color: colors.suau,
                  fontSize: 11,
                  formatter: (valor: string) => data(valor),
                },
                ...{ axisLine: eix.categoria.axisLine, axisTick: eix.categoria.axisTick },
              },
              yAxis: { type: "value", scale: true, ...eix.valor },
              series: [
                {
                  type: "line",
                  smooth: true,
                  showSymbol: false,
                  data: saldos.data?.map((punt) => nombre(punt.balance)),
                  lineStyle: { color: colors.accent, width: 2 },
                  areaStyle: { color: colors.accent, opacity: 0.12 },
                },
              ],
            }}
          />
        </Estat>
      </Targeta>
    </div>
  );
}
