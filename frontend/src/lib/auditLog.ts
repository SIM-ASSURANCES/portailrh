import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { prisma } from "backend";

/**
 * Extrait l'adresse IP du client à partir des en-têtes de la requête.
 */
export async function getClientIp(): Promise<string> {
  try {
    const headersList = await headers();
    let rawIp = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "127.0.0.1";
    if (rawIp.includes(",")) rawIp = rawIp.split(",")[0].trim();
    return rawIp.replace(/^::ffff:/i, "");
  } catch {
    return "127.0.0.1";
  }
}

function formatLogTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * Ajoute une ligne dans un fichier de log physique sur le disque.
 * Crée le répertoire `logs/` s'il n'existe pas.
 */
export function appendToPhysicalLog(filename: string, line: string): void {
  try {
    const targetDirs = new Set<string>();
    targetDirs.add(path.resolve(process.cwd(), "logs"));
    // Si process.cwd() est le dossier frontend, on écrit également à la racine du projet
    targetDirs.add(path.resolve(process.cwd(), "..", "logs"));

    for (const dir of targetDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(path.join(dir, filename), line + "\n", "utf-8");
      } catch {
        // Ignorer les erreurs de permission éventuelles sur un dossier spécifique
      }
    }
  } catch (err) {
    console.error(`[auditLog] Erreur lors de l'écriture dans ${filename}:`, err);
  }
}

export type AuditLogParams = {
  entity: string;
  entityId: string;
  action: string;
  detail: string;
  userId: string;
  userFullName?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  logFileName?: string; // ex: "services.log"
};

/**
 * Journalise une action d'administration ou métier à double niveau :
 * 1. Dans la base de données (modèle `HistoriqueEntry`, visible sur `/admin/logs`)
 * 2. Dans les fichiers de log physiques (`system.log` et optionnellement fichier dédié)
 */
export async function logAuditAction(params: AuditLogParams): Promise<void> {
  const ip = params.ipAddress ?? (await getClientIp());

  // 1. Base de données
  try {
    await prisma.historiqueEntry.create({
      data: {
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        detail: params.detail,
        ipAddress: ip,
        userId: params.userId,
      },
    });
  } catch (err) {
    console.error("[auditLog] Erreur lors de la création de HistoriqueEntry:", err);
  }

  // 2. Fichier(s) de logs sur disque
  const timestamp = formatLogTimestamp();
  const userStr =
    params.userFullName || params.userEmail
      ? `${params.userFullName ?? ""} (${params.userEmail ?? ""})`.trim()
      : `ID:${params.userId}`;

  const formattedLine = `[${timestamp}] [${params.entity.toUpperCase()}] [${params.action}] [Utilisateur: ${userStr}] [IP: ${ip}] - ${params.detail}`;

  appendToPhysicalLog("system.log", formattedLine);

  if (params.logFileName && params.logFileName !== "system.log") {
    appendToPhysicalLog(params.logFileName, formattedLine);
  }
}
