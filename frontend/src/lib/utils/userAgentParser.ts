/**
 * Analyseur léger de User-Agent pour identifier l'appareil et le navigateur
 * d'un collaborateur enregistré pour les notifications Push FCM.
 * Sans dépendance externe.
 */

export interface ParsedDeviceInfo {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  label: string;
  icon: "monitor" | "smartphone" | "tablet" | "globe";
}

export function parseUserAgent(ua?: string | null): ParsedDeviceInfo {
  if (!ua || typeof ua !== "string") {
    return {
      browser: "Navigateur inconnu",
      os: "Système inconnu",
      deviceType: "unknown",
      label: "Appareil non identifié",
      icon: "globe",
    };
  }

  // 1. Détection de l'OS / Appareil
  let os = "Autre";
  let deviceType: ParsedDeviceInfo["deviceType"] = "desktop";
  let icon: ParsedDeviceInfo["icon"] = "monitor";

  if (/iPhone/i.test(ua)) {
    os = "iPhone (iOS)";
    deviceType = "mobile";
    icon = "smartphone";
  } else if (/iPad/i.test(ua)) {
    os = "iPad (iPadOS)";
    deviceType = "tablet";
    icon = "tablet";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    deviceType = /Mobile/i.test(ua) ? "mobile" : "tablet";
    icon = deviceType === "mobile" ? "smartphone" : "tablet";
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = "Windows 10/11";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  // 2. Détection du Navigateur
  let browser = "Navigateur Web";

  if (/Edg\//i.test(ua)) {
    browser = "Microsoft Edge";
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = "Opera";
  } else if (/SamsungBrowser/i.test(ua)) {
    browser = "Samsung Internet";
  } else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) {
    browser = "Google Chrome";
  } else if (/Firefox\//i.test(ua)) {
    browser = "Mozilla Firefox";
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Apple Safari";
  }

  return {
    browser,
    os,
    deviceType,
    label: `${browser} sur ${os}`,
    icon,
  };
}
