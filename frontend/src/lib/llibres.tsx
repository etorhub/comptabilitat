import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLlibres } from "../api/hooks";
import type { Llibre } from "../api/types";

interface Ambit {
  llibres: Llibre[];
  seleccionats: number[];
  /** undefined quan hi son tots: l'API ho interpreta com a vista consolidada. */
  filtre: number[] | undefined;
  alterna: (id: number) => void;
  totsSeleccionats: boolean;
  selecionaTots: () => void;
  carregant: boolean;
}

const Context = createContext<Ambit | null>(null);
const CLAU = "comptabilitat.llibres";

export function ProveidorLlibres({ children }: { children: ReactNode }) {
  const { data: llibres = [], isLoading } = useLlibres();
  const [seleccionats, setSeleccionats] = useState<number[]>([]);

  useEffect(() => {
    if (!llibres.length) return;
    const desats = localStorage.getItem(CLAU);
    const valids = new Set(llibres.map((llibre) => llibre.id));
    const recuperats = desats
      ? (JSON.parse(desats) as number[]).filter((id) => valids.has(id))
      : [];
    setSeleccionats(recuperats.length ? recuperats : llibres.map((llibre) => llibre.id));
  }, [llibres]);

  useEffect(() => {
    if (seleccionats.length) localStorage.setItem(CLAU, JSON.stringify(seleccionats));
  }, [seleccionats]);

  const valor = useMemo<Ambit>(() => {
    const totsSeleccionats = llibres.length > 0 && seleccionats.length === llibres.length;
    return {
      llibres,
      seleccionats,
      filtre: totsSeleccionats ? undefined : seleccionats,
      totsSeleccionats,
      carregant: isLoading,
      alterna: (id: number) =>
        setSeleccionats((actuals) => {
          const seguents = actuals.includes(id)
            ? actuals.filter((element) => element !== id)
            : [...actuals, id];
          // Mai es queda tot buit: sense cap llibre no hi hauria res a mirar.
          return seguents.length ? seguents : actuals;
        }),
      selecionaTots: () => setSeleccionats(llibres.map((llibre) => llibre.id)),
    };
  }, [llibres, seleccionats, isLoading]);

  return <Context.Provider value={valor}>{children}</Context.Provider>;
}

export function useAmbitLlibres(): Ambit {
  const context = useContext(Context);
  if (!context) throw new Error("useAmbitLlibres fora del proveidor");
  return context;
}
