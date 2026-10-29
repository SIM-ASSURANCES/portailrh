import { NextRequest, NextResponse } from "next/server";
import { networkInterfaces } from "os";
import { urlReseauDev } from "backend";

/**
 * GET /api/network-config
 * Retourne l'URL réseau du serveur pour les QR codes
 * Utile pour scanner depuis un autre appareil du réseau local
 *
 * Outil de développement uniquement : en production, elle révélerait l'IP
 * interne du serveur à n'importe qui. `QRCodeDownload` ne l'appelle que sur
 * localhost, et retombe sur `window.location.origin` si elle échoue.
 *
 * Le choix de l'adresse (cartes virtuelles WSL/Docker ignorées, 192.168.x.x préférée, port repris de
 * l'hôte) est dans `backend/src/reseauLocal.ts`. `DEV_NETWORK_IP` force l'adresse si la détection se trompe.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const host = request.headers.get("host") || "localhost:3000";
    const { networkUrl, networkIp } = urlReseauDev({
      host,
      interfaces: networkInterfaces(),
      ipForcee: process.env.DEV_NETWORK_IP,
    });

    return NextResponse.json({ networkUrl, host, networkIp });
  } catch (error) {
    console.error("Error fetching network config:", error);
    return NextResponse.json(
      { networkUrl: "http://localhost:3000", error: "Failed to detect network URL" },
      { status: 500 }
    );
  }
}
