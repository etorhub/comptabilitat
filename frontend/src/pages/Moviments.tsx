import { useMemo, useState } from "react";
import { descarrega } from "../api/client";
import {
  useCategories,
  useCategoritza,
  useCategoritzaEnLot,
  useMoviments,
  type FiltresMoviments,
} from "../api/hooks";
import type { Moviment } from "../api/types";
import { SelectorCategoria } from "../components/SelectorCategoria";
import { Boto, Estat, Etiqueta, Import, Targeta } from "../components/ui";
import { data, diesEnrere } from "../lib/format";
import { useEspaiActiu } from "../lib/espai";

const PER_PAGINA = 50;

const ORIGEN: Record<Moviment["category_source"], { text: string; to: Parameters<typeof Etiqueta>[0]["to"] }> = {
  none: { text: "sense classificar", to: "neutre" },
  merchant: { text: "comerç", to: "accent" },
  rule: { text: "regla", to: "accent" },
  llm: { text: "model", to: "avis" },
  user: { text: "tu", to: "positiu" },
};

export function Moviments() {
  const { codi, espai, potEditar } = useEspaiActiu();
  const { data: categories = [] } = useCategories(codi);
  const categoritza = useCategoritza(codi);
  const enLot = useCategoritzaEnLot(codi);

  const [cerca, setCerca] = useState("");
  const [desDe, setDesDe] = useState(diesEnrere(90));
  const [finsA, setFinsA] = useState("");
  const [nomesSenseClassificar, setNomesSenseClassificar] = useState(false);
  const [inclouTraspassos, setInclouTraspassos] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [seleccio, setSeleccio] = useState<number[]>([]);

  const filtres: FiltresMoviments = useMemo(
    () => ({
      search: cerca || undefined,
      date_from: desDe || undefined,
      date_to: finsA || undefined,
      only_uncategorized: nomesSenseClassificar || undefined,
      include_transfers: inclouTraspassos,
      limit: PER_PAGINA,
      offset: pagina * PER_PAGINA,
    }),
    [cerca, desDe, finsA, nomesSenseClassificar, inclouTraspassos, pagina],
  );

  const moviments = useMoviments(codi, filtres);
  const total = moviments.data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / PER_PAGINA) - 1);

  const parametresExport = {
    search: cerca || undefined,
    date_from: desDe || undefined,
    date_to: finsA || undefined,
  };

  function alternaSeleccio(id: number) {
    setSeleccio((actual) =>
      actual.includes(id) ? actual.filter((element) => element !== id) : [...actual, id],
    );
  }

  function aplicaEnLot(categoriaId: number) {
    enLot.mutate(
      { transaction_ids: seleccio, category_id: categoriaId },
      { onSuccess: () => setSeleccio([]) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Moviments</h1>
          <p className="text-suau text-sm">
            {total} {total === 1 ? "moviment" : "moviments"} a {espai.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Boto onClick={() => descarrega(`/workspaces/${codi}/export/transactions.csv`, parametresExport)}>
            Exporta CSV
          </Boto>
          <Boto onClick={() => descarrega(`/workspaces/${codi}/export/transactions.xlsx`, parametresExport)}>
            Exporta Excel
          </Boto>
        </div>
      </header>

      <Targeta>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-suau block text-xs">Cerca</span>
            <input
              value={cerca}
              onChange={(event) => {
                setCerca(event.target.value);
                setPagina(0);
              }}
              placeholder="concepte, comerç…"
              className="mt-1 w-56"
            />
          </label>
          <label className="text-sm">
            <span className="text-suau block text-xs">Des de</span>
            <input
              type="date"
              value={desDe}
              onChange={(event) => {
                setDesDe(event.target.value);
                setPagina(0);
              }}
              className="mt-1"
            />
          </label>
          <label className="text-sm">
            <span className="text-suau block text-xs">Fins a</span>
            <input
              type="date"
              value={finsA}
              onChange={(event) => {
                setFinsA(event.target.value);
                setPagina(0);
              }}
              className="mt-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={nomesSenseClassificar}
              onChange={(event) => {
                setNomesSenseClassificar(event.target.checked);
                setPagina(0);
              }}
            />
            Només sense classificar
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inclouTraspassos}
              onChange={(event) => {
                setInclouTraspassos(event.target.checked);
                setPagina(0);
              }}
            />
            Inclou traspassos
          </label>
        </div>
      </Targeta>

      {potEditar && seleccio.length > 0 && (
        <Targeta>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{seleccio.length} seleccionats</span>
            <SelectorCategoria
              categories={categories}
              value={null}
              onChange={(categoryId) => {
                if (categoryId !== null) aplicaEnLot(categoryId);
              }}
              placeholder="Assigna una categoria…"
            />
            <Boto onClick={() => setSeleccio([])}>Deselecciona</Boto>
          </div>
        </Targeta>
      )}

      <Targeta className="overflow-x-auto">
        <Estat
          carregant={moviments.isLoading}
          error={moviments.error}
          buit={!moviments.data?.items.length}
          missatgeBuit="Cap moviment amb aquests filtres."
        >
          <table className="dades">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Data</th>
                <th>Concepte</th>
                <th>Comerç</th>
                <th>Categoria</th>
                <th className="text-right">Import</th>
              </tr>
            </thead>
            <tbody>
              {moviments.data?.items.map((moviment) => (
                <tr key={moviment.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={seleccio.includes(moviment.id)}
                      onChange={() => alternaSeleccio(moviment.id)}
                    />
                  </td>
                  <td className="whitespace-nowrap text-sm">
                    {data(moviment.booking_date)}
                    {moviment.status === "pending" && (
                      <div>
                        <Etiqueta to="avis">pendent</Etiqueta>
                      </div>
                    )}
                  </td>
                  <td className="max-w-md text-sm">
                    <div className="truncate" title={moviment.description}>
                      {moviment.description || "—"}
                    </div>
                    {moviment.transfer_group_id && <Etiqueta>traspàs</Etiqueta>}
                  </td>
                  <td className="text-sm">{moviment.merchant_name ?? "—"}</td>
                  <td>
                    <SelectorCategoria
                      categories={categories}
                      value={moviment.category_id}
                      disabled={!potEditar}
                      onChange={(categoryId) =>
                        categoritza.mutate({
                          id: moviment.id,
                          category_id: categoryId,
                        })
                      }
                    />
                    <div className="mt-1">
                      <Etiqueta to={ORIGEN[moviment.category_source].to}>
                        {ORIGEN[moviment.category_source].text}
                      </Etiqueta>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Import valor={moviment.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estat>
      </Targeta>

      {total > PER_PAGINA && (
        <div className="flex items-center justify-center gap-3">
          <Boto onClick={() => setPagina((actual) => Math.max(0, actual - 1))} disabled={pagina === 0}>
            Anterior
          </Boto>
          <span className="text-suau text-sm">
            Pàgina {pagina + 1} de {ultimaPagina + 1}
          </span>
          <Boto
            onClick={() => setPagina((actual) => Math.min(ultimaPagina, actual + 1))}
            disabled={pagina >= ultimaPagina}
          >
            Següent
          </Boto>
        </div>
      )}
    </div>
  );
}
