/**
 * Actors: qui hi ha a l'altra banda d'una transferencia.
 *
 * Com els comerços, son per espai i a proposit. A diferencia d'un comerç, un
 * actor **mai** no classifica res (vegeu `services/classification.ts`): els
 * seus moviments sempre queden pendents de revisar. La mateixa persona et pot
 * fer el lloguer cada mes i tornar-te un sopar excepcional, i cap de les dues
 * coses no la converteix en una categoria per defecte.
 *
 * L'unica manera de crear-ne un es `obteOCreaActor`, cridada des de
 * `services/contraparts.ts` quan un moviment es una transferencia.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import {
  actorAliases,
  actors,
  ledgers,
  transactions,
  userLedgerPermissions,
  users,
  type Actor,
  type ActorKind,
} from "../db/schema/index.ts";
import { AppError, NotFoundError } from "../lib/http.ts";
import { money } from "../lib/money.ts";
import { addDays } from "../lib/time.ts";

/** Filtres de la llista d'actors. */
export interface FiltresActors {
  cerca: string;
  nomesSenseConfirmar: boolean;
  limit: number;
  offset: number;
}

export interface ActorVista {
  id: number;
  normalizedName: string;
  displayName: string;
  kind: ActorKind;
  isConfirmed: boolean;
  userId: number | null;
  /** El nom de l'usuari lligat, per no fer una consulta per fila. */
  userName: string | null;
  transactionCount: number;
  lastSeenAt: string | null;
}

export interface PaginaActors {
  items: ActorVista[];
  total: number;
  limit: number;
  offset: number;
}

const CAMPS_VISTA = {
  id: actors.id,
  normalizedName: actors.normalizedName,
  displayName: actors.displayName,
  kind: actors.kind,
  isConfirmed: actors.isConfirmed,
  userId: actors.userId,
  userName: users.fullName,
  transactionCount: actors.transactionCount,
  lastSeenAt: actors.lastSeenAt,
} as const;

function condicions(ledgerId: number, filtres: FiltresActors): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(actors.ledgerId, ledgerId)];

  const cerca = filtres.cerca.trim();
  if (cerca) {
    const patro = `%${cerca}%`;
    parts.push(or(ilike(actors.normalizedName, patro), ilike(actors.displayName, patro)));
  }
  if (filtres.nomesSenseConfirmar) parts.push(eq(actors.isConfirmed, false));

  return and(...parts);
}

/** Els actors de l'espai, els que mes surten primer. */
export async function llistaActors(
  ledgerId: number,
  filtres: FiltresActors,
): Promise<PaginaActors> {
  const on = condicions(ledgerId, filtres);

  const [total] = await db.select({ n: count() }).from(actors).where(on);

  const files = await db
    .select(CAMPS_VISTA)
    .from(actors)
    .leftJoin(users, eq(users.id, actors.userId))
    .where(on)
    .orderBy(desc(actors.transactionCount), asc(actors.normalizedName))
    .limit(filtres.limit)
    .offset(filtres.offset);

  return {
    items: files,
    total: total?.n ?? 0,
    limit: filtres.limit,
    offset: filtres.offset,
  };
}

/** Un actor d'aquest espai, o 404. */
export async function actorDeLespai(id: number, ledgerId: number): Promise<Actor> {
  const [actor] = await db
    .select()
    .from(actors)
    .where(and(eq(actors.id, id), eq(actors.ledgerId, ledgerId)))
    .limit(1);
  if (!actor) throw new NotFoundError("Aquest actor no existeix");
  return actor;
}

/** Torna la vista d'un actor, per redibuixar-ne la fila. */
export async function vistaActor(id: number, ledgerId: number): Promise<ActorVista> {
  const [fila] = await db
    .select(CAMPS_VISTA)
    .from(actors)
    .leftJoin(users, eq(users.id, actors.userId))
    .where(and(eq(actors.id, id), eq(actors.ledgerId, ledgerId)))
    .limit(1);
  if (!fila) throw new NotFoundError("Aquest actor no existeix");
  return fila;
}

/** Confirma un actor: qui l'ha creat automaticament no sabia la mena que era. */
export async function confirmaActor(
  id: number,
  ledgerId: number,
  dades: { kind: ActorKind; displayName: string },
): Promise<Actor> {
  await actorDeLespai(id, ledgerId);
  const nom = dades.displayName.trim();
  if (!nom) throw new AppError("El nom no pot ser buit", 422);

  const [actualitzat] = await db
    .update(actors)
    .set({ kind: dades.kind, displayName: nom.slice(0, 200), isConfirmed: true })
    .where(eq(actors.id, id))
    .returning();
  if (!actualitzat) throw new NotFoundError("Aquest actor no existeix");
  return actualitzat;
}

/**
 * Lliga (o desenllaça, amb `userId = null`) un actor a un usuari de l'app.
 *
 * Es el pont que permet identificar-lo a la interficie i aparellar els seus
 * moviments amb els d'altres espais on aquell usuari tingui permis. No canvia
 * cap classificacio: un actor no en fa mai.
 */
export async function lligaUsuari(
  id: number,
  ledgerId: number,
  userId: number | null,
): Promise<Actor> {
  await actorDeLespai(id, ledgerId);

  if (userId !== null) {
    const [usuari] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!usuari) throw new AppError("Aquest usuari no existeix", 422);
  }

  const [actualitzat] = await db
    .update(actors)
    .set({ userId })
    .where(eq(actors.id, id))
    .returning();
  if (!actualitzat) throw new NotFoundError("Aquest actor no existeix");
  return actualitzat;
}

/**
 * Fusiona dos actors del mateix espai: el perdedor desapareix, el guanyador
 * es queda amb els seus alies i els seus moviments.
 */
export async function fusionaActors(
  guanyadorId: number,
  perdedorId: number,
  ledgerId: number,
): Promise<Actor> {
  if (guanyadorId === perdedorId) {
    throw new AppError("Un actor no es pot fusionar amb ell mateix", 422);
  }

  const guanyador = await actorDeLespai(guanyadorId, ledgerId);
  const perdedor = await actorDeLespai(perdedorId, ledgerId);

  await db.transaction(async (tx) => {
    await tx
      .update(actorAliases)
      .set({ actorId: guanyadorId })
      .where(eq(actorAliases.actorId, perdedorId));

    // El nom normalitzat del perdedor esdevé un alies mes del guanyador.
    await tx
      .insert(actorAliases)
      .values({ actorId: guanyadorId, ledgerId, normalizedName: perdedor.normalizedName })
      .onConflictDoNothing();

    await tx
      .update(transactions)
      .set({ actorId: guanyadorId })
      .where(eq(transactions.actorId, perdedorId));

    await tx.delete(actors).where(eq(actors.id, perdedorId));
  });

  await recompteActors([guanyadorId]);
  const [refet] = await db.select().from(actors).where(eq(actors.id, guanyadorId)).limit(1);
  return refet ?? guanyador;
}

/**
 * L'actor d'aquest espai amb aquest nom normalitzat, creant-lo (amb el seu
 * alies) si cal.
 *
 * La cerca va sempre contra `actor_aliases`, no contra `actors.normalized_name`
 * directament: aixi «MARIA G LOPEZ» i «MARIA GARCIA LOPEZ» poden acabar sota
 * el mateix actor sense que la propera sincronitzacio en creï un de nou.
 *
 * @param incrementaComptador si es fals, nomes obté o crea sense tocar
 *   `transaction_count` (per a reassignacions en lot que després recompten).
 */
export async function obteOCreaActor(
  ledgerId: number,
  normalizedName: string,
  display = "",
  seenOn: string | null = null,
  connexio: Transactor = db,
  incrementaComptador = true,
): Promise<Actor | null> {
  const nom = (normalizedName || "").trim();
  if (!nom) return null;

  const [alies] = await connexio
    .select({ actorId: actorAliases.actorId })
    .from(actorAliases)
    .where(and(eq(actorAliases.ledgerId, ledgerId), eq(actorAliases.normalizedName, nom)))
    .limit(1);

  let actor: Actor | undefined;
  if (alies) {
    [actor] = await connexio.select().from(actors).where(eq(actors.id, alies.actorId)).limit(1);
  }

  if (!actor) {
    const [creat] = await connexio
      .insert(actors)
      .values({
        ledgerId,
        normalizedName: nom.slice(0, 200),
        displayName: (display || nom).slice(0, 200),
        kind: "desconegut",
        isConfirmed: false,
        userId: null,
        transactionCount: 0,
        lastSeenAt: null,
      })
      .returning();
    actor = creat;

    if (actor) {
      await connexio
        .insert(actorAliases)
        .values({ actorId: actor.id, ledgerId, normalizedName: nom.slice(0, 200) })
        .onConflictDoNothing();
    }
  }
  if (!actor) return null;

  if (!incrementaComptador) {
    if (seenOn !== null && (actor.lastSeenAt === null || seenOn > actor.lastSeenAt)) {
      const [ambData] = await connexio
        .update(actors)
        .set({ lastSeenAt: seenOn })
        .where(eq(actors.id, actor.id))
        .returning();
      return ambData ?? actor;
    }
    return actor;
  }

  const vistUltim =
    seenOn !== null && (actor.lastSeenAt === null || seenOn > actor.lastSeenAt)
      ? seenOn
      : actor.lastSeenAt;

  const [actualitzat] = await connexio
    .update(actors)
    .set({ transactionCount: actor.transactionCount + 1, lastSeenAt: vistUltim })
    .where(eq(actors.id, actor.id))
    .returning();

  return actualitzat ?? actor;
}

/** Recompta `transaction_count` a partir dels moviments reals. */
export async function recompteActors(
  actorIds: number[],
  connexio: Transactor = db,
): Promise<void> {
  const ids = [...new Set(actorIds.filter((id) => id > 0))];
  if (ids.length === 0) return;

  const recomptes = await connexio
    .select({ actorId: transactions.actorId, n: count() })
    .from(transactions)
    .where(inArray(transactions.actorId, ids))
    .groupBy(transactions.actorId);

  const perId = new Map(recomptes.map((r) => [r.actorId, Number(r.n)]));
  for (const id of ids) {
    await connexio
      .update(actors)
      .set({ transactionCount: perId.get(id) ?? 0 })
      .where(eq(actors.id, id));
  }
}

/** Els usuaris actius, per al selector de «lligar a un usuari». */
export async function usuarisPerLligar(): Promise<{ id: number; fullName: string }[]> {
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.fullName));
}

/**
 * Tots els actors de l'espai (nomes id i nom), per al selector de «fusiona
 * amb». Cada fila en treu els altres filtrant-se ella mateixa.
 */
export async function totsElsActors(
  ledgerId: number,
): Promise<{ id: number; displayName: string }[]> {
  return db
    .select({ id: actors.id, displayName: actors.displayName })
    .from(actors)
    .where(eq(actors.ledgerId, ledgerId))
    .orderBy(asc(actors.displayName));
}

/** L'altra cama d'un moviment entre espais, per identificar-la a la pantalla. */
export interface AltraCama {
  transactionId: number;
  ledgerCode: string;
  ledgerName: string;
}

/** Marge de dies entre les dues cames, com `transfers.ts`. */
const MATCH_WINDOW_DAYS = 3;

/**
 * Si aquest moviment es d'un actor lligat a un usuari, busca l'import oposat
 * en un altre espai on aquell mateix usuari sigui, tambe, un actor lligat.
 *
 * **No toca cap import ni cap informe**: nomes identifica, com fa
 * `services/transfers.ts` dins d'un espai. Aixo es entre espais, i per aixo
 * cal una garantia mes: si qui mira no te permis a l'altre espai, la
 * resposta ha de ser byte a byte la mateixa que si no hi hagues cap altra
 * cama. Per aixo la consulta sempre passa per un `innerJoin` amb
 * `user_ledger_permissions` de qui mira, mai un filtre a posteriori.
 */
export async function altraCamaEntreEspais(
  transactionId: number,
  viewerUserId: number,
): Promise<AltraCama | null> {
  const [origen] = await db
    .select({
      ledgerId: transactions.ledgerId,
      amount: transactions.amount,
      bookingDate: transactions.bookingDate,
      actorUserId: actors.userId,
    })
    .from(transactions)
    .innerJoin(actors, eq(actors.id, transactions.actorId))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!origen || origen.ledgerId === null || origen.actorUserId === null) return null;

  const des = addDays(origen.bookingDate, -MATCH_WINDOW_DAYS);
  const fins = addDays(origen.bookingDate, MATCH_WINDOW_DAYS);
  const objectiu = money(origen.amount).negated();

  const candidats = await db
    .select({
      transactionId: transactions.id,
      amount: transactions.amount,
      ledgerCode: ledgers.code,
      ledgerName: ledgers.name,
    })
    .from(transactions)
    .innerJoin(actors, eq(actors.id, transactions.actorId))
    .innerJoin(ledgers, eq(ledgers.id, transactions.ledgerId))
    .innerJoin(
      userLedgerPermissions,
      and(
        eq(userLedgerPermissions.ledgerId, transactions.ledgerId),
        eq(userLedgerPermissions.userId, viewerUserId),
      ),
    )
    .where(
      and(
        eq(actors.userId, origen.actorUserId),
        ne(transactions.ledgerId, origen.ledgerId),
        gte(transactions.bookingDate, des),
        lte(transactions.bookingDate, fins),
      ),
    );

  const trobat = candidats.find((c) => money(c.amount).equals(objectiu));
  if (!trobat) return null;

  return {
    transactionId: trobat.transactionId,
    ledgerCode: trobat.ledgerCode,
    ledgerName: trobat.ledgerName,
  };
}
