import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise le téléphone du réseau local à charger les ressources HMR
  // pendant les tests via l'adresse IP du PC de développement.
  allowedDevOrigins: ["192.168.1.22"],
};

export default nextConfig;
