// Gestion Compta, lot GC-2e : correspondances Odoo (tiers, compte, journal) des référentiels. Module PUR (aucun accès base), partagé
// par l'écran, la Server Action et les tests. Q14 (format exact attendu par Odoo) est ouverte : on ne contrôle donc que la longueur
// et l'absence de caractères de contrôle, jamais un format ; un champ vide veut dire « non renseigné » (null), jamais une chaîne vide.

import { nettoyerTexteCpt, type ErreursChampsCpt, type ResultatValidationCpt } from "./cptReferentiels";

export const ENTITES_ODOO_CPT = ["PARTENAIRE", "CLIENT", "PRODUIT", "COMPTE"] as const;
export type EntiteOdooCpt = (typeof ENTITES_ODOO_CPT)[number];

export type ChampOdooCpt = "tiersOdoo" | "compteOdoo" | "journalOdoo";

export const LIBELLE_ENTITE_ODOO_CPT: Record<EntiteOdooCpt, string> = {
  PARTENAIRE: "Partenaires",
  CLIENT: "Clients",
  PRODUIT: "Produits",
  COMPTE: "Comptes d'encaissement",
};

/** Champs Odoo de chaque entité, dans l'ordre d'affichage. Les longueurs sont celles des formulaires de fiche (`cptReferentiels.ts`). */
export const CHAMPS_ODOO_CPT: Record<EntiteOdooCpt, readonly { champ: ChampOdooCpt; libelle: string; max: number }[]> = {
  PARTENAIRE: [{ champ: "tiersOdoo", libelle: "Tiers Odoo", max: 60 }],
  CLIENT: [{ champ: "tiersOdoo", libelle: "Tiers Odoo", max: 60 }],
  PRODUIT: [{ champ: "compteOdoo", libelle: "Compte Odoo", max: 40 }],
  COMPTE: [
    { champ: "journalOdoo", libelle: "Journal Odoo", max: 40 },
    { champ: "compteOdoo", libelle: "Compte Odoo", max: 40 },
  ],
};

export function estEntiteOdooCpt(valeur: unknown): valeur is EntiteOdooCpt {
  return typeof valeur === "string" && (ENTITES_ODOO_CPT as readonly string[]).includes(valeur);
}

export type ValeursOdooCpt = Partial<Record<ChampOdooCpt, string | null>>;

const CARACTERES_DE_CONTROLE = /[\u0000-\u001f\u007f]/;

/**
 * Lit la saisie d'une correspondance : seuls les champs de l'entité sont lus (tout autre champ envoyé est ignoré, jamais écrit).
 * Un champ absent de la saisie vaut « non renseigné » : l'écran envoie toujours tous les champs de la ligne.
 */
export function validerCorrespondanceOdooCpt(entite: EntiteOdooCpt, saisie: Record<string, unknown>): ResultatValidationCpt<Record<string, string | null>> {
  const erreurs: ErreursChampsCpt = {};
  const valeur: Record<string, string | null> = {};
  for (const { champ, libelle, max } of CHAMPS_ODOO_CPT[entite]) {
    const brut = saisie[champ];
    if (typeof brut === "string" && CARACTERES_DE_CONTROLE.test(brut.replace(/[\t\r\n]/g, " "))) {
      erreurs[champ] = `${libelle} : caractères non admis.`;
      valeur[champ] = null;
      continue;
    }
    const texte = nettoyerTexteCpt(brut);
    if (texte.length > max) {
      erreurs[champ] = `${libelle} : ${max} caractères au plus.`;
      valeur[champ] = null;
    } else {
      valeur[champ] = texte === "" ? null : texte;
    }
  }
  return Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, valeur };
}

/** Libellés des champs Odoo non renseignés d'une fiche (vide = correspondance complète). */
export function champsOdooManquantsCpt(entite: EntiteOdooCpt, valeurs: ValeursOdooCpt): string[] {
  return CHAMPS_ODOO_CPT[entite].filter(({ champ }) => !nettoyerTexteCpt(valeurs[champ])).map(({ libelle }) => libelle);
}

export type ResumeOdooCpt = { total: number; completes: number; aCompleter: number };

/** Compteurs d'une entité à partir de son total et du nombre de fiches à compléter (fiches actives seulement : décidé par l'appelant). */
export function resumeOdooCpt(total: number, aCompleter: number): ResumeOdooCpt {
  const manque = Math.min(Math.max(aCompleter, 0), Math.max(total, 0));
  return { total, completes: total - manque, aCompleter: manque };
}
