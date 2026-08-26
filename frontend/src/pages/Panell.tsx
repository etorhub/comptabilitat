import { Link } from "react-router-dom";
import { useMensual, usePanell, useRepartimentCategories, useSaldos } from "../api/hooks";
import { Grafic, PALETA, eixos, useColors } from "../components/Grafic";
import { Estat, Targeta, Xifra } from "../components/ui";
import { data, euros, mesLlegible, nombre } from "../lib/format";
import { useEspaiActiu } from "../lib/espai";

export function Panell() {
  const { codi, espai } = useEspaiActiu();
  const panell = usePanell(codi);
  const mensual = useMensual(codi, 12);
  const categories = useRepartimentCategories(codi);
  const saldos = useSaldos(codi, 180);
  const colors = useColors();
  const eix = eixos(colors);

  const resum = panell.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: espai.color }}
              aria-hidden
            />
            {espai.name}
          </h1>
          <p className="text-suau text-sm">
            {resum ? `Actualitzat el ${data(resum.generated_at)}` : "Carregant…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-6">
          <Xifra
            etiqueta="Saldo"
            valor={euros(resum?.current_balance ?? 0)}
            detall={resum?.balance_date ? `a ${data(resum.balance_date)}` : undefined}
            color={nombre(resum?.current_balance) < 0 ? "var(--negatiu)" : undefined}
          />
          <Xifra
            etiqueta="Aquest mes"
            valor={euros(resum?.net_this_month ?? 0)}
            detall={
              resum
                ? `${euros(resum.income_this_month, true)} · −${euros(
                    resum.expenses_this_month,
                    true,
                  ).replace("-", "")}`
                : undefined
            }
          />
          {resum && resum.pending_review > 0 && (
            <Xifra
              etiqueta="Per revisar"
              valor={<Link to={`/e/${codi}/revisio`}>{resum.pending_review}</Link>}
              detall="moviments"
            />
          )}
          {resum && resum.active_alerts > 0 && (
            <Xifra
              etiqueta="Avisos"
              valor={<Link to={`/e/${codi}/avisos`}>{resum.active_alerts}</Link>}
              color="var(--avis)"
            />
          )}
        </div>
      </header>

      <Estat carregant={panell.isLoading} error={panell.error}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Targeta titol="Ingressos i despeses per mes">
            <Estat
              carregant={mensual.isLoading}
              error={mensual.error}
              buit={!mensual.data?.length}
              missatgeBuit="Encara no hi ha prou moviments en aquest espai."
            >
              <Grafic
                opcions={{
                  legend: {},
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

          <Targeta titol="Despeses per categoria">
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
      </Estat>

      <Targeta
        titol="Evolució del saldo"
        accio={
          resum ? (
            <span className="text-suau text-xs">
              {resum.accounts} {resum.accounts === 1 ? "compte" : "comptes"}
              {resum.uncategorized > 0 && ` · ${resum.uncategorized} sense classificar`}
            </span>
          ) : null
        }
      >
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
                axisLine: eix.categoria.axisLine,
                axisTick: eix.categoria.axisTick,
              },
              yAxis: { type: "value", scale: true, ...eix.valor },
              series: [
                {
                  type: "line",
                  smooth: true,
                  showSymbol: false,
                  data: saldos.data?.map((punt) => nombre(punt.balance)),
                  lineStyle: { color: espai.color, width: 2 },
                  itemStyle: { color: espai.color },
                  areaStyle: { color: espai.color, opacity: 0.12 },
                },
              ],
            }}
          />
        </Estat>
      </Targeta>
    </div>
  );
}
