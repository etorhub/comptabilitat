const MONEDA = new Intl.NumberFormat("ca-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const MONEDA_CURTA = new Intl.NumberFormat("ca-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const DATA = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short" });
const DATA_LLARGA = new Intl.DateTimeFormat("ca-ES", { dateStyle: "long" });

/** Els imports arriben com a text per no perdre decimals pel camí. */
export function euros(valor: string | number | null | undefined, curt = false): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (Number.isNaN(numero)) return "—";
  return curt ? MONEDA_CURTA.format(numero) : MONEDA.format(numero);
}

export function nombre(valor: string | number | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return Number.isNaN(numero) ? 0 : numero;
}

export function data(valor: string | null | undefined, llarga = false): string {
  if (!valor) return "—";
  const dia = new Date(valor.length <= 10 ? `${valor}T00:00:00` : valor);
  if (Number.isNaN(dia.getTime())) return "—";
  return (llarga ? DATA_LLARGA : DATA).format(dia);
}

export function mesLlegible(periode: string): string {
  const [any, mes] = periode.split("-");
  const noms = [
    "gen", "feb", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "oct", "nov", "des",
  ];
  return `${noms[Number(mes) - 1] ?? mes} ${any.slice(2)}`;
}

export function diesEnrere(dies: number): string {
  const dia = new Date();
  dia.setDate(dia.getDate() - dies);
  return dia.toISOString().slice(0, 10);
}

export function avui(): string {
  return new Date().toISOString().slice(0, 10);
}

export function inicieDeMes(): string {
  const dia = new Date();
  return new Date(dia.getFullYear(), dia.getMonth(), 1).toISOString().slice(0, 10);
}
