"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { type ActionState, fieldErrorsFromZod } from "backend";

const geolocalisationSchema = z.object({
  geolocalisationActive: z.enum(["on", "off"]),
  bureauLatitude: z
    .string()
    .transform((v) => parseFloat(v))
    .refine((v) => !isNaN(v) && v >= -90 && v <= 90, {
      message: "Latitude invalide (entre -90 et 90).",
    }),
  bureauLongitude: z
    .string()
    .transform((v) => parseFloat(v))
    .refine((v) => !isNaN(v) && v >= -180 && v <= 180, {
      message: "Longitude invalide (entre -180 et 180).",
    }),
  rayonAutorise: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v >= 30 && v <= 200, {
      message: "Le rayon doit être compris entre 30 et 200 mètres.",
    }),
});

export async function updateGeolocalisationAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Non authentifié." };
  }
  if (!hasPermission(session, "pointage.gerer_horaires")) {
    return { status: "error", message: "Accès refusé. Vous n'avez pas la permission de modifier ce paramétrage." };
  }

  const parseResult = geolocalisationSchema.safeParse({
    geolocalisationActive: formData.get("geolocalisationActive") ?? "off",
    bureauLatitude: formData.get("bureauLatitude"),
    bureauLongitude: formData.get("bureauLongitude"),
    rayonAutorise: formData.get("rayonAutorise"),
  });

  if (!parseResult.success) {
    return {
      status: "error",
      message: "Veuillez vérifier les valeurs saisies.",
      fieldErrors: fieldErrorsFromZod(parseResult.error),
    };
  }

  const { geolocalisationActive, bureauLatitude, bureauLongitude, rayonAutorise } = parseResult.data;

  try {
    const actif = await prisma.parametrageHoraire.findFirst({
      where: { isActive: true },
    });

    const payload = {
      geolocalisationActive: geolocalisationActive === "on",
      bureauLatitude,
      bureauLongitude,
      rayonAutorise,
    };

    if (actif) {
      await prisma.parametrageHoraire.update({
        where: { id: actif.id },
        data: payload,
      });
    } else {
      // Crée un enregistrement complet avec les horaires par défaut
      await prisma.parametrageHoraire.create({
        data: {
          ...payload,
          isActive: true,
          heureDebutMatin: "07:45",
          heureFinMatin: "12:00",
          heureDebutApresMidi: "13:00",
          heureFinApresMidi: "16:45",
        },
      });
    }

    revalidatePath("/pointage");
    publishDataChanged();

    return {
      status: "success",
      message: `Géolocalisation ${geolocalisationActive === "on" ? "activée" : "désactivée"} avec succès. Rayon configuré : ${rayonAutorise}m.`,
    };
  } catch (error) {
    console.error("updateGeolocalisationAction error:", error);
    return { status: "error", message: "Une erreur est survenue lors de la mise à jour." };
  }
}

/**
 * Action déclenchée depuis le bouton "Utiliser ma position".
 * Reçoit les coordonnées du navigateur admin et les enregistre.
 */
export async function saveAdminPositionAction(
  lat: number,
  lon: number
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "pointage.gerer_horaires")) {
    return { status: "error", message: "Accès refusé." };
  }

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { status: "error", message: "Coordonnées GPS invalides." };
  }

  try {
    const actif = await prisma.parametrageHoraire.findFirst({ where: { isActive: true } });

    if (actif) {
      await prisma.parametrageHoraire.update({
        where: { id: actif.id },
        data: { bureauLatitude: lat, bureauLongitude: lon },
      });
    } else {
      await prisma.parametrageHoraire.create({
        data: {
          isActive: true,
          bureauLatitude: lat,
          bureauLongitude: lon,
          rayonAutorise: 50,
          geolocalisationActive: false,
          heureDebutMatin: "07:45",
          heureFinMatin: "12:00",
          heureDebutApresMidi: "13:00",
          heureFinApresMidi: "16:45",
        },
      });
    }

    revalidatePath("/pointage/rh/geolocalisation");
    return { status: "success", message: `Position enregistrée : ${lat.toFixed(7)}, ${lon.toFixed(7)}` };
  } catch {
    return { status: "error", message: "Erreur lors de l'enregistrement de la position." };
  }
}
