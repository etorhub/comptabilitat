import { Navigate, Route, Routes } from "react-router-dom";
import { useUsuari } from "./api/hooks";
import { Layout } from "./components/Layout";
import { ProveidorEspai, ultimEspai } from "./lib/espai";
import { Avisos } from "./pages/Avisos";
import { Configuracio } from "./pages/Configuracio";
import { Connexions } from "./pages/Connexions";
import { Entrada } from "./pages/Entrada";
import { Informes } from "./pages/Informes";
import { Moviments } from "./pages/Moviments";
import { Panell } from "./pages/Panell";
import { Previsio } from "./pages/Previsio";
import { Recurrents } from "./pages/Recurrents";
import { Revisio } from "./pages/Revisio";

function Protegit({ children }: { children: React.ReactNode }) {
  const { data: usuari, isLoading, isError } = useUsuari();

  if (isLoading) {
    return <p className="text-suau p-8 text-center text-sm">Carregant…</p>;
  }
  if (isError || !usuari) {
    return <Navigate to="/entrada" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  // L'aplicació sempre és dins d'un espai: l'arrel porta a l'últim visitat.
  const inici = ultimEspai() ? `/e/${ultimEspai()}` : "/e/-";

  return (
    <Routes>
      <Route path="/entrada" element={<Entrada />} />

      <Route
        path="/e/:codi"
        element={
          <Protegit>
            <ProveidorEspai>
              <Layout />
            </ProveidorEspai>
          </Protegit>
        }
      >
        <Route index element={<Panell />} />
        <Route path="moviments" element={<Moviments />} />
        <Route path="revisio" element={<Revisio />} />
        <Route path="recurrents" element={<Recurrents />} />
        <Route path="informes" element={<Informes />} />
        <Route path="previsio" element={<Previsio />} />
        <Route path="avisos" element={<Avisos />} />
        <Route path="configuracio" element={<Configuracio />} />
      </Route>

      {/* Les connexions bancàries són transversals: no pengen de cap espai. */}
      <Route
        path="/connexions"
        element={
          <Protegit>
            <ProveidorEspai>
              <Layout />
            </ProveidorEspai>
          </Protegit>
        }
      >
        <Route index element={<Connexions />} />
      </Route>

      <Route path="*" element={<Navigate to={inici} replace />} />
    </Routes>
  );
}
