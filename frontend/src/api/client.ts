/** Client de l'API. Les sessions van en una cookie httpOnly, no cal cap token. */

export class ErrorAPI extends Error {
  readonly estat: number;

  constructor(message: string, estat: number) {
    super(message);
    this.estat = estat;
  }
}

type Parametres = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

function construeixURL(ruta: string, parametres?: Parametres): string {
  const url = new URL(`/api${ruta}`, window.location.origin);
  for (const [clau, valor] of Object.entries(parametres ?? {})) {
    if (valor === undefined || valor === null || valor === "") continue;
    if (Array.isArray(valor)) {
      for (const element of valor) url.searchParams.append(clau, String(element));
    } else {
      url.searchParams.set(clau, String(valor));
    }
  }
  return url.pathname + url.search;
}

async function processa(resposta: Response) {
  if (resposta.status === 204) return null;
  const text = await resposta.text();
  let cos: unknown = null;
  if (text) {
    try {
      cos = JSON.parse(text);
    } catch {
      throw new ErrorAPI(text || `Error ${resposta.status}`, resposta.status);
    }
  }
  if (!resposta.ok) {
    const detall = cos?.detail;
    const missatge =
      typeof detall === "string"
        ? detall
        : Array.isArray(detall)
          ? detall.map((item: { msg?: string }) => item.msg ?? "").join(", ")
          : `Error ${resposta.status}`;
    throw new ErrorAPI(missatge, resposta.status);
  }
  return cos;
}

export async function get<T>(ruta: string, parametres?: Parametres): Promise<T> {
  const resposta = await fetch(construeixURL(ruta, parametres), { credentials: "same-origin" });
  return (await processa(resposta)) as T;
}

async function ambCos<T>(metode: string, ruta: string, cos?: unknown): Promise<T> {
  const resposta = await fetch(`/api${ruta}`, {
    method: metode,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: cos === undefined ? undefined : JSON.stringify(cos),
  });
  return (await processa(resposta)) as T;
}

export const post = <T,>(ruta: string, cos?: unknown) => ambCos<T>("POST", ruta, cos);
export const patch = <T,>(ruta: string, cos?: unknown) => ambCos<T>("PATCH", ruta, cos);
export const put = <T,>(ruta: string, cos?: unknown) => ambCos<T>("PUT", ruta, cos);
export const del = <T,>(ruta: string) => ambCos<T>("DELETE", ruta);

/** Obre una descarrega: el navegador ja porta la cookie de sessio. */
export function descarrega(ruta: string, parametres?: Parametres): void {
  window.open(construeixURL(ruta, parametres), "_blank");
}
