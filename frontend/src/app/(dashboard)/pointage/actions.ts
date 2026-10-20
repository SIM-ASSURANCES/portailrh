"use server";

import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { headers } from "next/headers";
import {
  timeToMinutes,
  getTrustedClientIp,
  isOfficeIpAllowed,
  reglesPointage,
  refusArriveeHoraire,
  heureDepartPossible,
  formatHeureLocale,
  type HorairesPointage,
  departTropTot,
  horairesPointage,
  DELAI_MINIMUM_DEPART_MINUTES,
  isWithinRadius,
  isGeoPrecisionAcceptable,
  BUREAU_DEFAULT_COORDS,
  PERMISSION_RH_POINTAGE,
  journeeCouverteParAbsence,
} from "backend";
import { revalidatePath } from "next/cache";
import { pointageEmitter } from "@/lib/events";
import { ActionState, fieldErrorsFromZod } from "backend";
import { notifyByPermission } from "@/lib/notifications";
import { lireJourNonOuvre } from "@/lib/joursOuvres";

const pointageSchema = z.object({
  source: z.enum(["QR_CODE", "ORDINATEUR"]),
  type: z.enum(["ARRIVEE", "DEPART"]),
  // Plus de motif au pointage (lot 3) : un retard ou un départ anticipé se justifie après coup
  // (JustificationPointage).
  // Coordonnées GPS (envoyées uniquement en mode fallback géolocalisation)
  geoLatitude: z.number().optional(),
  geoLongitude: z.number().optional(),
  geoPrecision: z.number().optional(),
});

export async function enregistrerPointageAction(
  input: {
    source: "QR_CODE" | "ORDINATEUR";
    type: "ARRIVEE" | "DEPART";
    geoLatitude?: number;
    geoLongitude?: number;
    geoPrecision?: number;
  }
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié" };
  if (!hasPermission(session, "pointage.pointer")) return { status: "error", message: "Vous n'avez pas la permission de pointer." };

  const parsed = pointageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Données invalides", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { source, type, geoLatitude, geoLongitude, geoPrecision } = parsed.data;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Capture de l'IP du terminal
  // ─────────────────────────────────────────────────────────────────────────
  const headersList = await headers();
  // IP ajoutée par le proxy de confiance, jamais l'en-tête brut (voir
  // getTrustedClientIp) : plusieurs IP "a, b" faisaient échouer le contrôle.
  const ip = getTrustedClientIp(headersList);

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
      await notifyByPermission(PERMISSION_RH_POINTAGE, {
        titre: "⚠️ Alerte Sécurité Pointage",
        message: `${session.user.fullName} a tenté de pointer hors réseau (IP: ${ip}). La géolocalisation est désactivée.`,
        lien: "/pointage/rh",
        priority: "IMPORTANT",
        category: "POINTAGE",
      });
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

    // Précision GPS obligatoire : l'omettre ne doit jamais permettre de sauter
    // le contrôle ci-dessous (les clients légitimes l'envoient toujours avec
    // les coordonnées, voir useGeolocation).
    if (geoPrecision === undefined) {
      return {
        status: "error",
        message: "Précision GPS non transmise. Réessayez le pointage.",
      };
    }

    // Précision GPS insuffisante (trop imprécis pour garantir la position)
    if (!isGeoPrecisionAcceptable(geoPrecision)) {
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
      await notifyByPermission(PERMISSION_RH_POINTAGE, {
        titre: "🚨 Tentative de pointage non autorisée",
        message: `${session.user.fullName} a tenté de pointer hors réseau et hors périmètre. IP: ${ip} | Distance au bureau: ${geoDistance}m (rayon: ${rayon}m). Aucun pointage enregistré.`,
        lien: "/pointage/rh",
        priority: "IMPORTANT",
        category: "POINTAGE",
      });
      return {
        status: "error",
        message: `Pointage impossible : vous êtes à ${geoDistance}m du bureau. Le rayon autorisé est de ${rayon}m. Rapprochez-vous du bureau et réessayez.`,
      };
    }

    // Géoloc valide → on bascule en mode GEOLOCALISATION
    geoFallbackUsed = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Règles d'horaires du jour (lot 3 bis : jour non ouvré = ni retard, ni départ anticipé, ni justification)
  // ─────────────────────────────────────────────────────────────────────────
  const horaires = horairesPointage(parametrage);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const { jourNonOuvre } = await lireJourNonOuvre(now);

  // Permissions du jour : repoussent l'heure de référence de l'arrivée, avancent celle du départ.
  const plagesDuJour = await prisma.plageAbsenceAutorisee.findMany({
    where: { userId: session.user.id, date: { gte: startOfDay, lte: endOfDay } },
    select: { heureDebut: true, heureFin: true },
  });

  const heurePrevue = type === "ARRIVEE" ? horaires.heureDebutMatin : horaires.heureFinApresMidi;

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Retard et départ anticipé : une seule règle (`reglesPointage`), aucun motif demandé ici
  // ─────────────────────────────────────────────────────────────────────────
  const { estRetard, minutesRetard, estDepartAnticipe } = reglesPointage(type, now, horaires, plagesDuJour, jourNonOuvre);

  // Source effective : GEOLOCALISATION si fallback, sinon source déclarée
  const sourceEffective = geoFallbackUsed ? "GEOLOCALISATION" : source;

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Écriture atomique. Lot 3 bis : la relecture des pointages du jour, les refus et la création se font dans la
  // même transaction, sous un verrou par collaborateur et par jour (deux onglets simultanés : un seul pointage).
  // ─────────────────────────────────────────────────────────────────────────
  try {
    await prisma.$transaction(async (tx) => {
      const cleVerrou = `pointage:${session.user.id}:${startOfDay.getFullYear()}-${startOfDay.getMonth() + 1}-${startOfDay.getDate()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cleVerrou})::bigint)`;

      const allToday = await tx.pointage.findMany({
        where: { userId: session.user.id, heure: { gte: startOfDay, lte: endOfDay } },
        select: { type: true, heure: true },
      });
      const refus = refusPointage(type, now, allToday, horaires, jourNonOuvre);
      if (refus) throw new RefusPointage(refus);

      const pointage = await tx.pointage.create({
        data: {
          type,
          source: sourceEffective,
          heure: now,
          heurePrevue,
          estRetard,
          minutesRetard,
          estDepartAnticipe,
          ipAddress: ip,
          // Données GPS (nulles si pointage réseau normal)
          geoLatitude: geoFallbackUsed ? (geoLatitude ?? null) : null,
          geoLongitude: geoFallbackUsed ? (geoLongitude ?? null) : null,
          geoPrecision: geoFallbackUsed ? (geoPrecision ?? null) : null,
          geoDistance: geoFallbackUsed ? geoDistance : null,
          userId: session.user.id,
          // Retard ou départ anticipé : justification à demander (EN_ATTENTE), dans la même transaction.
          ...(estRetard || estDepartAnticipe ? { justification: { create: {} } } : {}),
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

    // Plus d'alerte RH « anomalie » au pointage (lot 3) : le retard ou le départ anticipé suit le circuit de
    // justification.

    // Notification RH pour information : pointage validé par géolocalisation
    if (geoFallbackUsed) {
      await notifyByPermission(PERMISSION_RH_POINTAGE, {
        titre: "📍 Pointage par géolocalisation",
        message: `${session.user.fullName} a pointé hors réseau Wi-Fi. Validé par GPS à ${geoDistance}m du bureau (précision: ${geoPrecision ? Math.round(geoPrecision) : "?"}m).`,
        lien: "/pointage/rh/presence",
        priority: "IMPORTANT",
        category: "POINTAGE",
      });
    }

    if (estRetard) {
      return {
        status: "success",
        message: `Arrivée enregistrée à ${formatHeure(now)}, ${minutesRetard} min de retard. Un lien pour justifier vous sera envoyé.`,
      };
    }
    if (estDepartAnticipe) {
      return {
        status: "success",
        message: "Départ enregistré. Un lien pour justifier votre départ anticipé vous sera envoyé.",
      };
    }
    return { status: "success", message: "Pointage enregistré avec succès." };
  } catch (e) {
    if (e instanceof RefusPointage) return { status: "error", message: e.message };
    return { status: "error", message: "Erreur lors de l'enregistrement en base." };
  }
}

/** Refus métier levé dans la transaction du pointage (annule la transaction, message renvoyé tel quel). */
class RefusPointage extends Error {}

/**
 * Refus d'un pointage au vu des pointages du jour, relus sous le verrou. Libellés inchangés (lot 3) ; l'arrivée après
 * la fin de journée n'est refusée qu'un jour ouvré (`refusArriveeHoraire`, lot 3 bis).
 */
function refusPointage(
  type: "ARRIVEE" | "DEPART",
  now: Date,
  allToday: { type: "ARRIVEE" | "DEPART"; heure: Date }[],
  horaires: HorairesPointage,
  jourNonOuvre: boolean
): string | null {
  const hasArrivee = allToday.some((p) => p.type === "ARRIVEE");
  const hasDepart = allToday.some((p) => p.type === "DEPART");
  if (type === "ARRIVEE" && hasArrivee) return "Vous avez déjà pointé votre arrivée aujourd'hui.";
  if (type === "ARRIVEE") {
    const refusHoraire = refusArriveeHoraire(now, horaires, jourNonOuvre);
    if (refusHoraire) return refusHoraire;
  }
  if (type === "DEPART" && hasDepart) return "Vous avez déjà pointé votre départ aujourd'hui.";
  if (type === "DEPART" && !hasArrivee) return "Vous devez pointer votre arrivée avant votre départ.";
  if (allToday.length >= 2) return "Vous avez déjà complété vos pointages pour aujourd'hui.";
  // Un départ moins de 30 minutes après l'arrivée est refusé (évite un double scan accidentel).
  const arrivee = allToday.find((p) => p.type === "ARRIVEE");
  if (type === "DEPART" && arrivee && departTropTot(arrivee.heure, now)) {
    return `Départ impossible moins de ${DELAI_MINIMUM_DEPART_MINUTES} minutes après votre arrivée (pointée à ${formatHeure(arrivee.heure)}). Vous pourrez pointer votre départ à partir de ${formatHeure(heureDepartPossible(arrivee.heure))}.`;
  }
  return null;
}

export async function enregistrerAbsenceAutomatiqueAction(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié" };

  const now = new Date();

  // 1. Contrôle des week-ends (Samedi 6 et Dimanche 0)
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { status: "error", message: "Aucune absence ne peut être enregistrée le week-end." };
  }

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // 2. Contrôle des jours fériés
  const jourFerie = await prisma.jourFerie.findFirst({
    where: { date: { gte: startOfDay, lte: endOfDay } },
  });
  if (jourFerie) {
    return { status: "error", message: `Aujourd'hui est un jour férié (${jourFerie.libelle}). Aucune absence automatique enregistrée.` };
  }

  // Option B : Le jour de création ou de réactivation du compte n'est pas pénalisé par l'absence automatique
  const userDb = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { createdAt: true },
  });
  if (userDb) {
    const derniereActivation = await prisma.historiqueEntry.findFirst({
      where: {
        entity: "User",
        entityId: session.user.id,
        action: { in: ["ACTIVATE", "INVITATION_ACTIVATED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const dateReference = (derniereActivation && derniereActivation.createdAt > userDb.createdAt)
      ? derniereActivation.createdAt
      : userDb.createdAt;

    const userEffectiveDay = new Date(dateReference);
    userEffectiveDay.setHours(0, 0, 0, 0);
    const todayDay = new Date(now);
    todayDay.setHours(0, 0, 0, 0);
    if (todayDay <= userEffectiveDay) {
      return { status: "error", message: "Le jour de création ou d'activation du compte n'est pas soumis à l'absence automatique." };
    }
  }

  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true },
  });

  const limiteDepartMinutes = timeToMinutes(parametrage?.heureFinApresMidi || "16:45");
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes < limiteDepartMinutes) {
    return { status: "error", message: "La journée n'est pas encore terminée." };
  }

  // Congé ou permission couvrant toute la journée : jamais d'absence automatique.
  const plagesDuJour = await prisma.plageAbsenceAutorisee.findMany({
    where: { userId: session.user.id, date: { gte: startOfDay, lte: endOfDay } },
    select: { heureDebut: true, heureFin: true },
  });
  if (
    journeeCouverteParAbsence(plagesDuJour, {
      heureDebutMatin: parametrage?.heureDebutMatin || "07:45",
      heureFinApresMidi: parametrage?.heureFinApresMidi || "16:45",
    })
  ) {
    return { status: "error", message: "Congé autorisé enregistré pour aujourd'hui." };
  }

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

    await notifyByPermission(PERMISSION_RH_POINTAGE, {
      titre: "Absence Automatique",
      message: `${session.user.fullName} a été marqué(e) absent(e) (fin de journée atteinte sans pointage).`,
      lien: "/pointage/rh/absences",
      priority: "IMPORTANT",
      category: "POINTAGE",
    });

    revalidatePath("/pointage");
    publishDataChanged();
  }

  return { status: "success", message: "Absence automatique enregistrée." };
}

/** Heure locale « HH:MM » (une seule mise en forme, `formatHeureLocale`). */
const formatHeure = formatHeureLocale;
