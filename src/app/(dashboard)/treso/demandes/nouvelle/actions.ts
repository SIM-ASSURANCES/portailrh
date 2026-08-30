"use server";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDemandeReference } from "@/lib/reference";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const MAX_ATTEMPTS = 5;

const demandeSchema = z.object({
  montant: z.coerce.number().positive("Le montant doit être supérieur à 0"),
  description: z.string().min(3, "Merci de décrire votre besoin (3 caractères minimum)"),
  commentaire: z.string().optional(),
});

function isReferenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Boolean((error.meta?.target as string[] | undefined)?.includes("reference"))
  );
}

/**
 * Crée une demande pour le Collaborateur connecté. Réservée à
 * `treso.creer_demande` — revérifiée ici même si la page est déjà gardée,
 * car une Server Action est un point d'entrée indépendant.
 */
export async function creerDemandeAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = demandeSchema.safeParse({
    montant: formData.get("montant"),
    description: formData.get("description"),
    commentaire: formData.get("commentaire") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { montant, description, commentaire } = parsed.data;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reference = await generateDemandeReference();

    try {
      const demande = await prisma.demande.create({
        data: {
          reference,
          montant,
          description,
          commentaire: commentaire || null,
          createurId: session.user.id,
          // REFONTE V1 (temporaire, voir CLAUDE.md "Refonte V1 en cours") :
          // beneficiaireType est désormais obligatoire, mais ce formulaire
          // (Ticket 1) n'a pas encore d'UI pour choisir un bénéficiaire
          // distinct du créateur — on le renseigne par défaut comme étant
          // le créateur lui-même. Un vrai sélecteur (collaborateur/
          // stagiaire/fournisseur/entreprise) reste à construire dans une
          // phase dédiée.
          beneficiaireType: "COLLABORATEUR",
          beneficiaireUserId: session.user.id,
        },
      });

      await prisma.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: demande.id,
          action: "CREATE",
          detail: `Création de la demande ${demande.reference}`,
          userId: session.user.id,
        },
      });

      return { status: "success", message: `Demande ${demande.reference} créée.` };
    } catch (error) {
      if (!isReferenceConflict(error) || attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
      // Collision de référence (soumissions concurrentes) : on retente
      // avec une référence fraîchement recalculée.
    }
  }

  return { status: "error", message: "Impossible de créer la demande, réessayez." };
}
