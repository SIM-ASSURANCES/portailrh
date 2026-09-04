"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
