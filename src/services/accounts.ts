/**
 * Cicle de vida d'un compte bancari dins dels espais.
 *
 * L'unica cosa que hi ha aqui es moure un compte d'espai, i es prou delicada
 * per tenir modul propi: toca l'historial sencer del compte i abans vivia dins
 * d'un gestor de ruta de noranta linies.
 */

import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import { accounts, categories, ledgers, transactions } from "../db/schema/index.ts";
import { NotFoundError } from "../lib/http.ts";
import { classificaPendents } from "./classification.ts";
import { obteOCreaComerc } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";

export interface ResumMoviment {
  /** Moviments que han canviat d'espai. */
  moguts: number;
  /** Als quals s'ha pogut conservar la categoria que havia triat una persona. */
  conservades: number;
  /** Traspassos de l'espai vell que s'han hagut de desfer. */
  traspassosDesfets: number;
}

/**
 * Mou un compte —i tot el seu historial— a un altre espai.
 *
 * **No es una operacio per fer sovint.** Les categories, els comerços i les
 * regles son de cada espai, aixi que els identificadors de l'espai vell no
 * volen dir res al nou i la classificacio s'ha de refer.
 *
 * El que **si** que es conserva es el que ha decidit una persona. Tots els
 * espais es sembren amb el mateix pla de categories, de manera que el *slug*
 * («alimentacio-supermercat») si que vol dir el mateix a banda i banda: els
 * moviments amb `category_source = "user"` es tornen a lligar per slug a
 * l'espai nou. Els que no hi encaixen —una categoria que nomes existia a
 * l'espai vell— van a la safata de revisio, com la resta.
 *
 * La part estructural va dins d'una transaccio. La reclassificacio final, no:
 * es idempotent i es pot tornar a executar, i si falles el pitjor que passa es
 * que uns quants moviments es quedin per revisar, que es l'estat segur.
 */
export async function mouCompteDEspai(
  compteId: number,
  nouEspai: number | null,
): Promise<ResumMoviment> {
  const [compte] = await db.select().from(accounts).where(eq(accounts.id, compteId)).limit(1);
  if (!compte) throw new NotFoundError("Aquest compte no existeix");

  if (nouEspai !== null) {
    const [espai] = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(eq(ledgers.id, nouEspai))
      .limit(1);
    if (!espai) throw new NotFoundError("Aquest espai no existeix");
  }

  if (nouEspai === compte.ledgerId) {
    return { moguts: 0, conservades: 0, traspassosDesfets: 0 };
  }

  const resum = await db.transaction(async (tx) => {
    // --- El que s'ha de recordar abans d'esborrar-ho ---

    // Les decisions d'una persona, apuntades pel slug, que es el que vol dir
    // el mateix a tots els espais.
    const decisions = await tx
      .select({ movimentId: transactions.id, slug: categories.slug })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(eq(transactions.accountId, compteId), eq(transactions.categorySource, "user")),
      );

    // Els traspassos on aquest compte era una de les dues cames. L'altra es
    // queda a l'espai vell, i si no li traiem el grup es queda apuntant a un
    // aparellament que ja no existeix: fora dels informes per sempre, sense
    // res amb que tornar a aparellar-se.
    const grups = (
      await tx
        .selectDistinct({ grup: transactions.transferGroupId })
        .from(transactions)
        .where(
          and(eq(transactions.accountId, compteId), isNotNull(transactions.transferGroupId)),
        )
    )
      .map((f) => f.grup)
      .filter((g): g is string => g !== null);

    let traspassosDesfets = 0;
    if (grups.length > 0) {
      const orfes = await tx
        .update(transactions)
        .set({ transferGroupId: null })
        .where(
          and(
            inArray(transactions.transferGroupId, grups),
            ne(transactions.accountId, compteId),
          ),
        )
        .returning({ id: transactions.id });
      traspassosDesfets = orfes.length;
    }

    // --- El trasllat ---

    await tx.update(accounts).set({ ledgerId: nouEspai }).where(eq(accounts.id, compteId));

    const moguts = await tx
      .update(transactions)
      .set({
        ledgerId: nouEspai,
        merchantId: null,
        categoryId: null,
        categorySource: "none",
        categoryConfidence: null,
        appliedRuleId: null,
        transferGroupId: null,
        needsReview: true,
      })
      .where(eq(transactions.accountId, compteId))
      .returning({ id: transactions.id });

    let conservades = 0;
    if (nouEspai !== null) {
      // --- El que es recupera ---
      conservades = await tornaLesDecisions(tx, nouEspai, decisions);
      await refesElsComercos(tx, compteId, nouEspai);
    }

    // Els comerços dels **dos** espais queden desquadrats: els de l'espai nou
    // perque `obteOCreaComerc` puja el comptador d'un en un i aqui s'ha cridat
    // un cop per comerç, i els de l'espai vell perque compten moviments que
    // ja no hi son.
    await requadraElsComptadors(tx, [compte.ledgerId, nouEspai]);

    return { moguts: moguts.length, conservades, traspassosDesfets };
  });

  // Fora de la transaccio a posta: `classificaPendents` obre les seves
  // consultes i no veuria res del que encara no s'ha desat.
  if (nouEspai !== null) await classificaPendents(nouEspai);

  return resum;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Torna a posar les categories que havia triat una persona, lligant-les pel
 * slug a l'espai nou. Retorna quantes se n'han pogut recuperar.
 */
async function tornaLesDecisions(
  tx: Tx,
  nouEspai: number,
  decisions: { movimentId: number; slug: string }[],
): Promise<number> {
  if (decisions.length === 0) return 0;

  const slugs = [...new Set(decisions.map((d) => d.slug))];
  const destins = await tx
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(and(eq(categories.ledgerId, nouEspai), inArray(categories.slug, slugs)));

  const perSlug = new Map(destins.map((c) => [c.slug, c.id]));

  // Un `update` per categoria de desti, no per moviment.
  const perCategoria = new Map<number, number[]>();
  for (const decisio of decisions) {
    const categoriaId = perSlug.get(decisio.slug);
    if (categoriaId === undefined) continue;
    perCategoria.set(categoriaId, [
      ...(perCategoria.get(categoriaId) ?? []),
      decisio.movimentId,
    ]);
  }

  let conservades = 0;
  for (const [categoriaId, ids] of perCategoria) {
    await tx
      .update(transactions)
      .set({
        categoryId: categoriaId,
        categorySource: "user",
        categoryConfidence: 1,
        needsReview: false,
      })
      .where(inArray(transactions.id, ids));
    conservades += ids.length;
  }

  return conservades;
}

/**
 * Torna a crear els comerços dins de l'espai nou i hi lliga els moviments.
 *
 * Va per comerç i no per moviment: un compte amb tres mil apunts sol tenir
 * unes desenes de comerços, i la diferencia son milers de consultes.
 */
async function refesElsComercos(tx: Tx, compteId: number, nouEspai: number): Promise<void> {
  const seus = await tx
    .select({
      id: transactions.id,
      description: transactions.description,
      counterparty: transactions.counterparty,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, compteId), isNull(transactions.merchantId)));

  interface Grup {
    mostrar: string;
    ultimDia: string | null;
    ids: number[];
  }
  const perNom = new Map<string, Grup>();

  for (const moviment of seus) {
    const [normalitzat, mostrar] = normalizeDescription(
      moviment.description,
      moviment.counterparty,
    );
    if (!normalitzat) continue;

    const clau = normalitzat.slice(0, 200);
    const grup = perNom.get(clau);
    if (grup === undefined) {
      perNom.set(clau, { mostrar, ultimDia: moviment.bookingDate, ids: [moviment.id] });
    } else {
      grup.ids.push(moviment.id);
      if (moviment.bookingDate > (grup.ultimDia ?? "")) grup.ultimDia = moviment.bookingDate;
    }
  }

  for (const [normalitzat, grup] of perNom) {
    const comerc = await obteOCreaComerc(
      nouEspai,
      normalitzat,
      grup.mostrar,
      grup.ultimDia,
      tx,
    );
    await tx
      .update(transactions)
      .set({ normalizedDescription: normalitzat, merchantId: comerc?.id ?? null })
      .where(inArray(transactions.id, grup.ids));
  }
}

/**
 * Torna a comptar els moviments de cada comerç dels espais que s'indiquin.
 *
 * El comptador s'anava pujant d'un en un a mesura que apareixien moviments, i
 * aixo nomes val mentre no se'n mogui cap. Recomptar es igual de barat i no
 * pot anar-se'n de mare: es el que es veu a la llista de comerços i el que
 * ordena la cua del model local.
 */
async function requadraElsComptadors(tx: Tx, espais: (number | null)[]): Promise<void> {
  const ids = [...new Set(espais.filter((e): e is number => e !== null))];
  if (ids.length === 0) return;

  await tx.execute(sql`
    update merchants
       set transaction_count = coalesce((
             select count(*) from transactions
              where transactions.merchant_id = merchants.id
           ), 0)
     where merchants.ledger_id in ${sql.raw(`(${ids.join(",")})`)}
  `);
}
