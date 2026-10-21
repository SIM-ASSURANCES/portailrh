// Congés — filtres et mise en forme de la vue d'ensemble DG/RH et de l'export Excel (module simplifié, 2026-10-20).
// Logique PURE : aucun accès base, partagée entre l'écran `/conges/toutes` et la route `GET /api/conges/export`.

import type { NatureConge } from "./generated/prisma/enums";
import { LIBELLE_NATURE_CONGE, LIBELLE_STATUT_CONGE, type StatutCircuitConge } from "./circuitConge";
import {
  ajouterJours,
  colonneDateDepuisJourCivil,
  comparerJours,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  MAX_JOURS_PERIODE,
  parseJourCivil,
  type JourCivil,
} from "./congesCalcul";

export const STATUTS_CONGE_VUE_ENSEMBLE: readonly StatutCircuitConge[] = [
  "EN_ATTENTE_RESPONSABLE",
  "EN_ATTENTE_RH",
  "MODIFICATION_DEMANDEE",
  "VALIDEE",
  "REJETEE",
  "ANNULEE",
];

const NATURES_CONGE: readonly NatureConge[] = ["CONGE", "PERMISSION_EXCEPTIONNELLE"];

export interface ParamsRechercheConges {
  du?: string;
  au?: string;
  statut?: string;
  service?: string;
  serviceId?: string;
  nature?: string;
}

export interface FiltresCongesVueEnsemble {
  du: JourCivil;
  au: JourCivil;
  statuts: StatutCircuitConge[];
  statut: StatutCircuitConge | "TOUS";
  serviceId: string | null;
  nature: NatureConge | null;
}

export type ResultatFiltresConges =
  | ({ ok: true } & FiltresCongesVueEnsemble)
  | { ok: false; erreur: string };

/**
 * Lit et valide les filtres de recherche de la vue d'ensemble et de l'export Excel :
 *   - période par défaut : mois en cours de `aujourdhui` ;
 *   - statut par défaut : `VALIDEE` (`statut=TOUS` signifie tous les statuts) ;
 *   - service et nature par défaut : tous (`null`) ;
 *   - refus si une date est invalide, si `du > au`, ou si la période dépasse 366 jours.
 */
export function filtresCongesDepuisRecherche(
  params: ParamsRechercheConges,
  aujourdhui: JourCivil
): ResultatFiltresConges {
  const ref = parseJourCivil(aujourdhui);
  if (!ref) return { ok: false, erreur: "Date du jour invalide." };

  const debutMois = formatJourCivil(new Date(ref.getFullYear(), ref.getMonth(), 1));
  const finMois = formatJourCivil(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));

  const du = (params.du ?? "").trim() || debutMois;
  const au = (params.au ?? "").trim() || finMois;

  if (!parseJourCivil(du) || !parseJourCivil(au)) {
    return { ok: false, erreur: "Les dates doivent être des jours civils valides au format AAAA-MM-JJ." };
  }
  if (comparerJours(du, au) > 0) {
    return { ok: false, erreur: "La date de début du filtre ne peut pas dépasser sa date de fin." };
  }
  if (comparerJours(au, ajouterJours(du, MAX_JOURS_PERIODE - 1)) > 0) {
    return { ok: false, erreur: `La période ne peut pas dépasser ${MAX_JOURS_PERIODE} jours.` };
  }

  const statutBrut = (params.statut ?? "").trim();
  let statut: StatutCircuitConge | "TOUS";
  let statuts: StatutCircuitConge[];
  if (statutBrut === "") {
    statut = "VALIDEE";
    statuts = ["VALIDEE"];
  } else if (statutBrut === "TOUS") {
    statut = "TOUS";
    statuts = [...STATUTS_CONGE_VUE_ENSEMBLE];
  } else if (STATUTS_CONGE_VUE_ENSEMBLE.includes(statutBrut as StatutCircuitConge)) {
    statut = statutBrut as StatutCircuitConge;
    statuts = [statut];
  } else {
    return { ok: false, erreur: "Statut de congé invalide." };
  }

  const natureBrut = (params.nature ?? "").trim();
  let nature: NatureConge | null = null;
  if (natureBrut !== "" && natureBrut !== "TOUS" && natureBrut !== "TOUTES") {
    if (!NATURES_CONGE.includes(natureBrut as NatureConge)) {
      return { ok: false, erreur: "Nature de congé invalide." };
    }
    nature = natureBrut as NatureConge;
  }

  const serviceBrut = (params.service ?? params.serviceId ?? "").trim();
  const serviceId = serviceBrut === "" || serviceBrut === "TOUS" ? null : serviceBrut;

  return {
    ok: true,
    du,
    au,
    statuts,
    statut,
    serviceId,
    nature,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mise en forme d'une ligne d'export Excel (13 colonnes, même texte que l'écran)
// ---------------------------------------------------------------------------------------------------------------------

export interface DemandeCongeExportSource {
  reference: string;
  nature: NatureConge;
  motif: string;
  dateDebut: JourCivil | Date;
  dateFin: JourCivil | Date;
  nbJoursOuvres: number;
  statut: StatutCircuitConge;
  etapeResponsableRequise: boolean;
  saisieParRH: boolean;
  observationRH: string | null;
  user: {
    fullName: string;
    service: { name: string } | null;
  };
  approuvePar: { fullName: string } | null;
  approuveAt: Date | null;
  validePar: { fullName: string } | null;
  valideAt: Date | null;
}

export interface LigneExportConge {
  reference: string;
  collaborateur: string;
  service: string;
  nature: string;
  motif: string;
  du: Date;
  au: Date;
  joursOuvres: number;
  statut: string;
  responsable: string;
  decisionRH: string;
  observationRH: string;
  saisieParRH: "Oui" | "Non";
}

export const COLONNES_EXPORT_CONGE: readonly {
  cle: keyof LigneExportConge;
  header: string;
  width: number;
  date?: boolean;
}[] = [
  { cle: "reference", header: "Référence", width: 20 },
  { cle: "collaborateur", header: "Collaborateur", width: 28 },
  { cle: "service", header: "Service", width: 22 },
  { cle: "nature", header: "Nature", width: 24 },
  { cle: "motif", header: "Motif", width: 38 },
  { cle: "du", header: "Du", width: 14, date: true },
  { cle: "au", header: "Au", width: 14, date: true },
  { cle: "joursOuvres", header: "Jours ouvrés", width: 14 },
  { cle: "statut", header: "Statut", width: 26 },
  { cle: "responsable", header: "Responsable", width: 28 },
  { cle: "decisionRH", header: "Décision RH", width: 28 },
  { cle: "observationRH", header: "Observation RH", width: 34 },
  { cle: "saisieParRH", header: "Saisi par la RH", width: 16 },
];

function dateFrDepuisInstant(d: Date): string {
  const [a, m, j] = formatJourCivil(d).split("-");
  return `${j}/${m}/${a}`;
}

function formaterActeurDate(acteur: { fullName: string } | null, date: Date | null): string {
  if (!acteur) return "";
  return date ? `${acteur.fullName}, ${dateFrDepuisInstant(date)}` : acteur.fullName;
}

function dateExcelDepuisJourOuColonne(valeur: JourCivil | Date): Date {
  const jour = typeof valeur === "string" ? valeur : jourCivilDepuisColonneDate(valeur);
  return colonneDateDepuisJourCivil(jour);
}

/**
 * Construit l'objet des 13 colonnes de l'export Excel d'une demande de congé :
 *   1. Référence
 *   2. Collaborateur
 *   3. Service
 *   4. Nature
 *   5. Motif
 *   6. Du (Date Excel)
 *   7. Au (Date Excel)
 *   8. Jours ouvrés
 *   9. Statut
 *   10. Responsable (nom et date, ou « Non requise » si l'étape n'était pas requise, vide si pas encore décidée)
 *   11. Décision RH (nom et date, vide si pas encore décidée)
 *   12. Observation RH
 *   13. Saisi par la RH (Oui / Non)
 */
export function ligneExportConge(demande: DemandeCongeExportSource): LigneExportConge {
  const responsable = !demande.etapeResponsableRequise
    ? "Non requise"
    : formaterActeurDate(demande.approuvePar, demande.approuveAt);

  return {
    reference: demande.reference,
    collaborateur: demande.user.fullName,
    service: demande.user.service?.name ?? "Aucun service",
    nature: LIBELLE_NATURE_CONGE[demande.nature],
    motif: demande.motif,
    du: dateExcelDepuisJourOuColonne(demande.dateDebut),
    au: dateExcelDepuisJourOuColonne(demande.dateFin),
    joursOuvres: demande.nbJoursOuvres,
    statut: LIBELLE_STATUT_CONGE[demande.statut],
    responsable,
    decisionRH: formaterActeurDate(demande.validePar, demande.valideAt),
    observationRH: demande.observationRH ?? "",
    saisieParRH: demande.saisieParRH ? "Oui" : "Non",
  };
}

