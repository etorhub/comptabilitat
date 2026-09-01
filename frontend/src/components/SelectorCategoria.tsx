import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Categoria } from "../api/types";
import { Etiqueta } from "./ui";

function normalitza(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function coincideix(categoria: Categoria, pare: Categoria | null, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const text = normalitza(pare ? `${pare.name} ${categoria.name}` : categoria.name);
  return tokens.every((token) => text.includes(token));
}

type ElementLlista =
  | { tipus: "buit"; id: string }
  | { tipus: "pare"; categoria: Categoria; id: string }
  | { tipus: "fill"; categoria: Categoria; pare: Categoria; id: string };

function construeixLlista(
  categories: Categoria[],
  cerca: string,
  exclosos: Set<number>,
): ElementLlista[] {
  const tokens = normalitza(cerca).split(/\s+/).filter(Boolean);
  const pares = categories.filter((c) => c.parent_id === null && !exclosos.has(c.id));
  const fillsPerPare = new Map<number, Categoria[]>();
  for (const categoria of categories) {
    if (categoria.parent_id !== null && !exclosos.has(categoria.id)) {
      const llista = fillsPerPare.get(categoria.parent_id) ?? [];
      llista.push(categoria);
      fillsPerPare.set(categoria.parent_id, llista);
    }
  }

  const elements: ElementLlista[] = [{ tipus: "buit", id: "buit" }];

  for (const pare of pares) {
    const fills = fillsPerPare.get(pare.id) ?? [];
    const pareCoincideix = coincideix(pare, null, tokens);
    const fillsVisibles = fills.filter((fill) => coincideix(fill, pare, tokens));

    if (!tokens.length) {
      elements.push({ tipus: "pare", categoria: pare, id: `p-${pare.id}` });
      for (const fill of fills) {
        elements.push({ tipus: "fill", categoria: fill, pare, id: `c-${fill.id}` });
      }
      continue;
    }

    if (pareCoincideix) {
      elements.push({ tipus: "pare", categoria: pare, id: `p-${pare.id}` });
      for (const fill of fills) {
        elements.push({ tipus: "fill", categoria: fill, pare, id: `c-${fill.id}` });
      }
    } else if (fillsVisibles.length) {
      elements.push({ tipus: "pare", categoria: pare, id: `p-${pare.id}` });
      for (const fill of fillsVisibles) {
        elements.push({ tipus: "fill", categoria: fill, pare, id: `c-${fill.id}` });
      }
    } else if (coincideix(pare, null, tokens)) {
      elements.push({ tipus: "pare", categoria: pare, id: `p-${pare.id}` });
    }
  }

  return elements;
}

function idCategoria(element: ElementLlista): number | null {
  if (element.tipus === "buit") return null;
  return element.categoria.id;
}

export function SelectorCategoria({
  categories,
  value,
  onChange,
  disabled = false,
  placeholder = "Cerca una categoria…",
  className = "",
  excludeIds = [],
}: {
  categories: Categoria[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  excludeIds?: number[];
}) {
  const baseId = useId();
  const contenidorRef = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  const llistaRef = useRef<HTMLDivElement>(null);
  const [obert, setObert] = useState(false);
  const [cerca, setCerca] = useState("");
  const [destacat, setDestacat] = useState(0);
  const [posicio, setPosicio] = useState({ top: 0, left: 0, width: 0 });

  const exclosos = useMemo(() => new Set(excludeIds), [excludeIds]);
  const seleccionada = categories.find((c) => c.id === value) ?? null;
  const elements = useMemo(
    () => construeixLlista(categories, cerca, exclosos),
    [categories, cerca, exclosos],
  );

  const actualitzaPosicio = useCallback(() => {
    const node = contenidorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosicio({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!obert) return;
    actualitzaPosicio();
  }, [obert, actualitzaPosicio, cerca]);

  useEffect(() => {
    if (!obert) return;
    function enScroll() {
      actualitzaPosicio();
    }
    window.addEventListener("scroll", enScroll, true);
    window.addEventListener("resize", enScroll);
    return () => {
      window.removeEventListener("scroll", enScroll, true);
      window.removeEventListener("resize", enScroll);
    };
  }, [obert, actualitzaPosicio]);

  useEffect(() => {
    if (!obert) return;
    function fora(event: MouseEvent) {
      const node = contenidorRef.current;
      const llista = llistaRef.current;
      if (
        node &&
        !node.contains(event.target as Node) &&
        llista &&
        !llista.contains(event.target as Node)
      ) {
        setObert(false);
        setCerca(seleccionada?.full_name ?? "");
      }
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [obert, seleccionada]);

  useEffect(() => {
    setCerca(seleccionada?.full_name ?? "");
  }, [seleccionada?.id, seleccionada?.full_name]);

  useEffect(() => {
    if (destacat >= elements.length) {
      setDestacat(Math.max(0, elements.length - 1));
    }
  }, [destacat, elements.length]);

  useEffect(() => {
    if (!obert || !llistaRef.current) return;
    const actiu = llistaRef.current.querySelector('[data-actiu="true"]');
    actiu?.scrollIntoView({ block: "nearest" });
  }, [destacat, obert]);

  function selecciona(element: ElementLlista) {
    onChange(idCategoria(element));
    setObert(false);
    setCerca(
      element.tipus === "buit"
        ? ""
        : element.categoria.full_name,
    );
    entradaRef.current?.blur();
  }

  function enTecla(event: KeyboardEvent<HTMLInputElement>) {
    if (!obert && (event.key === "ArrowDown" || event.key === "Enter")) {
      setObert(true);
      setDestacat(0);
      event.preventDefault();
      return;
    }
    if (!obert) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDestacat((actual) => Math.min(actual + 1, elements.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setDestacat((actual) => Math.max(actual - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (elements[destacat]) selecciona(elements[destacat]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setObert(false);
      setCerca(seleccionada?.full_name ?? "");
    } else if (event.key === "Tab") {
      setObert(false);
      setCerca(seleccionada?.full_name ?? "");
    }
  }

  const actiuId =
    elements[destacat]?.tipus === "buit"
      ? `${baseId}-buit`
      : `${baseId}-${elements[destacat]?.id}`;

  const desplegable =
    obert &&
    createPortal(
      <div
        ref={llistaRef}
        id={`${baseId}-llista`}
        role="listbox"
        className="superficie fixed z-50 max-h-64 overflow-y-auto rounded-lg border shadow-lg"
        style={{
          top: posicio.top,
          left: posicio.left,
          width: Math.max(posicio.width, 240),
          borderColor: "var(--vora)",
        }}
      >
        {elements.length <= 1 && cerca ? (
          <p className="text-suau px-3 py-2 text-sm">Cap categoria coincideix.</p>
        ) : (
          elements.map((element, index) => {
            const actiu = index === destacat;
            if (element.tipus === "buit") {
              return (
                <button
                  key={element.id}
                  id={`${baseId}-buit`}
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  data-actiu={actiu}
                  className="block w-full px-3 py-2 text-left text-sm"
                  style={
                    actiu
                      ? {
                          background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                        }
                      : undefined
                  }
                  onMouseEnter={() => setDestacat(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selecciona(element)}
                >
                  Sense classificar
                </button>
              );
            }
            if (element.tipus === "pare") {
              return (
                <button
                  key={element.id}
                  id={`${baseId}-${element.id}`}
                  type="button"
                  role="option"
                  aria-selected={value === element.categoria.id}
                  data-actiu={actiu}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold"
                  style={
                    actiu
                      ? {
                          background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                        }
                      : undefined
                  }
                  onMouseEnter={() => setDestacat(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selecciona(element)}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: element.categoria.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{element.categoria.name}</span>
                  {element.categoria.is_subscription && (
                    <Etiqueta to="accent">subscripció</Etiqueta>
                  )}
                </button>
              );
            }
            return (
              <button
                key={element.id}
                id={`${baseId}-${element.id}`}
                type="button"
                role="option"
                aria-selected={value === element.categoria.id}
                data-actiu={actiu}
                className="flex w-full items-center gap-2 py-2 pr-3 pl-7 text-left text-sm"
                style={
                  actiu
                    ? {
                        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                      }
                    : undefined
                }
                onMouseEnter={() => setDestacat(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selecciona(element)}
              >
                <span className="text-suau shrink-0">›</span>
                <span className="min-w-0 flex-1 truncate">{element.categoria.name}</span>
                {element.categoria.is_subscription && (
                  <Etiqueta to="accent">subscripció</Etiqueta>
                )}
              </button>
            );
          })
        )}
      </div>,
      document.body,
    );

  return (
    <div ref={contenidorRef} className={`relative min-w-48 ${className}`}>
      <input
        ref={entradaRef}
        type="text"
        role="combobox"
        aria-expanded={obert}
        aria-controls={`${baseId}-llista`}
        aria-activedescendant={obert ? actiuId : undefined}
        aria-autocomplete="list"
        disabled={disabled}
        value={cerca}
        placeholder={placeholder}
        className="w-full text-sm"
        onFocus={() => {
          setObert(true);
          setDestacat(0);
          setCerca("");
        }}
        onChange={(event) => {
          setCerca(event.target.value);
          setObert(true);
          setDestacat(0);
        }}
        onKeyDown={enTecla}
        onBlur={() => {
          window.setTimeout(() => {
            if (!obert) setCerca(seleccionada?.full_name ?? "");
          }, 150);
        }}
      />
      {desplegable}
    </div>
  );
}
