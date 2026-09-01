import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAvisos, usePanell, useSortida, useUsuari } from "../api/hooks";
import { useEspaiActiu } from "../lib/espai";
import { Etiqueta } from "./ui";

const SECCIONS = [
  { a: "", text: "Panell", exacte: true },
  { a: "moviments", text: "Moviments" },
  { a: "revisio", text: "Per revisar", comptador: "revisio" as const },
  { a: "recurrents", text: "Recurrents" },
  { a: "categories", text: "Categories" },
  { a: "informes", text: "Informes" },
  { a: "previsio", text: "Previsió" },
  { a: "avisos", text: "Avisos", comptador: "avisos" as const },
  { a: "configuracio", text: "Configuració" },
];

export function Layout() {
  const { data: usuari } = useUsuari();
  const { codi, espai, espais } = useEspaiActiu();
  const { data: panell } = usePanell(codi);
  const { data: avisos = [] } = useAvisos(codi);
  const sortida = useSortida();
  const navega = useNavigate();

  const comptadors = {
    revisio: panell?.pending_review ?? 0,
    avisos: avisos.filter((avis) => avis.status === "new").length,
  };

  const enllac = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition ${
      isActive ? "font-semibold" : "text-suau hover:opacity-80"
    }`;

  const estilActiu = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
      : undefined;

  return (
    <div className="flex min-h-screen">
      <aside
        className="hidden w-60 shrink-0 flex-col justify-between border-r p-4 md:flex"
        style={{ borderColor: "var(--vora)", background: "var(--superficie)" }}
      >
        <div>
          {/* Selector d'espai: sempre n'hi ha un d'actiu i només un. */}
          <label className="mb-6 block">
            <span className="text-suau text-xs uppercase tracking-wide">Espai</span>
            <select
              value={codi}
              onChange={(event) => navega(`/e/${event.target.value}`)}
              className="mt-1 w-full font-semibold"
              style={{ borderLeft: `4px solid ${espai.color}` }}
            >
              {espais.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="text-suau mt-1 block text-xs">{usuari?.email}</span>
          </label>

          <nav className="flex flex-col gap-0.5">
            {SECCIONS.map((seccio) => (
              <NavLink
                key={seccio.a}
                to={`/e/${codi}${seccio.a ? `/${seccio.a}` : ""}`}
                end={seccio.exacte}
                className={enllac}
                style={estilActiu}
              >
                <span>{seccio.text}</span>
                {seccio.comptador && comptadors[seccio.comptador] > 0 && (
                  <Etiqueta to="avis">{comptadors[seccio.comptador]}</Etiqueta>
                )}
              </NavLink>
            ))}
          </nav>

          {usuari?.is_admin && (
            <>
              <div className="text-suau mt-6 mb-1 px-3 text-xs uppercase tracking-wide">
                Administració
              </div>
              <nav className="flex flex-col gap-0.5">
                <NavLink to="/connexions" className={enllac} style={estilActiu}>
                  Connexions bancàries
                </NavLink>
              </nav>
            </>
          )}
        </div>

        <button
          type="button"
          className="text-suau px-3 py-2 text-left text-sm hover:opacity-80"
          onClick={() => sortida.mutate(undefined, { onSuccess: () => navega("/entrada") })}
        >
          Tanca la sessió
        </button>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
