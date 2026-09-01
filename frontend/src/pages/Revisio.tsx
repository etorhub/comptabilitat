import { useCategories, useCategoritza, useRevisio } from "../api/hooks";
import { SelectorCategoria } from "../components/SelectorCategoria";
import { Boto, Estat, Etiqueta, Import, Targeta } from "../components/ui";
import { data } from "../lib/format";
import { useEspaiActiu } from "../lib/espai";

export function Revisio() {
  const { codi } = useEspaiActiu();
  const revisio = useRevisio(codi);
  const { data: categories = [] } = useCategories(codi);
  const categoritza = useCategoritza(codi);

  const elements = revisio.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Per revisar</h1>
        <p className="text-suau text-sm">
          Moviments que el sistema no ha sabut classificar amb prou seguretat. En confirmar-ne
          un, la decisió es recorda per a tot el comerç.
        </p>
      </header>

      <Estat
        carregant={revisio.isLoading}
        error={revisio.error}
        buit={!elements.length}
        missatgeBuit="No queda res per revisar."
      >
        <div className="flex flex-col gap-3">
          {elements.map(({ transaction, suggested_category_id, suggested_category_name, confidence, rationale }) => (
            <Targeta key={transaction.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-suau text-xs">{data(transaction.booking_date)}</span>
                    {transaction.merchant_name && (
                      <span className="font-medium">{transaction.merchant_name}</span>
                    )}
                  </div>
                  <p className="text-suau mt-1 truncate text-sm">{transaction.description}</p>
                  {transaction.is_masked && (
                    <div className="mt-1">
                      <Etiqueta>enmascarat</Etiqueta>
                    </div>
                  )}
                  {suggested_category_name && (
                    <p className="mt-2 text-sm">
                      <Etiqueta to="avis">
                        proposta: {suggested_category_name}
                        {confidence != null && ` · ${Math.round(confidence * 100)}%`}
                      </Etiqueta>
                      {rationale && <span className="text-suau ml-2 text-xs">{rationale}</span>}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Import valor={transaction.amount} />
                  <div className="flex items-center gap-2">
                    <SelectorCategoria
                      categories={categories}
                      value={transaction.category_id ?? suggested_category_id ?? null}
                      onChange={(categoryId) =>
                        categoritza.mutate({
                          id: transaction.id,
                          category_id: categoryId,
                        })
                      }
                    />
                    <Boto
                      tipus="primari"
                      disabled={!transaction.category_id && !suggested_category_id}
                      onClick={() =>
                        categoritza.mutate({
                          id: transaction.id,
                          category_id: transaction.category_id ?? suggested_category_id,
                        })
                      }
                    >
                      Confirma
                    </Boto>
                  </div>
                </div>
              </div>
            </Targeta>
          ))}
        </div>
      </Estat>
    </div>
  );
}
