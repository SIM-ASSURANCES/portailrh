// src/app/(dashboard)/pointage/actions.ts
"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hasPermission } from "@/lib/auth";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";
import { TypePointage, SourcePointage } from "@/generated/prisma/client";
import { headers } from "next/headers";
import { checkLateStatus, detectPointageDevice, getClientIp, isOfficeIpAllowed } from "@/lib/pointage-utils";
import { revalidatePath } from "next/cache";

const pointageSchema = z.object({
  type: z.nativeEnum(TypePointage),
  source: z.nativeEnum(SourcePointage),
  motif: z.string().optional().nullable(),
});

export type PointageSuccessData = {
  type: TypePointage;
  recordedAt: string;
  minutesRetard: number | null;
};

export async function enregistrerPointageAction(
  _prevState: ActionState<PointageSuccessData>,
  formData: FormData
): Promise<ActionState<PointageSuccessData>> {
  try {
    const session = await getSession();
    if (!session || !session.user) {
      return { status: "error", message: "Session expirée ou utilisateur non connecté." };
    }

    // Vérification de la permission standard
    if (!hasPermission(session, "pointage.pointer")) {
      return { status: "error", message: "Vous n'avez pas l'autorisation de pointer." };
    }

    // Validation des données du formulaire
    const parsed = pointageSchema.safeParse({
      type: formData.get("type"),
      source: formData.get("source"),
      motif: formData.get("motif") || undefined,
    });

    if (!parsed.success) {
      return {
        status: "error",
        message: "Formulaire invalide.",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      };
    }

    const { type, motif } = parsed.data;
    const now = new Date(); // L'heure de référence est impérativement celle du serveur

    const headersList = await headers();
    const device = detectPointageDevice(headersList.get("user-agent") ?? "");
    const isMobile = device === "TELEPHONE";

    // Ticket 3 : Restriction réseau pour ordinateurs
    const clientIp = getClientIp(headersList);
    if (!isMobile) {
      const whitelistEnv = process.env.ALLOWED_OFFICE_IPS || "";
      if (!isOfficeIpAllowed(clientIp, whitelistEnv)) {
        await prisma.historiqueEntry.create({
          data: {
            entity: "PointageAccess",
            entityId: session.user.id,
            action: "ACCESS_DENIED",
            detail: JSON.stringify({ device, clientIp, reason: "OFFICE_NETWORK_REQUIRED" }),
            userId: session.user.id,
          },
        });
        return {
          status: "error",
          message: "Le pointage depuis un ordinateur n'est autorisé que depuis le réseau de l'entreprise.",
        };
      }
    }

    // Récupération de la configuration horaire active
    const config = await prisma.parametrageHoraire.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      return { status: "error", message: "Aucune configuration horaire active trouvée." };
    }

    // Validation pour DEPART : vérifier qu'une ARRIVEE existe aujourd'hui
    if (type === TypePointage.DEPART) {
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);

      const todayArrival = await prisma.pointage.findFirst({
        where: {
          userId: session.user.id,
          type: TypePointage.ARRIVEE,
          heure: { gte: startOfToday, lte: endOfToday },
        },
      });

      if (!todayArrival) {
        return {
          status: "error",
          message: "Vous devez d'abord pointer votre arrivée avant de pouvoir pointer votre départ.",
        };
      }

      // Vérifier que le départ n'est pas avant heureFinApresMidi
      const [finHeure, finMinute] = config.heureFinApresMidi.split(":").map(Number);
      const finDate = new Date(now);
      finDate.setHours(finHeure, finMinute, 0, 0);

      if (now < finDate) {
        // Avant l'heure de fin, motif est obligatoire
        if (!motif || motif.trim().length === 0) {
          return {
            status: "error",
            message: `Vous ne pouvez pointer votre départ avant ${config.heureFinApresMidi}. Un motif est obligatoire si vous souhaitez pointer avant cette heure.`,
            fieldErrors: {
              motif: `Motif obligatoire pour un départ avant ${config.heureFinApresMidi}.`,
            },
          };
        }
      }
    }

    let estRetard = false;
    let minutesRetard = null;
    let motifAConserver = null;

    // Validation spécifique du retard pour l'ARRIVEE
    if (type === TypePointage.ARRIVEE) {
      const lateCheck = checkLateStatus(now, config);
      if (lateCheck.estRetard) {
        estRetard = true;
        minutesRetard = lateCheck.minutesRetard;

        if (!motif || motif.trim().length === 0) {
          return {
            status: "error",
            message: "Un motif de retard est obligatoire.",
            fieldErrors: { motif: "Veuillez renseigner un motif pour justifier votre retard." },
          };
        }
        motifAConserver = motif;
      }
    } else if (type === TypePointage.DEPART && motif && motif.trim().length > 0) {
      // Pour un départ, conserver le motif s'il est fourni
      motifAConserver = motif;
    }

    const recordedSource = isMobile ? SourcePointage.QR_CODE : SourcePointage.ORDINATEUR;
    const pointage = await prisma.$transaction(async (transaction) => {
      const createdPointage = await transaction.pointage.create({
        data: {
          type,
          source: recordedSource,
          heure: now,
          estRetard,
          minutesRetard,
          motif: motifAConserver,
          userId: session.user.id,
          effectueParId: session.user.id,
        },
      });

      await transaction.historiqueEntry.create({
        data: {
          entity: "Pointage",
          entityId: createdPointage.id,
          action: "CREATE",
          detail: JSON.stringify({
            type: createdPointage.type,
            source: createdPointage.source,
            heureServeur: createdPointage.heure.toISOString(),
            estRetard: createdPointage.estRetard,
            minutesRetard: createdPointage.minutesRetard,
            motif: createdPointage.motif,
          }),
          userId: session.user.id,
        },
      });

      if (type === TypePointage.ARRIVEE) {
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        await transaction.absence.deleteMany({
          where: {
            userId: session.user.id,
            date: { gte: startOfToday, lte: endOfToday },
            statut: "A_CONTROLER",
          },
        });
      }

      return createdPointage;
    });

    revalidatePath("/pointage");

    const labelAction = type === TypePointage.ARRIVEE ? "Arrivée" : "Départ";
    return {
      status: "success",
      message: `Votre ${labelAction} a été enregistrée à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
      data: {
        type,
        recordedAt: pointage.heure.toISOString(),
        minutesRetard: pointage.minutesRetard,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return { status: "error", message: "Erreur serveur : " + message };
  }
}