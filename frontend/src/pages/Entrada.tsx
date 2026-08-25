import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEntrada } from "../api/hooks";
import { Boto } from "../components/ui";

export function Entrada() {
  const [email, setEmail] = useState("");
  const [contrasenya, setContrasenya] = useState("");
  const entrada = useEntrada();
  const navega = useNavigate();

  function envia(event: React.FormEvent) {
    event.preventDefault();
    entrada.mutate(
      { email, password: contrasenya },
      { onSuccess: () => navega("/", { replace: true }) },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={envia} className="superficie w-full max-w-sm rounded-xl p-6">
        <h1 className="text-xl font-semibold">Comptabilitat</h1>
        <p className="text-suau mt-1 mb-6 text-sm">Entra per veure els teus llibres.</p>

        <label className="mb-3 block text-sm">
          <span className="text-suau">Correu</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="mt-1 w-full"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="text-suau">Contrasenya</span>
          <input
            type="password"
            value={contrasenya}
            onChange={(event) => setContrasenya(event.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full"
          />
        </label>

        {entrada.isError && (
          <p className="mb-3 text-sm" style={{ color: "var(--negatiu)" }}>
            {entrada.error instanceof Error ? entrada.error.message : "No s'ha pogut entrar"}
          </p>
        )}

        <Boto type="submit" tipus="primari" disabled={entrada.isPending} className="w-full">
          {entrada.isPending ? "Entrant…" : "Entra"}
        </Boto>
      </form>
    </div>
  );
}
