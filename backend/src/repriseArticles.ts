// Lot B (2026-10-15) — reprise des demandes existantes : recalcule, pour chaque demande À ARTICLES, le montant validé
// (somme des articles validés), l'étape (déduite des articles) et le statut (règle `statutDepuisLignes`). Logique PURE ;
// l'entrée/sortie base est dans `prisma/recalculer-statuts-articles.ts`, lancé À LA MAIN (jamais par une migration).

import type { EtapeCircuit, ModeEtapeDG, StatutDemande } from "./generated/prisma/enums";
import { etapeDepuisArticles, montantValideDepuisLignes, statutDepuisLignes, type StatutArticle } from "./etatArticles";

export interface DemandeARecalculer {
  id: string;
  reference: string;
  typeDemande: "STANDARD" | "DEPENSE_DIRECTE";
  statut: StatutDemande;
  etapeCircuit: EtapeCircuit;
  modeEtapeDG: ModeEtapeDG;
  montant: number;
  montantValide: number;
  totalRegle: number;
  lignes: { quantite: number; prixUnitaire: string; statutValidation: StatutArticle; soumiseAuDG: boolean; decisionDG: "VALIDEE" | "REFUSEE" | null }[];
}

export interface CorrectionDemande {
  id: string;
  reference: string;
  /** Champs à changer (seuls ceux qui diffèrent). */
  changements: { statut?: StatutDemande; etapeCircuit?: EtapeCircuit; montantValide?: number };
  /** Lecture humaine « champ : avant → après ». */
  resume: string[];
}

const TERMINAUX: readonly StatutDemande[] = ["REJETEE", "CLOTUREE", "ABANDONNEE"];

/** Correction à appliquer à une demande, `null` si elle est déjà conforme (idempotence : un 2ᵉ passage ne trouve rien). */
export function corrigerDemande(d: DemandeARecalculer): CorrectionDemande | null {
  // Seules les demandes À ARTICLES sont concernées (la dépense directe garde ses règles d'origine).
  if (d.typeDemande !== "STANDARD" || d.lignes.length === 0) return null;
  const lignes = d.lignes.map((l) => ({ quantite: l.quantite, prixUnitaire: l.prixUnitaire, statut: l.statutValidation }));
  const montantValide = montantValideDepuisLignes(lignes);
  const statut = statutDepuisLignes({ statutActuel: d.statut, montant: d.montant, montantValide, totalRegle: d.totalRegle, lignes });
  const terminal = TERMINAUX.includes(d.statut);
  const etape = terminal
    ? d.etapeCircuit
    : etapeDepuisArticles(d.etapeCircuit, d.modeEtapeDG, d.lignes.map((l) => ({ statut: l.statutValidation, soumiseAuDG: l.soumiseAuDG, decisionDG: l.decisionDG })));

  const changements: CorrectionDemande["changements"] = {};
  const resume: string[] = [];
  if (statut !== d.statut) {
    changements.statut = statut;
    resume.push(`statut : ${d.statut} → ${statut}`);
  }
  if (etape !== d.etapeCircuit) {
    changements.etapeCircuit = etape;
    resume.push(`étape : ${d.etapeCircuit} → ${etape}`);
  }
  if (Math.round(montantValide * 100) !== Math.round(d.montantValide * 100)) {
    changements.montantValide = montantValide;
    resume.push(`montant validé : ${d.montantValide} → ${montantValide}`);
  }
  return resume.length > 0 ? { id: d.id, reference: d.reference, changements, resume } : null;
}
