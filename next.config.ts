import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise le téléphone du réseau local à charger les ressources HMR
  // pendant les tests du Pointage QR via l'adresse IP du PC de développement.
  allowedDevOrigins: ["localhost", "192.168.1.*"],
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
};

export default nextConfig;
