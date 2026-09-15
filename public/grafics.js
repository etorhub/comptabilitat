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

  /**
   * Els colors surten dels mateixos testimonis CSS que la resta de la
   * pàgina. Nomes tinta i un accent: cap serie de cap gràfic fa servir
   * vermell/verd/taronja. Vegeu `handoff/README.md`, seccio 4, «Charts».
   */
  function colors() {
    var estil = getComputedStyle(document.documentElement);
    function token(nom, defecte) {
      return (estil.getPropertyValue(nom) || defecte).trim();
    }
    return {
      text: token("--ink", "#201e1d"),
      fort: token("--ink-70", "#444141"),
      suau: token("--ink-55", "#605d5d"),
      fluix: token("--ink-40", "#7d7979"),
      vora: token("--rule", "rgba(32,30,29,0.16)"),
      accent: token("--accent", "#0088b0"),
      alerta: token("--alert", "#d6006c"),
      paper: token("--paper", "#f3f2f2"),
    };
  }

  function euros(valor) {
    return new Intl.NumberFormat("ca-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(valor);
  }

  /**
   * Quant pot ocupar el nom d'un comerç a l'eix vertical.
   *
   * Eren 140 píxels fixos. En una pantalla de 390 això es menja gairebé la
   * meitat de l'amplada i les barres queden en no res; a l'escriptori, en
   * canvi, 140 va bé. Com que els gràfics ja es tornen a dibuixar quan la
   * finestra canvia de mida, n'hi ha prou de mirar-la aquí.
   */
  function ampladaEtiqueta() {
    return Math.max(72, Math.min(140, Math.round(window.innerWidth * 0.28)));
  }

  /** Base comuna: sense títol, amb quadrícula discreta i tipografia heretada. */
  function base(c) {
    return {
      textStyle: { fontFamily: "inherit", color: c.text },
      grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: c.text,
        borderColor: c.text,
        textStyle: { color: c.paper },
      },
      legend: { textStyle: { color: c.suau }, top: 0 },
    };
  }

  var constructors = {
    /** Ingressos i despeses (fixes a baix, variables a damunt) mes a mes. */
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
          itemStyle: { color: c.text },
          data: dades.map(function (d) {
            return d.income;
          }),
        },
        {
          name: "Fixes",
          type: "bar",
          stack: "despeses",
          itemStyle: { color: c.fort },
          data: dades.map(function (d) {
            return d.fixedExpenses;
          }),
        },
        {
          name: "Variables",
          type: "bar",
          stack: "despeses",
          itemStyle: { color: c.fluix },
          data: dades.map(function (d) {
            return d.variableExpenses;
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
            return d.cleaned;
          }),
        },
      ];
      return opcions;
    },

    /** Repartiment de la despesa per categoria (llegenda clicable). */
    categories: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "item";
      opcions.tooltip.formatter = "{b}: {c} € ({d}%)";
      opcions.legend = {
        show: true,
        type: "scroll",
        orient: "horizontal",
        top: 0,
        textStyle: { color: c.suau },
      };
      opcions.series = [
        {
          type: "pie",
          radius: ["40%", "68%"],
          center: ["50%", "58%"],
          itemStyle: { borderColor: c.paper, borderWidth: 2 },
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
          return d.day;
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
          lineStyle: { color: c.accent, width: 2 },
          itemStyle: { color: c.accent },
          data: dades.map(function (d) {
            return d.balance;
          }),
        },
      ];
      return opcions;
    },

    /**
     * Previsió: saldo real a l'esquerra, projecció a la dreta.
     * Avui es el punt de junta: Real acaba i Esperat comença.
     */
    previsio: function (dades, c) {
      var opcions = base(c);
      opcions.tooltip.trigger = "axis";

      var historic = dades.history || [];
      var punts = dades.points || [];
      var avui = punts.length > 0 ? punts[0].day : null;

      var eixX = [];
      var vist = {};
      historic.forEach(function (h) {
        if (!vist[h.day]) {
          vist[h.day] = true;
          eixX.push(h.day);
        }
      });
      punts.forEach(function (p) {
        if (!vist[p.day]) {
          vist[p.day] = true;
          eixX.push(p.day);
        }
      });

      var saldoPerDia = {};
      historic.forEach(function (h) {
        saldoPerDia[h.day] = h.balance;
      });
      var previsPerDia = {};
      punts.forEach(function (p) {
        previsPerDia[p.day] = p;
      });

      opcions.xAxis = {
        type: "category",
        data: eixX,
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
      if (dades.firstOverdraft) {
        var puntDescobert = previsPerDia[dades.firstOverdraft];
        if (puntDescobert) {
          markPoint = {
            silent: true,
            symbol: "pin",
            symbolSize: 42,
            itemStyle: { color: c.alerta },
            label: { formatter: "Descobert", color: c.paper, fontSize: 10 },
            data: [
              {
                name: "Descobert",
                coord: [dades.firstOverdraft, puntDescobert.expected],
              },
            ],
          };
        }
      }

      var diesRebut = dades.billDays || [];
      var puntsRebut = diesRebut
        .map(function (dia) {
          var p = previsPerDia[dia];
          return p ? [dia, p.expected] : null;
        })
        .filter(Boolean);

      function valorReal(dia) {
        if (avui && dia > avui) return null;
        return saldoPerDia[dia] != null ? saldoPerDia[dia] : null;
      }
      function valorPrevis(dia, camp) {
        if (avui && dia < avui) return null;
        var p = previsPerDia[dia];
        return p ? p[camp] : null;
      }

      var serieEsperat = {
        name: "Esperat",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: c.accent, width: 2 },
        itemStyle: { color: c.accent },
        data: eixX.map(function (dia) {
          return valorPrevis(dia, "expected");
        }),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.alerta, type: "dashed" },
          label: { formatter: "Llindar", color: c.alerta },
          data: [{ yAxis: dades.threshold }],
        },
      };
      if (markPoint) serieEsperat.markPoint = markPoint;

      opcions.series = [
        {
          name: "Real",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.text, width: 2 },
          itemStyle: { color: c.text },
          data: eixX.map(valorReal),
        },
        {
          name: "Optimista",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.fluix, type: "dashed", width: 1 },
          itemStyle: { color: c.fluix },
          data: eixX.map(function (dia) {
            return valorPrevis(dia, "optimista");
          }),
        },
        serieEsperat,
        {
          name: "Pessimista",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.fluix, type: "dashed", width: 1 },
          itemStyle: { color: c.fluix },
          data: eixX.map(function (dia) {
            return valorPrevis(dia, "pessimistic");
          }),
        },
        {
          name: "Tendència",
          type: "line",
          smooth: false,
          showSymbol: false,
          lineStyle: { color: c.suau, width: 1.5, type: "dotted" },
          itemStyle: { color: c.suau },
          data: eixX.map(function (dia) {
            return valorPrevis(dia, "trend");
          }),
        },
      ];

      if (puntsRebut.length > 0) {
        opcions.series.push({
          name: "Rebuts",
          type: "scatter",
          symbolSize: 9,
          itemStyle: { color: c.accent, borderColor: c.paper, borderWidth: 1 },
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
        axisLabel: { color: c.suau, width: ampladaEtiqueta(), overflow: "truncate" },
      };
      opcions.xAxis = {
        type: "value",
        splitLine: { lineStyle: { color: c.vora } },
        axisLabel: { color: c.suau, formatter: euros },
      };
      opcions.series = [
        {
          type: "bar",
          itemStyle: { color: c.accent },
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
})();
