// src/lib/pointage-utils.ts
import { ParametrageHoraire } from "@/generated/prisma/client";

export type PointageDevice = "TELEPHONE" | "ORDINATEUR";

export function detectPointageDevice(userAgent: string): PointageDevice {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? "TELEPHONE" : "ORDINATEUR";
}

export function getClientIp(headersList: Headers): string {
  const forwardedFor = headersList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0].trim() || headersList.get("x-real-ip") || "127.0.0.1";
}

export function isOfficeIpAllowed(clientIp: string, whitelist: string): boolean {
  const allowedIps = whitelist.split(",").map((ip) => ip.trim()).filter(Boolean);
  return allowedIps.length > 0 && allowedIps.includes(clientIp);
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

/**
 * Détermine si un pointage d'arrivée est en retard et de combien de minutes
 */
export function checkLateStatus(
  now: Date,
  config: ParametrageHoraire
): { estRetard: boolean; minutesRetard: number } {
  const currentMinutes = getMinutesSinceMidnight(now);
  const finMatinMinutes = parseTimeStringToMinutes(config.heureFinMatin);

  // Si le pointage est effectué après la fin de matinée, on prend le début de l'après-midi comme repère
  const referenceTimeStr =
    currentMinutes > finMatinMinutes
      ? config.heureDebutApresMidi
      : config.heureDebutMatin;

  const referenceMinutes = parseTimeStringToMinutes(referenceTimeStr);

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