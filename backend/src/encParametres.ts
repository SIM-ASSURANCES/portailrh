// Paramètres du module Encaissements (docs/encaissements-conception.md §5.1, modèle `EncParametre`).
//
// Source UNIQUE des clés et valeurs par défaut : reprise par le seed ET par les migrations
// `20260927142216_encaissements_socle_technique` (5 premiers paramètres) et
// `20260930000000_encaissements_parametres_v2` (retire `taxe.delai_exigibilite_mois`, ajoute
// `accessoires.part_partenaire_defaut`) — le seed ne tourne qu'une fois en production, les migrations posent donc
// aussi les défauts sur une base existante. `encParametres.test.ts` échoue si l'une des deux diverge.
//
// Les valeurs sont stockées en texte et typées ici : une valeur illisible en base est une erreur, jamais remplacée
// silencieusement par le défaut (un paramètre faux doit se voir, pas se corriger tout seul).

import type { ParametresExigibilite } from "./encCalcul";
import type { PrismaClient } from "./generated/prisma/client";

export interface EncParametreDefinition {
  cle: string;
  libelle: string;
  defaut: string;
  min: number;
  max: number;
  /** Entier strict, décimal (au centime) positif, ou fraction (0 à 1, 6 décimales au plus — `Decimal(7,6)`). */
  type: "entier" | "montant" | "taux";
  /** Référence au cahier des charges (docs/cahier-des-charges-encaissements.md). */
  source: string;
}

export const ENC_PARAMETRES = [
  {
    cle: "taxe.jour_limite_reversement",
    libelle: "Jour limite de reversement des taxes",
    defaut: "20",
    min: 1,
    max: 28, // CDC V2.6 §3.6
    type: "entier",
    source: "§3.5 Référentiels (paramètres), §5.4",
  },
  {
    cle: "controle.tolerance_fcfa",
    libelle: "Tolérance des contrôles de cohérence (FCFA)",
    defaut: "1",
    min: 0,
    max: 1000,
    type: "montant",
    source: "§3.7, F2, §8.1 (prime nette + accessoires + taxes = prime TTC à 1 FCFA près)",
  },
  {
    cle: "taxe.rappel_jours_avant_limite",
    libelle: "Rappel des taxes exigibles (jours avant la date limite)",
    defaut: "5",
    min: 0,
    max: 31,
    type: "entier",
    source: "§8.2 Alertes",
  },
  {
    cle: "suspens.alerte_jours",
    libelle: "Alerte d'ancienneté d'un suspens (jours)",
    defaut: "60",
    min: 1,
    max: 3650,
    type: "entier",
    source: "F10.9",
  },
  {
    cle: "accessoires.part_partenaire_defaut",
    libelle: "Part partenaire par défaut sur les accessoires (fraction 0 à 1)",
    defaut: "0",
    min: 0,
    max: 1,
    type: "taux",
    source: "§3.6 Référentiels (partenaires), branché sur choisirTauxAccessoires (encCalcul.ts)",
  },
] as const satisfies readonly EncParametreDefinition[];

export type EncParametreCle = (typeof ENC_PARAMETRES)[number]["cle"];
export type EncParametresValeurs = Record<EncParametreCle, number>;

export class EncParametreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncParametreError";
  }
}

const DEFINITIONS = new Map<string, EncParametreDefinition>(ENC_PARAMETRES.map((p) => [p.cle, p]));

/** Convertit et contrôle une valeur texte. Lève `EncParametreError` si la clé est inconnue ou la valeur invalide. */
export function lireValeurParametre(cle: string, valeur: string): number {
  const def = DEFINITIONS.get(cle);
  if (!def) throw new EncParametreError(`Paramètre inconnu : « ${cle} ».`);
  const texte = valeur.trim();
  const motif = def.type === "entier" ? /^\d+$/ : def.type === "montant" ? /^\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,6})?$/;
  if (!motif.test(texte)) {
    const attendu =
      def.type === "entier" ? "un entier" : def.type === "montant" ? "un montant (2 décimales au plus)" : "un taux (6 décimales au plus)";
    throw new EncParametreError(`${def.libelle} : « ${valeur} » n'est pas ${attendu}.`);
  }
  const n = Number(texte);
  if (n < def.min || n > def.max) {
    throw new EncParametreError(`${def.libelle} : ${texte} hors bornes (${def.min} à ${def.max}).`);
  }
  return n;
}

/**
 * Assemble les paramètres typés à partir des lignes lues en base. Toute clé attendue doit être présente (la migration
 * la pose) : une absence est une erreur explicite, jamais un repli silencieux sur le défaut.
 */
export function assemblerParametres(lignes: { cle: string; valeur: string }[]): EncParametresValeurs {
  const parCle = new Map(lignes.map((l) => [l.cle, l.valeur]));
  const resultat = {} as EncParametresValeurs;
  for (const def of ENC_PARAMETRES) {
    const valeur = parCle.get(def.cle);
    if (valeur === undefined) throw new EncParametreError(`Paramètre manquant en base : « ${def.cle} ».`);
    resultat[def.cle] = lireValeurParametre(def.cle, valeur);
  }
  return resultat;
}

/** Paramètres attendus par `calculerExigibilite` (encCalcul.ts). Le délai d'exigibilité n'est plus paramétrable
 *  (N+1 fixe, CDC V2.6 §5.3) : sa ligne a été retirée d'`EncParametre` par la migration
 *  `20260930000000_encaissements_parametres_v2`. */
export function parametresExigibilite(p: EncParametresValeurs): ParametresExigibilite {
  return { jourLimite: p["taxe.jour_limite_reversement"] };
}

/**
 * Part partenaire par défaut des accessoires, formatée pour `choisirTauxAccessoires`/`partagerAccessoires`
 * (`encCalcul.ts`, arg `defaut`) : ces fonctions attendent un `MontantEntree` (chaîne ou Decimal), jamais un `number`
 * nu — la valeur déjà validée par `assemblerParametres` est donc reconvertie en chaîne à 6 décimales, la même
 * précision que la colonne `Decimal(7,6)` où elle finit par être comparée/stockée (`EncPartenaire`/`EncTauxControle`).
 */
export function tauxAccessoiresDefaut(p: EncParametresValeurs): string {
  return p["accessoires.part_partenaire_defaut"].toFixed(6);
}

/** Lit et type tous les paramètres (client ou transaction Prisma). */
export async function chargerParametresEnc(db: Pick<PrismaClient, "encParametre">): Promise<EncParametresValeurs> {
  return assemblerParametres(await db.encParametre.findMany({ select: { cle: true, valeur: true } }));
}
