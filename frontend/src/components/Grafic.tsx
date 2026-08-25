import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
// La compilació ESM exporta el component per defecte; la de CommonJS no.
import ReactECharts from "echarts-for-react/esm/core";
import { useEffect, useState } from "react";

// Només es registra el que es fa servir: importar echarts sencer triplica el paquet.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

/** Colors llegits de la fulla d'estil, perquè les gràfiques segueixin el tema. */
export function useColors() {
  const [colors, setColors] = useState(() => llegeixColors());
  useEffect(() => {
    const consulta = window.matchMedia("(prefers-color-scheme: dark)");
    const actualitza = () => setColors(llegeixColors());
    consulta.addEventListener("change", actualitza);
    return () => consulta.removeEventListener("change", actualitza);
  }, []);
  return colors;
}

function llegeixColors() {
  const estil = getComputedStyle(document.documentElement);
  const valor = (nom: string, defecte: string) =>
    estil.getPropertyValue(nom).trim() || defecte;
  return {
    text: valor("--text", "#0f172a"),
    suau: valor("--text-suau", "#64748b"),
    vora: valor("--vora", "#e2e8f0"),
    accent: valor("--accent", "#2563eb"),
    positiu: valor("--positiu", "#16a34a"),
    negatiu: valor("--negatiu", "#dc2626"),
    avis: valor("--avis", "#d97706"),
    superficie: valor("--superficie", "#ffffff"),
  };
}

/** Paleta categòrica per a les gràfiques amb moltes sèries. */
export const PALETA = [
  "#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626",
  "#7c3aed", "#db2777", "#65a30d", "#0d9488", "#c2410c",
];

export function Grafic({
  opcions,
  alçada = 280,
}: {
  opcions: Record<string, unknown>;
  alçada?: number;
}) {
  const colors = useColors();
  const teLlegenda = Boolean(opcions.legend);
  const base = {
    textStyle: { color: colors.text, fontFamily: "inherit" },
    tooltip: {
      backgroundColor: colors.superficie,
      borderColor: colors.vora,
      textStyle: { color: colors.text },
    },
    // Amb llegenda cal deixar-li lloc a dalt perquè no trepitgi la gràfica.
    grid: { left: 8, right: 12, top: teLlegenda ? 42 : 24, bottom: 8, containLabel: true },
  };
  const llegenda = teLlegenda
    ? {
        top: 0,
        icon: "roundRect",
        itemGap: 20,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: colors.suau, padding: [0, 0, 0, 4] },
        ...(opcions.legend as Record<string, unknown>),
      }
    : undefined;

  return (
    <ReactECharts
      echarts={echarts}
      option={{ ...base, ...opcions, ...(llegenda ? { legend: llegenda } : {}) }}
      style={{ height: alçada, width: "100%" }}
      notMerge
      opts={{ renderer: "svg" }}
    />
  );
}

/** Eixos amb el mateix aspecte a totes les gràfiques. */
export function eixos(colors: ReturnType<typeof useColors>) {
  return {
    categoria: {
      axisLine: { lineStyle: { color: colors.vora } },
      axisTick: { show: false },
      axisLabel: { color: colors.suau, fontSize: 11 },
    },
    valor: {
      splitLine: { lineStyle: { color: colors.vora, type: "dashed" as const } },
      axisLabel: { color: colors.suau, fontSize: 11 },
    },
  };
}
