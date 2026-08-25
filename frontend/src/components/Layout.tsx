import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAvisos, usePanell, useSortida, useUsuari } from "../api/hooks";
import { useAmbitLlibres } from "../lib/llibres";
import { Etiqueta } from "./ui";

const SECCIONS = [
  { a: "/", text: "Panell", exacte: true },
  { a: "/moviments", text: "Moviments" },
  { a: "/revisio", text: "Per revisar", comptador: "revisio" as const },
  { a: "/recurrents", text: "Recurrents" },
  { a: "/informes", text: "Informes" },
  { a: "/previsio", text: "Previsió" },
  { a: "/avisos", text: "Avisos", comptador: "avisos" as const },
];

const SECCIONS_ADMIN = [
  { a: "/connexions", text: "Connexions" },
  { a: "/configuracio", text: "Configuració" },
];

export function Layout() {
  const { data: usuari } = useUsuari();
  const { data: panell } = usePanell(undefined);
  const { data: avisos = [] } = useAvisos();
  const sortida = useSortida();
  const navega = useNavigate();
  const { llibres, seleccionats, alterna } = useAmbitLlibres();

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
          <div className="mb-6 px-2">
            <div className="text-lg font-semibold">Comptabilitat</div>
            <div className="text-suau text-xs">{usuari?.email}</div>
          </div>

          <nav className="flex flex-col gap-0.5">
            {SECCIONS.map((seccio) => (
              <NavLink
                key={seccio.a}
                to={seccio.a}
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
                {SECCIONS_ADMIN.map((seccio) => (
                  <NavLink key={seccio.a} to={seccio.a} className={enllac} style={estilActiu}>
                    {seccio.text}
                  </NavLink>
                ))}
              </nav>
            </>
          )}

          <div className="text-suau mt-6 mb-1 px-3 text-xs uppercase tracking-wide">Llibres</div>
          <div className="flex flex-col gap-1 px-1">
            {llibres.map((llibre) => {
              const actiu = seleccionats.includes(llibre.id);
              return (
                <label
                  key={llibre.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                  style={{ opacity: actiu ? 1 : 0.45 }}
                >
                  <input
                    type="checkbox"
                    checked={actiu}
                    onChange={() => alterna(llibre.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: llibre.color }}
                    aria-hidden
                  />
                  {llibre.name}
                </label>
              );
            })}
          </div>
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
