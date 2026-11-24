// Gestion Compta, lot GC-7e — PRÉVISION D'ENCAISSEMENTS par semaine et par mois, comparée au réel. MOTEUR PUR : aucune base, aucune horloge
// (la date du jour est un paramètre AAAA-MM-JJ). Mêmes sources que l'état des créances (`cptCreances.ts`), aucun second calcul :
//  - PRÉVU d'une période = montants dus des échéances (non annulées, contrats non annulés) dont la date prévue tombe dans la période ;
//  - dont RESTE À ENCAISSER = ce qu'il en reste à payer (montant dû − montant réglé prouvé) ;
//  - RÉEL = encaissé PROUVÉ de la période : rattachements VALIDÉS dont l'encaissement a sa date de valeur dans la période (ce n'est PAS le
//    paiement des seules échéances de la période : un retard payé pendant la période compte dans son réel) ;
//  - PROMESSES = montants promis, en cours, dont la date promise tombe dans la période (information : la promesse porte sur une dette déjà
//    comptée dans le prévu, elle ne s'y ajoute jamais).

import { ajouterJoursCpt, ajouterMoisCpt, enCentimesEcheancier } from "./cptEcheancier";
import { lundiDeLaSemaineCpt } from "./cptSuiviHebdo";

const ZERO = BigInt(0);

export type GranulariteCpt = "SEMAINE" | "MOIS";
export const SEMAINES_AVANT_CPT = 4;
export const SEMAINES_APRES_CPT = 8;
export const MOIS_AVANT_CPT = 3;
export const MOIS_APRES_CPT = 5;

export interface PeriodeCpt {
  /** AAAA-MM-JJ, inclus. */
  debut: string;
  fin: string;
  libelle: string;
  /** PASSEE : terminée avant aujourd'hui ; COURANTE : contient aujourd'hui ; FUTURE. */
  position: "PASSEE" | "COURANTE" | "FUTURE";
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const jourFr = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}`;
const position = (debut: string, fin: string, aujourdhui: string): PeriodeCpt["position"] => (fin < aujourdhui ? "PASSEE" : debut > aujourdhui ? "FUTURE" : "COURANTE");

/** Semaines du lundi au dimanche : `avant` semaines avant la semaine courante, la courante, `apres` suivantes. */
export function semainesCpt(aujourdhui: string, avant = SEMAINES_AVANT_CPT, apres = SEMAINES_APRES_CPT): PeriodeCpt[] {
  const lundi = lundiDeLaSemaineCpt(aujourdhui);
  const liste: PeriodeCpt[] = [];
  for (let i = -avant; i <= apres; i++) {
    const debut = ajouterJoursCpt(lundi, i * 7);
    const fin = ajouterJoursCpt(debut, 6);
    liste.push({ debut, fin, libelle: `Semaine du ${jourFr(debut)} au ${jourFr(fin)}`, position: position(debut, fin, aujourdhui) });
  }
  return liste;
}

/** Mois civils : `avant` mois avant le mois courant, le courant, `apres` suivants. */
export function moisCpt(aujourdhui: string, avant = MOIS_AVANT_CPT, apres = MOIS_APRES_CPT): PeriodeCpt[] {
  const premier = `${aujourdhui.slice(0, 8)}01`;
  const liste: PeriodeCpt[] = [];
  for (let i = -avant; i <= apres; i++) {
    const debut = ajouterMoisCpt(premier, i);
    const fin = ajouterJoursCpt(ajouterMoisCpt(debut, 1), -1);
    liste.push({ debut, fin, libelle: `${MOIS_FR[Number(debut.slice(5, 7)) - 1]} ${debut.slice(0, 4)}`, position: position(debut, fin, aujourdhui) });
  }
  return liste;
}

/** Une ligne de somme par jour (le chargement base regroupe par date : jamais une ligne par échéance). */
export interface EcheancesDuJourCpt {
  jour: string;
  montantDu: string;
  montantRegle: string;
}
export interface MontantDuJourCpt {
  jour: string;
  montant: string;
}

export interface LignePrevisionCpt extends PeriodeCpt {
  prevu: bigint;
  resteAEncaisser: bigint;
  reel: bigint;
  promesses: bigint;
  /** réel − prévu (jamais utilisé pour décider quoi que ce soit : un écart d'information). */
  ecart: bigint;
}

const somme = (lignes: readonly { jour: string }[], cle: (l: never) => string, debut: string, fin: string) =>
  lignes.filter((l) => l.jour >= debut && l.jour <= fin).reduce((s, l) => s + (enCentimesEcheancier(cle(l as never)) ?? ZERO), ZERO);

/** Assemble les lignes de prévision pour les périodes données. Les montants sont en centimes. */
export function assemblerPrevisionCpt(
  periodes: readonly PeriodeCpt[],
  echeances: readonly EcheancesDuJourCpt[],
  encaisse: readonly MontantDuJourCpt[],
  promesses: readonly MontantDuJourCpt[]
): LignePrevisionCpt[] {
  return periodes.map((p) => {
    const prevu = somme(echeances, (l: EcheancesDuJourCpt) => l.montantDu, p.debut, p.fin);
    const regle = somme(echeances, (l: EcheancesDuJourCpt) => l.montantRegle, p.debut, p.fin);
    const reel = somme(encaisse, (l: MontantDuJourCpt) => l.montant, p.debut, p.fin);
    return {
      ...p,
      prevu,
      resteAEncaisser: prevu > regle ? prevu - regle : ZERO,
      reel,
      promesses: somme(promesses, (l: MontantDuJourCpt) => l.montant, p.debut, p.fin),
      ecart: reel - prevu,
    };
  });
}
