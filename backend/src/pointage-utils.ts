// src/lib/pointage-utils.ts
import { ParametrageHoraire } from "./generated/prisma/client";

export type PointageDevice = "TELEPHONE" | "ORDINATEUR";

export function detectPointageDevice(userAgent: string): PointageDevice {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? "TELEPHONE" : "ORDINATEUR";
}

export function getClientIp(headersList: Headers): string {
  const forwardedFor = headersList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0].trim() || headersList.get("x-real-ip") || "127.0.0.1";
}

/**
 * IP du client telle que vue par le proxy de confiance (Traefik), le seul
 * proxy devant l'application en production (un test depuis le bureau
 * montre une seule IP dans `x-forwarded-for`, l'IP publique du bureau).
 *
 * On retient l'IP la plus à DROITE de `x-forwarded-for` : c'est celle que
 * Traefik ajoute lui-même en bout de liste, jamais une valeur choisie par
 * le client. Les IP plus à gauche peuvent venir d'un en-tête forgé par le
 * client (contrairement à `getClientIp`, qui prend la plus à gauche).
 * Correct que Traefik supprime ou conserve l'en-tête reçu du client.
 * À revoir si un second proxy (CDN...) est un jour placé devant Traefik.
 */
export function getTrustedClientIp(headersList: Headers): string {
  const forwardedFor = headersList.get("x-forwarded-for");
  const rightmost = forwardedFor
    ?.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
    .pop();
  const ip = rightmost || headersList.get("x-real-ip")?.trim() || "IP_INCONNUE";
  return ip.replace(/^::ffff:/, "");
}

// export function isOfficeIpAllowed(clientIp: string, whitelist: string): boolean {
//   const allowedIps = whitelist.split(",").map((ip) => ip.trim()).filter(Boolean);
//   return allowedIps.length > 0 && allowedIps.includes(clientIp);
// }
import ipaddr from 'ipaddr.js';

export function isOfficeIpAllowed(clientIp: string, whitelist: string): boolean {
  if (!whitelist) return false;

  // 1. Nettoyage de l'IP du client (on retire ::ffff:)
  let cleanClientIp = clientIp.trim();
  if (cleanClientIp.startsWith('::ffff:')) {
    cleanClientIp = cleanClientIp.replace('::ffff:', '');
  }

  // 2. Traitement de la liste blanche du .env
  const allowedIps = whitelist.split(",").map((ip) => ip.trim()).filter(Boolean);

  try {
    // On convertit l'IP du client en objet IP exploitable par la librairie
    const parsedClientIp = ipaddr.parse(cleanClientIp);

    // 3. On parcourt le tableau pour vérifier les correspondances (IP ou CIDR)
    return allowedIps.some((allowedIp) => {
      if (allowedIp.includes('/')) {
        // C'est une plage CIDR (ex: 192.168.1.0/24)
        const [range, bits] = allowedIp.split('/');
        const parsedRange = ipaddr.parse(range);
        return parsedClientIp.match(parsedRange, parseInt(bits, 10));
      } else {
        // C'est une IP exacte (ex: 127.0.0.1)
        return cleanClientIp === allowedIp;
      }
    });
  } catch (error) {
    console.error("Erreur lors de la vérification de la plage IP :", error);
    return false;
  }
}


/**
 * Convertit une chaîne au format "HH:MM" en minutes depuis minuit
 */
export function parseTimeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Calcule les minutes écoulées depuis minuit pour une date donnée
 */
export function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function checkLateStatus(
  now: Date,
  config: ParametrageHoraire
): { estRetard: boolean; minutesRetard: number } {
  const currentMinutes = getMinutesSinceMidnight(now);
  
  // L'employé est tenu d'être présent dès le matin.
  // Tout pointage d'arrivée se calcule donc par rapport à l'heure de début de matinée.
  const referenceMinutes = parseTimeStringToMinutes(config.heureDebutMatin);

  if (currentMinutes > referenceMinutes) {
    return {
      estRetard: true,
      minutesRetard: currentMinutes - referenceMinutes,
    };
  }

  return {
    estRetard: false,
    minutesRetard: 0,
  };
}
/**
 * Convertit une heure "HH:MM" en minutes écoulées depuis minuit
 * pour faciliter les comparaisons mathématiques.
 */
export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Génère le message dynamique de fin de journée.
 */
export function getMessageDepart(): string {
  const jourSemaine = new Date().getDay(); // 0 = Dimanche ... 5 = Vendredi, 6 = Samedi
  if (jourSemaine === 5) {
    return "Pointage validé. Bon week-end et à lundi !";
  }
  return "Pointage validé. Bonne fin de journée et à demain !";
}