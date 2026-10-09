import { NextRequest, NextResponse } from "next/server";
import { networkInterfaces } from "os";

/**
 * GET /api/network-config
 * Retourne l'URL réseau du serveur pour les QR codes
 * Utile pour scanner depuis un autre appareil du réseau local
 *
 * Outil de développement uniquement : en production, elle révélerait l'IP
 * interne du serveur à n'importe qui. `QRCodeDownload` ne l'appelle que sur
 * localhost, et retombe sur `window.location.origin` si elle échoue.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Récupère le hostname du serveur depuis les headers de la requête
    const host = request.headers.get("host") || "localhost:3000";
    
    // Récupère l'adresse IP locale (IPv4, non-loopback)
    let networkIp: string | null = null;
    const interfaces = networkInterfaces();
    
    for (const [, addresses] of Object.entries(interfaces)) {
      if (!addresses) continue;
      for (const addr of addresses) {
        // Cherche une adresse IPv4 non-loopback
        if (addr.family === "IPv4" && !addr.address.startsWith("127.")) {
          networkIp = addr.address;
          break;
        }
      }
      if (networkIp) break;
    }

    // Si pas d'IP trouvée, essaie d'extraire du host
    const baseUrl = host.includes("192.") || host.includes("10.") || host.includes("172.")
      ? `http://${host}`
      : networkIp
        ? `http://${networkIp}:3000`
        : `http://localhost:3000`;

    return NextResponse.json({
      networkUrl: baseUrl,
      host: host,
      networkIp: networkIp,
    });
  } catch (error) {
    console.error("Error fetching network config:", error);
    return NextResponse.json(
      { networkUrl: "http://localhost:3000", error: "Failed to detect network URL" },
      { status: 500 }
    );
  }
}
