"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { headers } from "next/headers";
import {
  timeToMinutes,
  isOfficeIpAllowed,
  checkLateStatus,
  isWithinRadius,
  isGeoPrecisionAcceptable,
  BUREAU_DEFAULT_COORDS,
} from "backend";
import { revalidatePath } from "next/cache";
import { pointageEmitter } from "@/lib/events";
import { ActionState, fieldErrorsFromZod } from "backend";
import { createNotification } from "@/lib/notifications";

const pointageSchema = z.object({
  source: z.enum(["QR_CODE", "ORDINATEUR"]),
  type: z.enum(["ARRIVEE", "DEPART"]),
  motif: z.string().optional(),
  // Coordonnées GPS (envoyées uniquement en mode fallback géolocalisation)
  geoLatitude: z.number().optional(),
  geoLongitude: z.number().optional(),
  geoPrecision: z.number().optional(),
});

export async function enregistrerPointageAction(
  input: {
    source: "QR_CODE" | "ORDINATEUR";
    type: "ARRIVEE" | "DEPART";
    motif?: string;
    geoLatitude?: number;
    geoLongitude?: number;
    geoPrecision?: number;
  }
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié" };

  const parsed = pointageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Données invalides", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { source, type, motif, geoLatitude, geoLongitude, geoPrecision } = parsed.data;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Capture de l'IP du terminal
  // ─────────────────────────────────────────────────────────────────────────
  const headersList = await headers();
  const rawIp = headersList.get("x-forwarded-for") || "IP_INCONNUE";
  const ip = rawIp.replace(/^::ffff:/, "");

  const whitelistEnv = process.env.ALLOWED_OFFICE_IPS || "";
  const ipAutorisee = isOfficeIpAllowed(ip, whitelistEnv);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Récupérer le paramétrage horaire (inclut config géoloc)
  // ─────────────────────────────────────────────────────────────────────────
  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Si l'IP n'est pas dans la whitelist → tenter le fallback géolocalisation
  // ─────────────────────────────────────────────────────────────────────────
  let geoFallbackUsed = false;
  let geoDistance: number | null = null;

  if (!ipAutorisee) {
    const geoActive = parametrage?.geolocalisationActive ?? false;

    // La géolocalisation est désactivée par les RH
    if (!geoActive) {
      const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
      for (const rh of rhUsers) {
        await createNotification({
          userId: rh.id,
          titre: "⚠️ Alerte Sécurité Pointage",
          message: `${session.user.fullName} a tenté de pointer hors réseau (IP: ${ip}). La géolocalisation est désactivée.`,
          lien: "/pointage/rh",
        });
      }
      return {
        status: "error",
        message: "Le pointage n'est autorisé que depuis le réseau Wi-Fi de l'entreprise.",
      };
    }

    // Coordonnées GPS non transmises par le client
    if (geoLatitude === undefined || geoLongitude === undefined) {
      return {
        status: "error",
        message: "GEOLOCATION_REQUIRED",
      };
    }

    // Précision GPS insuffisante (trop imprécis pour garantir la position)
    if (geoPrecision !== undefined && !isGeoPrecisionAcceptable(geoPrecision)) {
      return {
        status: "error",
        message: `Signal GPS trop faible (précision : ${Math.round(geoPrecision)}m). Déplacez-vous en extérieur et réessayez.`,
      };
    }

    // Coordonnées du bureau : paramétrage BD ou valeurs par défaut SIM Assurances
    const officeLat = parametrage?.bureauLatitude ?? BUREAU_DEFAULT_COORDS.latitude;
    const officeLon = parametrage?.bureauLongitude ?? BUREAU_DEFAULT_COORDS.longitude;
    const rayon = parametrage?.rayonAutorise ?? 50;

    const geoCheck = isWithinRadius(geoLatitude, geoLongitude, officeLat, officeLon, rayon);
    geoDistance = geoCheck.distanceMetres;

    if (!geoCheck.allowed) {
      // ── GARDE-FOU : collaborateur hors réseau ET hors du rayon géographique ──
      const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
      for (const rh of rhUsers) {
        await createNotification({
          userId: rh.id,
          titre: "🚨 Tentative de pointage non autorisée",
          message: `${session.user.fullName} a tenté de pointer hors réseau et hors périmètre. IP: ${ip} | Distance au bureau: ${geoDistance}m (rayon: ${rayon}m). Aucun pointage enregistré.`,
          lien: "/pointage/rh",
        });
      }
      return {
        status: "error",
        message: `Pointage impossible : vous êtes à ${geoDistance}m du bureau. Le rayon autorisé est de ${rayon}m. Rapprochez-vous du bureau et réessayez.`,
      };
    }

    // Géoloc valide → on bascule en mode GEOLOCALISATION
    geoFallbackUsed = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Vérification des règles d'horaires
  // ─────────────────────────────────────────────────────────────────────────
  const limiteArriveeMinutes = timeToMinutes(parametrage?.heureDebutMatin || "07:45");
  const limiteDepartMinutes = timeToMinutes(parametrage?.heureFinApresMidi || "16:45");

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const allToday = await prisma.pointage.findMany({
    where: {
      userId: session.user.id,
      heure: { gte: startOfDay, lte: endOfDay },
    },
    select: { type: true },
  });

  const hasArrivee = allToday.some((p) => p.type === "ARRIVEE");
  const hasDepart = allToday.some((p) => p.type === "DEPART");

  if (type === "ARRIVEE" && hasArrivee) {
    return { status: "error", message: "Vous avez déjà pointé votre arrivée aujourd'hui." };
  }
  if (type === "ARRIVEE" && currentMinutes >= limiteDepartMinutes) {
    return { status: "error", message: "La journée de travail est terminée. Vous êtes considéré(e) comme absent(e)." };
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

  const heurePrevue =
    type === "ARRIVEE"
      ? parametrage?.heureDebutMatin || "07:45"
      : parametrage?.heureFinApresMidi || "16:45";

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

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Défense en profondeur : motif obligatoire en cas d'anomalie
  // ─────────────────────────────────────────────────────────────────────────
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

  // Source effective : GEOLOCALISATION si fallback, sinon source déclarée
  const sourceEffective = geoFallbackUsed ? "GEOLOCALISATION" : source;

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Écriture atomique (Pointage + Traces d'historique)
  // ─────────────────────────────────────────────────────────────────────────
  try {
    await prisma.$transaction(async (tx) => {
      const pointage = await tx.pointage.create({
        data: {
          type,
          source: sourceEffective,
          heure: now,
          heurePrevue,
          estRetard,
          minutesRetard,
          estDepartAnticipe,
          motif: motif || null,
          ipAddress: ip,
          // Données GPS (nulles si pointage réseau normal)
          geoLatitude: geoFallbackUsed ? (geoLatitude ?? null) : null,
          geoLongitude: geoFallbackUsed ? (geoLongitude ?? null) : null,
          geoPrecision: geoFallbackUsed ? (geoPrecision ?? null) : null,
          geoDistance: geoFallbackUsed ? geoDistance : null,
          userId: session.user.id,
        },
      });

      // Trace d'historique générale
      const geoDetail = geoFallbackUsed
        ? ` | GPS: (${geoLatitude?.toFixed(6)}, ${geoLongitude?.toFixed(6)}), distance: ${geoDistance}m, précision: ${geoPrecision ? Math.round(geoPrecision) : "?"}m`
        : "";

      await tx.historiqueEntry.create({
        data: {
          entity: "Pointage",
          entityId: pointage.id,
          action: "CREATE",
          detail: `Type: ${type}, Source: ${sourceEffective}, IP: ${ip}${geoDetail}`,
          userId: session.user.id,
        },
      });

      // Trace spécifique QR Code
      if (source === "QR_CODE" && !geoFallbackUsed) {
        await tx.historiqueEntry.create({
          data: {
            entity: "PointageQR",
            entityId: pointage.id,
            action: "SCAN",
            detail: `Scan QR authentifié. Terminal IP: ${ip}`,
            userId: session.user.id,
          },
        });
      }

      // Trace spécifique géolocalisation
      if (geoFallbackUsed) {
        await tx.historiqueEntry.create({
          data: {
            entity: "PointageGeo",
            entityId: pointage.id,
            action: "GEO_VALIDATE",
            detail: `Pointage hors réseau validé par GPS. Distance bureau: ${geoDistance}m, précision GPS: ${geoPrecision ? Math.round(geoPrecision) : "?"}m`,
            userId: session.user.id,
          },
        });
      }
    });

    revalidatePath("/pointage");
    publishDataChanged();
    pointageEmitter.emit("pointage-updated");

    // Notification RH pour les anomalies classiques (retard / départ anticipé)
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

    // Notification RH pour information : pointage validé par géolocalisation
    if (geoFallbackUsed) {
      const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
      for (const rh of rhUsers) {
        await createNotification({
          userId: rh.id,
          titre: "📍 Pointage par géolocalisation",
          message: `${session.user.fullName} a pointé hors réseau Wi-Fi. Validé par GPS à ${geoDistance}m du bureau (précision: ${geoPrecision ? Math.round(geoPrecision) : "?"}m).`,
          lien: "/pointage/rh/presence",
        });
      }
    }

    return { status: "success", message: "Pointage enregistré avec succès." };
  } catch {
    return { status: "error", message: "Erreur lors de l'enregistrement en base." };
  }
}

export async function enregistrerAbsenceAutomatiqueAction(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié" };

  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true },
  });

  const limiteDepartMinutes = timeToMinutes(parametrage?.heureFinApresMidi || "16:45");
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes < limiteDepartMinutes) {
    return { status: "error", message: "La journée n'est pas encore terminée." };
  }

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const hasPointage = await prisma.pointage.findFirst({
    where: { userId: session.user.id, heure: { gte: startOfDay, lte: endOfDay } },
  });

  if (hasPointage) {
    return { status: "error", message: "Pointages existants trouvés." };
  }

  const absenceExistante = await prisma.absence.findFirst({
    where: { userId: session.user.id, date: { gte: startOfDay, lte: endOfDay } },
  });

  if (!absenceExistante) {
    const absenceDate = new Date(now);
    absenceDate.setHours(12, 0, 0, 0);

    await prisma.absence.create({
      data: {
        date: absenceDate,
        statut: "A_CONTROLER",
        userId: session.user.id,
      },
    });

    const rhUsers = await prisma.user.findMany({ where: { role: { name: "RH" }, isActive: true } });
    for (const rh of rhUsers) {
      await createNotification({
        userId: rh.id,
        titre: "Absence Automatique",
        message: `${session.user.fullName} a été marqué(e) absent(e) (fin de journée atteinte sans pointage).`,
        lien: "/pointage/rh/absences",
      });
    }

    revalidatePath("/pointage");
    publishDataChanged();
  }

  return { status: "success", message: "Absence automatique enregistrée." };
}