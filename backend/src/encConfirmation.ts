// Moteur de confirmation d'un encaissement (commit 6a, D26) — SEULE fonction qui confirme, pour toutes les voies :
// confirmation F5 (« Reçu », « Finalement reçu »), saisie F3, paiement multiple F4, relevé (6f). Rien n'écrit les
// montants figés d'un encaissement ailleurs.
//
// Sous le verrou par police de l'import (`pg_advisory_xact_lock(hashtext('police:' || numPolice))`), dans la
// transaction de l'appelant :
// - date de prise en compte TOUJOURS le jour de l'action (aucune autre date acceptée, ni passée ni future), sauf en
//   mode reprise explicite (F1.5 : date de paiement réelle, jamais de « Régularisation ») ; rang = dernier rang + 1
//   (D27 : ordre RÉEL de confirmation ; « Finalement reçu » = nouvelle prise en compte à sa date) ;
// - montants figés (AA, AB, AC, AD, commission, honoraires ; reliquat exact à l'encaissement qui solde — D3, D9) ;
// - exigibilité §5.3 (mois, date limite au jour paramétré, mention « Régularisation ») ;
// - part d'accessoires (police > partenaire > défaut) ;
// - bénéficiaire des honoraires en vigueur à la date de prise en compte ;
// - trop-perçu : renvoyé à l'appelant sans rien écrire, sauf confirmation explicite (D30 : jamais en lot ni en
//   confirmation automatique) ; excédent non ventilé (D28, V2-A6 provisoire) ;
// - `EncAudit`.

import type { Prisma, PrismaClient } from "./generated/prisma/client";
import type { EncStatutEncaissement } from "./generated/prisma/enums";
import {
  ajouterAuCumul,
  calculerExigibilite,
  choisirTauxAccessoires,
  cumulVide,
  figerEncaissement,
  montant,
  type CumulVersements,
  type EncaissementFige,
  type MontantEntree,
  type MontantsContrat,
  type SourceTauxAccessoires,
  type Montant,
} from "./encCalcul";
import { ecrireAudit, type EncAuditDb } from "./encAudit";
import { chargerParametresEnc, parametresExigibilite, tauxAccessoiresDefaut } from "./encParametres";
import { beneficiaireHonorairesEnVigueur } from "./encReferentiels";

export class EncConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncConfirmationError";
  }
}

/** Statuts depuis lesquels un encaissement peut être confirmé : à confirmer, ou « non reçu » (« Finalement reçu »). */
export const STATUTS_CONFIRMABLES: readonly EncStatutEncaissement[] = ["A_CONFIRMER", "NON_RECU"];

/** Jour calendaire (UTC, minuit) d'un instant : la date de prise en compte est une date, pas un horodatage. */
export function jourDe(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/** Encaissement déjà confirmé du contrat, tel que figé (contre-passations comprises, montants négatifs). */
export interface EncaissementConfirmeFige {
  Z: MontantEntree;
  AB: MontantEntree;
  AC: MontantEntree;
  AD: MontantEntree;
  commission: MontantEntree;
  honoraires: MontantEntree;
}

/** Cumul des encaissements confirmés (l'ordre n'importe pas pour une somme). */
export function cumulConfirmes(confirmes: readonly EncaissementConfirmeFige[]): CumulVersements {
  return confirmes.reduce<CumulVersements>(
    (c, e) => ({
      Z: c.Z.plus(montant(e.Z)),
      AB: c.AB.plus(montant(e.AB)),
      AC: c.AC.plus(montant(e.AC)),
      AD: c.AD.plus(montant(e.AD)),
      commission: c.commission.plus(montant(e.commission)),
      honoraires: c.honoraires.plus(montant(e.honoraires)),
    }),
    cumulVide()
  );
}

export interface EntreeCalculConfirmation {
  contrat: MontantsContrat;
  confirmes: readonly EncaissementConfirmeFige[];
  datePaiement: Date;
  datePriseEnCompte: Date;
  Z: MontantEntree;
  jourLimite: number;
  taux: { police?: MontantEntree | null; partenaire?: MontantEntree | null; defaut: MontantEntree };
  beneficiaires: readonly { id: string; nom: string; dateDebut: Date }[];
}

export interface CalculConfirmation {
  fige: EncaissementFige;
  sourceTauxAccessoires: SourceTauxAccessoires;
  beneficiaireHonoraires: { id: string; nom: string } | null;
}

/** Cœur PUR de la confirmation : montants figés, exigibilité, part d'accessoires, bénéficiaire des honoraires. */
export function calculerConfirmation(e: EntreeCalculConfirmation): CalculConfirmation {
  const taux = choisirTauxAccessoires(e.taux);
  const exigibilite = calculerExigibilite(e.datePaiement, e.datePriseEnCompte, { jourLimite: e.jourLimite });
  const fige = figerEncaissement({
    contrat: e.contrat,
    cumul: cumulConfirmes(e.confirmes),
    montantRecu: e.Z,
    tauxAccessoires: taux.taux,
    exigibilite,
  });
  const benef = beneficiaireHonorairesEnVigueur(e.beneficiaires, e.datePriseEnCompte) as { id: string; nom: string } | null;
  return { fige, sourceTauxAccessoires: taux.source, beneficiaireHonoraires: benef ? { id: benef.id, nom: benef.nom } : null };
}

/** Encaissements confirmés successifs d'un même contrat (tests, simulations) : chacun figé sur le cumul des précédents. */
export function confirmerSuccessivement(
  contrat: MontantsContrat,
  versements: readonly { Z: MontantEntree; datePaiement: Date; datePriseEnCompte: Date }[],
  autres: Omit<EntreeCalculConfirmation, "contrat" | "confirmes" | "datePaiement" | "datePriseEnCompte" | "Z">
): EncaissementFige[] {
  const resultat: EncaissementFige[] = [];
  let cumul = cumulVide();
  for (const v of versements) {
    const { fige } = calculerConfirmation({ ...autres, contrat, confirmes: [cumulVersFige(cumul)], ...v });
    resultat.push(fige);
    cumul = ajouterAuCumul(cumul, fige);
  }
  return resultat;
}

const cumulVersFige = (c: CumulVersements): EncaissementConfirmeFige => ({
  Z: c.Z.toFixed(2),
  AB: c.AB.toFixed(2),
  AC: c.AC.toFixed(2),
  AD: c.AD.toFixed(2),
  commission: c.commission.toFixed(2),
  honoraires: c.honoraires.toFixed(2),
});

export type EncConfirmationDb = Pick<
  PrismaClient,
  "encEncaissement" | "encContrat" | "encParametre" | "encBeneficiaireHonoraires" | "$executeRaw"
> &
  EncAuditDb;

export interface EntreeConfirmation {
  encaissementId: string;
  userId: string;
  /** Instant de l'action : la date de prise en compte est son jour (garde-fou, aucune autre date n'est acceptée). */
  maintenant: Date;
  /**
   * Reprise initiale (F1.5) SEULEMENT : la prise en compte est la date de paiement réelle (jamais de « Régularisation »).
   * Aucune autre voie ne doit l'utiliser.
   */
  reprise?: boolean;
  /**
   * Contrôle facultatif : si l'appelant indique une date de prise en compte, elle doit être celle que le moteur retient
   * (le jour de l'action, ou la date de paiement en reprise) ; toute autre date, passée ou future, est refusée.
   */
  datePriseEnCompte?: Date;
  /** Le trop-perçu a été confirmé explicitement par l'utilisateur (jamais en lot ni en confirmation automatique, D30). */
  accepterTropPercu?: boolean;
  ip?: string | null;
}

export type ResultatConfirmation =
  | {
      statut: "CONFIRME";
      encaissementId: string;
      paiementId: string;
      rang: number;
      datePriseEnCompte: Date;
      fige: EncaissementFige;
      tropPercu: Montant | null;
    }
  /** Rien n'a été écrit : l'appelant doit faire confirmer le trop-perçu explicitement, ligne par ligne. */
  | { statut: "TROP_PERCU_A_CONFIRMER"; encaissementId: string; paiementId: string; tropPercu: Montant; restantDu: Montant };

const d2 = (m: Montant) => m.toFixed(2);

/**
 * Confirme un encaissement (D26). Toujours dans la transaction de l'appelant. Lève `EncConfirmationError` si
 * l'encaissement est introuvable ou déjà confirmé ; renvoie `TROP_PERCU_A_CONFIRMER` sans rien écrire si le montant
 * dépasse le restant dû et que le trop-perçu n'a pas été accepté explicitement.
 */
export async function confirmerEncaissement(db: EncConfirmationDb, entree: EntreeConfirmation): Promise<ResultatConfirmation> {
  const cible = await db.encEncaissement.findUnique({
    where: { id: entree.encaissementId },
    select: { contrat: { select: { numPolice: true } } },
  });
  if (!cible) throw new EncConfirmationError("Encaissement introuvable.");
  // Même verrou que l'import et « Ajouter quand même » : deux confirmations de la même police sont sérialisées, la
  // seconde lit le rang et le cumul laissés par la première.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"police:" + cible.contrat.numPolice})::bigint)`;

  const enc = await db.encEncaissement.findUnique({
    where: { id: entree.encaissementId },
    select: {
      id: true,
      paiementId: true,
      statut: true,
      datePaiement: true,
      Z: true,
      contratId: true,
      contrat: {
        select: {
          S: true,
          T: true,
          U: true,
          V: true,
          W: true,
          X: true,
          partAccessoiresPartenaire: true,
          partenaire: { select: { partAccessoiresPartenaire: true } },
        },
      },
    },
  });
  if (!enc) throw new EncConfirmationError("Encaissement introuvable.");
  if (!STATUTS_CONFIRMABLES.includes(enc.statut)) {
    throw new EncConfirmationError(`Cet encaissement ne peut pas être confirmé (statut : ${enc.statut}).`);
  }

  const [confirmes, rangMax, parametres, beneficiaires] = await Promise.all([
    db.encEncaissement.findMany({
      where: { contratId: enc.contratId, statut: "CONFIRME" },
      select: { Z: true, AB: true, AC: true, AD: true, commission: true, honoraires: true },
    }),
    db.encEncaissement.aggregate({ where: { contratId: enc.contratId, statut: "CONFIRME" }, _max: { ordrePriseEnCompte: true } }),
    chargerParametresEnc(db),
    db.encBeneficiaireHonoraires.findMany({ select: { id: true, nom: true, dateDebut: true } }),
  ]);
  for (const c of confirmes) {
    if (c.AB === null || c.AC === null || c.AD === null || c.commission === null || c.honoraires === null) {
      throw new EncConfirmationError("Un encaissement confirmé de ce contrat n'a pas ses montants figés : confirmation impossible.");
    }
  }

  // Garde-fou : la prise en compte est le jour de l'action ; en reprise explicite, la date de paiement réelle.
  const datePriseEnCompte = entree.reprise ? jourDe(enc.datePaiement) : jourDe(entree.maintenant);
  if (entree.datePriseEnCompte && jourDe(entree.datePriseEnCompte).getTime() !== datePriseEnCompte.getTime()) {
    throw new EncConfirmationError(
      entree.reprise
        ? "Reprise : la date de prise en compte est la date de paiement réelle, aucune autre date n'est acceptée."
        : "La date de prise en compte est toujours la date du jour : aucune autre date (passée ou future) n'est acceptée."
    );
  }
  const k = enc.contrat;
  const calcul = calculerConfirmation({
    contrat: { S: montant(k.S), T: montant(k.T), U: montant(k.U), V: montant(k.V), W: montant(k.W), X: montant(k.X) },
    confirmes: confirmes as EncaissementConfirmeFige[],
    datePaiement: enc.datePaiement,
    datePriseEnCompte,
    Z: enc.Z,
    jourLimite: parametresExigibilite(parametres).jourLimite,
    taux: {
      police: k.partAccessoiresPartenaire,
      partenaire: k.partenaire?.partAccessoiresPartenaire ?? null,
      defaut: tauxAccessoiresDefaut(parametres),
    },
    beneficiaires,
  });
  const f = calcul.fige;

  if (f.tropPercu && !entree.accepterTropPercu) {
    return {
      statut: "TROP_PERCU_A_CONFIRMER",
      encaissementId: enc.id,
      paiementId: enc.paiementId,
      tropPercu: f.tropPercu,
      restantDu: f.AA.plus(f.Z),
    };
  }

  const rang = (rangMax._max.ordrePriseEnCompte ?? 0) + 1;
  const data: Prisma.EncEncaissementUncheckedUpdateManyInput = {
    statut: "CONFIRME",
    dateConfirmation: entree.maintenant,
    confirmeParId: entree.userId,
    datePriseEnCompte,
    ordrePriseEnCompte: rang,
    AA: d2(f.AA),
    AB: d2(f.AB),
    AC: d2(f.AC),
    AD: d2(f.AD),
    commission: d2(f.commission),
    honoraires: d2(f.honoraires),
    partAccessoiresTaux: f.accessoires.taux.toFixed(6),
    partAccessoiresPartenaire: d2(f.accessoires.partPartenaire),
    partAccessoiresSim: d2(f.accessoires.partSim),
    moisExigibilite: f.exigibilite.moisExigibilite,
    dateLimiteReversement: f.exigibilite.dateLimite,
    estRegularisation: f.exigibilite.estRegularisation,
    beneficiaireHonorairesId: calcul.beneficiaireHonoraires?.id ?? null,
  };
  // Changement conditionné au statut lu : un second passage (déjà confirmé entre-temps) n'écrit rien.
  const maj = await db.encEncaissement.updateMany({ where: { id: enc.id, statut: enc.statut }, data });
  if (maj.count !== 1) throw new EncConfirmationError("Cet encaissement a changé entre-temps : rechargez la page.");

  await ecrireAudit(db, {
    entite: "EncEncaissement",
    entiteId: enc.id,
    action: entree.reprise ? "confirmation_reprise" : enc.statut === "NON_RECU" ? "finalement_recu" : "confirmation",
    avant: { statut: enc.statut },
    apres: {
      statut: "CONFIRME",
      rang,
      datePriseEnCompte,
      Z: d2(f.Z),
      AA: d2(f.AA),
      AB: d2(f.AB),
      AC: d2(f.AC),
      AD: d2(f.AD),
      commission: d2(f.commission),
      honoraires: d2(f.honoraires),
      partAccessoires: { taux: f.accessoires.taux.toFixed(6), source: calcul.sourceTauxAccessoires },
      moisExigibilite: f.exigibilite.moisExigibilite,
      estRegularisation: f.exigibilite.estRegularisation,
      beneficiaireHonoraires: calcul.beneficiaireHonoraires?.nom ?? null,
      tropPercu: f.tropPercu ? d2(f.tropPercu) : null,
    },
    motif: f.tropPercu ? `Trop-perçu de ${d2(f.tropPercu)} FCFA confirmé explicitement` : null,
    mois: datePriseEnCompte,
    userId: entree.userId,
    ip: entree.ip ?? null,
  });

  return {
    statut: "CONFIRME",
    encaissementId: enc.id,
    paiementId: enc.paiementId,
    rang,
    datePriseEnCompte,
    fige: f,
    tropPercu: f.tropPercu,
  };
}
