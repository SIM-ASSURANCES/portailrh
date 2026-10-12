// Reporting « une ligne par demande » (2026-10-08) : tout ce qui est rattaché à une demande (lignes d'articles,
// règlements, dépenses, retours, remboursements, ajustements, validations) tient sur UNE ligne, à l'écran et dans
// l'export Excel. Les données multiples sont regroupées dans une cellule (un élément par ligne de la cellule), avec des
// colonnes numériques de totaux à côté. Fonctions PURES (aucun accès base) : le chargement est dans `reporting.ts`.

/** Une entrée d'historique utile au reporting (validations, clôture, ajustements). */
export interface HistoriqueReporting {
  action: string;
  detail: string | null;
  auteur: string;
  date: Date;
}

export interface DemandeReportingSource {
  reference: string;
  creeLe: Date;
  typeDemande: "STANDARD" | "DEPENSE_DIRECTE";
  statut: string;
  etapeCircuit: string | null;
  demandeur: string;
  service: string | null;
  beneficiaire: string;
  /** Dépense directe sans ligne : sa description et sa catégorie. */
  description: string | null;
  categorie: string | null;
  objet: string | null;
  montantDemande: number;
  montantValide: number;
  lignes: {
    libelle: string;
    motif: string | null;
    quantite: number;
    prixUnitaire: number;
    categorie: string | null;
    objet: string | null;
    statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
    motifRejet: string | null;
    decidePar: string | null;
    decideLe: Date | null;
  }[];
  reglements: {
    montant: number;
    mode: "CAISSE" | "BANQUE";
    estConfirme: boolean;
    estAnnule: boolean;
    motifAnnulation: string | null;
    auteur: string;
    creeLe: Date;
    confirmeLe: Date | null;
    retours: {
      montantARetourner: number;
      estReceptionne: boolean;
      receptionneLe: Date | null;
      receptionnePar: string | null;
      declarant: string;
      declareLe: Date;
      creeParAssistant: boolean;
      complementSignalement: boolean;
      reouvertureExceptionnelle: boolean;
      depenses: { libelle: string; montant: number; justifiee: boolean; motifNonJustifie: string | null }[];
      remboursements: {
        montant: number;
        statut: "EN_ATTENTE_VALIDATION" | "VALIDE" | "REJETE";
        proposePar: string;
        proposeLe: Date;
        validePar: string | null;
        valideLe: Date | null;
        motifRejet: string | null;
      }[];
    }[];
  }[];
  retoursExceptionnels: {
    montant: number;
    statut: "EN_ATTENTE_VALIDATION" | "VALIDE" | "REJETE";
    saisiPar: string;
    saisiLe: Date;
    validePar: string | null;
    valideLe: Date | null;
    motifRejet: string | null;
  }[];
  historique: HistoriqueReporting[];
}

export interface LigneReportingDemande {
  reference: string;
  creeLe: Date;
  type: string;
  statut: string;
  etape: string;
  demandeur: string;
  service: string;
  beneficiaire: string;
  /** Cellules multi-valeurs : un élément par ligne de la cellule. */
  lignesArticles: string[];
  validations: string[];
  reglements: string[];
  depenses: string[];
  retours: string[];
  remboursements: string[];
  ajustements: string[];
  totalDemande: number;
  totalValide: number;
  totalRegle: number;
  totalDepense: number;
  totalDepenseJustifiee: number;
  totalRetourne: number;
  /** Réglé − dépensé − retourné (même formule que le « Solde à régulariser », `getEcart`). Jamais plafonné. */
  solde: number;
}

/** Colonnes du rapport, dans l'ordre — partagées par l'écran et l'export Excel (jamais deux listes divergentes). */
export const COLONNES_REPORTING_DEMANDE: { cle: keyof LigneReportingDemande; titre: string; montant?: boolean; multi?: boolean }[] = [
  { cle: "reference", titre: "Référence" },
  { cle: "creeLe", titre: "Créée le" },
  { cle: "type", titre: "Type" },
  { cle: "statut", titre: "Statut" },
  { cle: "etape", titre: "Étape du circuit" },
  { cle: "demandeur", titre: "Demandeur" },
  { cle: "service", titre: "Service" },
  { cle: "beneficiaire", titre: "Bénéficiaire" },
  { cle: "lignesArticles", titre: "Lignes d'articles", multi: true },
  { cle: "totalDemande", titre: "Demandé", montant: true },
  { cle: "validations", titre: "Validations (Service, Finance, DG)", multi: true },
  { cle: "totalValide", titre: "Validé", montant: true },
  { cle: "reglements", titre: "Règlements", multi: true },
  { cle: "totalRegle", titre: "Réglé", montant: true },
  { cle: "depenses", titre: "Dépenses", multi: true },
  { cle: "totalDepense", titre: "Dépensé", montant: true },
  { cle: "totalDepenseJustifiee", titre: "Dont justifié", montant: true },
  { cle: "retours", titre: "Retours de caisse", multi: true },
  { cle: "remboursements", titre: "Remboursements", multi: true },
  { cle: "ajustements", titre: "Ajustements et régularisations", multi: true },
  { cle: "totalRetourne", titre: "Retourné", montant: true },
  { cle: "solde", titre: "Solde", montant: true },
];

// Espace ordinaire comme séparateur de milliers (même choix que les PDF, `formatMontant`) : lisible partout, y compris
// dans une cellule Excel copiée ailleurs.
const fcfa = (m: number) => `${Math.round(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const jour = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });
const par = (nom: string | null, d: Date | null) => [nom ? `par ${nom}` : null, d ? `le ${jour(d)}` : null].filter(Boolean).join(" ");
const centimes = (m: number) => Math.round(m * 100);

const LIBELLE_STATUT_LIGNE = { EN_ATTENTE: "En attente", VALIDEE: "Validée", REJETEE: "Rejetée" } as const;
const LIBELLE_STATUT_DECISION = { EN_ATTENTE_VALIDATION: "En attente de validation", VALIDE: "Validé", REJETE: "Rejeté" } as const;

/**
 * Étape et libellé d'une entrée d'historique de validation ; `null` si l'action n'est pas une validation. L'étape d'une
 * décision du circuit se lit au début de son détail (« Finance → Terminée », « DG → … »).
 */
export function libelleValidation(action: string, detail: string | null): { niveau: string; libelle: string } | null {
  const source = detail?.split(" → ")[0]?.trim() ?? "";
  const niveauDepuisDetail = /niveau (\S+)/.exec(detail ?? "")?.[1];
  switch (action) {
    case "validation_service":
      return { niveau: "Service", libelle: "validée" };
    case "renvoi_correction":
      return { niveau: niveauDepuisDetail ?? (source || "—"), libelle: "renvoyée en correction" };
    case "decision_circuit":
      return { niveau: source === "DG" ? "DG" : "Finance", libelle: "décision sur les lignes" };
    case "validation":
      return { niveau: "Finance", libelle: "montant validé" };
    case "validation_complementaire":
      return { niveau: "Finance", libelle: "validation complémentaire" };
    case "rejet":
      return { niveau: "Finance", libelle: "rejet" };
    case "rejet_reliquat":
      return { niveau: "Finance", libelle: "reliquat rejeté" };
    case "soumission_dg":
    case "resoumission_dg":
      return { niveau: "Finance", libelle: "soumise au DG" };
    // Soumission au DG ligne par ligne (2026-10-10) : le détail porte déjà les lignes concernées.
    case "soumission_lignes_dg":
      return { niveau: "Finance", libelle: detail?.split(" → DG — ")[1] ?? "lignes soumises au DG" };
    case "validation_ligne_dg":
    case "refus_ligne_dg":
      return {
        niveau: "DG",
        libelle: (detail?.replace(/^DG — /, "").split(" — DG → ")[0]) ?? (action === "validation_ligne_dg" ? "ligne validée" : "ligne refusée"),
      };
    case "validation_dg":
      return { niveau: "DG", libelle: "validée" };
    case "rejet_dg":
      return { niveau: "DG", libelle: "rejetée" };
    case "validation_complete_dg":
      return { niveau: "DG", libelle: "approbation de clôture" };
    case "rejet_validation_complete":
      return { niveau: "DG", libelle: "approbation de clôture refusée" };
    case "annulation_validation_complete":
      return { niveau: "DG", libelle: "approbation de clôture annulée" };
    case "cloture_totale":
      return { niveau: "Finance", libelle: "clôture totale" };
    case "cloture_partielle":
      return { niveau: "Finance", libelle: "clôture partielle" };
    default:
      return null;
  }
}

/** Construit la ligne unique d'une demande (cellules multi-valeurs + totaux). */
export function construireLigneReporting(d: DemandeReportingSource): LigneReportingDemande {
  const lignesArticles =
    d.lignes.length > 0
      ? d.lignes.map((l) => {
          const morceaux = [
            l.libelle,
            l.motif ? `motif : ${l.motif}` : null,
            `${l.quantite} × ${fcfa(l.prixUnitaire)} = ${fcfa(l.quantite * l.prixUnitaire)}`,
            l.categorie ? `${l.categorie}${l.objet ? ` / ${l.objet}` : ""}` : "sans catégorie",
            [LIBELLE_STATUT_LIGNE[l.statut], l.statut === "REJETEE" && l.motifRejet ? `(${l.motifRejet})` : null, par(l.decidePar, l.decideLe)]
              .filter(Boolean)
              .join(" "),
          ];
          return morceaux.filter(Boolean).join(" — ");
        })
      : [
          [
            d.typeDemande === "DEPENSE_DIRECTE" ? "Dépense directe" : "Sans ligne",
            d.description,
            fcfa(d.montantDemande),
            d.categorie ? `${d.categorie}${d.objet ? ` / ${d.objet}` : ""}` : "sans catégorie",
          ]
            .filter(Boolean)
            .join(" — "),
        ];

  const validations: string[] = [];
  const ajustements: string[] = [];
  for (const h of d.historique) {
    const v = libelleValidation(h.action, h.detail);
    if (v) {
      const montant = h.action === "validation" || h.action === "validation_complementaire" ? /: ([\d\s  ,]+) FCFA/.exec(h.detail ?? "")?.[1] : null;
      validations.push(`${v.niveau} — ${v.libelle}${montant ? ` (${montant.trim()} FCFA)` : ""} — ${h.auteur}, ${jour(h.date)}`);
    } else if (h.action === "ajustement_total_retour") {
      ajustements.push(`Ajustement du total déclaré — ${h.detail ?? ""} — ${jour(h.date)}`);
    }
  }

  const reglements: string[] = [];
  const depenses: string[] = [];
  const retours: string[] = [];
  const remboursements: string[] = [];
  let totalRegle = 0;
  let totalDepense = 0;
  let totalDepenseJustifiee = 0;
  let totalRetourne = 0;

  for (const r of d.reglements) {
    const mode = r.mode === "CAISSE" ? "Caisse" : "Banque";
    if (!r.estConfirme) {
      reglements.push(`Brouillon — ${mode} — ${fcfa(r.montant)} — saisi ${par(r.auteur, r.creeLe)}`);
    } else if (r.estAnnule) {
      reglements.push(`Annulé — ${mode} — ${fcfa(r.montant)} — ${par(r.auteur, r.confirmeLe)}${r.motifAnnulation ? ` (motif : ${r.motifAnnulation})` : ""}`);
    } else {
      totalRegle += r.montant;
      reglements.push(`${mode} — ${fcfa(r.montant)} — ${par(r.auteur, r.confirmeLe)}`);
    }
    for (const t of r.retours) {
      for (const dep of t.depenses) {
        totalDepense += dep.montant;
        if (dep.justifiee) totalDepenseJustifiee += dep.montant;
        const etat = dep.justifiee ? "justifiée" : dep.motifNonJustifie ? `non justifiée (${dep.motifNonJustifie})` : "non détaillée";
        depenses.push(`${dep.libelle} — ${fcfa(dep.montant)} — ${etat}`);
      }
      const origine = [
        t.creeParAssistant ? "déclaré par l'Assistant Finance" : null,
        t.complementSignalement ? "complément suite à un signalement" : null,
        t.reouvertureExceptionnelle ? "réouverture exceptionnelle" : null,
      ].filter(Boolean);
      const suffixe = origine.length > 0 ? ` (${origine.join(", ")})` : "";
      if (t.estReceptionne) {
        totalRetourne += t.montantARetourner;
        const nul = r.mode === "CAISSE" && centimes(t.montantARetourner) === 0;
        retours.push(
          nul
            ? `Retour nul constaté ${par(t.receptionnePar, t.receptionneLe)}${suffixe}`
            : `${fcfa(t.montantARetourner)} rendus — réceptionné ${par(t.receptionnePar, t.receptionneLe)}${suffixe}`
        );
      } else {
        retours.push(`En attente de réception — ${fcfa(t.montantARetourner)} à rendre — déclaré ${par(t.declarant, t.declareLe)}${suffixe}`);
      }
      for (const rb of t.remboursements) {
        if (rb.statut === "VALIDE") totalRetourne -= rb.montant;
        const decision =
          rb.statut === "EN_ATTENTE_VALIDATION"
            ? "en attente de validation"
            : `${LIBELLE_STATUT_DECISION[rb.statut].toLowerCase()} ${par(rb.validePar, rb.valideLe)}${rb.motifRejet ? ` (${rb.motifRejet})` : ""}`;
        remboursements.push(`${fcfa(rb.montant)} — proposé ${par(rb.proposePar, rb.proposeLe)} — ${decision}`);
      }
    }
  }

  for (const e of d.retoursExceptionnels) {
    if (e.statut === "VALIDE") totalRetourne += e.montant;
    const decision =
      e.statut === "EN_ATTENTE_VALIDATION"
        ? "en attente de validation"
        : `${LIBELLE_STATUT_DECISION[e.statut].toLowerCase()} ${par(e.validePar, e.valideLe)}${e.motifRejet ? ` (${e.motifRejet})` : ""}`;
    ajustements.push(`Retour exceptionnel post-clôture — ${fcfa(e.montant)} — saisi ${par(e.saisiPar, e.saisiLe)} — ${decision}`);
  }

  return {
    reference: d.reference,
    creeLe: d.creeLe,
    type: d.typeDemande === "DEPENSE_DIRECTE" ? "Dépense directe" : "Standard",
    statut: d.statut,
    etape: d.etapeCircuit ?? "—",
    demandeur: d.demandeur,
    service: d.service ?? "—",
    beneficiaire: d.beneficiaire,
    lignesArticles,
    validations,
    reglements,
    depenses,
    retours,
    remboursements,
    ajustements,
    totalDemande: d.montantDemande,
    totalValide: d.montantValide,
    totalRegle,
    totalDepense,
    totalDepenseJustifiee,
    totalRetourne,
    solde: totalRegle - totalDepense - totalRetourne,
  };
}
