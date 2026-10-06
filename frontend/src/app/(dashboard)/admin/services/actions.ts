"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "backend";
import { type ActionState } from "backend";

import { getSession, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { logAuditAction } from "@/lib/auditLog";

export async function createServiceAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;
  const responsableId = formData.get("responsableId")?.toString() || "";

  if (!name) {
    return { status: "error", message: "Le nom du service est requis.", fieldErrors: { name: "Requis" } };
  }
  // Responsable obligatoire (circuit de validation, 2026-10-06) : il valide l'étape « Service » des demandes.
  if (!responsableId) {
    return { status: "error", message: "Le responsable du service est obligatoire.", fieldErrors: { responsableId: "Requis" } };
  }
  const responsable = await prisma.user.findUnique({ where: { id: responsableId }, select: { fullName: true, isActive: true } });
  if (!responsable || !responsable.isActive) {
    return { status: "error", message: "Le responsable choisi doit être un compte actif.", fieldErrors: { responsableId: "Compte actif requis" } };
  }

  try {
    const existing = await prisma.service.findUnique({ where: { name } });
    if (existing) {
      return { status: "error", message: "Ce service existe déjà.", fieldErrors: { name: "Déjà pris" } };
    }

    const service = await prisma.service.create({
      data: { name, description, responsableId },
    });

    await logAuditAction({
      entity: "Service",
      entityId: service.id,
      action: "CREATE",
      detail: `Création du service « ${service.name} »${service.description ? ` (${service.description})` : ""}, responsable : ${responsable.fullName}`,
      userId: session.user.id,
      userFullName: session.user.fullName,
      userEmail: session.user.email,
      logFileName: "services.log",
    });

    revalidatePath("/admin/services");
    publishDataChanged();
    return { status: "success", message: "Service créé avec succès." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    return { status: "error", message: msg };
  }
}

export async function deleteServiceAction(serviceId: string): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { _count: { select: { users: true } } },
    });

    if (!service) return { status: "error", message: "Service introuvable." };

    if (service._count.users > 0) {
      return { status: "error", message: "Impossible de supprimer un service qui contient des utilisateurs." };
    }

    await prisma.service.delete({
      where: { id: serviceId },
    });

    await logAuditAction({
      entity: "Service",
      entityId: serviceId,
      action: "DELETE",
      detail: `Suppression du service « ${service.name} »`,
      userId: session.user.id,
      userFullName: session.user.fullName,
      userEmail: session.user.email,
      logFileName: "services.log",
    });

    revalidatePath("/admin/services");
    publishDataChanged();
    return { status: "success", message: "Service supprimé." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    return { status: "error", message: msg };
  }
}

/**
 * Désigne le responsable d'un service (circuit de validation, 2026-10-06) : il valide l'étape « Service » des demandes
 * des membres du service. Obligatoire : on le remplace, on ne le retire jamais. Compte actif exigé.
 */
export async function definirResponsableServiceAction(serviceId: string, responsableId: string): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (!responsableId) {
    return { status: "error", message: "Le responsable du service est obligatoire." };
  }
  try {
    const [service, responsable] = await Promise.all([
      prisma.service.findUnique({ where: { id: serviceId }, include: { responsable: { select: { fullName: true } } } }),
      prisma.user.findUnique({ where: { id: responsableId }, select: { fullName: true, isActive: true } }),
    ]);
    if (!service) return { status: "error", message: "Service introuvable." };
    if (!responsable || !responsable.isActive) {
      return { status: "error", message: "Le responsable choisi doit être un compte actif." };
    }
    if (service.responsableId === responsableId) {
      return { status: "success", message: "Responsable inchangé." };
    }

    await prisma.service.update({ where: { id: serviceId }, data: { responsableId } });

    await logAuditAction({
      entity: "Service",
      entityId: serviceId,
      action: "CHANGE_RESPONSABLE",
      detail: `Responsable du service « ${service.name} » : ${service.responsable?.fullName ?? "aucun"} → ${responsable.fullName}`,
      userId: session.user.id,
      userFullName: session.user.fullName,
      userEmail: session.user.email,
      logFileName: "services.log",
    });

    revalidatePath("/admin/services");
    revalidatePath("/admin");
    publishDataChanged();
    return { status: "success", message: `${responsable.fullName} est désormais responsable du service « ${service.name} ».` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    return { status: "error", message: msg };
  }
}

export async function updateServiceAction(
  serviceId: string,
  name: string,
  description?: string | null
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { status: "error", message: "Le nom du service est requis." };
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return { status: "error", message: "Service introuvable." };

    const existing = await prisma.service.findFirst({
      where: { name: trimmedName, id: { not: serviceId } },
    });
    if (existing) {
      return { status: "error", message: "Un autre service porte déjà ce nom." };
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { name: trimmedName, description: description?.trim() || null },
    });

    await logAuditAction({
      entity: "Service",
      entityId: serviceId,
      action: "UPDATE",
      detail: `Modification du service « ${service.name} » → « ${updated.name} »${
        updated.description ? ` (${updated.description})` : ""
      }`,
      userId: session.user.id,
      userFullName: session.user.fullName,
      userEmail: session.user.email,
      logFileName: "services.log",
    });

    revalidatePath("/admin/services");
    publishDataChanged();
    return { status: "success", message: "Service mis à jour avec succès." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    return { status: "error", message: msg };
  }
}

