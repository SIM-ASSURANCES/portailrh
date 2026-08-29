"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

type SimpleActionResult = { status: "success" | "error"; message: string };

function revalidateCategoriesPaths() {
  revalidatePath("/admin/categories");
  // Le catalogue actif alimente aussi le formulaire de catégorisation
  // Finance (Ticket 2) et les filtres du reporting (Ticket 10).
  revalidatePath("/treso/finance/demandes", "layout");
  revalidatePath("/treso/finance/reporting");
}

const createCategorieSchema = z.object({
  label: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
});

/**
 * Crée une nouvelle Catégorie. Réservée aux administrateurs (isAdmin()) —
 * jamais de suppression dans le portail (Categorie/Objet sont
 * potentiellement référencés par des Demande existantes) : seule la
 * désactivation (toggleCategorieActiveAction) est possible.
 */
export async function createCategorieAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = createCategorieSchema.safeParse({ label: formData.get("label") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.categorie.findUnique({ where: { label: parsed.data.label } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { label: "Une catégorie porte déjà ce libellé." },
    };
  }

  const categorie = await prisma.categorie.create({ data: { label: parsed.data.label } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Categorie",
      entityId: categorie.id,
      action: "CREATE",
      detail: `Création de la catégorie « ${categorie.label} »`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: `Catégorie « ${categorie.label} » créée.` };
}

const createObjetSchema = z.object({
  label: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
  categorieId: z.string().min(1, "Catégorie requise"),
});

/** Crée un nouvel Objet sous une Catégorie existante. Réservée aux administrateurs. */
export async function createObjetAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = createObjetSchema.safeParse({
    label: formData.get("label"),
    categorieId: formData.get("categorieId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const categorie = await prisma.categorie.findUnique({ where: { id: parsed.data.categorieId } });
  if (!categorie) {
    return { status: "error", message: "Catégorie introuvable." };
  }

  const objet = await prisma.objet.create({
    data: { label: parsed.data.label, categorieId: parsed.data.categorieId },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Objet",
      entityId: objet.id,
      action: "CREATE",
      detail: `Création de l'objet « ${objet.label} » sous « ${categorie.label} »`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: `Objet « ${objet.label} » créé.` };
}

/**
 * Active ou désactive une Catégorie. Une catégorie désactivée n'apparaît
 * plus dans les sélecteurs de nouvelle catégorisation ni les filtres de
 * reporting, mais reste affichée normalement sur les demandes qui la
 * référencent déjà.
 */
export async function toggleCategorieActiveAction(
  categorieId: string,
  active: boolean
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const categorie = await prisma.categorie.update({ where: { id: categorieId }, data: { isActive: active } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Categorie",
      entityId: categorie.id,
      action: active ? "ACTIVATE" : "DEACTIVATE",
      detail: `Catégorie ${active ? "activée" : "désactivée"} : ${categorie.label}`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: active ? "Catégorie activée." : "Catégorie désactivée." };
}

/** Active ou désactive un Objet. Même principe que toggleCategorieActiveAction. */
export async function toggleObjetActiveAction(
  objetId: string,
  active: boolean
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const objet = await prisma.objet.update({ where: { id: objetId }, data: { isActive: active } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Objet",
      entityId: objet.id,
      action: active ? "ACTIVATE" : "DEACTIVATE",
      detail: `Objet ${active ? "activé" : "désactivé"} : ${objet.label}`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: active ? "Objet activé." : "Objet désactivé." };
}
