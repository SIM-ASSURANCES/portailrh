"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { timeToMinutes, isOfficeIpAllowed, checkLateStatus } from "@/lib/pointage-utils";
import { revalidatePath } from "next/cache";
import { pointageEmitter } from "@/lib/events";
import { ActionState, fieldErrorsFromZod } from "@/lib/validation";
import { createNotification } from "@/lib/notifications";

const pointageSchema = z.object({
  source: z.enum(["QR_CODE", "ORDINATEUR"]),
  type: z.enum(["ARRIVEE", "DEPART"]),
  motif: z.string().optional()
});

export async function enregistrerPointageAction(
  input: { source: "QR_CODE" | "ORDINATEUR", type: "ARRIVEE" | "DEPART", motif?: string }
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié" };

  const parsed = pointageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Données invalides", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { source, type, motif } = parsed.data;

  // 1. Capture de l'IP du terminal 
  const headersList = await headers();
  const rawIp = headersList.get("x-forwarded-for") || "IP_INCONNUE";
  const ip = rawIp.replace(/^::ffff:/, "");

  // Vérification de l'IP pour sécuriser le pointage (Ordinateur + Smartphone)
  const whitelistEnv = process.env.ALLOWED_OFFICE_IPS || "";
  if (!isOfficeIpAllowed(ip, whitelistEnv)) {
    const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
    for (const rh of rhUsers) {
      await createNotification({
        userId: rh.id,
        titre: "Alerte Sécurité Pointage",
        message: `${session.user.fullName} a tenté de pointer en dehors du réseau de l'entreprise (IP: ${ip}).`,
        lien: "/pointage/rh",
      });
    }

    return {
      status: "error",
      message: "Le pointage n'est autorisé que depuis le réseau (Wi-Fi) de l'entreprise."
    };
  }

  // 2. Vérification côté serveur des règles d'horaires
  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true }
  });

  const limiteArriveeMinutes = timeToMinutes(parametrage?.heureDebutMatin || "07:45");
  const limiteDepartMinutes = timeToMinutes(parametrage?.heureFinApresMidi || "16:45");

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const allToday = await prisma.pointage.findMany({
    where: {
      userId: session.user.id,
      heure: { gte: startOfDay, lte: endOfDay }
    },
    select: { type: true }
  });

  const hasArrivee = allToday.some(p => p.type === "ARRIVEE");
  const hasDepart = allToday.some(p => p.type === "DEPART");

  if (type === "ARRIVEE" && hasArrivee) {
    return { status: "error", message: "Vous avez déjà pointé votre arrivée aujourd'hui." };
  }
  if (type === "DEPART" && hasDepart) {
    return { status: "error", message: "Vous avez déjà pointé votre départ aujourd'hui." };
  }
  if (type === "DEPART" && !hasArrivee) {
    return { status: "error", message: "Vous devez pointer votre arrivée avant votre départ." };
  }
  if (allToday.length >= 2) {
    return { status: "error", message: "Vous avez déjà complété vos pointages pour aujourd'hui." };
  }

  const heurePrevue = type === "ARRIVEE"
    ? (parametrage?.heureDebutMatin || "07:45")
    : (parametrage?.heureFinApresMidi || "16:45");

  let estRetard = false;
  let minutesRetard: number | null = null;

  if (type === "ARRIVEE" && parametrage) {
    const lateStatus = checkLateStatus(now, parametrage);
    estRetard = lateStatus.estRetard;
    minutesRetard = estRetard ? lateStatus.minutesRetard : null;
  } else if (type === "ARRIVEE" && currentMinutes > limiteArriveeMinutes) {
    estRetard = true;
    minutesRetard = currentMinutes - limiteArriveeMinutes;
  }

  // 3. Défense en profondeur : Empêcher le bypass via requêtes cURL
  if (type === "ARRIVEE" && estRetard) {
    if (!motif || motif.trim().length < 3) {
      return { status: "error", message: "Un motif explicatif est obligatoire en cas de retard." };
    }
  }

  const estDepartAnticipe = type === "DEPART" && currentMinutes < limiteDepartMinutes;
  if (estDepartAnticipe) {
    if (!motif || motif.trim().length < 3) {
      return { status: "error", message: "Un motif est obligatoire en cas de départ anticipé." };
    }
  }

  // 4. Écriture atomique (Pointage + Traces d'historique)
  try {
    await prisma.$transaction(async (tx) => {
      const pointage = await tx.pointage.create({
        data: {
          type,
          source,
          heure: now,
          heurePrevue,
          estRetard,
          minutesRetard,
          estDepartAnticipe,
          motif: motif || null,
          ipAddress: ip,
          userId: session.user.id
        }
      });

      // Historisation générale requise par la sécurité
      await tx.historiqueEntry.create({
        data: {
          entity: "Pointage",
          entityId: pointage.id,
          action: "CREATE",
          detail: `Type: ${type}, Source: ${source}, IP: ${ip}`,
          userId: session.user.id
        }
      });

      // Trace spécifique au QR Code (utile en cas d'audit)
      if (source === "QR_CODE") {
        await tx.historiqueEntry.create({
          data: {
            entity: "PointageQR",
            entityId: pointage.id,
            action: "SCAN",
            detail: `Scan QR authentifié. Terminal IP: ${ip}`,
            userId: session.user.id
          }
        });
      }
    });

    revalidatePath("/pointage");
    publishDataChanged();
    // Seule action Pointage émise en plus sur le bus dédié de Thierry
    // (pointageEmitter) : c'est le seul flux atteignable depuis la page
    // publique /pointage/qr (hors AppShell, donc hors de portée de mon
    // eventBus authentifié) — voir CLAUDE.md "Fusion Module Pointage RH".
    pointageEmitter.emit("pointage-updated");

    if (estRetard || estDepartAnticipe) {
      const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
      const raison = estRetard ? "retard" : "départ anticipé";
      for (const rh of rhUsers) {
        await createNotification({
          userId: rh.id,
          titre: "Anomalie de pointage signalée",
          message: `${session.user.fullName} a signalé un ${raison}. Motif : ${motif}`,
          lien: "/pointage/rh/presence",
        });
      }
    }

    return { status: "success", message: "Pointage enregistré avec succès." };
  } catch {
    return { status: "error", message: "Erreur lors de l'enregistrement en base." };
  }
}