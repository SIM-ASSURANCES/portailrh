"use server";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";
import { revalidatePath } from "next/cache";

export async function ajouterMotifRetard(pointageId: string, motif: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.corriger_pointage")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    await prisma.pointage.update({
      where: { id: pointageId },
      data: { motif },
    });
    revalidatePath("/pointage/rh/presence");
    return { status: "success", message: "Motif ajouté avec succès" };
  } catch (error) {
    console.error("Erreur ajouterMotifRetard:", error);
    return { status: "error", message: "Erreur lors de l'ajout du motif" };
  }
}
