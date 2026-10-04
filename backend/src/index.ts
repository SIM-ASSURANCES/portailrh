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
export * from "./dashboardFinance";
export * from "./pointageReporting";
export * from "./pointage-utils";
export * from "./geo-utils";
export * from "./reference";
export * from "./validation";
export * from "./beneficiaire";
export * from "./feedback";
export * from "./reinitialisation";

// Module Encaissements : socle technique (séquences, audit, paramètres, permissions). Le moteur de calcul
// (encCalcul.ts) n'est pas réexporté ici : il est importé directement là où il sert.
export * from "./encSequence";
export * from "./encAudit";
export * from "./encParametres";
export * from "./encPermissions";
export * from "./encReferentiels";
// F1 (import mensuel du fichier de production) : lecture (4a), règles (4b), application en base (4c) — encCalcul.ts,
// lui, reste non réexporté (importé directement là où il sert, commentaire ci-dessus).
export * from "./encImportLecture";
export * from "./encImportRegles";
export * from "./encImportApplication";
// F2 (recherche, fiche police) — commit 5a.
export * from "./encRecherche";
export * from "./encSituation";
// Onglet « À vérifier » (traitement des signalements) — commit 5b.
export * from "./encSignalements";

// Règles de permissions (extraites de `frontend/src/lib/auth.ts`, voir
// `permissions.ts` pour le détail du raisonnement).
export * from "./permissions";
