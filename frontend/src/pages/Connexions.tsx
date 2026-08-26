import { useSearchParams } from "react-router-dom";
import {
  useAssignaEspai,
  useAutoritza,
  useComptesSenseEspai,
  useConnexions,
  useEspais,
  useSincronitza,
} from "../api/hooks";
import type { Connexio } from "../api/types";
import { Boto, Estat, Etiqueta, Import, Targeta } from "../components/ui";
import { data } from "../lib/format";

const ESTATS: Record<Connexio["status"], { text: string; to: "positiu" | "avis" | "negatiu" | "neutre" }> = {
  active: { text: "activa", to: "positiu" },
  pending: { text: "pendent d'autoritzar", to: "avis" },
  expired: { text: "consentiment caducat", to: "negatiu" },
  revoked: { text: "revocada", to: "neutre" },
  error: { text: "amb errors", to: "negatiu" },
};

export function Connexions() {
  const connexions = useConnexions();
  const senseEspaiConsulta = useComptesSenseEspai();
  const { data: espais = [] } = useEspais();
  const autoritza = useAutoritza();
  const sincronitza = useSincronitza();
  const assigna = useAssignaEspai();
  const [parametres] = useSearchParams();

  const estatRetorn = parametres.get("estat");
  const motiu = parametres.get("motiu");

  function connecta(connectionId?: number) {
    autoritza.mutate(
      connectionId ? { connection_id: connectionId } : {},
      {
        // El banc demana l'SCA a la seva pàgina: hi anem amb el navegador.
        onSuccess: (resposta) => {
          window.location.href = resposta.authorization_url;
        },
      },
    );
  }

  const senseEspai = senseEspaiConsulta.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Connexions bancàries</h1>
          <p className="text-suau text-sm">
            El consentiment del banc caduca cada 90 dies i cal renovar-lo amb autenticació al banc.
          </p>
        </div>
        <Boto tipus="primari" onClick={() => connecta()} disabled={autoritza.isPending}>
          {autoritza.isPending ? "Obrint el banc…" : "Connecta un banc"}
        </Boto>
      </header>

      {estatRetorn === "ok" && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "color-mix(in srgb, var(--positiu) 10%, transparent)",
            border: "1px solid var(--positiu)",
          }}
        >
          Connexió autoritzada. Assigna cada compte al seu espai i després sincronitza.
        </div>
      )}
      {estatRetorn === "error" && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "color-mix(in srgb, var(--negatiu) 10%, transparent)",
            border: "1px solid var(--negatiu)",
            color: "var(--negatiu)",
          }}
        >
          El banc no ha completat l'autorització{motiu ? `: ${motiu}` : "."}
        </div>
      )}

      {autoritza.isError && (
        <p className="text-sm" style={{ color: "var(--negatiu)" }}>
          {autoritza.error instanceof Error ? autoritza.error.message : "No s'ha pogut connectar"}
        </p>
      )}

      {senseEspai.length > 0 && (
        <Targeta titol="Comptes sense espai assignat">
          <p className="text-suau mb-3 text-sm">
            Fins que no tinguin espai, els seus moviments no apareixen enlloc. Assignar un
            compte a un espai hi arrossega tot el seu historial.
          </p>
          <table className="dades">
            <tbody>
              {senseEspai.map((compte) => (
                <tr key={compte.id}>
                  <td className="text-sm">
                    {compte.name || compte.product} · {compte.iban_masked}
                  </td>
                  <td>
                    <select
                      defaultValue=""
                      onChange={(event) =>
                        assigna.mutate({ id: compte.id, ledger_id: Number(event.target.value) })
                      }
                    >
                      <option value="">Tria un espai…</option>
                      {espais.map((espai) => (
                        <option key={espai.id} value={espai.id}>
                          {espai.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Targeta>
      )}

      <Estat
        carregant={connexions.isLoading}
        error={connexions.error}
        buit={!connexions.data?.length}
        missatgeBuit="Encara no hi ha cap banc connectat."
      >
        <div className="flex flex-col gap-4">
          {connexions.data?.map((connexio) => (
            <Targeta
              key={connexio.id}
              titol={
                <span className="flex items-center gap-2">
                  {connexio.aspsp_name} ({connexio.aspsp_country})
                  <Etiqueta to={ESTATS[connexio.status].to}>
                    {ESTATS[connexio.status].text}
                  </Etiqueta>
                </span>
              }
              accio={
                <div className="flex gap-2">
                  <Boto
                    onClick={() => sincronitza.mutate({ id: connexio.id })}
                    disabled={sincronitza.isPending || connexio.status !== "active"}
                  >
                    {sincronitza.isPending ? "Sincronitzant…" : "Sincronitza"}
                  </Boto>
                  <Boto onClick={() => connecta(connexio.id)}>Renova el consentiment</Boto>
                </div>
              }
            >
              <div className="text-suau mb-3 flex flex-wrap gap-6 text-sm">
                <span>
                  Última sincronització: {connexio.last_sync_at ? data(connexio.last_sync_at) : "mai"}
                </span>
                <span>
                  Caduca:{" "}
                  {connexio.valid_until
                    ? `${data(connexio.valid_until)}${
                        connexio.days_until_expiry != null
                          ? ` (${connexio.days_until_expiry} dies)`
                          : ""
                      }`
                    : "—"}
                </span>
              </div>

              {connexio.last_error && (
                <p className="mb-3 text-sm" style={{ color: "var(--negatiu)" }}>
                  {connexio.last_error}
                </p>
              )}

              <table className="dades">
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>IBAN</th>
                    <th>Espai</th>
                    <th>Històric</th>
                    <th className="text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {connexio.accounts.map((compte) => (
                    <tr key={compte.id}>
                      <td className="text-sm">{compte.name || compte.product || "—"}</td>
                      <td className="text-suau text-sm">{compte.iban_masked}</td>
                      <td>
                        <select
                          value={compte.ledger_id ?? ""}
                          onChange={(event) =>
                            assigna.mutate({
                              id: compte.id,
                              ledger_id: event.target.value ? Number(event.target.value) : null,
                            })
                          }
                          className="text-sm"
                        >
                          <option value="">Sense espai</option>
                          {espais.map((espai) => (
                            <option key={espai.id} value={espai.id}>
                              {espai.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-suau text-sm">
                        {compte.history_start_date
                          ? `des de ${data(compte.history_start_date)}`
                          : "sense importar"}
                      </td>
                      <td className="text-right">
                        {compte.current_balance != null ? (
                          <Import valor={compte.current_balance} />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Targeta>
          ))}
        </div>
      </Estat>
    </div>
  );
}
