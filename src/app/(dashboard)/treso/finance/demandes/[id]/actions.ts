"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEcart } from "@/lib/tresorerie";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const categorisationSchema = z.object({
  demandeId: z.string().min(1),
  categorieId: z.string().min(1, "Catégorie requise"),
  objetId: z.string().min(1, "Objet requis"),
  budgetDisponible: z.coerce.number().positive("Le budget doit être supérieur à 0"),
});

/**
 * Renseigne catégorie/objet/budget d'une demande. Réservée à
 * `treso.categoriser_demande`.
 *
 * Défense en profondeur (règle impérative du cahier des charges) : le
 * statut EN_ATTENTE est revérifié ici, côté serveur, juste avant l'écriture
 * — jamais uniquement via l'UI qui ne propose le formulaire que dans ce
 * cas. Le statut a pu changer entre l'affichage de la page et la
 * soumission (ex: validée entre-temps par un autre utilisateur Finance).
 * Une fois VALIDEE, ces champs sont définitivement verrouillés, y compris
 * pour Finance.
 */
export async function categoriserDemandeAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = categorisationSchema.safeParse({
    demandeId: formData.get("demandeId"),
    categorieId: formData.get("categorieId"),
    objetId: formData.get("objetId"),
    budgetDisponible: formData.get("budgetDisponible"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, categorieId, objetId, budgetDisponible } = parsed.data;

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const objet = await prisma.objet.findUnique({ where: { id: objetId }, include: { categorie: true } });
  if (!objet || objet.categorieId !== categorieId) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { objetId: "Cet objet n'appartient pas à la catégorie sélectionnée." },
    };
  }

  await prisma.demande.update({
    where: { id: demandeId },
    data: { categorieId, objetId, budgetDisponible },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "CATEGORISER",
      detail: `Catégorie « ${objet.categorie.label} », objet « ${objet.label} », budget ${budgetDisponible.toLocaleString("fr-FR")} FCFA`,
      userId: session.user.id,
    },
  });

  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);

  return { status: "success", message: "Catégorisation enregistrée." };
}

type SimpleActionResult = { status: "success" | "error"; message: string };

function revalidateDemandePaths(demandeId: string) {
  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/demandes");
  revalidatePath(`/treso/demandes/${demandeId}`);
}

/**
 * Valide une demande. Réservée à `treso.valider_demande`.
 *
 * Verrouillage DÉFINITIF (règle impérative) : une fois VALIDEE, plus aucune
 * action ne peut la faire revenir en arrière — il n'existe volontairement
 * aucune fonction de "dévalidation" dans tout le portail. Défense en
 * profondeur : le statut EN_ATTENTE est revérifié ici juste avant
 * l'écriture, jamais uniquement via le masquage du bouton dans l'UI (même
 * principe que `categoriserDemandeAction` ci-dessus).
 */
export async function validerDemandeAction(demandeId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  await prisma.$transaction([
    prisma.demande.update({ where: { id: demandeId }, data: { statut: "VALIDEE" } }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "validation",
        detail: null,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Demande ${demande.reference} validée.` };
}

const motifRejetSchema = z
  .string()
  .trim()
  .min(3, "Le motif du rejet est obligatoire (3 caractères minimum)");

/**
 * Rejette une demande. Réservée à `treso.valider_demande` (même permission
 * que valider — la décision valider/rejeter est un seul et même pouvoir).
 * Motif obligatoire (validé ici, jamais uniquement côté client) ; même
 * défense en profondeur sur le statut EN_ATTENTE que `validerDemandeAction`.
 */
export async function rejeterDemandeAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifRejetSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { statut: "REJETEE", motifRejet: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "rejet",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Demande ${demande.reference} rejetée.` };
}

const motifClotureSchema = z
  .string()
  .trim()
  .min(3, "Le motif de la clôture partielle est obligatoire (3 caractères minimum)");

/**
 * Clôture une demande VALIDEE. Réservée à `treso.cloturer_demande` (Finance
 * uniquement selon le seed actuel, pas le DG — la garde du layout partagé
 * n'accorde pas cette permission automatiquement, revérifiée ici).
 *
 * Verrouillage DÉFINITIF (même principe que `validerDemandeAction`) : une
 * fois `CLOTUREE_TOTALE` ou `CLOTUREE_PARTIELLE`, plus aucune action n'est
 * possible sur la demande — ni nouveau règlement, ni nouvelle déclaration
 * de retour, ni nouvelle réception, ni re-clôture. Cette Server Action ne
 * fait que fermer son propre statut ; la défense en profondeur côté des
 * AUTRES actions (`creerReglementAction`, `creerRetourCaisseAction`,
 * `receptionnerRetourAction`, `annulerReglementAction`) revérifie chacune
 * `demande.statut === "VALIDEE"` de son côté (voir leurs fichiers
 * respectifs) : le statut CLOTUREE_* les fait toutes échouer naturellement.
 *
 * Clôture totale : motif libre optionnel, stocké dans `motifCloture` à
 * titre de commentaire (pas de validation de longueur). Clôture partielle :
 * motif obligatoire (min 3 caractères), refusé côté serveur sans lui, même
 * si le bouton de confirmation est aussi bloqué côté client si le champ est
 * vide.
 */
export async function cloturerDemandeAction(
  demandeId: string,
  type: "TOTALE" | "PARTIELLE",
  motif?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.cloturer_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  let motifValide: string | null = null;
  if (type === "PARTIELLE") {
    const parsedMotif = motifClotureSchema.safeParse(motif);
    if (!parsedMotif.success) {
      return { status: "error", message: parsedMotif.error.issues[0].message };
    }
    motifValide = parsedMotif.data;
  } else if (motif?.trim()) {
    motifValide = motif.trim();
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "VALIDEE") {
    return {
      status: "error",
      message: `Cette demande ne peut pas être clôturée (statut actuel : ${demande.statut}).`,
    };
  }

  const ecart = await getEcart(demandeId);
  const detail =
    type === "PARTIELLE"
      ? motifValide!
      : `Clôture totale — écart au moment de la clôture : ${ecart.toLocaleString("fr-FR")} FCFA${
          motifValide ? ` (${motifValide})` : ""
        }`;

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: {
        statut: type === "TOTALE" ? "CLOTUREE_TOTALE" : "CLOTUREE_PARTIELLE",
        motifCloture: motifValide,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: type === "TOTALE" ? "cloture_totale" : "cloture_partielle",
        detail,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return {
    status: "success",
    message: `Demande ${demande.reference} clôturée${type === "PARTIELLE" ? " (partielle)" : ""}.`,
  };
}
