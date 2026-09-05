/**
 * Els gràfics.
 *
 * Aquesta és tota la illa de JavaScript que hi ha a l'aplicació, i està feta
 * per ser-ho: no hi ha cap marc de client, cap magatzem d'estat ni cap
 * empaquetador. Un gràfic és un `<div data-grafic>` amb les seves dades a
 * dins, en un `<script type="application/json">` que ha escrit el servidor.
 *
 * El servidor decideix què es dibuixa; això només ho dibuixa.
 *
 * Es torna a executar a cada `htmx:afterSwap`, de manera que un gràfic que
 * arriba dins d'un fragment també es dibuixa. Els que ja hi eren es
 * reaprofiten en lloc de tornar-los a crear.
 */
(function () {
  "use strict";

  var instancies = new WeakMap();

  /** Els colors surten dels mateixos testimonis CSS que la resta de la pàgina. */
  function colors() {
    var estil = getComputedStyle(document.documentElement);
    function token(nom, defecte) {
      return (estil.getPropertyValue(nom) || defecte).trim();
    }
    return {
      text: token("--text", "#0f172a"),
      suau: token("--text-suau", "#64748b"),
      vora: token("--vora", "#e2e8f0"),
      accent: token("--accent", "#2563eb"),
      positiu: token("--positiu", "#16a34a"),
      negatiu: token("--negatiu", "#dc2626"),
      avis: token("--avis", "#d97706"),
      superficie: token("--superficie", "#ffffff"),
    };
  }

  function euros(valor) {
    return new Intl.NumberFormat("ca-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(valor);
  }

  /** Base comuna: sense títol, amb quadrícula discreta i tipografia heretada. */
  function base(c) {
    return {
      textStyle: { fontFamily: "inherit", color: c.text },
      grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: c.superficie,
        borderColor: c.vora,
        textStyle: { color: c.text },
      },
      legend: { textStyle: { color: c.suau }, top: 0 },
    };
  }

  var constructors = {
    /** Ingressos i despeses mes a mes. */
    mensual: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "axis";
      opcions.xAxis = {
        type: "category",
        data: dades.map(function (d) {
          return d.periode;
        }),
        axisLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau },
      };
      opcions.yAxis = {
        type: "value",
        splitLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, formatter: euros },
      };
      opcions.series = [
        {
          name: "Ingressos",
          type: "bar",
          itemStyle: { color: c.positiu, borderRadius: [3, 3, 0, 0] },
          data: dades.map(function (d) {
            return d.ingressos;
          }),
        },
        {
          name: "Despeses",
          type: "bar",
          itemStyle: { color: c.negatiu, borderRadius: [3, 3, 0, 0] },
          data: dades.map(function (d) {
            return d.despeses;
          }),
        },
        {
          name: "Resultat",
          type: "line",
          smooth: true,
          symbol: "circle",
          lineStyle: { color: c.accent },
          itemStyle: { color: c.accent },
          data: dades.map(function (d) {
            return d.net;
          }),
        },
      ];
      return opcions;
    },

    /** Repartiment de la despesa per categoria. */
    categories: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "item";
      opcions.tooltip.formatter = "{b}: {c} € ({d}%)";
      opcions.legend = { show: false };
      opcions.series = [
        {
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderColor: c.superficie, borderWidth: 2 },
          label: { color: c.suau },
          data: dades.map(function (d) {
            return {
              name: d.categoryName,
              value: d.amount,
              itemStyle: { color: d.color },
            };
          }),
        },
      ];
      return opcions;
    },

    /** Evolució del saldo. */
    saldos: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "axis";
      opcions.xAxis = {
        type: "category",
        data: dades.map(function (d) {
          return d.dia;
        }),
        axisLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau },
      };
      opcions.yAxis = {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, formatter: euros },
      };
      opcions.series = [
        {
          name: "Saldo",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.accent },
          areaStyle: { color: c.accent, opacity: 0.12 },
          data: dades.map(function (d) {
            return d.saldo;
          }),
        },
      ];
      return opcions;
    },

    /** Previsió: banda optimista, esperada i pessimista, amb el llindar. */
    previsio: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "axis";
      opcions.xAxis = {
        type: "category",
        data: dades.punts.map(function (p) {
          return p.dia;
        }),
        axisLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau },
      };
      opcions.yAxis = {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, formatter: euros },
      };

      var markPoint = null;
      if (dades.primerDescobert) {
        var puntDescobert = dades.punts.find(function (p) {
          return p.dia === dades.primerDescobert;
        });
        if (puntDescobert) {
          markPoint = {
            silent: true,
            symbol: "pin",
            symbolSize: 42,
            itemStyle: { color: c.negatiu },
            label: { formatter: "Descobert", color: "#fff", fontSize: 10 },
            data: [
              {
                name: "Descobert",
                coord: [puntDescobert.dia, puntDescobert.esperat],
              },
            ],
          };
        }
      }

      var diesRebut = dades.diesRebut || [];
      var perDia = {};
      dades.punts.forEach(function (p) {
        perDia[p.dia] = p;
      });
      var puntsRebut = diesRebut
        .map(function (dia) {
          var p = perDia[dia];
          return p ? [dia, p.esperat] : null;
        })
        .filter(Boolean);

      var serieEsperat = {
        name: "Esperat",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: c.accent, width: 2 },
        areaStyle: { color: c.accent, opacity: 0.1 },
        data: dades.punts.map(function (p) {
          return p.esperat;
        }),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.negatiu, type: "dashed" },
          label: { formatter: "Llindar", color: c.negatiu },
          data: [{ yAxis: dades.llindar }],
        },
      };
      if (markPoint) serieEsperat.markPoint = markPoint;

      opcions.series = [
        {
          name: "Optimista",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.positiu, type: "dashed", width: 1 },
          data: dades.punts.map(function (p) {
            return p.optimista;
          }),
        },
        serieEsperat,
        {
          name: "Pessimista",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.avis, type: "dashed", width: 1 },
          data: dades.punts.map(function (p) {
            return p.pessimista;
          }),
        },
        {
          name: "Tendència",
          type: "line",
          smooth: false,
          showSymbol: false,
          lineStyle: { color: c.suau, width: 1.5 },
          data: dades.punts.map(function (p) {
            return p.tendencia;
          }),
        },
      ];

      if (puntsRebut.length > 0) {
        opcions.series.push({
          name: "Rebuts",
          type: "scatter",
          symbolSize: 9,
          itemStyle: { color: c.accent, borderColor: c.superficie, borderWidth: 1 },
          data: puntsRebut,
          z: 5,
        });
      }

      return opcions;
    },

    /** On es gasta més, de més a menys. */
    comercos: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "axis";
      opcions.legend = { show: false };
      opcions.grid.left = 8;
      opcions.yAxis = {
        type: "category",
        inverse: true,
        data: dades.map(function (d) {
          return d.merchantName;
        }),
        axisLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, width: 140, overflow: "truncate" },
      };
      opcions.xAxis = {
        type: "value",
        splitLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, formatter: euros },
      };
      opcions.series = [
        {
          type: "bar",
          itemStyle: { color: c.accent, borderRadius: [0, 3, 3, 0] },
          data: dades.map(function (d) {
            return d.amount;
          }),
        },
      ];
      return opcions;
    },
  };

  function dibuixa(node) {
    if (!window.echarts) return;

    var tipus = node.getAttribute("data-grafic");
    var constructor = constructors[tipus];
    if (!constructor) return;

    var font = node.querySelector('script[type="application/json"]');
    if (!font) return;

    var dades;
    try {
      dades = JSON.parse(font.textContent);
    } catch {
      // Dades malmeses: val mes no dibuixar res que dibuixar mentides.
      return;
    }

    // Sense dades no es dibuixa res: val més un buit honest que uns eixos sols.
    var buit = Array.isArray(dades) ? dades.length === 0 : !dades;
    if (buit) {
      node.setAttribute("data-buit", "true");
      return;
    }
    node.removeAttribute("data-buit");

    var instancia = instancies.get(node);
    if (!instancia || instancia.isDisposed()) {
      instancia = window.echarts.init(node, null, { renderer: "svg" });
      instancies.set(node, instancia);
    }
    instancia.setOption(constructor(dades, colors()), true);
    instancia.resize();
  }

  function dibuixaTots() {
    var nodes = document.querySelectorAll("[data-grafic]");
    for (var i = 0; i < nodes.length; i++) dibuixa(nodes[i]);
  }

  window.Grafics = { dibuixaTots: dibuixaTots };

  document.addEventListener("DOMContentLoaded", dibuixaTots);
  window.addEventListener("resize", dibuixaTots);
  // El mode fosc el decideix el sistema: quan canvia, els colors dels gràfics
  // també han de canviar.
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", dibuixaTots);
  }
})();
