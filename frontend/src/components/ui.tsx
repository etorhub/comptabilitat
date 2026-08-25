import type { ReactNode } from "react";
import { euros, nombre } from "../lib/format";

export function Targeta({
  titol,
  accio,
  children,
  className = "",
}: {
  titol?: ReactNode;
  accio?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`superficie rounded-xl ${className}`}>
      {(titol || accio) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3"
                style={{ borderColor: "var(--vora)" }}>
          <h2 className="text-sm font-semibold">{titol}</h2>
          {accio}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Import({ valor, gran = false }: { valor: string | number; gran?: boolean }) {
  const numero = nombre(valor);
  const color = numero < 0 ? "var(--negatiu)" : numero > 0 ? "var(--positiu)" : "var(--text-suau)";
  return (
    <span
      className={`tabular-nums font-medium ${gran ? "text-2xl" : ""}`}
      style={{ color }}
    >
      {euros(valor)}
    </span>
  );
}

export function Etiqueta({
  children,
  to = "neutre",
}: {
  children: ReactNode;
  to?: "neutre" | "accent" | "positiu" | "negatiu" | "avis";
}) {
  const colors = {
    neutre: "var(--text-suau)",
    accent: "var(--accent)",
    positiu: "var(--positiu)",
    negatiu: "var(--negatiu)",
    avis: "var(--avis)",
  } as const;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: colors[to],
        background: `color-mix(in srgb, ${colors[to]} 12%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

export function Boto({
  children,
  onClick,
  tipus = "secundari",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tipus?: "primari" | "secundari" | "perillos";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const estils = {
    primari: { background: "var(--accent)", color: "#fff", border: "1px solid transparent" },
    secundari: {
      background: "var(--superficie)",
      color: "var(--text)",
      border: "1px solid var(--vora)",
    },
    perillos: {
      background: "transparent",
      color: "var(--negatiu)",
      border: "1px solid var(--negatiu)",
    },
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={estils[tipus]}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition
                  disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90 ${className}`}
    >
      {children}
    </button>
  );
}

export function Estat({
  carregant,
  error,
  buit,
  missatgeBuit = "No hi ha res per mostrar.",
  children,
}: {
  carregant?: boolean;
  error?: unknown;
  buit?: boolean;
  missatgeBuit?: string;
  children: ReactNode;
}) {
  if (carregant) {
    return <p className="text-suau py-6 text-center text-sm">Carregant…</p>;
  }
  if (error) {
    const missatge = error instanceof Error ? error.message : "Hi ha hagut un problema";
    return (
      <p className="py-6 text-center text-sm" style={{ color: "var(--negatiu)" }}>
        {missatge}
      </p>
    );
  }
  if (buit) {
    return <p className="text-suau py-6 text-center text-sm">{missatgeBuit}</p>;
  }
  return <>{children}</>;
}

export function Xifra({
  etiqueta,
  valor,
  detall,
  color,
}: {
  etiqueta: string;
  valor: ReactNode;
  detall?: ReactNode;
  color?: string;
}) {
  return (
    <div>
      <div className="text-suau text-xs uppercase tracking-wide">{etiqueta}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {valor}
      </div>
      {detall && <div className="text-suau mt-0.5 text-xs">{detall}</div>}
    </div>
  );
}
