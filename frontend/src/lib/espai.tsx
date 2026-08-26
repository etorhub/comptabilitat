import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useEspais } from "../api/hooks";
import type { Espai } from "../api/types";

interface Context {
  /** L'espai actiu. Sempre n'hi ha exactament un: no hi ha vista consolidada. */
  espai: Espai;
  codi: string;
  /** Tots els espais on l'usuari té accés, per al selector. */
  espais: Espai[];
  potEditar: boolean;
  potGestionar: boolean;
}

const EspaiContext = createContext<Context | null>(null);
const ULTIM = "comptabilitat.ultim-espai";

/** Recorda l'últim espai visitat per obrir-hi directament la propera vegada. */
export function ultimEspai(): string | null {
  try {
    return localStorage.getItem(ULTIM);
  } catch {
    return null;
  }
}

export function ProveidorEspai({ children }: { children: ReactNode }) {
  // Les pàgines transversals (connexions) no porten codi a la ruta: llavors es
  // manté l'últim espai visitat, perquè el selector de la barra lateral tingui
  // sempre alguna cosa a mostrar.
  const { codi: codiRuta } = useParams();
  const { data: espais = [], isLoading, isError } = useEspais();

  if (isLoading) {
    return <p className="text-suau p-8 text-center text-sm">Carregant…</p>;
  }

  if (isError || espais.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="font-medium">No tens accés a cap espai.</p>
        <p className="text-suau mt-1 text-sm">
          Demana a qui administra l'aplicació que t'hi doni accés.
        </p>
      </div>
    );
  }

  const codi = codiRuta ?? ultimEspai() ?? espais[0].code;
  const espai = espais.find((item) => item.code === codi);
  if (!espai) {
    return <Navigate to={`/e/${espais[0].code}`} replace />;
  }

  try {
    localStorage.setItem(ULTIM, espai.code);
  } catch {
    // Navegació privada o emmagatzematge bloquejat: no és res greu.
  }

  const valor: Context = {
    espai,
    codi: espai.code,
    espais,
    potEditar: espai.role === "editor" || espai.role === "admin",
    potGestionar: espai.role === "admin",
  };

  return <EspaiContext.Provider value={valor}>{children}</EspaiContext.Provider>;
}

export function useEspaiActiu(): Context {
  const context = useContext(EspaiContext);
  if (!context) throw new Error("useEspaiActiu fora del proveïdor");
  return context;
}
