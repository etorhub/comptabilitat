export type Rol = "viewer" | "editor" | "admin";

export interface Usuari {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  last_login_at: string | null;
}

/** Un espai és una comptabilitat estanca amb els seus propis usuaris. */
export interface Espai {
  id: number;
  code: string;
  name: string;
  description: string;
  currency: string;
  color: string;
  overdraft_threshold: string;
  position: number;
  is_active: boolean;
  /** Rol de qui ho consulta dins d'aquest espai. */
  role: Rol | null;
}

export interface EspaiDetall extends Espai {
  alert_recipients: string[];
}

export interface Membre {
  user_id: number;
  email: string;
  full_name: string;
  role: Rol;
}

export interface Compte {
  id: number;
  connection_id: number;
  ledger_id: number | null;
  name: string;
  product: string;
  iban_masked: string;
  currency: string;
  cash_account_type: string;
  is_active: boolean;
  history_start_date: string | null;
  last_booked_date: string | null;
  current_balance: string | null;
}

export interface Connexio {
  id: number;
  name: string;
  aspsp_name: string;
  aspsp_country: string;
  status: "pending" | "active" | "expired" | "revoked" | "error";
  valid_until: string | null;
  last_sync_at: string | null;
  last_error: string;
  days_until_expiry: number | null;
  accounts: Compte[];
}

export interface Categoria {
  id: number;
  parent_id: number | null;
  slug: string;
  name: string;
  full_name: string;
  kind: "income" | "expense" | "transfer";
  color: string;
  icon: string;
  is_system: boolean;
  is_subscription: boolean;
  transaction_count?: number;
  total_amount?: string;
}

export interface Comerc {
  id: number;
  normalized_name: string;
  display_name: string;
  default_category_id: number | null;
  category_source: string;
  is_confirmed: boolean;
  transaction_count: number;
  last_seen_at: string | null;
}

export interface Moviment {
  id: number;
  account_id: number;
  ledger_id: number | null;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  status: "booked" | "pending";
  description: string;
  normalized_description: string;
  counterparty: string;
  merchant_id: number | null;
  merchant_name: string | null;
  category_id: number | null;
  category_name: string | null;
  category_source: "none" | "merchant" | "rule" | "llm" | "user";
  category_confidence: number | null;
  needs_review: boolean;
  transfer_group_id: string | null;
  notes: string;
  tags: string[];
  is_excluded: boolean;
  is_masked: boolean;
}

export interface ElementRevisio {
  transaction: Moviment;
  suggested_category_id: number | null;
  suggested_category_name: string | null;
  confidence: number | null;
  rationale: string;
}

export interface Pagina<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Panell {
  generated_at: string;
  ledger_id: number;
  ledger_code: string;
  ledger_name: string;
  ledger_color: string;
  currency: string;
  current_balance: string;
  balance_date: string | null;
  income_this_month: string;
  expenses_this_month: string;
  net_this_month: string;
  accounts: number;
  uncategorized: number;
  pending_review: number;
  active_alerts: number;
}

export interface PuntMensual {
  period: string;
  income: string;
  expenses: string;
  net: string;
}

export interface RepartimentCategoria {
  category_id: number | null;
  category_name: string;
  color: string;
  amount: string;
  share: number;
  transactions: number;
}

export interface RepartimentComerc {
  merchant_id: number | null;
  merchant_name: string;
  amount: string;
  transactions: number;
}

export interface PuntSaldo {
  day: string;
  balance: string;
}

export interface PuntPrevisio {
  day: string;
  expected: string;
  optimistic: string;
  pessimistic: string;
}

export interface EsdevenimentPrevisio {
  day: string;
  label: string;
  amount: string;
  series_id: number | null;
}

export interface Previsio {
  ledger_id: number;
  ledger_name: string;
  currency: string;
  starting_balance: string;
  horizon_days: number;
  threshold: string;
  points: PuntPrevisio[];
  events: EsdevenimentPrevisio[];
  first_breach_day: string | null;
  first_breach_amount: string | null;
  daily_discretionary: string;
}

export interface SerieRecurrent {
  id: number;
  ledger_id: number;
  label: string;
  merchant_id: number | null;
  category_id: number | null;
  category_name: string | null;
  cadence: string;
  expected_amount: string;
  amount_tolerance: string;
  interval_days: number;
  monthly_cost: string;
  confidence: number;
  occurrences_count: number;
  first_seen_date: string;
  last_seen_date: string;
  next_expected_date: string | null;
  is_subscription: boolean;
  status: "active" | "ended";
  include_in_forecast: boolean;
}

export interface Avis {
  id: number;
  ledger_id: number | null;
  type: string;
  severity: "info" | "warning" | "critical";
  status: "new" | "read" | "dismissed";
  title: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
  notified_at: string | null;
}

export interface CondicioRegla {
  field: string;
  operator: string;
  value: string;
}

export interface Regla {
  id: number;
  name: string;
  ledger_id: number | null;
  priority: number;
  is_active: boolean;
  conditions: CondicioRegla[];
  set_category_id: number | null;
  set_merchant_id: number | null;
  set_tags: string[];
  source: "user" | "learned";
  match_count: number;
}

export interface Sincronitzacio {
  id: number;
  connection_id: number;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  accounts_synced: number;
  transactions_inserted: number;
  transactions_updated: number;
  error: string;
}
