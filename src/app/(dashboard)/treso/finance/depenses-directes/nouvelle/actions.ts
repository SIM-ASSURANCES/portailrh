"use server";

import { z } from "zod";

import { NATURE_DEPENSE_DIRECTE_LABEL } from "@/components/tresorerie/depenseDirecte";
import { BENEFICIAIRE_TYPE_LABEL } from "@/components/tresorerie/beneficiaire";
import { Prisma } from "@/generated/prisma/client";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDemandeReference } from "@/lib/reference";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const MAX_ATTEMPTS = 5;

const depenseDirecteSchema = z
  .object({
    nature: z.enum(["PRIME_STAGE", "DOTATION_CARBURANT", "DEPENSE_ENTREPRISE", "DEPENSE_COLLECTIVE", "AUTRE"], {
      message: "La nature de la dépense est obligatoire.",
    }),
    beneficiaireType: z.enum(["COLLABORATEUR", "STAGIAIRE", "FOURNISSEUR", "ENTREPRISE"], {
      message: "Le type de bénéficiaire est obligatoire.",
    }),
    beneficiaireUserId: z.string().optional(),
    beneficiaireNom: z.string().optional(),
    description: z.string().trim().min(3, "Merci de décrire précisément cette dépense (3 caractères minimum)"),
    montant: z.coerce.number().positive("Le montant doit être supérieur à 0"),
    commentaire: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const nomRenseigne = Boolean(data.beneficiaireNom?.trim());
    const userRenseigne = Boolean(data.beneficiaireUserId);

    if (data.beneficiaireType === "COLLABORATEUR" && !userRenseigne) {
      ctx.addIssue({
        code: "custom",
        path: ["beneficiaireUserId"],
        message: "Sélectionnez le collaborateur bénéficiaire.",
      });
    }
    if (data.beneficiaireType === "STAGIAIRE" && !userRenseigne && !nomRenseigne) {
      ctx.addIssue({
        code: "custom",
        path: ["beneficiaireNom"],
        message: "Sélectionnez un compte existant, ou renseignez le nom du stagiaire s'il n'en a pas.",
      });
    }
    if (data.beneficiaireType === "FOURNISSEUR" && !nomRenseigne) {
      ctx.addIssue({
        code: "custom",
        path: ["beneficiaireNom"],
        message: "Le nom du fournisseur/prestataire est obligatoire.",
      });
    }
    if (data.beneficiaireType === "ENTREPRISE" && !nomRenseigne) {
      ctx.addIssue({
        code: "custom",
        path: ["beneficiaireNom"],
        message: "Le nom de l'entreprise est obligatoire.",
      });
    }
  });

function isReferenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Boolean((error.meta?.target as string[] | undefined)?.includes("reference"))
  );
}

/**
 * Crée une dépense saisie directement (Phase F, cahier des charges section
 * 11) : Finance (`treso.saisir_depense_directe`) saisit une demande pour un
 * bénéficiaire qui n'intervient pas lui-même dans la création (prime de
 * stage, dotation carburant, dépense pour l'entreprise, dépense
 * collective...). `createurId` reste l'utilisateur Finance connecté — le
 * bénéficiaire (`beneficiaireType`/`beneficiaireUserId`/`beneficiaireNom`,
 * Phase A) est une personne distincte par construction.
 *
 * **Règle centrale (documentée dans CLAUDE.md) : une fois créée, cette
 * demande suit EXACTEMENT le même circuit qu'une demande standard** —
 * statut initial `EN_ATTENTE_VALIDATION` (jamais pré-validée
 * automatiquement), validation/règlement/fonds remis/clôture identiques.
 * Seule cette action de création est spécifique.
 */
export async function creerDepenseDirecteAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.saisir_depense_directe")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = depenseDirecteSchema.safeParse({
    nature: formData.get("nature"),
    beneficiaireType: formData.get("beneficiaireType"),
    beneficiaireUserId: formData.get("beneficiaireUserId") || undefined,
    beneficiaireNom: formData.get("beneficiaireNom") || undefined,
    description: formData.get("description"),
    montant: formData.get("montant"),
    commentaire: formData.get("commentaire") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { nature, beneficiaireType, beneficiaireUserId, beneficiaireNom, description, montant, commentaire } =
    parsed.data;

  // Cohérence bénéficiaire, revérifiée ici (pas seulement le superRefine
  // ci-dessus, qui autorise déjà les deux champs à la fois pour STAGIAIRE) :
  // ne jamais enregistrer les deux à la fois, l'utilisateur du système prime
  // s'il est sélectionné.
  const beneficiaireUserIdFinal = beneficiaireUserId || null;
  const beneficiaireNomFinal = beneficiaireUserIdFinal ? null : beneficiaireNom?.trim() || null;

  let beneficiaireLabel = beneficiaireNomFinal ?? "—";
  if (beneficiaireUserIdFinal) {
    const utilisateur = await prisma.user.findUnique({ where: { id: beneficiaireUserIdFinal } });
    if (!utilisateur) {
      return {
        status: "error",
        message: "Le formulaire contient des erreurs.",
        fieldErrors: { beneficiaireUserId: "Utilisateur introuvable." },
      };
    }
    beneficiaireLabel = utilisateur.fullName;
  }

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
          typeDemande: "DEPENSE_DIRECTE",
          natureDepenseDirecte: nature,
          beneficiaireType,
          beneficiaireUserId: beneficiaireUserIdFinal,
          beneficiaireNom: beneficiaireNomFinal,
        },
      });

      await prisma.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: demande.id,
          action: "creation",
          detail: `Dépense directe saisie par ${session.user.fullName} — nature « ${NATURE_DEPENSE_DIRECTE_LABEL[nature]} », bénéficiaire ${BENEFICIAIRE_TYPE_LABEL[beneficiaireType].toLowerCase()} « ${beneficiaireLabel} »`,
          userId: session.user.id,
        },
      });

      return { status: "success", message: `Dépense directe ${demande.reference} créée.` };
    } catch (error) {
      if (!isReferenceConflict(error) || attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  return { status: "error", message: "Impossible de créer la dépense directe, réessayez." };
}
