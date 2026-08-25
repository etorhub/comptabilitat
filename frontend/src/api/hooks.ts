import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "./client";
import type {
  Avis,
  Categoria,
  Comerc,
  Compte,
  Connexio,
  ElementRevisio,
  Llibre,
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
  ledger_ids?: number[];
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

export const claus = {
  usuari: ["usuari"] as const,
  llibres: ["llibres"] as const,
  comptes: ["comptes"] as const,
  connexions: ["connexions"] as const,
  categories: ["categories"] as const,
  panell: (llibres?: number[]) => ["panell", llibres] as const,
  moviments: (filtres: FiltresMoviments) => ["moviments", filtres] as const,
  revisio: (llibres?: number[]) => ["revisio", llibres] as const,
  recurrents: (llibres?: number[]) => ["recurrents", llibres] as const,
  avisos: ["avisos"] as const,
  regles: ["regles"] as const,
  comercos: (cerca: string, nomesPendents: boolean) =>
    ["comercos", cerca, nomesPendents] as const,
};

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

export function useLlibres() {
  return useQuery({ queryKey: claus.llibres, queryFn: () => get<Llibre[]>("/ledgers") });
}

export function useCategories() {
  return useQuery({
    queryKey: claus.categories,
    queryFn: () => get<Categoria[]>("/categories"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useComptes() {
  return useQuery({ queryKey: claus.comptes, queryFn: () => get<Compte[]>("/accounts") });
}

export function usePanell(llibres?: number[]) {
  return useQuery({
    queryKey: claus.panell(llibres),
    queryFn: () => get<Panell>("/analytics/dashboard", { ledger_ids: llibres }),
  });
}

export function useMoviments(filtres: FiltresMoviments) {
  return useQuery({
    queryKey: claus.moviments(filtres),
    queryFn: () => get<Pagina<Moviment>>("/transactions", { ...filtres }),
    placeholderData: (anterior) => anterior,
  });
}

export function useRevisio(llibres?: number[]) {
  return useQuery({
    queryKey: claus.revisio(llibres),
    queryFn: () =>
      get<Pagina<ElementRevisio>>("/transactions/review", { ledger_ids: llibres, limit: 100 }),
  });
}

export function useCategoritza() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...dades
    }: {
      id: number;
      category_id: number | null;
      remember_merchant?: boolean;
      create_rule?: boolean;
    }) => patch<Moviment>(`/transactions/${id}`, dades),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["moviments"] });
      client.invalidateQueries({ queryKey: ["revisio"] });
      client.invalidateQueries({ queryKey: ["panell"] });
    },
  });
}

export function useCategoritzaEnLot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dades: { transaction_ids: number[]; category_id: number | null }) =>
      post<{ message: string }>("/transactions/bulk-categorize", dades),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["moviments"] });
      client.invalidateQueries({ queryKey: ["revisio"] });
    },
  });
}

export function useMensual(llibres?: number[], mesos = 12) {
  return useQuery({
    queryKey: ["mensual", llibres, mesos],
    queryFn: () => get<PuntMensual[]>("/analytics/monthly", { ledger_ids: llibres, months: mesos }),
  });
}

export function useRepartimentCategories(
  llibres?: number[],
  desDe?: string,
  finsA?: string,
  despeses = true,
) {
  return useQuery({
    queryKey: ["categories-repartiment", llibres, desDe, finsA, despeses],
    queryFn: () =>
      get<RepartimentCategoria[]>("/analytics/categories", {
        ledger_ids: llibres,
        date_from: desDe,
        date_to: finsA,
        expenses: despeses,
      }),
  });
}

export function useRepartimentComercos(llibres?: number[], desDe?: string, finsA?: string) {
  return useQuery({
    queryKey: ["comercos-repartiment", llibres, desDe, finsA],
    queryFn: () =>
      get<RepartimentComerc[]>("/analytics/merchants", {
        ledger_ids: llibres,
        date_from: desDe,
        date_to: finsA,
      }),
  });
}

export function useSaldos(llibres?: number[], dies = 180) {
  return useQuery({
    queryKey: ["saldos", llibres, dies],
    queryFn: () => get<PuntSaldo[]>("/analytics/balance-series", { ledger_ids: llibres, days: dies }),
  });
}

export function usePrevisio(llibreId: number | undefined, dies = 90) {
  return useQuery({
    queryKey: ["previsio", llibreId, dies],
    queryFn: () => get<Previsio>(`/analytics/forecast/${llibreId}`, { horizon_days: dies }),
    enabled: Boolean(llibreId),
  });
}

export function useRecurrents(llibres?: number[], nomesSubscripcions = false) {
  return useQuery({
    queryKey: [...claus.recurrents(llibres), nomesSubscripcions],
    queryFn: () =>
      get<SerieRecurrent[]>("/recurring", {
        ledger_ids: llibres,
        only_subscriptions: nomesSubscripcions,
      }),
  });
}

export function useResumSubscripcions(llibres?: number[]) {
  return useQuery({
    queryKey: ["subscripcions-resum", llibres],
    queryFn: () => get<Record<string, string>>("/recurring/summary", { ledger_ids: llibres }),
  });
}

export function useActualitzaSerie() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dades }: { id: number; include_in_forecast?: boolean; label?: string }) =>
      patch<SerieRecurrent>(`/recurring/${id}`, dades),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["recurrents"] });
      client.invalidateQueries({ queryKey: ["previsio"] });
    },
  });
}

export function useAvisos() {
  return useQuery({ queryKey: claus.avisos, queryFn: () => get<Avis[]>("/alerts") });
}

export function useDescartaAvis() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/alerts/${id}/dismiss`),
    onSuccess: () => client.invalidateQueries({ queryKey: claus.avisos }),
  });
}

export function useConnexions() {
  return useQuery({
    queryKey: claus.connexions,
    queryFn: () => get<Connexio[]>("/connections"),
    retry: false,
  });
}

export function useAutoritza() {
  return useMutation({
    mutationFn: (dades: { aspsp_name?: string; connection_id?: number }) =>
      post<{ authorization_url: string; connection_id: number }>(
        "/connections/authorize",
        dades,
      ),
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

export function useAssignaLlibre() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ledger_id }: { id: number; ledger_id: number | null }) =>
      patch<Compte>(`/accounts/${id}`, { ledger_id }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useComercos(cerca: string, nomesPendents: boolean) {
  return useQuery({
    queryKey: claus.comercos(cerca, nomesPendents),
    queryFn: () =>
      get<Pagina<Comerc>>("/merchants", {
        search: cerca || undefined,
        only_unclassified: nomesPendents,
        limit: 200,
      }),
  });
}

export function useActualitzaComerc() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dades }: { id: number; default_category_id: number | null }) =>
      patch<Comerc>(`/merchants/${id}`, dades),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useRegles() {
  return useQuery({ queryKey: claus.regles, queryFn: () => get<Regla[]>("/rules") });
}

export function useEsborraRegla() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/rules/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: claus.regles }),
  });
}

export function useAplicaRegla() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post<{ message: string }>(`/rules/${id}/apply`),
    onSuccess: () => client.invalidateQueries(),
  });
}
