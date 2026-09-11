"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

/**
 * Éligibilité à CRÉER/SUPPRIMER une Catégorie ou un Objet — `isAdmin()`
 * OU la permission dédiée `treso.gerer_categories` (accordée à Finance
 * dans le seed ; tout rôle combiné qui cumulerait le module Finance, ex.
 * "Rh/finances", en hérite de la même façon dès qu'il porte cette
 * permission — jamais un accès en dur sur un nom de rôle). Volontairement
 * SCOPÉ à la création et la suppression seulement : l'activation/
 * désactivation (`toggleCategorieActiveAction`/`toggleObjetActiveAction`)
 * et le budget partagé (`modifierBudgetCategorieAction`) restent réservés
 * à `isAdmin()` seul, périmètre non demandé par cette tâche — voir
 * CLAUDE.md "Gestion des Catégories/Objets ouverte à Finance" pour ce
 * choix explicite.
 */
function peutGererCategories(session: { estAdmin: boolean; permissions: string[] } | null): boolean {
  return !!session && (isAdmin(session) || hasPermission(session, "treso.gerer_categories"));
}

function revalidateCategoriesPaths() {
  revalidatePath("/admin/categories");
  // Second point d'entrée Finance (voir CLAUDE.md "Gestion des
  // Catégories/Objets ouverte à Finance") — sans cette ligne, cette route
  // ne se met à jour qu'après le passage du rafraîchissement SSE (~1-2s,
  // voir "Rafraîchissement en temps réel"), jamais immédiatement comme
  // `/admin/categories` : un oubli constaté explicitement pendant la
  // vérification de cette tâche (toast de succès reçu, mais page pas
  // encore à jour avant le round-trip SSE).
  revalidatePath("/treso/finance/categories");
  // Le catalogue actif alimente aussi le formulaire de catégorisation
  // Finance (Ticket 2) et les filtres du reporting (Ticket 10).
  revalidatePath("/treso/finance/demandes", "layout");
  revalidatePath("/treso/finance/reporting");
  publishDataChanged();
}

const createCategorieSchema = z.object({
  label: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
});

/**
 * Crée une nouvelle Catégorie. Réservée à `peutGererCategories()`
 * (Admin OU `treso.gerer_categories`, voir plus haut) — ouverte à Finance
 * depuis CLAUDE.md "Gestion des Catégories/Objets ouverte à Finance"
 * (auparavant réservée à `isAdmin()` seul).
 */
export async function createCategorieAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !peutGererCategories(session)) {
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

/** Crée un nouvel Objet sous une Catégorie existante. Réservée à `peutGererCategories()` (voir plus haut). */
export async function createObjetAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !peutGererCategories(session)) {
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

const budgetAlloueSchema = z
  .number()
  .positive("Le budget doit être supérieur à 0")
  .nullable();

/**
 * Définit ou retire le budget PARTAGÉ (`budgetAlloue`) d'une Catégorie —
 * voir CLAUDE.md "Budget partagé par Catégorie". `null` = aucune limite,
 * aucun contrôle appliqué désormais pour cette catégorie (jamais la
 * consommation déjà enregistrée qui, elle, ne peut techniquement pas être
 * "retirée" — le grand livre des règlements reste immuable). Réservée aux
 * administrateurs, comme le reste de cet écran.
 */
export async function modifierBudgetCategorieAction(
  categorieId: string,
  budgetAlloue: number | null
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = budgetAlloueSchema.safeParse(budgetAlloue);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const categorie = await prisma.categorie.update({
    where: { id: categorieId },
    data: { budgetAlloue: parsed.data },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Categorie",
      entityId: categorie.id,
      action: "BUDGET_ALLOUE",
      detail:
        parsed.data != null
          ? `Budget alloué de « ${categorie.label} » fixé à ${parsed.data.toLocaleString("fr-FR")} FCFA`
          : `Budget alloué de « ${categorie.label} » retiré (aucune limite)`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return {
    status: "success",
    message:
      parsed.data != null
        ? `Budget de « ${categorie.label} » fixé à ${parsed.data.toLocaleString("fr-FR")} FCFA.`
        : `Budget de « ${categorie.label} » retiré (aucune limite).`,
  };
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

/**
 * Supprime DÉFINITIVEMENT une Catégorie — jamais possible si elle porte la
 * moindre donnée réelle liée, même principe exhaustif que
 * `supprimerUtilisateurAction` (admin/users/actions.ts) : la suppression
 * n'est possible QUE pour une Catégorie qui n'a jamais servi à rien, sinon
 * seule la désactivation (`toggleCategorieActiveAction`) reste disponible.
 *
 * **Relations réellement vérifiées dans `schema.prisma`** (recherche
 * exhaustive de `categorieId`/`Categorie` dans tout le fichier, aucune
 * autre trouvée) :
 * - `Objet.categorieId` — une Catégorie qui a encore des Objets (actifs OU
 *   inactifs) ne peut pas être supprimée : les supprimer un par un
 *   d'abord, sans quoi la contrainte de clé étrangère échouerait de toute
 *   façon (`onDelete` non défini = comportement par défaut `Restrict`).
 * - `Demande.categorieId` — une Catégorie référencée par au moins une
 *   Demande (quel que soit son statut) ne peut pas être supprimée.
 *   **Aucune vérification séparée sur `Reglement`/`JournalCaisse`/
 *   `DepenseLigne` n'est nécessaire** : aucun de ces modèles ne référence
 *   `Categorie` directement (vérifié), ils ne l'atteignent que
 *   TRANSITIVEMENT via `Demande` — déjà couvert par ce seul contrôle,
 *   même raisonnement que documenté pour `DepenseLigne`/`PieceJointe`
 *   dans `supprimerUtilisateurAction`.
 * - `Categorie.budgetAlloue` non nul — pas une relation au sens strict,
 *   mais un choix délibéré d'inclure ce cas dans les blocages : supprimer
 *   une Catégorie avec un budget partagé explicitement configuré effacerait
 *   silencieusement cette configuration (voir "Budget partagé par
 *   Catégorie"). Un Admin qui veut vraiment supprimer une telle Catégorie
 *   retire d'abord son budget (`modifierBudgetCategorieAction`, mettre à
 *   `null`), geste explicite plutôt qu'une perte de configuration invisible.
 */
export async function supprimerCategorieAction(categorieId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutGererCategories(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const categorie = await prisma.categorie.findUnique({
    where: { id: categorieId },
    include: {
      _count: { select: { objets: true, demandes: true } },
    },
  });
  if (!categorie) {
    return { status: "error", message: "Catégorie introuvable." };
  }

  const blocages: string[] = [];
  if (categorie._count.objets > 0) {
    blocages.push(`${categorie._count.objets} objet(s) rattaché(s)`);
  }
  if (categorie._count.demandes > 0) {
    blocages.push(`${categorie._count.demandes} demande(s) l'utilisant`);
  }
  if (categorie.budgetAlloue != null) {
    blocages.push(
      `un budget alloué de ${Number(categorie.budgetAlloue).toLocaleString("fr-FR")} FCFA défini`
    );
  }

  if (blocages.length > 0) {
    const liste =
      blocages.length === 1
        ? blocages[0]
        : `${blocages.slice(0, -1).join(", ")} et ${blocages[blocages.length - 1]}`;
    return {
      status: "error",
      message: `Impossible de supprimer « ${categorie.label} » : elle a ${liste}. Désactivez-la plutôt.`,
    };
  }

  await prisma.categorie.delete({ where: { id: categorieId } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Categorie",
      entityId: categorieId,
      action: "DELETE",
      detail: `Suppression définitive de la catégorie « ${categorie.label} »`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: `Catégorie « ${categorie.label} » supprimée.` };
}

/**
 * Supprime DÉFINITIVEMENT un Objet — même principe que
 * `supprimerCategorieAction` ci-dessus. **Seule relation réelle trouvée**
 * dans `schema.prisma` : `Demande.objetId`.
 */
export async function supprimerObjetAction(objetId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutGererCategories(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const objet = await prisma.objet.findUnique({
    where: { id: objetId },
    include: { _count: { select: { demandes: true } } },
  });
  if (!objet) {
    return { status: "error", message: "Objet introuvable." };
  }

  if (objet._count.demandes > 0) {
    return {
      status: "error",
      message: `Impossible de supprimer « ${objet.label} » : ${objet._count.demandes} demande(s) l'utilisent. Désactivez-le plutôt.`,
    };
  }

  await prisma.objet.delete({ where: { id: objetId } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Objet",
      entityId: objetId,
      action: "DELETE",
      detail: `Suppression définitive de l'objet « ${objet.label} »`,
      userId: session.user.id,
    },
  });

  revalidateCategoriesPaths();

  return { status: "success", message: `Objet « ${objet.label} » supprimé.` };
}
