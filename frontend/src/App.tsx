import { Navigate, Route, Routes } from "react-router-dom";
import { useUsuari } from "./api/hooks";
import { Layout } from "./components/Layout";
import { ProveidorLlibres } from "./lib/llibres";
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
  return <ProveidorLlibres>{children}</ProveidorLlibres>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrada" element={<Entrada />} />
      <Route
        element={
          <Protegit>
            <Layout />
          </Protegit>
        }
      >
        <Route path="/" element={<Panell />} />
        <Route path="/moviments" element={<Moviments />} />
        <Route path="/revisio" element={<Revisio />} />
        <Route path="/recurrents" element={<Recurrents />} />
        <Route path="/informes" element={<Informes />} />
        <Route path="/previsio" element={<Previsio />} />
        <Route path="/avisos" element={<Avisos />} />
        <Route path="/connexions" element={<Connexions />} />
        <Route path="/configuracio" element={<Configuracio />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
