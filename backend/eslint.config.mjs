import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Config ESLint minimale pour `backend/` : du TypeScript pur (aucune
// dépendance React/Next.js), donc pas d'`eslint-config-next` ici — ce
// preset est conçu pour être colocalisé avec l'app Next.js elle-même (voir
// `frontend/eslint.config.mjs`) et ses règles (JSX a11y, hooks React...)
// n'auraient aucun sens sur ce code. Règles TypeScript recommandées
// uniquement, pour garder une couverture de lint sur ce package sans
// réintroduire un couplage à Next.js.
const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(["node_modules/**", "src/generated/**"]),
]);

export default eslintConfig;
