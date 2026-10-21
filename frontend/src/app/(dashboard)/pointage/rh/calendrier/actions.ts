"use server";

import { revalidatePath } from "next/cache";
import { prisma, jourCivilDepuisColonneDate } from "backend";
import type { PlageCongeCalendrier } from "@/lib/conges/plagesCalendrier";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";

export async function getJoursFeries() {
  const session = await getSession();
  if (!session) {
    throw new Error("Non autorisé");
  }

  return await prisma.jourFerie.findMany({
    orderBy: { date: 'asc' }
  });
}

/**
 * Plages de congé du collaborateur connecté (validées ou en cours de circuit) pour le calendrier du Topbar.
 * Strictement limitées à `session.user.id`.
 */
export async function getMesPlagesConges(): Promise<PlageCongeCalendrier[]> {
  const session = await getSession();
  if (!session) {
    throw new Error("Non autorisé");
  }

  const limite = new Date();
  limite.setMonth(limite.getMonth() - 3);

  const demandes = await prisma.demandeConge.findMany({
    where: {
      userId: session.user.id,
      statut: { in: ["VALIDEE", "EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "MODIFICATION_DEMANDEE"] },
      dateFin: { gte: limite },
    },
    select: { id: true, dateDebut: true, dateFin: true, statut: true },
  });

  return demandes.map((d) => ({
    id: d.id,
    debut: jourCivilDepuisColonneDate(d.dateDebut),
    fin: jourCivilDepuisColonneDate(d.dateFin),
    etat: d.statut === "VALIDEE" ? "valide" : "demande",
  }));
}

export async function ajouterJoursFeriesBatch(jours: { date: Date, libelle: string }[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    let ajoutes = 0;
    for (const j of jours) {
      const datePropre = new Date(j.date);
      datePropre.setUTCHours(0, 0, 0, 0);

      const exist = await prisma.jourFerie.findFirst({
        where: { date: datePropre }
      });

      if (!exist) {
        await prisma.jourFerie.create({
          data: {
            date: datePropre,
            libelle: j.libelle
          }
        });
        ajoutes++;
      }
    }

    revalidatePath("/pointage/rh/calendrier");
    return { status: "success", message: `${ajoutes} jour(s) férié(s) ajouté(s).` };
  } catch (error) {
    console.error("Erreur ajouterJoursFeriesBatch:", error);
    return { status: "error", message: "Erreur lors de l'ajout" };
  }
}

export async function supprimerJourFerie(id: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    await prisma.jourFerie.delete({
      where: { id }
    });
    revalidatePath("/pointage/rh/calendrier");
    return { status: "success", message: "Jour férié supprimé" };
  } catch (error) {
    console.error("Erreur supprimerJourFerie:", error);
    return { status: "error", message: "Erreur lors de la suppression" };
  }
}
