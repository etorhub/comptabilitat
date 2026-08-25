import { useState } from "react";
import {
  useActualitzaComerc,
  useAplicaRegla,
  useCategories,
  useComercos,
  useEsborraRegla,
  useRegles,
} from "../api/hooks";
import { Boto, Estat, Etiqueta, Targeta } from "../components/ui";
import { data } from "../lib/format";

const PESTANYES = ["Comerços", "Regles"] as const;
type Pestanya = (typeof PESTANYES)[number];

export function Configuracio() {
  const [pestanya, setPestanya] = useState<Pestanya>("Comerços");

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Configuració</h1>
        <p className="text-suau text-sm">
          La memòria de comerços i les regles són el que fa que els moviments nous ja arribin
          classificats.
        </p>
      </header>

      <nav className="flex gap-2">
        {PESTANYES.map((nom) => (
          <button
            key={nom}
            type="button"
            onClick={() => setPestanya(nom)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium"
            style={
              pestanya === nom
                ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
                : { color: "var(--text-suau)" }
            }
          >
            {nom}
          </button>
        ))}
      </nav>

      {pestanya === "Comerços" ? <Comercos /> : <Regles />}
    </div>
  );
}

function Comercos() {
  const [cerca, setCerca] = useState("");
  const [nomesPendents, setNomesPendents] = useState(false);
  const comercos = useComercos(cerca, nomesPendents);
  const { data: categories = [] } = useCategories();
  const actualitza = useActualitzaComerc();

  return (
    <Targeta>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="text-suau block text-xs">Cerca</span>
          <input
            value={cerca}
            onChange={(event) => setCerca(event.target.value)}
            placeholder="nom del comerç"
            className="mt-1 w-56"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={nomesPendents}
            onChange={(event) => setNomesPendents(event.target.checked)}
          />
          Només els que no tenen categoria
        </label>
      </div>

      <Estat
        carregant={comercos.isLoading}
        error={comercos.error}
        buit={!comercos.data?.items.length}
        missatgeBuit="Cap comerç amb aquests filtres."
      >
        <div className="overflow-x-auto">
          <table className="dades">
            <thead>
              <tr>
                <th>Comerç</th>
                <th>Categoria per defecte</th>
                <th className="text-right">Moviments</th>
                <th>Últim cop</th>
                <th>Estat</th>
              </tr>
            </thead>
            <tbody>
              {comercos.data?.items.map((comerc) => (
                <tr key={comerc.id}>
                  <td className="text-sm">
                    <div className="font-medium">{comerc.display_name}</div>
                    <div className="text-suau text-xs">{comerc.normalized_name}</div>
                  </td>
                  <td>
                    <select
                      value={comerc.default_category_id ?? ""}
                      onChange={(event) =>
                        actualitza.mutate({
                          id: comerc.id,
                          default_category_id: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                      className="max-w-56 text-sm"
                    >
                      <option value="">Sense categoria</option>
                      {categories.map((categoria) => (
                        <option key={categoria.id} value={categoria.id}>
                          {categoria.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right text-sm tabular-nums">{comerc.transaction_count}</td>
                  <td className="text-suau text-sm">{data(comerc.last_seen_at)}</td>
                  <td>
                    {comerc.is_confirmed ? (
                      <Etiqueta to="positiu">confirmat</Etiqueta>
                    ) : comerc.category_source === "llm" ? (
                      <Etiqueta to="avis">proposat pel model</Etiqueta>
                    ) : (
                      <Etiqueta>sense revisar</Etiqueta>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Estat>
    </Targeta>
  );
}

function Regles() {
  const regles = useRegles();
  const esborra = useEsborraRegla();
  const aplica = useAplicaRegla();

  return (
    <Targeta>
      <Estat
        carregant={regles.isLoading}
        error={regles.error}
        buit={!regles.data?.length}
        missatgeBuit="Encara no hi ha cap regla. Se'n creen soles quan corregeixes una categoria."
      >
        <div className="overflow-x-auto">
          <table className="dades">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Condicions</th>
                <th>Assigna</th>
                <th className="text-right">Prioritat</th>
                <th className="text-right">Encerts</th>
                <th>Origen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {regles.data?.map((regla) => (
                <tr key={regla.id}>
                  <td className="text-sm font-medium">{regla.name}</td>
                  <td className="text-suau text-sm">
                    {regla.conditions
                      .map((condicio) => `${condicio.field} ${condicio.operator} "${condicio.value}"`)
                      .join(" i ")}
                  </td>
                  <td className="text-sm">{regla.set_category_id ?? "—"}</td>
                  <td className="text-right text-sm tabular-nums">{regla.priority}</td>
                  <td className="text-right text-sm tabular-nums">{regla.match_count}</td>
                  <td>
                    <Etiqueta to={regla.source === "learned" ? "accent" : "neutre"}>
                      {regla.source === "learned" ? "apresa" : "manual"}
                    </Etiqueta>
                  </td>
                  <td className="whitespace-nowrap">
                    <Boto onClick={() => aplica.mutate(regla.id)}>Torna-la a aplicar</Boto>{" "}
                    <Boto tipus="perillos" onClick={() => esborra.mutate(regla.id)}>
                      Esborra
                    </Boto>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Estat>
    </Targeta>
  );
}
