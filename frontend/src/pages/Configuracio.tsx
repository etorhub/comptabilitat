import { useEffect, useState } from "react";
import {
  useActualitzaComerc,
  useActualitzaEspai,
  useAplicaRegla,
  useCategories,
  useComercos,
  useEsborraRegla,
  useEspai,
  useMembres,
  useRegles,
} from "../api/hooks";
import { Boto, Estat, Etiqueta, Targeta } from "../components/ui";
import { data } from "../lib/format";
import { useEspaiActiu } from "../lib/espai";

const ROLS: Record<string, string> = {
  viewer: "només mira",
  editor: "pot classificar",
  admin: "el gestiona",
};

export function Configuracio() {
  const { espai, potGestionar } = useEspaiActiu();
  const pestanyes = ["Comerços", "Regles", ...(potGestionar ? ["Espai"] : [])];
  const [pestanya, setPestanya] = useState(pestanyes[0]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Configuració de {espai.name}</h1>
        <p className="text-suau text-sm">
          Els comerços i les regles són només d'aquest espai: el que decideixis aquí no toca
          res dels altres.
        </p>
      </header>

      <nav className="flex gap-2">
        {pestanyes.map((nom) => (
          <button
            key={nom}
            type="button"
            onClick={() => setPestanya(nom)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium"
            style={
              pestanya === nom
                ? {
                    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                    color: "var(--accent)",
                  }
                : { color: "var(--text-suau)" }
            }
          >
            {nom}
          </button>
        ))}
      </nav>

      {pestanya === "Comerços" && <Comercos />}
      {pestanya === "Regles" && <Regles />}
      {pestanya === "Espai" && <ConfiguracioEspai />}
    </div>
  );
}

function Comercos() {
  const { codi, potEditar } = useEspaiActiu();
  const [cerca, setCerca] = useState("");
  const [nomesPendents, setNomesPendents] = useState(false);
  const comercos = useComercos(codi, cerca, nomesPendents);
  const { data: categories = [] } = useCategories(codi);
  const actualitza = useActualitzaComerc(codi);

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
                      disabled={!potEditar}
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
  const { codi, potEditar } = useEspaiActiu();
  const regles = useRegles(codi);
  const esborra = useEsborraRegla(codi);
  const aplica = useAplicaRegla(codi);

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
                <th className="text-right">Prioritat</th>
                <th className="text-right">Encerts</th>
                <th>Origen</th>
                {potEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {regles.data?.map((regla) => (
                <tr key={regla.id}>
                  <td className="text-sm font-medium">{regla.name}</td>
                  <td className="text-suau text-sm">
                    {regla.conditions
                      .map(
                        (condicio) =>
                          `${condicio.field} ${condicio.operator} "${condicio.value}"`,
                      )
                      .join(" i ")}
                  </td>
                  <td className="text-right text-sm tabular-nums">{regla.priority}</td>
                  <td className="text-right text-sm tabular-nums">{regla.match_count}</td>
                  <td>
                    <Etiqueta to={regla.source === "learned" ? "accent" : "neutre"}>
                      {regla.source === "learned" ? "apresa" : "manual"}
                    </Etiqueta>
                  </td>
                  {potEditar && (
                    <td className="whitespace-nowrap">
                      <Boto onClick={() => aplica.mutate(regla.id)}>Torna-la a aplicar</Boto>{" "}
                      <Boto tipus="perillos" onClick={() => esborra.mutate(regla.id)}>
                        Esborra
                      </Boto>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Estat>
    </Targeta>
  );
}

function ConfiguracioEspai() {
  const { codi } = useEspaiActiu();
  const detall = useEspai(codi);
  const membres = useMembres(codi);
  const actualitza = useActualitzaEspai(codi);
  const [destinataris, setDestinataris] = useState("");
  const [llindar, setLlindar] = useState("");

  useEffect(() => {
    if (detall.data) {
      setDestinataris(detall.data.alert_recipients.join(", "));
      setLlindar(detall.data.overdraft_threshold);
    }
  }, [detall.data]);

  function desa() {
    actualitza.mutate({
      alert_recipients: destinataris
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      overdraft_threshold: llindar,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Targeta titol="Avisos d'aquest espai">
        <Estat carregant={detall.isLoading} error={detall.error}>
          <label className="block text-sm">
            <span className="text-suau block text-xs">
              Qui rep els avisos (correus separats per comes)
            </span>
            <input
              value={destinataris}
              onChange={(event) => setDestinataris(event.target.value)}
              placeholder="tu@example.com, parella@example.com"
              className="mt-1 w-full"
            />
          </label>
          <p className="text-suau mt-1 text-xs">
            Si es deixa buit, s'envien als destinataris generals de la configuració.
          </p>

          <label className="mt-4 block text-sm">
            <span className="text-suau block text-xs">
              Llindar de descobert (avisa si el saldo previst hi baixa)
            </span>
            <input
              value={llindar}
              onChange={(event) => setLlindar(event.target.value)}
              className="mt-1 w-40"
            />
          </label>

          <div className="mt-4">
            <Boto tipus="primari" onClick={desa} disabled={actualitza.isPending}>
              {actualitza.isPending ? "Desant…" : "Desa"}
            </Boto>
          </div>
        </Estat>
      </Targeta>

      <Targeta titol="Qui hi té accés">
        <Estat
          carregant={membres.isLoading}
          error={membres.error}
          buit={!membres.data?.length}
          missatgeBuit="Encara no hi ha ningú més."
        >
          <table className="dades">
            <tbody>
              {membres.data?.map((membre) => (
                <tr key={membre.user_id}>
                  <td className="text-sm">
                    <div className="font-medium">{membre.full_name || membre.email}</div>
                    <div className="text-suau text-xs">{membre.email}</div>
                  </td>
                  <td>
                    <Etiqueta to={membre.role === "admin" ? "accent" : "neutre"}>
                      {ROLS[membre.role] ?? membre.role}
                    </Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-suau mt-3 text-xs">
            Els accessos es donen des de l'administració d'usuaris.
          </p>
        </Estat>
      </Targeta>
    </div>
  );
}
