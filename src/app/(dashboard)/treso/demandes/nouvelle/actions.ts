"use server";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { DEVISE_CODES } from "@/components/tresorerie/devise";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDemandeReference } from "@/lib/reference";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const MAX_ATTEMPTS = 5;

export interface LigneDemandeInput {
  libelle: string;
  quantite: number;
  prixUnitaire: number;
}

export interface CreerDemandeInput {
  beneficiaireType: string;
  categorieId: string;
  dateLivraisonSouhaitee?: string;
  posteBudgetaireId?: string;
  devise: string;
  /** "Motif de l'achat" — stocké dans `Demande.description`. */
  motif: string;
  lignes: LigneDemandeInput[];
  /** Nom de fichier renvoyé par `POST /api/treso/pieces-jointes/upload`, le cas échéant (facultatif). */
  pieceJointeUrl?: string;
}

const ligneSchema = z.object({
  libelle: z.string().trim().min(1, "Libellé requis"),
  quantite: z.coerce.number().int("Nombre entier attendu").positive("Le nombre doit être supérieur à 0"),
  prixUnitaire: z.coerce.number().nonnegative("Prix unitaire invalide"),
});

const demandeSchema = z.object({
  beneficiaireType: z.enum(["COLLABORATEUR", "STAGIAIRE", "FOURNISSEUR", "ENTREPRISE"], {
    message: "Entité bénéficiaire requise",
  }),
  categorieId: z.string().min(1, "Catégorie d'achat requise"),
  dateLivraisonSouhaitee: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Date invalide"),
  posteBudgetaireId: z.string().optional(),
  devise: z.enum(DEVISE_CODES as [string, ...string[]], { message: "Devise invalide" }),
  motif: z.string().trim().min(3, "Merci de préciser le motif de l'achat (3 caractères minimum)"),
  lignes: z.array(ligneSchema).min(1, "Ajoutez au moins une ligne d'article"),
});

function isReferenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Boolean((error.meta?.target as string[] | undefined)?.includes("reference"))
  );
}

/**
 * Crée une demande d'achat pour le Collaborateur connecté. Réservée à
 * `treso.creer_demande` — revérifiée ici même si la page est déjà gardée,
 * car une Server Action est un point d'entrée indépendant.
 *
 * Signature à arguments simples (et non `(prevState, formData)`) : le
 * "Tableau des articles" est un tableau de lignes qui ne se prête pas
 * nativement à `FormData` — même pattern que `creerRetourCaisseAction`
 * (Phase D). Le formulaire appelle donc directement cette action via
 * `useTransition`.
 *
 * Le `montant` de la demande n'est pas saisi : il est recalculé ici comme
 * la somme des (quantite × prixUnitaire) des lignes.
 */
export async function creerDemandeAction(
  input: CreerDemandeInput
): Promise<ActionState<{ demandeId: string }>> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { beneficiaireType, categorieId, dateLivraisonSouhaitee, posteBudgetaireId, devise, motif, lignes } =
    parsed.data;

  const montant = lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaire, 0);
  if (montant <= 0) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { lignes: "Le total général doit être supérieur à 0." },
    };
  }

  // La catégorie d'achat doit exister et être active ; le poste budgétaire
  // (facultatif) doit exister s'il est fourni.
  const categorie = await prisma.categorie.findFirst({
    where: { id: categorieId, isActive: true },
    select: { id: true },
  });
  if (!categorie) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { categorieId: "Catégorie d'achat inconnue." },
    };
  }
  if (posteBudgetaireId) {
    const poste = await prisma.categorie.findUnique({
      where: { id: posteBudgetaireId },
      select: { id: true },
    });
    if (!poste) {
      return {
        status: "error",
        message: "Le formulaire contient des erreurs.",
        fieldErrors: { posteBudgetaireId: "Poste budgétaire inconnu." },
      };
    }
  }

  // Bénéficiaire : pour une personne (collaborateur/stagiaire), le
  // bénéficiaire par défaut est le créateur lui-même (pas encore de
  // sélecteur de tiers) ; pour l'entreprise, on fige le nom ; pour un
  // fournisseur, le nom sera renseigné plus tard (aucun champ dédié à ce
  // stade).
  const beneficiaire =
    beneficiaireType === "COLLABORATEUR" || beneficiaireType === "STAGIAIRE"
      ? { beneficiaireUserId: session.user.id, beneficiaireNom: null }
      : beneficiaireType === "ENTREPRISE"
        ? { beneficiaireUserId: null, beneficiaireNom: "SIM Assurances CI" }
        : { beneficiaireUserId: null, beneficiaireNom: null };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reference = await generateDemandeReference();

    try {
      const demande = await prisma.demande.create({
        data: {
          reference,
          montant,
          description: motif,
          devise,
          categorieId: categorie.id,
          posteBudgetaireId: posteBudgetaireId || null,
          dateLivraisonSouhaitee: dateLivraisonSouhaitee ? new Date(dateLivraisonSouhaitee) : null,
          createurId: session.user.id,
          beneficiaireType,
          ...beneficiaire,
          lignes: {
            create: lignes.map((l) => ({
              libelle: l.libelle.trim(),
              quantite: l.quantite,
              prixUnitaire: l.prixUnitaire,
            })),
          },
          // Pièce jointe (facultative) : le fichier est déjà sur disque
          // (déposé par la route d'upload au moment de la sélection dans
          // le formulaire) — cette écriture ne fait qu'associer son nom
          // généré à la demande qui vient d'être créée.
          ...(input.pieceJointeUrl
            ? { pieces: { create: [{ url: input.pieceJointeUrl }] } }
            : {}),
        },
      });

      await prisma.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: demande.id,
          action: "CREATE",
          detail: `Création de la demande d'achat ${demande.reference} (${lignes.length} ligne(s), ${montant.toLocaleString("fr-FR")} ${devise})`,
          userId: session.user.id,
        },
      });

      return {
        status: "success",
        message: `Demande ${demande.reference} créée.`,
        data: { demandeId: demande.id },
      };
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
