// Régularisation des dépenses par l'Assistant Finance (2026-10-10) — règles PURES, sans accès base.
//
// Le détail des dépenses d'un règlement Caisse n'attend plus de retour de caisse : l'Assistant le renseigne directement,
// rangé dans une « fiche de régularisation » (un `RetourCaisse` créé d'office par l'Assistant, sans ligne générique),
// dont le montant à rendre est toujours calculé (`calculerMontantARetournerNet`, inchangée) : remis − détaillé. Un retour
// déclaré plus tard par le collaborateur complète cette fiche. Les dépenses détaillées sont des enregistrements de détail :
// aucune n'a d'écriture de caisse (seule la RÉCEPTION d'un retour en écrit une), elles se corrigent donc sur
// l'enregistrement, avec une entrée d'historique (avant/après, motif obligatoire).

/** Ligne de reste d'un retour (montant déclaré pas encore détaillé), recalculée d'office, jamais saisie. */
export const LIBELLE_DEPENSES_NON_DETAILLEES = "Dépenses non détaillées";

export const MOTIF_MODIFICATION_DEPENSE_MIN = 3;

/**
 * Fiche de régularisation : retour créé par l'Assistant, pas encore réceptionné ni complété par le collaborateur
 * (`dateRetour` nulle), sur un règlement Caisse, hors réouverture exceptionnelle et complément de signalement. Son total
 * de dépenses est libre (le montant à rendre en découle) ; tout autre retour a un total fixé (déclaré ou réceptionné).
 */
export function estFicheRegularisation(r: {
  creeParAssistant: boolean;
  estReceptionne: boolean;
  dateRetour: Date | null;
  mode: "CAISSE" | "BANQUE";
  motifReouvertureExceptionnelle: string | null;
  signalementOrigineId: string | null;
}): boolean {
  return (
    r.creeParAssistant &&
    !r.estReceptionne &&
    r.dateRetour === null &&
    r.mode === "CAISSE" &&
    !r.motifReouvertureExceptionnelle &&
    !r.signalementOrigineId
  );
}

/** Ligne de reste « Dépenses non détaillées » (sans motif Finance) : ni modifiable ni supprimable une par une. */
export function estLigneReste(l: { objet: string; motifNonJustifie: string | null }): boolean {
  return l.objet === LIBELLE_DEPENSES_NON_DETAILLEES && !l.motifNonJustifie;
}

export function refusMotifModification(motif: string | null | undefined): string | null {
  return (motif ?? "").trim().length < MOTIF_MODIFICATION_DEPENSE_MIN
    ? `Le motif de la modification est obligatoire (${MOTIF_MODIFICATION_DEPENSE_MIN} caractères minimum).`
    : null;
}

const centimes = (m: number) => Math.round(m * 100);
const fcfa = (m: number) => `${Math.round(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

/**
 * Effet d'une modification d'une dépense détaillée sur son retour (la suppression n'existe plus, 2026-10-10 : une ligne
 * se corrige uniquement par modification) :
 * - fiche de régularisation : le total détaillé ne dépasse jamais ce qui reste à expliquer sur le règlement
 *   (`disponibleFiche`, hors cette fiche) ; le montant à rendre devient `disponibleFiche − total` ;
 * - tout autre retour : son total est fixé (montant déclaré, ou déjà réceptionné : l'argent a bougé) — l'écart passe par
 *   la ligne de reste « Dépenses non détaillées », qui ne devient jamais négative.
 */
export function planModificationDepense(p: {
  fiche: boolean;
  lignes: readonly { id: string; montant: number; reste: boolean }[];
  cibleId: string;
  nouveauMontant: number;
  disponibleFiche: number;
}):
  | { ok: false; message: string }
  | { ok: true; montantReste: number; montantARetourner: number | null } {
  const cible = p.lignes.find((l) => l.id === p.cibleId);
  if (!cible) return { ok: false, message: "Dépense introuvable dans ce retour." };
  if (cible.reste) return { ok: false, message: "La ligne « Dépenses non détaillées » se met à jour d'elle-même." };
  if (!(p.nouveauMontant > 0)) return { ok: false, message: "Le montant doit être supérieur à 0." };
  const nouveau = p.nouveauMontant;
  const reste = p.lignes.filter((l) => l.reste).reduce((s, l) => s + centimes(l.montant), 0);

  if (p.fiche) {
    const total = p.lignes.filter((l) => l.id !== p.cibleId).reduce((s, l) => s + centimes(l.montant), 0) + centimes(nouveau);
    if (total > centimes(p.disponibleFiche)) {
      return {
        ok: false,
        message: `Les dépenses détaillées (${fcfa(total / 100)}) dépasseraient le montant remis restant à expliquer (${fcfa(p.disponibleFiche)}).`,
      };
    }
    return { ok: true, montantReste: reste / 100, montantARetourner: (centimes(p.disponibleFiche) - total) / 100 };
  }

  const nouveauReste = reste - (centimes(nouveau) - centimes(cible.montant));
  if (nouveauReste < 0) {
    return {
      ok: false,
      message: `Ce retour a un total fixé : la hausse dépasse le reste non détaillé (${fcfa(reste / 100)}). Ajustez le total déclaré ou passez par un remboursement.`,
    };
  }
  return { ok: true, montantReste: nouveauReste / 100, montantARetourner: null };
}

/**
 * « Détailler » le reste (2026-10-10) : de nouvelles lignes prises sur ce qui n'est pas encore détaillé — la ligne de
 * reste d'un retour à total fixé (elle diminue d'autant, jamais en dessous de 0), ou le montant à rendre d'une fiche de
 * régularisation (recalculé, borné par le montant remis restant à expliquer).
 */
export function planAjoutLignes(p: {
  fiche: boolean;
  /** Somme des lignes actuelles du retour (reste compris). */
  totalActuel: number;
  /** Ligne(s) de reste « Dépenses non détaillées » du retour. */
  reste: number;
  /** Fiche : montant remis restant à expliquer hors cette fiche. */
  disponibleFiche: number;
  ajout: readonly number[];
}): { ok: false; message: string } | { ok: true; montantReste: number; montantARetourner: number | null } {
  if (p.ajout.length === 0) return { ok: false, message: "Ajoutez au moins une dépense." };
  if (p.ajout.some((m) => !(m > 0))) return { ok: false, message: "Chaque dépense doit avoir un montant supérieur à 0." };
  const ajout = p.ajout.reduce((s, m) => s + centimes(m), 0);
  if (p.fiche) {
    const total = centimes(p.totalActuel) + ajout;
    if (total > centimes(p.disponibleFiche)) {
      return {
        ok: false,
        message: `Les dépenses détaillées (${fcfa(total / 100)}) dépasseraient le montant remis restant à expliquer (${fcfa(p.disponibleFiche)}).`,
      };
    }
    return { ok: true, montantReste: p.reste, montantARetourner: (centimes(p.disponibleFiche) - total) / 100 };
  }
  if (ajout > centimes(p.reste)) {
    return { ok: false, message: `La somme des dépenses (${fcfa(ajout / 100)}) dépasse le reste non détaillé (${fcfa(p.reste)}).` };
  }
  return { ok: true, montantReste: (centimes(p.reste) - ajout) / 100, montantARetourner: null };
}

/**
 * Totaux du détail d'un retour (écran du retour et Régularisation, une seule source) : remis, détaillé, reste (ligne de
 * reste d'un retour à total fixé, ou montant à rendre d'une fiche), dépenses sans pièce formelle (lignes détaillées),
 * retourné (montant réceptionné).
 */
export function totauxDetailRetour(r: {
  montantRegle: number;
  fiche: boolean;
  estReceptionne: boolean;
  montantARetourner: number;
  lignes: readonly { montant: number; reste: boolean; sansPiece: boolean }[];
}): { remis: number; detaille: number; reste: number; nonJustifie: number; retourne: number } {
  const somme = (garder: (l: { montant: number; reste: boolean; sansPiece: boolean }) => boolean) =>
    r.lignes.filter(garder).reduce((s, l) => s + centimes(l.montant), 0) / 100;
  return {
    remis: r.montantRegle,
    detaille: somme((l) => !l.reste),
    reste: r.fiche ? r.montantARetourner : somme((l) => l.reste),
    nonJustifie: somme((l) => !l.reste && l.sansPiece),
    retourne: r.estReceptionne ? r.montantARetourner : 0,
  };
}

export interface DepenseAvantApres {
  libelle: string;
  montant: number;
  type: "justifiee" | "sans_piece";
}

const LIBELLE_TYPE: Record<DepenseAvantApres["type"], string> = {
  justifiee: "Dépense justifiée",
  sans_piece: "Dépense sans pièce formelle",
};

/** Phrase lisible de l'historique : « Dépense modifiée : « Taxi » 15 000 → 12 500 FCFA, motif : … ». */
export function resumeModificationDepense(p: {
  avant: DepenseAvantApres;
  apres: DepenseAvantApres | null;
  motif: string;
}): string {
  const { avant, apres } = p;
  if (!apres) return `Dépense supprimée : « ${avant.libelle} » ${fcfa(avant.montant)} (${LIBELLE_TYPE[avant.type]}), motif : ${p.motif.trim()}`;
  const changements: string[] = [];
  if (centimes(avant.montant) !== centimes(apres.montant)) changements.push(`${fcfa(avant.montant)} → ${fcfa(apres.montant)}`);
  if (avant.libelle !== apres.libelle) changements.push(`libellé « ${avant.libelle} » → « ${apres.libelle} »`);
  if (avant.type !== apres.type) changements.push(`${LIBELLE_TYPE[avant.type]} → ${LIBELLE_TYPE[apres.type]}`);
  return `Dépense modifiée : « ${avant.libelle} » ${changements.length > 0 ? changements.join(", ") : "pièce jointe ou motif mis à jour"}, motif : ${p.motif.trim()}`;
}
