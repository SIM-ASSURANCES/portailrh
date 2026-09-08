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
export * from "./reference";
export * from "./validation";
export * from "./beneficiaire";

// Règles de permissions (extraites de `frontend/src/lib/auth.ts`, voir
// `permissions.ts` pour le détail du raisonnement).
export * from "./permissions";
