// Reporting des retours de caisse (lot G.5, 2026-10-14) : UNE LIGNE PAR RETOUR, avec le détail de l'article d'origine
// (libellé Finance et libellé du demandeur, bénéficiaire, montant validé, date de livraison), les règlements de l'article
// (Caisse et Banque), la demande (numéro, demandeur, service) et le retour lui-même. Fonctions PURES : le chargement est
// dans `reporting.ts` (`getReportingRetoursCaisse`). Écran et export Excel partagent `COLONNES_REPORTING_RETOUR`.

import { libelleDateLivraison } from "./dateLivraisonArticle";

const fcfa = (m: number) => `${Math.round(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const jour = (d: Date | null | undefined) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" }) : "—");
const centimes = (m: number) => Math.round(m * 100);

export interface SourceRetourReporting {
  retourId: string;
  declareLe: Date;
  declarant: string;
  creeParAssistant: boolean;
  estReceptionne: boolean;
  receptionneLe: Date | null;
  receptionnePar: string | null;
  versementBancaire: boolean;
  montantARetourner: number;
  totalDepenses: number;
  reglement: { mode: "CAISSE" | "BANQUE"; montant: number; confirmeLe: Date | null };
  demande: { reference: string; demandeur: string; service: string | null };
  /** Article payé par le règlement d'origine ; `null` si le règlement n'est rattaché à aucun article. */
  article: {
    libelleFinance: string;
    libelleDemandeur: string;
    beneficiaire: string;
    montantValide: number;
    dateLivraison: Date | null;
  } | null;
  /** Règlements confirmés et non annulés de l'article (ou de la demande sans article), Caisse et Banque. */
  reglementsArticle: { mode: "CAISSE" | "BANQUE"; montant: number; date: Date | null }[];
}

export interface LigneReportingRetour {
  demande: string;
  demandeur: string;
  service: string;
  article: string;
  articleDemandeur: string;
  beneficiaire: string;
  montantValideArticle: number | null;
  dateLivraison: string;
  reglementsArticle: string[];
  totalRegleArticle: number;
  dontCaisse: number;
  dontBanque: number;
  declareLe: Date;
  declarePar: string;
  etat: string;
  receptionne: string;
  modeReglement: string;
  montantReglement: number;
  nature: string;
  montantARetourner: number;
  totalDepenses: number;
}

export const COLONNES_REPORTING_RETOUR: { cle: keyof LigneReportingRetour; titre: string; montant?: boolean; multi?: boolean }[] = [
  { cle: "demande", titre: "Demande" },
  { cle: "demandeur", titre: "Demandeur" },
  { cle: "service", titre: "Service" },
  { cle: "article", titre: "Article (libellé Finance)" },
  { cle: "articleDemandeur", titre: "Article (libellé d'origine du demandeur)" },
  { cle: "beneficiaire", titre: "Bénéficiaire de l'article" },
  { cle: "montantValideArticle", titre: "Montant validé de l'article", montant: true },
  { cle: "dateLivraison", titre: "Date de livraison" },
  { cle: "reglementsArticle", titre: "Règlements de l'article", multi: true },
  { cle: "totalRegleArticle", titre: "Réglé sur l'article", montant: true },
  { cle: "dontCaisse", titre: "Dont Caisse", montant: true },
  { cle: "dontBanque", titre: "Dont Banque", montant: true },
  { cle: "declareLe", titre: "Retour déclaré le" },
  { cle: "declarePar", titre: "Déclaré par" },
  { cle: "etat", titre: "État du retour" },
  { cle: "receptionne", titre: "Réception" },
  { cle: "modeReglement", titre: "Règlement d'origine" },
  { cle: "montantReglement", titre: "Montant du règlement d'origine", montant: true },
  { cle: "nature", titre: "Nature du retour" },
  { cle: "montantARetourner", titre: "Montant à retourner", montant: true },
  { cle: "totalDepenses", titre: "Dépenses du retour", montant: true },
];

const libelleMode = (m: "CAISSE" | "BANQUE") => (m === "CAISSE" ? "Caisse" : "Banque");

export function construireLigneRetour(s: SourceRetourReporting): LigneReportingRetour {
  const dontCaisse = s.reglementsArticle.filter((r) => r.mode === "CAISSE").reduce((t, r) => t + centimes(r.montant), 0) / 100;
  const dontBanque = s.reglementsArticle.filter((r) => r.mode === "BANQUE").reduce((t, r) => t + centimes(r.montant), 0) / 100;
  const nul = s.estReceptionne && !s.versementBancaire && centimes(s.montantARetourner) === 0;
  return {
    demande: s.demande.reference,
    demandeur: s.demande.demandeur,
    service: s.demande.service ?? "—",
    article: s.article?.libelleFinance ?? "— (règlement non rattaché à un article)",
    articleDemandeur: s.article?.libelleDemandeur ?? "—",
    beneficiaire: s.article?.beneficiaire ?? "—",
    montantValideArticle: s.article ? s.article.montantValide : null,
    dateLivraison: s.article ? libelleDateLivraison(s.article.dateLivraison) : "—",
    reglementsArticle: s.reglementsArticle.map((r) => `${libelleMode(r.mode)} — ${fcfa(r.montant)} — ${jour(r.date)}`),
    totalRegleArticle: dontCaisse + dontBanque,
    dontCaisse,
    dontBanque,
    declareLe: s.declareLe,
    declarePar: `${s.declarant}${s.creeParAssistant ? " (Assistant Finance)" : ""}`,
    etat: nul ? "Retour nul" : s.estReceptionne ? "Réceptionné" : "En attente de réception",
    receptionne: s.estReceptionne ? `${jour(s.receptionneLe)}${s.receptionnePar ? ` par ${s.receptionnePar}` : ""}` : "—",
    modeReglement: libelleMode(s.reglement.mode),
    montantReglement: s.reglement.montant,
    nature: s.versementBancaire ? "Versement bancaire (avant le lot G)" : "Espèces à la caisse",
    montantARetourner: s.montantARetourner,
    totalDepenses: s.totalDepenses,
  };
}
