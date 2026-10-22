// Point d'entrée du package `backend` — tout ce que `frontend/` doit
// pouvoir importer (`import { ... } from "backend"`) est ré-exporté ici.
// Voir CLAUDE.md "Monorepo backend/frontend" pour le détail de ce qui vit
// dans ce package et pourquoi.

// Client Prisma généré (types de modèles, enums, namespace `Prisma`...) —
// ré-export intégral : le frontend doit pouvoir importer n'importe quel
// type généré (ex: `StatutDemande`) sans connaître le chemin interne
// `backend/src/generated/prisma/client`.
export * from "./generated/prisma/client";

// Singleton Prisma (connexion + driver adapter pg).
export * from "./prisma";

// Logique métier pure (calculs, règles, reporting, validation...).
export * from "./tresorerie";
export * from "./reporting";
export * from "./reportingArbre";
export * from "./dashboardFinance";
export * from "./pointageReporting";
export * from "./pointage-utils";
export * from "./justificationPointage";
export * from "./cheminRetour";
export * from "./planificateur";
export * from "./journalTechnique";
export * from "./clotureInitiale";
export * from "./reinitialisationPointage";
export * from "./absencesDebut";
export * from "./reseauLocal";
export * from "./urlPublique";
export * from "./equipe";
export * from "./cronAuth";
export * from "./geo-utils";
export * from "./reference";
export * from "./validation";
export * from "./beneficiaire";
export * from "./beneficiaireArticles";
export * from "./motifLigne";
export * from "./categorisationObligatoire";
export * from "./parametresTresorerie";
export * from "./budgets";
export * from "./budgetsDb";
export * from "./motifReglement";
export * from "./montant";
export * from "./motifEchange";
export * from "./retourNul";
export * from "./retourExterneRattache";
export * from "./regularisationDepenses";
export * from "./regularisationArticle";
export * from "./dateLivraisonArticle";
export * from "./regularisationArticleDb";
export * from "./clotureDemande";
export * from "./clotureDemandeDb";
export * from "./chronoDemande";
export * from "./retourExterneRattacheDb";
export * from "./feedback";
export * from "./reinitialisation";
export * from "./reinitialisationClassification";
export * from "./reinitialisationFichiers";
export * from "./reinitialisationEtapes";
export * from "./reinitialisationEtapesDb";
export * from "./comptesDeTest";

// Module Encaissements : socle technique (séquences, audit, paramètres, permissions). Le moteur de calcul
// (encCalcul.ts) n'est pas réexporté ici : il est importé directement là où il sert.
export * from "./encSequence";
export * from "./encAudit";
export * from "./encParametres";
export * from "./encPermissions";
export * from "./congesPermissions";
export * from "./congesCalcul";
export * from "./circuitConge";
export * from "./congesNotifications";
export * from "./congesPasse";
export * from "./congesDb";
export * from "./congesPointage";
export * from "./congesVueEnsemble";
export * from "./congesVueEnsembleDb";
export * from "./congesRappels";
export * from "./encReferentiels";
// F1 (import mensuel du fichier de production) : lecture (4a), règles (4b), application en base (4c) — encCalcul.ts,
// lui, reste non réexporté (importé directement là où il sert, commentaire ci-dessus).
export * from "./encImportLecture";
export * from "./encImportRegles";
export * from "./encImportApplication";
// F2 (recherche, fiche police) — commit 5a.
export * from "./encRecherche";
export * from "./encSituation";
// Services et responsables (circuit de validation des demandes, 2026-10-06).
export * from "./services";
// Circuit de validation des demandes (commit 3) : moteur pur et application en base.
export * from "./etatArticles";
export * from "./reglementArticle";
export * from "./repriseReglements";
export * from "./parcoursArticle";
export * from "./parcoursArticleDb";
export * from "./dateGestionDemande";
export * from "./circuitDemande";
export * from "./delegations";
export * from "./soumissionDGEcran";
export * from "./circuitDemandeDb";
export * from "./circuitReorientation";
export * from "./circuitReorientationDb";
export * from "./circuitReprise";
export * from "./circuitEvenementsDb";
export * from "./circuitRepriseDb";
export * from "./circuitNotifications";
// Onglet « À vérifier » (traitement des signalements) — commit 5b.
export * from "./encSignalements";
export * from "./encConfirmation";
export * from "./encConfirmationLot";
export * from "./encSaisie";

// Règles de permissions (extraites de `frontend/src/lib/auth.ts`, voir
// `permissions.ts` pour le détail du raisonnement).
export * from "./permissions";
export * from "./recapRetourCaisseDb";
export * from "./signature";
export * from "./signatureDb";
export * from "./signatureTransaction";
export * from "./signatureReprise";
