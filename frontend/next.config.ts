import path from "node:path";
import type { NextConfig } from "next";

// Monorepo (voir CLAUDE.md "Monorepo backend/frontend") : le ".env" canonique
// vit à la racine du monorepo (partagé avec Prisma dans `backend/` et Docker
// Compose) ; `frontend/.env` en est une copie synchronisée automatiquement
// juste avant `dev`/`build`/`start` (scripts `pre*` de `package.json`), pour
// que Next.js le charge par SON PROPRE mécanisme natif — fiable à 100% dans
// tous les contextes d'exécution (Route Handlers, Server Actions, middleware
// Edge). Un essai précédent avec `@next/env`'s `loadEnvConfig()` appelé ici
// a échoué en pratique : `AUTH_SECRET` n'était pas visible par le Route
// Handler NextAuth au runtime (`MissingSecret`, vérifié par un vrai test de
// connexion) — la mutation de `process.env` faite pendant le chargement de
// `next.config.ts` ne se propage pas de façon fiable au contexte qui exécute
// réellement les requêtes sous Turbopack. La copie de fichier, elle, ne
// dépend d'aucune hypothèse sur l'architecture interne du serveur de dev.
const MONOREPO_ROOT = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // Autorise le téléphone du réseau local à charger les ressources HMR
  // pendant les tests du Pointage QR via l'adresse IP du PC de développement.
  allowedDevOrigins: ["localhost", "192.168.1.*"],
  // Monorepo : le traçage des fichiers (standalone, ci-dessous) doit
  // remonter jusqu'à la racine pour inclure le package `backend` — sans
  // ça, Next.js ne trace que `frontend/` par défaut et le build échouerait
  // à l'exécution (module `backend` introuvable). Voir doc `output`
  // ("outputFileTracingRoot"), section monorepo.
  outputFileTracingRoot: MONOREPO_ROOT,
  // Turbopack (par défaut depuis Next.js 16, voir doc `transpilePackages`)
  // transpile déjà automatiquement les packages de workspace — déclaré ici
  // explicitement par robustesse (ex: si un jour `next build --webpack` est
  // utilisé), sans effet néfaste si déjà couvert nativement.
  transpilePackages: ["backend"],
  // Build autonome (Docker, Tâche 1) : produit .next/standalone avec un
  // serveur Node minimal + uniquement les node_modules réellement tracés
  // par le code — permet une image finale beaucoup plus légère qu'une
  // copie complète de node_modules. Voir Dockerfile (stage "runner") pour
  // les fichiers ajoutés manuellement en complément (CLI Prisma pour les
  // migrations, polices PDF lues dynamiquement) : le traçage automatique
  // de Next.js ne couvre que les imports JS/TS, pas les fichiers lus via
  // `fs.readFileSync` à un chemin construit dynamiquement, ni les commandes
  // CLI invoquées séparément du serveur Next.js lui-même.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
