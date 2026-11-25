import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { chargerParametresCpt } from "./cptParametres";
import {
  CLE_RAPPELS_TCA_INITIAUX_CPT,
  cleRappelTcaCpt,
  creneauRappelTcaCpt,
  messageRappelTcaCpt,
  moisConcerneRappelCpt,
  PERMISSION_RAPPEL_TCA_CPT,
  rappelAttenduCpt,
  type MessageRappelCpt,
  type TypeRappelTcaCpt,
} from "./cptRappelTca";
import { jourTexteCpt } from "./cptSuiviHebdo";
import { chargerCalculMoisCpt } from "./cptTaxeDb";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Réservation des rappels de la taxe (lot GC-8f). Même principe que les relances 7 / 30 / 60 jours (GC-6b, registre C-18) :
 *  - module NON mis en service (`CptMiseEnService` absente) : rien n'est lu, réservé ni envoyé ;
 *  - PREMIER passage après la mise en service : aucun envoi, aucun arriéré — le créneau en cours est réservé en silence et le marqueur
 *    `compta.rappels_tca_initiaux` est posé dans la même transaction ;
 *  - ensuite : le rappel d'un mois, d'un créneau (10 ou 17) et d'un type (déclarer ou payer) est RÉSERVÉ (clé unique dans `MarqueurUnique`)
 *    AVANT d'être envoyé : deux exécutions simultanées ou un rattrapage ne produisent jamais deux rappels.
 */

export type RappelsTcaDb = Pick<PrismaClient, "$transaction" | "cptMiseEnService">;

export interface RappelTcaAEnvoyerCpt {
  type: TypeRappelTcaCpt;
  mois: string;
  creneau: number;
  permission: string;
  message: MessageRappelCpt;
}

export interface ResultatRappelsTcaCpt {
  moduleMisEnService: boolean;
  premierPassage: boolean;
  /** Créneau couvert par ce jour (10 ou 17), `null` avant le 10. */
  creneau: number | null;
  mois: string | null;
  aEnvoyer: RappelTcaAEnvoyerCpt[];
  /** Rappels réservés sans envoi (premier passage). */
  silencieux: number;
  /** Rappel déjà réservé par une exécution précédente ou simultanée. */
  dejaFait: boolean;
}

const VIDE: ResultatRappelsTcaCpt = { moduleMisEnService: true, premierPassage: false, creneau: null, mois: null, aEnvoyer: [], silencieux: 0, dejaFait: false };

async function reserver(tx: Prisma.TransactionClient, cle: string, maintenant: Date): Promise<boolean> {
  return (await tx.$executeRaw`INSERT INTO "MarqueurUnique" ("cle", "creeAt") VALUES (${cle}, ${maintenant}) ON CONFLICT ("cle") DO NOTHING`) > 0;
}

export async function reserverRappelsTcaCpt(db: RappelsTcaDb, maintenant: Date): Promise<ResultatRappelsTcaCpt> {
  if ((await db.cptMiseEnService.findFirst({ select: { id: true } })) === null) return { ...VIDE, moduleMisEnService: false };
  const jour = jourTexteCpt(maintenant);
  const creneau = creneauRappelTcaCpt(jour);
  if (creneau === null) return { ...VIDE, creneau: null };
  const mois = moisConcerneRappelCpt(jour);

  return db.$transaction(
    async (tx): Promise<ResultatRappelsTcaCpt> => {
      const premierPassage = await reserver(tx, CLE_RAPPELS_TCA_INITIAUX_CPT, maintenant);
      const [etat, parametres] = await Promise.all([chargerCalculMoisCpt(tx, mois, maintenant), chargerParametresCpt(tx)]);
      const type = rappelAttenduCpt({
        aDeLaTaxe: etat.calcul.nbLignesDuMois > 0 || etat.calcul.montantAPayer > BigInt(0),
        declare: etat.declaration !== null,
        paye: etat.declaration?.statut === "PAYEE",
      });
      if (type === null) return { ...VIDE, premierPassage, creneau, mois };
      const reserve = await reserver(tx, cleRappelTcaCpt(mois, creneau, type), maintenant);
      if (!reserve) return { ...VIDE, premierPassage, creneau, mois, dejaFait: true };
      // Premier passage : le rappel du créneau en cours est réservé en silence (pas d'arriéré).
      if (premierPassage) return { ...VIDE, premierPassage, creneau, mois, silencieux: 1 };
      return {
        ...VIDE,
        creneau,
        mois,
        aEnvoyer: [{ type, mois, creneau, permission: PERMISSION_RAPPEL_TCA_CPT[type], message: messageRappelTcaCpt({ type, mois, jour, jourLimite: parametres["tca.jour_limite_paiement"] }) }],
      };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}
