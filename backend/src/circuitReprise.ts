// Lot K (2026-10-26) — « reprise » : retour d'une demande ou d'un article à l'étape PRÉCÉDENTE du circuit, motif obligatoire.
// Règles PURES (aucune base, aucune valeur Prisma) appelées par `transition` (action `REPRENDRE`) : l'écran et le serveur
// lisent donc la même phrase de refus (`raisonIndisponible`).
//
// Enchaînement réel du circuit (vérifié dans le code, pas dans la spec) : Service (demande entière) → Finance (article par
// article) → DG (articles soumis par la Finance) ; la validation d'un article par la Finance est une DÉCISION, puis vient
// l'exécution (règlement). Il n'existait AUCUNE fonction de retour en arrière : `repriseArticles.ts` et `repriseReglements.ts`
// sont des scripts de rattrapage de données (lots B et D), `cheminRetour.ts` valide la redirection après connexion — rien
// à réutiliser ici, ce fichier est le premier (et le seul) mécanisme de reprise du circuit.
//
// Trois reprises, et rien d'autre :
//   FINANCE_VERS_SERVICE   la demande ENTIÈRE, tant qu'aucun article n'a été décidé, soumis au DG ni réglé ;
//   DG_VERS_FINANCE        un article soumis au DG qui n'a pas encore reçu sa décision (retrait, ou renvoi par le DG) ;
//   VALIDATION_VERS_FINANCE un article validé par la FINANCE SEULE, sans aucun règlement (même brouillon ni partiel).
// Interdits : article rejeté (définitif), article validé par le DG (définitif — ne pas élargir le mécanisme du « DG
// définitif »), article avec un règlement, demande clôturée / rejetée / abandonnée, demande émise par le DG, dépense directe
// (aucune étape précédente), propre demande ou propre article (garde 8). Une reprise n'écrit JAMAIS dans le journal de caisse.

import { MOTIF_ECHANGE_MAX } from "./motifEchange";
import type { EtapeCircuit, ModeEtapeDG, StatutDemande } from "./generated/prisma/enums";
import { etapeDepuisArticles, etatLigneCircuit, type LigneEtat } from "./etatArticles";

export const MOTIF_REPRISE_MIN = 10;

export type TypeReprise = "FINANCE_VERS_SERVICE" | "DG_VERS_FINANCE" | "VALIDATION_VERS_FINANCE";

export const LIBELLE_TYPE_REPRISE: Record<TypeReprise, { de: string; vers: string }> = {
  FINANCE_VERS_SERVICE: { de: "Finance", vers: "Service" },
  DG_VERS_FINANCE: { de: "DG", vers: "Finance" },
  VALIDATION_VERS_FINANCE: { de: "Validé par la Finance", vers: "À décider par la Finance" },
};

/** Action d'historique d'une reprise (visible du demandeur : c'est l'histoire de SA demande). */
export const ACTION_HISTORIQUE_REPRISE = "reprise_etape";

export interface LigneReprise extends LigneEtat {
  id: string;
  libelle: string;
  /** Bénéficiaire EFFECTIF de l'article (garde 8). */
  beneficiaireUserId?: string | null;
  /** Règlements non annulés rattachés à l'article, brouillons compris. Absent = inconnu : la reprise est refusée. */
  nbReglementsActifs?: number;
}

export interface DemandeReprise {
  etape: EtapeCircuit;
  createurId: string;
  typeDemande: "STANDARD" | "DEPENSE_DIRECTE";
  etapeServiceRequise: boolean;
  modeEtapeDG: ModeEtapeDG;
  statutDemande?: StatutDemande;
  lignes: readonly LigneReprise[];
}

export interface ActeurReprise {
  userId: string;
  permissions: readonly string[];
}

export type ResultatReprise =
  | { ok: true; type: TypeReprise; etapeSuivante: EtapeCircuit; ligneId: string | null }
  | { ok: false; message: string };

const refus = (message: string): ResultatReprise => ({ ok: false, message });

export function refusMotifReprise(motif: string | null | undefined): string | null {
  // Lot M : le renvoi à la Finance par le DG (et toute reprise) porte un motif de 10 à 300 caractères.
  const n = (motif ?? "").trim().length;
  if (n < MOTIF_REPRISE_MIN) return `Le motif de la reprise est obligatoire (${MOTIF_REPRISE_MIN} caractères minimum).`;
  if (n > MOTIF_ECHANGE_MAX) return `Le motif de la reprise ne doit pas dépasser ${MOTIF_ECHANGE_MAX} caractères (${n} saisis).`;
  return null;
}

const STATUTS_CLOS: readonly StatutDemande[] = ["CLOTUREE", "REJETEE", "ABANDONNEE"];

/**
 * Décide si `acteur` peut reprendre la demande (`ligneId` absent) ou l'article `ligneId` à l'étape précédente.
 * Acteur : décideur de l'étape en cours (`treso.decider_finance` à l'étape Finance, `treso.decider_dg` à l'étape DG) ou de
 * l'étape suivante (le DG pour un dossier à la Finance ; la Finance qui avait soumis l'article au DG).
 */
export function evaluerReprise(
  demande: DemandeReprise,
  acteur: ActeurReprise,
  ligneId: string | undefined,
  motif: string
): ResultatReprise {
  const peutFinance = acteur.permissions.includes("treso.decider_finance");
  const peutDG = acteur.permissions.includes("treso.decider_dg");
  if (!peutFinance && !peutDG) return refus("Action non autorisée.");
  const motifInvalide = refusMotifReprise(motif);
  if (motifInvalide) return refus(motifInvalide);
  if (acteur.userId === demande.createurId) return refus("Vous ne pouvez pas décider votre propre demande.");

  if (demande.statutDemande && STATUTS_CLOS.includes(demande.statutDemande)) {
    return refus("Cette demande est clôturée, rejetée ou abandonnée : aucune reprise n'est possible.");
  }
  if (demande.etape === "A_CORRIGER" || demande.etape === "ABANDONNEE") {
    return refus("Cette demande est en correction chez le demandeur : il n'y a rien à reprendre.");
  }
  if (demande.typeDemande === "DEPENSE_DIRECTE" || demande.lignes.length === 0) {
    return refus("Une dépense directe n'a pas d'étape précédente : aucune reprise possible.");
  }

  const etats = new Map(demande.lignes.map((l) => [l.id, etatLigneCircuit(l, demande.modeEtapeDG)]));

  // ---- Reprise de la demande entière : Finance → Service ----
  if (ligneId === undefined) {
    if (!demande.etapeServiceRequise) {
      return refus("Cette demande n'est pas passée par l'étape Service : il n'y a pas d'étape précédente.");
    }
    if (demande.etape !== "FINANCE") return refus("Cette demande n'est pas à l'étape Finance.");
    const toutADecider = demande.lignes.every((l) => etats.get(l.id) === "A_DECIDER");
    if (!toutADecider) {
      return refus(
        "Des articles ont déjà été décidés ou soumis au DG : la demande ne peut plus être renvoyée au responsable de service. Reprenez les articles un par un."
      );
    }
    return { ok: true, type: "FINANCE_VERS_SERVICE", etapeSuivante: "SERVICE", ligneId: null };
  }

  // ---- Reprise d'un article ----
  const ligne = demande.lignes.find((l) => l.id === ligneId);
  if (!ligne) return refus("Une ligne ne fait pas partie de cette demande.");
  if (ligne.beneficiaireUserId && ligne.beneficiaireUserId === acteur.userId) {
    return refus(`Vous êtes le bénéficiaire de l'article « ${ligne.libelle} » : un autre compte le reprend.`);
  }
  const etat = etats.get(ligne.id)!;
  const reprendre = (type: TypeReprise, apres: LigneReprise): ResultatReprise => ({
    ok: true,
    type,
    etapeSuivante: etapeDepuisArticles(
      demande.etape,
      demande.modeEtapeDG,
      demande.lignes.map((l) => (l.id === ligne.id ? apres : l))
    ),
    ligneId: ligne.id,
  });

  switch (etat) {
    case "REJETEE":
      return refus(`L'article « ${ligne.libelle} » est rejeté : un rejet est définitif.`);
    case "VALIDEE_DG_A_CONFIRMER":
      return refus(`L'article « ${ligne.libelle} » a été validé par le DG : sa décision est définitive.`);
    case "REFUSEE_DG_A_TRANCHER":
    case "A_DECIDER":
      return refus(`L'article « ${ligne.libelle} » attend déjà la décision de la Finance : il n'y a rien à reprendre.`);
    case "CHEZ_DG":
      if (demande.modeEtapeDG === "OBLIGATOIRE") {
        return refus("Pour cette demande, le DG décide d'office : il n'y a pas d'étape précédente.");
      }
      return reprendre("DG_VERS_FINANCE", { ...ligne, soumiseAuDG: false, decisionDG: null });
    case "VALIDEE": {
      // « DG définitif » : une validation passée par le DG (ou décidée par lui) ne se reprend pas.
      if (ligne.decisionDG !== null || ligne.soumiseAuDG || demande.modeEtapeDG === "OBLIGATOIRE") {
        return refus(`L'article « ${ligne.libelle} » a été validé par le DG : sa décision est définitive.`);
      }
      if (ligne.nbReglementsActifs === undefined) {
        return refus("Les règlements de cet article n'ont pas pu être vérifiés : reprise impossible.");
      }
      if (ligne.nbReglementsActifs > 0) {
        return refus(`L'article « ${ligne.libelle} » a déjà un règlement (même partiel ou en brouillon) : il ne peut plus être repris.`);
      }
      return reprendre("VALIDATION_VERS_FINANCE", { ...ligne, statut: "EN_ATTENTE", soumiseAuDG: false, decisionDG: null });
    }
  }
}

/** Phrase d'historique : qui reprend quoi, de quelle étape à quelle étape, motif. */
export function detailReprise(p: { type: TypeReprise; motif: string; libelleArticle?: string | null; etapeAvant: string; etapeApres: string }): string {
  const t = LIBELLE_TYPE_REPRISE[p.type];
  const cible = p.libelleArticle ? `article « ${p.libelleArticle} »` : "demande entière";
  return `Reprise (${cible}) : ${t.de} → ${t.vers} — motif : ${p.motif.trim()} — étape de la demande : ${p.etapeAvant} → ${p.etapeApres} (chronomètre remis à zéro)`;
}
