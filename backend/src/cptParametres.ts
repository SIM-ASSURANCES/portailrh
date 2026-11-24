// Paramètres du module Gestion Compta (docs/compta-conception.md §1.3 C-3, C-8, C-9 et §7, modèle `CptParametre`).
//
// Copié de backend/src/encParametres.ts le 2026-10-22 — Gestion Compta est indépendant : toute correction se reporte à la main.
//
// Source UNIQUE des clés et valeurs par défaut : reprise par la migration `20261101100000_compta_parametres_defauts`
// (la production n'est seedée qu'une fois : la migration pose les défauts, sans jamais écraser une valeur modifiée).
// `cptParametres.test.ts` échoue si le SQL de la migration et ces constantes divergent.
//
// Les valeurs sont stockées en texte et typées ici : une valeur illisible en base est une erreur, jamais remplacée
// silencieusement par le défaut (un paramètre faux doit se voir, pas se corriger tout seul).
//
// Toutes les valeurs ci-dessous sont les chiffres du cahier des charges SIM-XX-XX ; celles que le cahier ne tranche pas
// restent modifiables par le RFCRH (question Q16) plutôt que figées dans le code.

import type { PrismaClient } from "./generated/prisma/client";

export interface CptParametreDefinition {
  cle: string;
  libelle: string;
  defaut: string;
  min: number;
  max: number;
  /** Entier strict, décimal (au centime) positif, ou fraction (0 à 1, 6 décimales au plus — `Decimal(7,6)`). */
  type: "entier" | "montant" | "taux";
  /** Référence au cahier des charges SIM-XX-XX. */
  source: string;
}

export const CPT_PARAMETRES = [
  {
    cle: "tca.jour_limite_paiement",
    libelle: "Jour limite de déclaration et de paiement de la taxe (du mois suivant)",
    defaut: "20",
    min: 1,
    max: 28,
    type: "entier",
    source: "§3 glossaire (TCA), §6.4, RG-05",
  },
  {
    cle: "rattachement.tolerance_montant_fcfa",
    libelle: "Rattachement par montant et date : écart de montant toléré (FCFA)",
    defaut: "1",
    min: 0,
    max: 1000,
    type: "montant",
    source: "§6.2 méthode 3",
  },
  {
    cle: "rattachement.fenetre_avant_jours",
    libelle: "Rattachement par montant et date : jours avant la date de paiement déclarée",
    defaut: "3",
    min: 0,
    max: 60,
    type: "entier",
    source: "§6.2 méthode 3",
  },
  {
    cle: "rattachement.fenetre_apres_jours",
    libelle: "Rattachement par montant et date : jours après la date de paiement déclarée",
    defaut: "5",
    min: 0,
    max: 60,
    type: "entier",
    source: "§6.2 méthode 3",
  },
  {
    cle: "rattachement.probable_ecart_taux",
    libelle: "Rattachement probable : écart de montant toléré (fraction du montant)",
    defaut: "0.02",
    min: 0,
    max: 1,
    type: "taux",
    source: "§6.2 méthode 5 (±2 %)",
  },
  {
    cle: "rattachement.probable_fenetre_jours",
    libelle: "Rattachement probable : fenêtre de dates (± jours)",
    defaut: "45",
    min: 1,
    max: 365,
    type: "entier",
    source: "§6.2 méthode 5 (±45 jours)",
  },
  {
    cle: "rattachement.reference_prefixe_caracteres",
    libelle: "Référence incomplète : nombre de premiers caractères identiques exigés",
    defaut: "12",
    min: 4,
    max: 64,
    type: "entier",
    source: "§6.2 méthode 2",
  },
  {
    cle: "relance.jours",
    libelle: "Contrôle hebdomadaire : relance automatique (jours)",
    defaut: "7",
    min: 1,
    max: 365,
    type: "entier",
    source: "§6.7",
  },
  {
    cle: "alerte.jours",
    libelle: "Contrôle hebdomadaire : alerte (jours)",
    defaut: "30",
    min: 1,
    max: 365,
    type: "entier",
    source: "§6.7",
  },
  {
    cle: "escalade.jours",
    libelle: "Contrôle hebdomadaire : escalade (jours)",
    defaut: "60",
    min: 1,
    max: 3650,
    type: "entier",
    source: "§6.7",
  },
  {
    cle: "import.limite_lignes",
    libelle: "Import : nombre maximal de lignes par fichier",
    defaut: "50000",
    min: 1000,
    max: 500000,
    type: "entier",
    source: "§8 exigences (10 000 lignes de relevé en moins de 2 minutes)",
  },
  {
    cle: "import.limite_taille_mo",
    libelle: "Import : taille maximale d'un fichier (Mo)",
    defaut: "10",
    min: 1,
    // Plafond réel du dépôt : Next.js ne garde que les 10 premiers Mo du corps d'une requête dès qu'un proxy existe
    // (`experimental.proxyClientMaxBodySize`). Décision du 2026-10-26 : 10 Mo, le paramètre ne promet pas davantage.
    max: 10,
    type: "entier",
    source: "§8 exigences",
  },
] as const satisfies readonly CptParametreDefinition[];

export type CptParametreCle = (typeof CPT_PARAMETRES)[number]["cle"];
export type CptParametresValeurs = Record<CptParametreCle, number>;

export class CptParametreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptParametreError";
  }
}

const DEFINITIONS = new Map<string, CptParametreDefinition>(CPT_PARAMETRES.map((p) => [p.cle, p]));

/** Convertit et contrôle une valeur texte. Lève `CptParametreError` si la clé est inconnue ou la valeur invalide. */
export function lireValeurParametre(cle: string, valeur: string): number {
  const def = DEFINITIONS.get(cle);
  if (!def) throw new CptParametreError(`Paramètre inconnu : « ${cle} ».`);
  const texte = valeur.trim();
  const motif = def.type === "entier" ? /^\d+$/ : def.type === "montant" ? /^\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,6})?$/;
  if (!motif.test(texte)) {
    const attendu =
      def.type === "entier" ? "un entier" : def.type === "montant" ? "un montant (2 décimales au plus)" : "un taux (6 décimales au plus)";
    throw new CptParametreError(`${def.libelle} : « ${valeur} » n'est pas ${attendu}.`);
  }
  const n = Number(texte);
  if (n < def.min || n > def.max) {
    throw new CptParametreError(`${def.libelle} : ${texte} hors bornes (${def.min} à ${def.max}).`);
  }
  return n;
}

/**
 * Cohérence entre paramètres : relance < alerte < escalade (sinon l'escalade se déclencherait avant l'alerte). Contrôlée à
 * la lecture ET utilisable avant d'enregistrer une modification.
 */
export function verifierCoherence(p: CptParametresValeurs): void {
  if (!(p["relance.jours"] < p["alerte.jours"] && p["alerte.jours"] < p["escalade.jours"])) {
    throw new CptParametreError(
      `Les seuils doivent croître : relance (${p["relance.jours"]} j) < alerte (${p["alerte.jours"]} j) < escalade (${p["escalade.jours"]} j).`
    );
  }
}

/**
 * Assemble les paramètres typés à partir des lignes lues en base. Toute clé attendue doit être présente (la migration
 * la pose) : une absence est une erreur explicite, jamais un repli silencieux sur le défaut.
 */
export function assemblerParametres(lignes: { cle: string; valeur: string }[]): CptParametresValeurs {
  const parCle = new Map(lignes.map((l) => [l.cle, l.valeur]));
  const resultat = {} as CptParametresValeurs;
  for (const def of CPT_PARAMETRES) {
    const valeur = parCle.get(def.cle);
    if (valeur === undefined) throw new CptParametreError(`Paramètre manquant en base : « ${def.cle} ».`);
    resultat[def.cle] = lireValeurParametre(def.cle, valeur);
  }
  verifierCoherence(resultat);
  return resultat;
}

/** Fenêtres du moteur de rattachement (méthodes 2, 3 et 5 du cahier, §6.2). */
export interface FenetresRapprochement {
  toleranceMontantFcfa: number;
  joursAvant: number;
  joursApres: number;
  probableEcartTaux: number;
  probableJours: number;
  caracteresReference: number;
}

export function fenetresRapprochement(p: CptParametresValeurs): FenetresRapprochement {
  return {
    toleranceMontantFcfa: p["rattachement.tolerance_montant_fcfa"],
    joursAvant: p["rattachement.fenetre_avant_jours"],
    joursApres: p["rattachement.fenetre_apres_jours"],
    probableEcartTaux: p["rattachement.probable_ecart_taux"],
    probableJours: p["rattachement.probable_fenetre_jours"],
    caracteresReference: p["rattachement.reference_prefixe_caracteres"],
  };
}

/** Seuils de relance, d'alerte et d'escalade du contrôle hebdomadaire (§6.7). */
export interface SeuilsRelance {
  relanceJours: number;
  alerteJours: number;
  escaladeJours: number;
}

export function seuilsRelance(p: CptParametresValeurs): SeuilsRelance {
  return { relanceJours: p["relance.jours"], alerteJours: p["alerte.jours"], escaladeJours: p["escalade.jours"] };
}

/** Lit et type tous les paramètres (client ou transaction Prisma). */
export async function chargerParametresCpt(db: Pick<PrismaClient, "cptParametre">): Promise<CptParametresValeurs> {
  return assemblerParametres(await db.cptParametre.findMany({ select: { cle: true, valeur: true } }));
}
