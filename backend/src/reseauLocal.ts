/**
 * Choix de l'adresse réseau local à encoder dans le QR code, en développement uniquement (route `/api/network-config`).
 *
 * `os.networkInterfaces()` renvoie aussi les cartes virtuelles (WSL, Hyper-V, Docker, VirtualBox…) : prendre la première
 * adresse IPv4 non-loopback donnait par exemple 172.26.112.1 (carte WSL) au lieu de l'adresse 192.168.x.x du Wi-Fi.
 * Règle : ignorer les cartes virtuelles par leur nom, puis préférer 192.168.x.x, puis 10.x.x.x, puis 172.16-31.x.x.
 */

export interface InterfaceReseau {
  address: string;
  family: string | number;
  internal?: boolean;
}

const CARTES_VIRTUELLES = /vethernet|wsl|hyper-v|docker|virtualbox|vmware|vmnet|vbox|loopback|tailscale|zerotier|bridge|br-|veth/i;

function rangPlage(adresse: string): number | null {
  if (adresse.startsWith("192.168.")) return 0;
  if (adresse.startsWith("10.")) return 1;
  const m = /^172\.(\d+)\./.exec(adresse);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2;
  return null;
}

export function choisirAdresseReseau(interfaces: Record<string, InterfaceReseau[] | undefined>): string | null {
  const candidats: { adresse: string; rang: number; virtuelle: boolean }[] = [];
  for (const [nom, adresses] of Object.entries(interfaces)) {
    for (const a of adresses ?? []) {
      if (a.internal || (a.family !== "IPv4" && a.family !== 4)) continue;
      if (a.address.startsWith("127.") || a.address.startsWith("169.254.")) continue;
      const rang = rangPlage(a.address);
      if (rang === null) continue;
      candidats.push({ adresse: a.address, rang, virtuelle: CARTES_VIRTUELLES.test(nom) });
    }
  }
  // Les cartes physiques passent toujours avant les virtuelles ; à défaut de physique, on garde une virtuelle plutôt que rien.
  candidats.sort((a, b) => Number(a.virtuelle) - Number(b.virtuelle) || a.rang - b.rang);
  return candidats[0]?.adresse ?? null;
}

/** Port du serveur de développement, lu dans l'en-tête `host` (3000 par défaut). */
export function portDepuisHost(host: string | null | undefined): string {
  const m = /:(\d{1,5})$/.exec(host ?? "");
  return m ? m[1] : "3000";
}

/**
 * URL de base du QR code en développement. `ipForcee` (variable `DEV_NETWORK_IP`) l'emporte sur la détection ;
 * un hôte déjà en adresse privée (page ouverte par l'IP réseau) est repris tel quel.
 */
export function urlReseauDev(params: {
  host: string | null | undefined;
  interfaces: Record<string, InterfaceReseau[] | undefined>;
  ipForcee?: string | null;
}): { networkUrl: string; networkIp: string | null } {
  const port = portDepuisHost(params.host);
  const hote = (params.host ?? "").replace(/:\d+$/, "");
  if (rangPlage(hote) !== null) return { networkUrl: `http://${params.host}`, networkIp: hote };
  const ip = params.ipForcee?.trim() || choisirAdresseReseau(params.interfaces);
  return { networkUrl: ip ? `http://${ip}:${port}` : `http://localhost:${port}`, networkIp: ip };
}
