import { useMemo, useState } from "react";
import { ErrorAPI } from "../api/client";
import {
  useActualitzaCategoria,
  useCategoriesAmbEstadistiques,
  useCreaCategoria,
  useEsborraCategoria,
} from "../api/hooks";
import type { Categoria } from "../api/types";
import { SelectorCategoria } from "../components/SelectorCategoria";
import { Boto, Estat, Etiqueta, Import, Targeta } from "../components/ui";
import { useEspaiActiu } from "../lib/espai";

const ETIQUETES_KIND: Record<Categoria["kind"], string> = {
  expense: "Despeses",
  income: "Ingressos",
  transfer: "Traspassos",
};

type Fila =
  | { tipus: "pare"; categoria: Categoria }
  | { tipus: "fill"; categoria: Categoria; pare: Categoria };

function construeixArbre(categories: Categoria[]): Record<Categoria["kind"], Fila[]> {
  const perKind: Record<Categoria["kind"], Fila[]> = {
    expense: [],
    income: [],
    transfer: [],
  };
  const pares = categories.filter((c) => c.parent_id === null);
  const fillsPerPare = new Map<number, Categoria[]>();
  for (const categoria of categories) {
    if (categoria.parent_id !== null) {
      const llista = fillsPerPare.get(categoria.parent_id) ?? [];
      llista.push(categoria);
      fillsPerPare.set(categoria.parent_id, llista);
    }
  }
  for (const pare of pares) {
    perKind[pare.kind].push({ tipus: "pare", categoria: pare });
    for (const fill of fillsPerPare.get(pare.id) ?? []) {
      perKind[pare.kind].push({ tipus: "fill", categoria: fill, pare });
    }
  }
  return perKind;
}

function idsExclosos(categoria: Categoria, categories: Categoria[]): number[] {
  const fills = categories.filter((c) => c.parent_id === categoria.id).map((c) => c.id);
  return [categoria.id, ...fills];
}

export function Categories() {
  const { codi, espai, potEditar } = useEspaiActiu();
  const categoriesQuery = useCategoriesAmbEstadistiques(codi);
  const crea = useCreaCategoria(codi);
  const actualitza = useActualitzaCategoria(codi);
  const esborra = useEsborraCategoria(codi);

  const categories = categoriesQuery.data ?? [];
  const arbre = useMemo(() => construeixArbre(categories), [categories]);

  const [nomNou, setNomNou] = useState("");
  const [kindNou, setKindNou] = useState<Categoria["kind"]>("expense");
  const [pareNou, setPareNou] = useState<number | null>(null);
  const [subscripcioNou, setSubscripcioNou] = useState(false);

  const [editantId, setEditantId] = useState<number | null>(null);
  const [nomEditat, setNomEditat] = useState("");

  const [esborrantId, setEsborrantId] = useState<number | null>(null);
  const [reassignaA, setReassignaA] = useState<number | null>(null);
  const [errorEsborrat, setErrorEsborrat] = useState<string | null>(null);
  const [calReassignar, setCalReassignar] = useState(false);

  const paresDisponibles = categories.filter((c) => c.parent_id === null);

  function desaNova() {
    if (!nomNou.trim()) return;
    crea.mutate(
      {
        name: nomNou.trim(),
        kind: kindNou,
        parent_id: pareNou,
        is_subscription: subscripcioNou,
      },
      {
        onSuccess: () => {
          setNomNou("");
          setPareNou(null);
          setSubscripcioNou(false);
        },
      },
    );
  }

  function iniciaEdicio(categoria: Categoria) {
    setEditantId(categoria.id);
    setNomEditat(categoria.name);
  }

  function desaEdicio(id: number) {
    if (!nomEditat.trim()) return;
    actualitza.mutate(
      { id, name: nomEditat.trim() },
      { onSuccess: () => setEditantId(null) },
    );
  }

  function toggleSubscripcio(categoria: Categoria) {
    actualitza.mutate({ id: categoria.id, is_subscription: !categoria.is_subscription });
  }

  function preparaEsborrat(categoria: Categoria) {
    setEsborrantId(categoria.id);
    setReassignaA(null);
    setErrorEsborrat(null);
    setCalReassignar(false);
  }

  function cancelaEsborrat() {
    setEsborrantId(null);
    setReassignaA(null);
    setErrorEsborrat(null);
    setCalReassignar(false);
  }

  function confirmaEsborrat(categoria: Categoria) {
    esborra.mutate(
      { id: categoria.id, reassign_to: calReassignar ? reassignaA : undefined },
      {
        onSuccess: () => cancelaEsborrat(),
        onError: (error) => {
          if (error instanceof ErrorAPI && error.estat === 409) {
            setCalReassignar(true);
            setErrorEsborrat(error.message);
            return;
          }
          setErrorEsborrat(error instanceof Error ? error.message : "Hi ha hagut un problema");
        },
      },
    );
  }

  function renderFila(fila: Fila) {
    const categoria = fila.categoria;
    const esPare = fila.tipus === "pare";
    const enEsborrat = esborrantId === categoria.id;

    return (
      <tr key={categoria.id}>
        <td className="text-sm">
          {editantId === categoria.id ? (
            <div className="flex items-center gap-2">
              <input
                value={nomEditat}
                onChange={(event) => setNomEditat(event.target.value)}
                className="w-full max-w-xs"
                autoFocus
              />
              <Boto tipus="primari" onClick={() => desaEdicio(categoria.id)}>
                Desa
              </Boto>
              <Boto onClick={() => setEditantId(null)}>Cancel·la</Boto>
            </div>
          ) : (
            <div className={esPare ? "font-semibold" : "pl-6"}>
              {!esPare && <span className="text-suau mr-1">›</span>}
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ background: categoria.color }}
              />
              {categoria.name}
              {categoria.is_system && (
                <span className="text-suau ml-2 text-xs">(sistema)</span>
              )}
            </div>
          )}
        </td>
        <td>
          {potEditar ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={categoria.is_subscription}
                onChange={() => toggleSubscripcio(categoria)}
              />
              {categoria.is_subscription && <Etiqueta to="accent">subscripció</Etiqueta>}
            </label>
          ) : categoria.is_subscription ? (
            <Etiqueta to="accent">subscripció</Etiqueta>
          ) : (
            "—"
          )}
        </td>
        <td className="text-right text-sm tabular-nums">
          {categoria.transaction_count ?? 0}
        </td>
        <td className="whitespace-nowrap text-right">
          <Import valor={categoria.total_amount ?? "0"} />
        </td>
        {potEditar && (
          <td className="whitespace-nowrap">
            {enEsborrat ? (
              <div className="flex min-w-72 flex-col gap-2">
                {calReassignar && (
                  <>
                    <p className="text-suau text-xs">{errorEsborrat}</p>
                    <SelectorCategoria
                      categories={categories}
                      value={reassignaA}
                      onChange={setReassignaA}
                      placeholder="Mou els moviments a…"
                      excludeIds={idsExclosos(categoria, categories)}
                    />
                  </>
                )}
                {!calReassignar && (
                  <p className="text-suau text-xs">Segur que vols esborrar «{categoria.name}»?</p>
                )}
                {errorEsborrat && !calReassignar && (
                  <p className="text-xs" style={{ color: "var(--negatiu)" }}>
                    {errorEsborrat}
                  </p>
                )}
                <div className="flex gap-2">
                  <Boto
                    tipus="perillos"
                    disabled={calReassignar && !reassignaA}
                    onClick={() => confirmaEsborrat(categoria)}
                  >
                    {esborra.isPending ? "Esborrant…" : "Confirma"}
                  </Boto>
                  <Boto onClick={cancelaEsborrat}>Cancel·la</Boto>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <Boto onClick={() => iniciaEdicio(categoria)}>Canvia el nom</Boto>
                {esPare && (
                  <Boto
                    onClick={() => {
                      setPareNou(categoria.id);
                      setKindNou(categoria.kind);
                      setNomNou("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Afegeix subcategoria
                  </Boto>
                )}
                <Boto tipus="perillos" onClick={() => preparaEsborrat(categoria)}>
                  Esborra
                </Boto>
              </div>
            )}
          </td>
        )}
      </tr>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Categories de {espai.name}</h1>
        <p className="text-suau text-sm">
          Organitza les despeses i ingressos en categories i subcategories. Marca les subscripcions
          per identificar-les ràpidament.
        </p>
      </header>

      {potEditar && (
        <Targeta titol="Afegeix una categoria">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="text-suau block text-xs">Nom</span>
              <input
                value={nomNou}
                onChange={(event) => setNomNou(event.target.value)}
                placeholder="Nom de la categoria"
                className="mt-1 w-56"
              />
            </label>
            {!pareNou && (
              <label className="text-sm">
                <span className="text-suau block text-xs">Tipus</span>
                <select
                  value={kindNou}
                  onChange={(event) => setKindNou(event.target.value as Categoria["kind"])}
                  className="mt-1"
                >
                  <option value="expense">Despesa</option>
                  <option value="income">Ingrés</option>
                  <option value="transfer">Traspàs</option>
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="text-suau block text-xs">Categoria pare (opcional)</span>
              <select
                value={pareNou ?? ""}
                onChange={(event) =>
                  setPareNou(event.target.value ? Number(event.target.value) : null)
                }
                className="mt-1 w-56"
              >
                <option value="">Cap (primer nivell)</option>
                {paresDisponibles.map((pare) => (
                  <option key={pare.id} value={pare.id}>
                    {pare.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={subscripcioNou}
                onChange={(event) => setSubscripcioNou(event.target.checked)}
              />
              És una subscripció
            </label>
            <Boto tipus="primari" onClick={desaNova} disabled={crea.isPending || !nomNou.trim()}>
              {crea.isPending ? "Afegint…" : "Afegeix"}
            </Boto>
          </div>
        </Targeta>
      )}

      <Estat
        carregant={categoriesQuery.isLoading}
        error={categoriesQuery.error}
        buit={!categories.length}
        missatgeBuit="Encara no hi ha cap categoria."
      >
        {(Object.keys(arbre) as Categoria["kind"][]).map((kind) => {
          const files = arbre[kind];
          if (!files.length) return null;
          return (
            <Targeta key={kind} titol={ETIQUETES_KIND[kind]}>
              <div className="overflow-x-auto">
                <table className="dades">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Subscripció</th>
                      <th className="text-right">Moviments</th>
                      <th className="text-right">Total</th>
                      {potEditar && <th />}
                    </tr>
                  </thead>
                  <tbody>{files.map(renderFila)}</tbody>
                </table>
              </div>
            </Targeta>
          );
        })}
      </Estat>
    </div>
  );
}
