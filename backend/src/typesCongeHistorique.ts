// Historique d'une modification de type de congé (C1) : l'ancienne ET la nouvelle valeur de chaque champ qui change.
// Fonction PURE, sans dépendance Node ni Prisma : importable par le serveur et par le formulaire (`backend/client`).

export interface TypeCongeDecrit {
  code: string;
  label: string;
  categorie: string;
  nbJoursDefaut: number;
  decompteType: string;
  justificatifObligatoire: boolean;
  nonDeductibleSolde: boolean;
  ancienneteMinimumMois: number;
}

/** À afficher près du nombre de jours : la valeur ne touche que les soldes créés ensuite. */
export const MESSAGE_NB_JOURS_SOLDES_FUTURS =
  "La nouvelle valeur s'applique aux soldes créés ensuite (nouvel exercice) ; les soldes existants se corrigent par « Ajuster » dans « Soldes ».";

/** Libellé de chaque décompte, partout à l'écran (C2) : les jours ouvrables vont du lundi au vendredi, jours fériés exclus. */
export const LIBELLE_DECOMPTE_CONGE: Record<"OUVRABLE" | "CALENDAIRE", string> = {
  OUVRABLE: "jours ouvrables (lundi à vendredi)",
  CALENDAIRE: "jours calendaires",
};
const LIBELLE_DECOMPTE: Record<string, string> = LIBELLE_DECOMPTE_CONGE;
const LIBELLE_CATEGORIE: Record<string, string> = {
  CONGE_STANDARD: "congé standard",
  PERMISSION_EXCEPTIONNELLE: "permission exceptionnelle",
};
const ouiNon = (b: boolean) => (b ? "oui" : "non");

/** Texte d'historique : « Type « X » (CODE) modifié — jours accordés : 30 → 28 ; … ». */
export function decrireModificationType(avant: TypeCongeDecrit, apres: TypeCongeDecrit): string {
  const changements: string[] = [];
  const comparer = <T>(nom: string, a: T, b: T, formater: (v: T) => string = String) => {
    if (a !== b) changements.push(`${nom} : ${formater(a)} → ${formater(b)}`);
  };
  comparer("libellé", avant.label, apres.label);
  comparer("code", avant.code, apres.code);
  comparer("catégorie", avant.categorie, apres.categorie, (v) => LIBELLE_CATEGORIE[v] ?? v);
  comparer("jours accordés", avant.nbJoursDefaut, apres.nbJoursDefaut);
  comparer("décompte", avant.decompteType, apres.decompteType, (v) => LIBELLE_DECOMPTE[v] ?? v);
  comparer("ancienneté minimale (mois)", avant.ancienneteMinimumMois, apres.ancienneteMinimumMois);
  comparer("pièce justificative obligatoire", avant.justificatifObligatoire, apres.justificatifObligatoire, ouiNon);
  comparer("non déduit du solde", avant.nonDeductibleSolde, apres.nonDeductibleSolde, ouiNon);
  const nom = `Type « ${apres.label} » (${apres.code}) modifié`;
  return changements.length > 0 ? `${nom} — ${changements.join(" ; ")}.` : `${nom} — aucune valeur modifiée.`;
}
