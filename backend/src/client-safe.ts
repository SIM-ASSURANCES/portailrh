// Sous-chemin d'export dédié aux Client Components du frontend
// (`import { ... } from "backend/client"`), voir `backend/package.json`
// ("exports"). Existe UNIQUEMENT parce que `backend/src/index.ts` (le point
// d'entrée principal) ré-exporte aussi `./prisma` (singleton PrismaClient +
// driver `pg`) : un Client Component qui importerait une simple VALEUR
// (pas un type, qui serait de toute façon effacé à la compilation) depuis
// `"backend"` — ex: `IDLE_ACTION_STATE` — entraînerait tout le graphe de
// `backend/src/index.ts` dans le bundle navigateur, y compris `pg`
// (dépendances Node pures : `tls`, `util/types`...), faisant échouer
// `next build` ("Module not found: Can't resolve 'tls'"). Constaté
// explicitement lors de la restructuration en monorepo (voir CLAUDE.md
// "Monorepo backend/frontend").
//
// Ne réexporte QUE des valeurs sans aucune dépendance Node : les enums
// Prisma générés (fichier séparé de `client.ts`, explicitement documenté
// par Prisma comme sûr à importer directement — aucun import, aucun effet
// de bord), la forme `ActionState`/`IDLE_ACTION_STATE`/`fieldErrorsFromZod`
// (validation, dépend seulement de `zod`), et les libellés bénéficiaire
// (dépend uniquement du TYPE `BeneficiaireType`, effacé à la compilation).
// Les imports de TYPES depuis `"backend"` (le point d'entrée principal)
// restent, eux, sans risque quelle que soit leur origine — TypeScript les
// efface avant même que le bundler ne les voie (`isolatedModules`) — donc
// jamais besoin de les rediriger ici.
export * from "./generated/prisma/enums";
export * from "./validation";
export * from "./beneficiaire";
