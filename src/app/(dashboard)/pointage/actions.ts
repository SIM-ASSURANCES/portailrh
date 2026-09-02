"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { timeToMinutes, isOfficeIpAllowed } from "@/lib/pointage-utils";
import { revalidatePath } from "next/cache";
import { ActionState, fieldErrorsFromZod } from "@/lib/validation";

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
  const ip = headersList.get("x-forwarded-for") || "IP_INCONNUE";

  // Vérification de l'IP pour le Ticket 3
  if (source === "ORDINATEUR") {
    const whitelistEnv = process.env.ALLOWED_OFFICE_IPS || "";
    if (!isOfficeIpAllowed(ip, whitelistEnv)) {
      return {
        status: "error",
        message: "Le pointage depuis un ordinateur n'est autorisé que depuis le réseau de l'entreprise."
      };
    }
  }

  // 2. Vérification côté serveur des règles d'horaires
  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true }
  });

  const limiteArriveeMinutes = timeToMinutes(parametrage?.heureDebutMatin || "07:45");
  const limiteDepartMinutes = timeToMinutes(parametrage?.heureFinApresMidi || "16:45");

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const heurePrevue = type === "ARRIVEE"
    ? (parametrage?.heureDebutMatin || "07:45")
    : (parametrage?.heureFinApresMidi || "16:45");

  let estRetard = false;
  let minutesRetard = null;

  // 3. Défense en profondeur : Empêcher le bypass via requêtes cURL
  if (type === "ARRIVEE" && currentMinutes > limiteArriveeMinutes) {
    if (!motif || motif.trim().length < 3) {
      return { status: "error", message: "Un motif explicatif est obligatoire après l'heure réglementaire." };
    }
    estRetard = true;
    minutesRetard = currentMinutes - limiteArriveeMinutes;
  }

  if (type === "DEPART" && currentMinutes < limiteDepartMinutes) {
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
          motif: motif || null,
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
    return { status: "success", message: "Pointage enregistré avec succès." };
  } catch (_error) {
    return { status: "error", message: "Erreur lors de l'enregistrement en base." };
  }
}