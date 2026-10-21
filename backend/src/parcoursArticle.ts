// Parcours d'un article (autonomie des articles, lot D, 2026-10-16) : Validé → Réglé → Retour de caisse → Régularisé.
// Module PUR : reçoit des données déjà lues (noms résolus, règlements de l'article et leurs retours) et renvoie un
// badge d'état, les montants clés et les seules étapes ATTEINTES — un champ qui ne s'applique pas encore n'est jamais
// produit. Aucune attribution devinée : seuls les règlements RATTACHÉS à l'article comptent (`Reglement.ligneDemandeId`),
// et les retours de caisse suivent leur règlement, donc l'article de ce règlement.
//
// Lot E (2026-10-17) : la régularisation est PAR ARTICLE. Le badge « Régularisé » s'affiche avec sa date et le solde final,
// détail des dépenses et des retours compris ; un retour exceptionnel post-clôture est rattaché à son article, l'état
// « indéterminé » ne subsiste que pour un retour ancien SANS article sur une demande à plusieurs articles réglés en Caisse.

import type { EtatArticle, StatutArticle } from "./etatArticles";
import { libelleMotifReglement } from "./motifReglement";
import { LIBELLE_ETAT_ARTICLE } from "./etatArticles";
import { depensesDeclareesLigne, getEcartLigne, resteNonDetailleTotal, type AgregatsRegularisation } from "./regularisationArticle";

export type BadgeParcours =
  | "EN_ATTENTE"
  | "REJETE"
  | "VALIDE"
  | "PARTIELLEMENT_REGLE"
  | "REGLE"
  | "RETOUR_EN_ATTENTE"
  | "REGULARISE";

export const LIBELLE_BADGE_PARCOURS: Record<BadgeParcours, string> = {
  EN_ATTENTE: "En attente",
  REJETE: "Rejeté",
  VALIDE: "Validé",
  PARTIELLEMENT_REGLE: "Partiellement réglé",
  REGLE: "Réglé",
  RETOUR_EN_ATTENTE: "Retour en attente",
  REGULARISE: "Régularisé",
};

export type VarianteBadgeParcours = "neutral" | "info" | "success" | "warning" | "danger";

export const VARIANTE_BADGE_PARCOURS: Record<BadgeParcours, VarianteBadgeParcours> = {
  EN_ATTENTE: "neutral",
  REJETE: "danger",
  VALIDE: "info",
  PARTIELLEMENT_REGLE: "warning",
  REGLE: "success",
  RETOUR_EN_ATTENTE: "warning",
  REGULARISE: "success",
};

export interface ParcoursSignature {
  /** Ce qui a été signé, en clair (`ACTIONS_SIGNEES`). */
  libelle: string;
  at: Date;
  signatureId: string;
  signataire: string;
  fonction: string;
  auNomDe: string | null;
  version: number;
}

export interface ParcoursRetour {
  estReceptionne: boolean;
  montantARetourner: number;
  /** Lot H : date de réception du retour s'il est réceptionné, sinon de sa déclaration ; absente = non connue. */
  date?: Date | null;
}

export interface ParcoursReglement {
  id: string;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  estConfirme: boolean;
  estAnnule: boolean;
  /** Date de confirmation (le règlement a réellement eu lieu). */
  confirmeAt: Date | null;
  /** Motif / nature du règlement (lot I) ; absent ou `null` pour un règlement antérieur (affiché « Non renseigné »). */
  motif?: string | null;
  /** Solde à régulariser du règlement (Caisse comme Banque, lot G) ; `null` si non calculé. */
  solde: number | null;
  retours: ParcoursRetour[];
}

/** Retour externe rattaché à l'article (lot G bis) : fonds versé par banque, rendu à la caisse par la Finance. */
export interface ParcoursRetourExterne {
  montant: number;
  creeAt: Date | null;
}

export interface EntreeParcours {
  /** Retours externes rattachés à l'article ; comptent comme retours reçus dans la régularisation. */
  retoursExternes?: ParcoursRetourExterne[];
  statut: StatutArticle;
  etat: EtatArticle;
  /** Total de l'article (quantité × prix unitaire). */
  montant: number;
  beneficiaire: string;
  /** Auteur et date de la décision finale (validation ou rejet). */
  decidePar: string | null;
  decideAt: Date | null;
  /** Finance qui a décidé ou confirmé l'article, si différent de `decidePar` (article validé par le DG). */
  confirmeParFinance: string | null;
  motifRejet: string | null;
  /** Règlements rattachés à CET article (tous statuts : le parcours ne retient que les confirmés et non annulés). */
  reglements: ParcoursReglement[];
  /**
   * La régularisation ne peut pas être attribuée à cet article sans deviner (retour exceptionnel post-clôture, qui
   * est au niveau de la demande, sur une demande dont plusieurs articles sont réglés en Caisse). Le badge « Régularisé »
   * n'est alors jamais produit.
   */
  regularisationIndeterminee?: boolean;
  /** Chiffres de régularisation de l'article (lot E) et date à laquelle son solde est devenu nul, si connue. */
  regularisation?: { agregats: AgregatsRegularisation; regulariseAt: Date | null };
}

export interface EtapeParcours {
  cle: "VALIDE" | "REGLE" | "RETOUR" | "RETOUR_EXTERNE" | "REGULARISE" | "REJETE";
  libelle: string;
  /** Une ligne de texte par information (les informations absentes ne sont pas produites). */
  lignes: string[];
}

export interface MontantsParcours {
  valide: number;
  regle: number;
  reste: number;
  /** Retours de caisse déclarés (attendu) et reçus ; `null` quand aucun retour n'existe. */
  retourAttendu: number | null;
  retourRecu: number | null;
}

/**
 * Lot H — « Géré le » : date du DERNIER événement du parcours de l'article (validé, rejeté, réglé, retour de caisse,
 * retour enregistré par la Finance, régularisé), avec le nom de l'étape. Déduite des dates déjà enregistrées : aucune colonne
 * ajoutée. `null` tant que l'article n'a connu aucune décision.
 */
export interface GestionArticle {
  etape: "Validé" | "Rejeté" | "Réglé" | "Retour de caisse" | "Retour enregistré par la Finance" | "Régularisé" | "Clôturée";
  date: Date;
}

export interface ParcoursArticle {
  /** Lot H : dernière étape gérée et sa date (« Géré le … »), `null` si l'article n'a pas encore été traité. */
  gere: GestionArticle | null;
  badge: BadgeParcours;
  libelleBadge: string;
  variante: VarianteBadgeParcours;
  /** Précision sous le badge (par ex. « À décider par la Finance » pour un article en attente). */
  precision: string | null;
  montants: MontantsParcours;
  etapes: EtapeParcours[];
  note: string | null;
  /** Lot C : « Clôturé sans régularisation — solde restant X » si la demande a été clôturée de force avec cet article non régularisé. */
  clotureSansRegularisation?: string | null;
  /** Lot K : réorientations de l'étape Service et reprises (retour à l'étape précédente) qui ont touché la demande ou cet article, une ligne chacune (date — auteur — détail avec motif). */
  circuit?: string[];
  /** Lot L : actions signées qui concernent l'article (ou la demande entière), dans l'ordre. */
  signatures?: ParcoursSignature[];
  /** Lot L : la décision de l'article précède la mise en service des signatures (« Antérieur à la signature »). */
  signatureAnterieure?: boolean;
  /** Lot J (Finance et DG seulement) : reste du budget global et de la catégorie après la validation de l'article. */
  budget?: { lignes: string[]; niveau: "AUCUN" | "ORANGE" | "ROUGE"; /** Lot J bis : la confirmation du DG couvre le règlement de l'article. */ couvertureReglement?: string };
}

const c = (n: number) => Math.round(n * 100);
const eur = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const jour = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" }) : null);

/** Libellé de la date de gestion : « Géré le 12/10/2026 (réglé) » ; « Géré le — » quand l'article n'a pas été traité. */
export function libelleGestionArticle(g: GestionArticle | null): string {
  if (!g) return "Géré le —";
  return `Géré le ${jour(g.date)} (${g.etape.charAt(0).toLowerCase()}${g.etape.slice(1)})`;
}

/** Dernier événement daté parmi ceux fournis (à date égale, le plus tardif de la liste : la suite logique du parcours). */
export function derniereGestion(evenements: { etape: GestionArticle["etape"]; date: Date | null | undefined }[]): GestionArticle | null {
  let retenu: GestionArticle | null = null;
  for (const ev of evenements) {
    if (!(ev.date instanceof Date)) continue;
    if (!retenu || ev.date.getTime() >= retenu.date.getTime()) retenu = { etape: ev.etape, date: ev.date };
  }
  return retenu;
}

export const NOTE_REGULARISATION_INDETERMINEE =
  "Un retour exceptionnel post-clôture ancien, rattaché à aucun article, a été enregistré sur cette demande : la régularisation ne peut pas être attribuée à cet article.";

export function parcoursArticle(e: EntreeParcours): ParcoursArticle {
  const confirmes = e.reglements.filter((r) => r.estConfirme && !r.estAnnule);
  // Lot G : un fonds versé par banque compte comme un fonds versé en caisse pour les retours et la régularisation.
  const retours = confirmes.flatMap((r) => r.retours);

  const valide = e.statut === "VALIDEE" ? e.montant : 0;
  const regle = confirmes.reduce((s, r) => s + c(r.montant), 0) / 100;
  const reste = Math.max(0, c(valide) - c(regle)) / 100;
  const retourAttendu = retours.length > 0 ? retours.reduce((s, r) => s + c(r.montantARetourner), 0) / 100 : null;
  const retourRecu =
    retours.length > 0 ? retours.filter((r) => r.estReceptionne).reduce((s, r) => s + c(r.montantARetourner), 0) / 100 : null;
  const montants: MontantsParcours = { valide, regle, reste, retourAttendu, retourRecu };

  const habiller = (badge: BadgeParcours, precision: string | null, etapes: EtapeParcours[], note: string | null = null): ParcoursArticle => ({
    gere: derniereGestion([
      { etape: e.statut === "REJETEE" ? "Rejeté" : "Validé", date: e.statut === "EN_ATTENTE" ? null : e.decideAt },
      ...confirmes.map((r) => ({ etape: "Réglé" as const, date: r.confirmeAt })),
      ...retours.map((r) => ({ etape: "Retour de caisse" as const, date: r.date })),
      ...(e.retoursExternes ?? []).map((x) => ({ etape: "Retour enregistré par la Finance" as const, date: x.creeAt })),
      { etape: "Régularisé", date: badge === "REGULARISE" ? (e.regularisation?.regulariseAt ?? null) : null },
    ]),
    badge,
    libelleBadge: LIBELLE_BADGE_PARCOURS[badge],
    variante: VARIANTE_BADGE_PARCOURS[badge],
    precision,
    montants,
    etapes,
    note,
  });

  if (e.statut === "REJETEE") {
    const lignes = [
      [e.decidePar ? `Rejeté par ${e.decidePar}` : "Rejeté", jour(e.decideAt) ? `le ${jour(e.decideAt)}` : null].filter(Boolean).join(" "),
      ...(e.motifRejet ? [`Motif : ${e.motifRejet}`] : []),
    ];
    return habiller("REJETE", null, [{ cle: "REJETE", libelle: "Rejet", lignes }]);
  }
  if (e.statut === "EN_ATTENTE") {
    return habiller("EN_ATTENTE", LIBELLE_ETAT_ARTICLE[e.etat], []);
  }

  // --- Article validé ------------------------------------------------------------------------------------------
  const etapes: EtapeParcours[] = [];
  const lignesValide = [
    [e.decidePar ? `Validé par ${e.decidePar}` : "Validé", jour(e.decideAt) ? `le ${jour(e.decideAt)}` : null].filter(Boolean).join(" "),
  ];
  if (e.confirmeParFinance) lignesValide.push(`Confirmé par la Finance : ${e.confirmeParFinance}`);
  lignesValide.push(`Montant validé : ${eur(e.montant)}`);
  etapes.push({ cle: "VALIDE", libelle: "Validé", lignes: lignesValide });

  if (confirmes.length > 0) {
    const lignes = confirmes.map(
      (r) =>
        `${eur(r.montant)} — ${r.mode === "CAISSE" ? "Caisse" : "Banque"}${jour(r.confirmeAt) ? ` — le ${jour(r.confirmeAt)}` : ""} — bénéficiaire : ${e.beneficiaire} — motif : ${libelleMotifReglement(r.motif)}`
    );
    if (reste > 0) lignes.push(`Réglé ${eur(regle)} sur ${eur(valide)} — reste ${eur(reste)}`);
    etapes.push({ cle: "REGLE", libelle: "Réglé", lignes });
  }

  const enAttente = retours.filter((r) => !r.estReceptionne).length;
  if (retours.length > 0) {
    const lignes = [`Attendu : ${eur(retourAttendu ?? 0)} — reçu : ${eur(retourRecu ?? 0)}`];
    if (enAttente > 0) lignes.push(`${enAttente} retour${enAttente > 1 ? "s" : ""} en attente de réception`);
    etapes.push({ cle: "RETOUR", libelle: "Retour de caisse", lignes });
  }

  const externes = e.retoursExternes ?? [];
  if (externes.length > 0) {
    etapes.push({
      cle: "RETOUR_EXTERNE",
      libelle: "Retour enregistré par la Finance",
      lignes: externes.map(
        (x) => `${eur(x.montant)} — fonds versé par banque, rendu à la caisse${jour(x.creeAt) ? ` le ${jour(x.creeAt)}` : ""}`
      ),
    });
  }

  const soldesConnus = confirmes.length > 0 && confirmes.every((r) => r.solde != null);
  const regularise = soldesConnus && confirmes.every((r) => c(r.solde as number) === 0) && !e.regularisationIndeterminee;
  const note = e.regularisationIndeterminee && confirmes.length > 0 ? NOTE_REGULARISATION_INDETERMINEE : null;
  if (regularise && reste === 0) {
    const lignes: string[] = [];
    const g = e.regularisation;
    lignes.push(g?.regulariseAt ? `Régularisé le ${jour(g.regulariseAt)}` : "Régularisé");
    if (g) {
      lignes.push(
        `Fonds remis ${eur(g.agregats.fondsRemis)} − dépenses ${eur(depensesDeclareesLigne(g.agregats))} − retours reçus ${eur(g.agregats.retoursRecus)}`
      );
      if (g.agregats.depensesSansPieceFormelle > 0 || resteNonDetailleTotal(g.agregats) > 0) {
        lignes.push(
          `Dont dépenses sans pièce formelle : ${eur(g.agregats.depensesSansPieceFormelle)}${resteNonDetailleTotal(g.agregats) > 0 ? ` — reste non détaillé : ${eur(resteNonDetailleTotal(g.agregats))}` : ""}`
        );
      }
      lignes.push(`Solde final : ${eur(getEcartLigne(g.agregats))}`);
    } else {
      lignes.push("Solde à régulariser : 0 FCFA");
    }
    etapes.push({ cle: "REGULARISE", libelle: "Régularisé", lignes });
  }

  if (confirmes.length === 0) return habiller("VALIDE", null, etapes, note);
  if (enAttente > 0) return habiller("RETOUR_EN_ATTENTE", null, etapes, note);
  if (reste > 0) return habiller("PARTIELLEMENT_REGLE", null, etapes, note);
  if (regularise) return habiller("REGULARISE", null, etapes, note);
  return habiller("REGLE", null, etapes, note);
}
