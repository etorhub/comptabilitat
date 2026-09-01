import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "./client";
import type {
  Avis,
  Categoria,
  Comerc,
  Compte,
  Connexio,
  ElementRevisio,
  Espai,
  EspaiDetall,
  Membre,
  Moviment,
  Pagina,
  Panell,
  Previsio,
  PuntMensual,
  PuntSaldo,
  Regla,
  RepartimentCategoria,
  RepartimentComerc,
  SerieRecurrent,
  Sincronitzacio,
  Usuari,
} from "./types";

/** Filtres de la llista de moviments; es passen tal qual a l'API. */
export interface FiltresMoviments {
  account_id?: number;
  date_from?: string;
  date_to?: string;
  category_ids?: number[];
  merchant_id?: number;
  search?: string;
  min_amount?: string;
  max_amount?: string;
  only_review?: boolean;
  only_uncategorized?: boolean;
  include_transfers?: boolean;
  limit?: number;
  offset?: number;
}

/** Totes les dades pengen d'un espai: la clau de cau sempre en porta el codi. */
const dins = (codi: string, ...parts: unknown[]) => ["espai", codi, ...parts] as const;

export const claus = {
  usuari: ["usuari"] as const,
  espais: ["espais"] as const,
  connexions: ["connexions"] as const,
  usuaris: ["usuaris"] as const,
};

// --- Sessió i espais -------------------------------------------------------

export function useUsuari() {
  return useQuery({
    queryKey: claus.usuari,
    queryFn: () => get<Usuari>("/auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEntrada() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dades: { email: string; password: string }) =>
      post<Usuari>("/auth/login", dades),
    onSuccess: (usuari) => {
      client.setQueryData(claus.usuari, usuari);
      client.invalidateQueries();
    },
  });
}

export function useSortida() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => post("/auth/logout"),
    onSuccess: () => client.clear(),
  });
}

export function useEspais() {
  return useQuery({ queryKey: claus.espais, queryFn: () => get<Espai[]>("/workspaces") });
}

export function useEspai(codi: string) {
  return useQuery({
    queryKey: dins(codi, "detall"),
    queryFn: () => get<EspaiDetall>(`/workspaces/${codi}`),
    enabled: Boolean(codi),
  });
}

export function useActualitzaEspai(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dades: { alert_recipients?: string[]; overdraft_threshold?: string }) =>
      patch<EspaiDetall>(`/workspaces/${codi}`, dades),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: dins(codi, "detall") });
      client.invalidateQueries({ queryKey: claus.espais });
    },
  });
}

export function useMembres(codi: string, actiu = true) {
  return useQuery({
    queryKey: dins(codi, "membres"),
    queryFn: () => get<Membre[]>(`/workspaces/${codi}/members`),
    enabled: Boolean(codi) && actiu,
    retry: false,
  });
}

// --- Dades de l'espai ------------------------------------------------------

export function useCategories(codi: string) {
  return useQuery({
    queryKey: dins(codi, "categories"),
    queryFn: () => get<Categoria[]>(`/workspaces/${codi}/categories`),
    enabled: Boolean(codi),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCategoriesAmbEstadistiques(codi: string) {
  return useQuery({
    queryKey: dins(codi, "categories", "estadistiques"),
    queryFn: () =>
      get<Categoria[]>(`/workspaces/${codi}/categories`, { with_stats: true }),
    enabled: Boolean(codi),
  });
}

export function useCreaCategoria(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dades: {
      name: string;
      kind: Categoria["kind"];
      parent_id?: number | null;
      color?: string;
      icon?: string;
      is_subscription?: boolean;
    }) => post<Categoria>(`/workspaces/${codi}/categories`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useActualitzaCategoria(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...dades
    }: {
      id: number;
      name?: string;
      parent_id?: number | null;
      color?: string;
      icon?: string;
      is_subscription?: boolean;
    }) => patch<Categoria>(`/workspaces/${codi}/categories/${id}`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useEsborraCategoria(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reassign_to }: { id: number; reassign_to?: number | null }) =>
      del<{ message: string }>(`/workspaces/${codi}/categories/${id}`, {
        reassign_to: reassign_to ?? undefined,
      }),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useComptes(codi: string) {
  return useQuery({
    queryKey: dins(codi, "comptes"),
    queryFn: () => get<Compte[]>(`/workspaces/${codi}/accounts`),
    enabled: Boolean(codi),
  });
}

export function usePanell(codi: string) {
  return useQuery({
    queryKey: dins(codi, "panell"),
    queryFn: () => get<Panell>(`/workspaces/${codi}/analytics/dashboard`),
    enabled: Boolean(codi),
  });
}

export function useMoviments(codi: string, filtres: FiltresMoviments) {
  return useQuery({
    queryKey: dins(codi, "moviments", filtres),
    queryFn: () => get<Pagina<Moviment>>(`/workspaces/${codi}/transactions`, { ...filtres }),
    enabled: Boolean(codi),
    placeholderData: (anterior) => anterior,
  });
}

export function useRevisio(codi: string) {
  return useQuery({
    queryKey: dins(codi, "revisio"),
    queryFn: () =>
      get<Pagina<ElementRevisio>>(`/workspaces/${codi}/transactions/review`, { limit: 100 }),
    enabled: Boolean(codi),
  });
}

function invalidaEspai(client: ReturnType<typeof useQueryClient>, codi: string) {
  client.invalidateQueries({ queryKey: ["espai", codi] });
}

export function useActualitzaMoviment(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...dades
    }: {
      id: number;
      category_id?: number | null;
      display_description?: string | null;
      remember_merchant?: boolean;
      create_rule?: boolean;
    }) => patch<Moviment>(`/workspaces/${codi}/transactions/${id}`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useCategoritza(codi: string) {
  return useActualitzaMoviment(codi);
}

export function useCategoritzaEnLot(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dades: { transaction_ids: number[]; category_id: number | null }) =>
      post<{ message: string }>(`/workspaces/${codi}/transactions/bulk-categorize`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useMensual(codi: string, mesos = 12) {
  return useQuery({
    queryKey: dins(codi, "mensual", mesos),
    queryFn: () =>
      get<PuntMensual[]>(`/workspaces/${codi}/analytics/monthly`, { months: mesos }),
    enabled: Boolean(codi),
  });
}

export function useRepartimentCategories(
  codi: string,
  desDe?: string,
  finsA?: string,
  despeses = true,
) {
  return useQuery({
    queryKey: dins(codi, "repartiment-categories", desDe, finsA, despeses),
    queryFn: () =>
      get<RepartimentCategoria[]>(`/workspaces/${codi}/analytics/categories`, {
        date_from: desDe,
        date_to: finsA,
        expenses: despeses,
      }),
    enabled: Boolean(codi),
  });
}

export function useRepartimentComercos(codi: string, desDe?: string, finsA?: string) {
  return useQuery({
    queryKey: dins(codi, "repartiment-comercos", desDe, finsA),
    queryFn: () =>
      get<RepartimentComerc[]>(`/workspaces/${codi}/analytics/merchants`, {
        date_from: desDe,
        date_to: finsA,
      }),
    enabled: Boolean(codi),
  });
}

export function useSaldos(codi: string, dies = 180) {
  return useQuery({
    queryKey: dins(codi, "saldos", dies),
    queryFn: () =>
      get<PuntSaldo[]>(`/workspaces/${codi}/analytics/balance-series`, { days: dies }),
    enabled: Boolean(codi),
  });
}

export function usePrevisio(codi: string, dies = 90) {
  return useQuery({
    queryKey: dins(codi, "previsio", dies),
    queryFn: () =>
      get<Previsio>(`/workspaces/${codi}/analytics/forecast`, { horizon_days: dies }),
    enabled: Boolean(codi),
  });
}

export function useRecurrents(codi: string, nomesSubscripcions = false) {
  return useQuery({
    queryKey: dins(codi, "recurrents", nomesSubscripcions),
    queryFn: () =>
      get<SerieRecurrent[]>(`/workspaces/${codi}/recurring`, {
        only_subscriptions: nomesSubscripcions,
      }),
    enabled: Boolean(codi),
  });
}

export function useResumSubscripcions(codi: string) {
  return useQuery({
    queryKey: dins(codi, "resum-subscripcions"),
    queryFn: () => get<Record<string, string>>(`/workspaces/${codi}/recurring/summary`),
    enabled: Boolean(codi),
  });
}

export function useActualitzaSerie(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dades }: { id: number; include_in_forecast?: boolean; label?: string }) =>
      patch<SerieRecurrent>(`/workspaces/${codi}/recurring/${id}`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useAvisos(codi: string) {
  return useQuery({
    queryKey: dins(codi, "avisos"),
    queryFn: () => get<Avis[]>(`/workspaces/${codi}/alerts`),
    enabled: Boolean(codi),
  });
}

export function useDescartaAvis(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/workspaces/${codi}/alerts/${id}/dismiss`),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useComercos(codi: string, cerca: string, nomesPendents: boolean) {
  return useQuery({
    queryKey: dins(codi, "comercos", cerca, nomesPendents),
    queryFn: () =>
      get<Pagina<Comerc>>(`/workspaces/${codi}/merchants`, {
        search: cerca || undefined,
        only_unclassified: nomesPendents,
        limit: 200,
      }),
    enabled: Boolean(codi),
  });
}

export function useActualitzaComerc(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dades }: { id: number; default_category_id: number | null }) =>
      patch<Comerc>(`/workspaces/${codi}/merchants/${id}`, dades),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useRegles(codi: string) {
  return useQuery({
    queryKey: dins(codi, "regles"),
    queryFn: () => get<Regla[]>(`/workspaces/${codi}/rules`),
    enabled: Boolean(codi),
  });
}

export function useEsborraRegla(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/workspaces/${codi}/rules/${id}`),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

export function useAplicaRegla(codi: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post<{ message: string }>(`/workspaces/${codi}/rules/${id}/apply`),
    onSuccess: () => invalidaEspai(client, codi),
  });
}

// --- Administració (transversal, fora dels espais) -------------------------

export function useConnexions() {
  return useQuery({
    queryKey: claus.connexions,
    queryFn: () => get<Connexio[]>("/connections"),
    retry: false,
  });
}

export function useComptesSenseEspai() {
  return useQuery({
    queryKey: [...claus.connexions, "sense-espai"],
    queryFn: () => get<Compte[]>("/connections/accounts/unassigned"),
    retry: false,
  });
}

export function useAutoritza() {
  return useMutation({
    mutationFn: (dades: { aspsp_name?: string; connection_id?: number }) =>
      post<{ authorization_url: string; connection_id: number }>("/connections/authorize", dades),
  });
}

export function useSincronitza() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days_back }: { id: number; days_back?: number }) =>
      post<Sincronitzacio>(`/connections/${id}/sync`, { days_back }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useAssignaEspai() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ledger_id }: { id: number; ledger_id: number | null }) =>
      patch<Compte>(`/connections/accounts/${id}`, { ledger_id }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useUsuaris() {
  return useQuery({
    queryKey: claus.usuaris,
    queryFn: () => get<Usuari[]>("/users"),
    retry: false,
  });
}
