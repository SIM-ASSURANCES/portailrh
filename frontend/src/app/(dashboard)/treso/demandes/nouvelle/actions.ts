"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "backend";
import { DEVISE_CODES } from "@/components/tresorerie/devise";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierEtapeCircuit } from "@/lib/notificationsCircuit";
import { prisma } from "backend";
import { generateDemandeReference } from "backend";
import { chargerServiceDuDemandeur, initialiserCircuit, messageBlocageCreationDemande } from "backend";
import { champsBeneficiaire, choixPropreArticle, MOTIF_LIGNE_MIN, type ChoixBeneficiaire } from "backend";
import { dateLivraisonAEnregistrer, refusDateLivraison, versDateStockee } from "backend";
import { fieldErrorsFromZod, lireMontant, nettoyerMotifEchange, refusMotifEchange, type ActionState } from "backend";

const MAX_ATTEMPTS = 5;

export interface LigneDemandeInput {
  libelle: string;
  /** Motif de la ligne (pourquoi cet article), obligatoire. */
  motif: string;
  quantite: number;
  /** Texte saisi (« 1 500 000 ») ou nombre : réanalysé par le serveur avec la devise de la demande. */
  prixUnitaire: number | string;
  /** Bénéficiaire propre de l'article ; absent ou `null` = hérite du bénéficiaire de la demande (autonomie des articles, lot A). */
  beneficiaire?: ChoixBeneficiaire | null;
  /** Pièces propres à l'article (noms de fichiers renvoyés par la route d'envoi), plusieurs possibles. */
  pieceJointeUrls?: string[];
  /** Date de livraison de l'article (`YYYY-MM-DD`) ; vide = date commune de la demande (lot G). */
  dateLivraison?: string;
}

export interface CreerDemandeInput {
  /** Champ « Bénéficiaire » : moi-même, un autre compte actif du portail, ou un nom libre. */
  beneficiaire: ChoixBeneficiaire;
  dateLivraisonSouhaitee?: string;
  devise: string;
  lignes: LigneDemandeInput[];
  /** Nom de fichier renvoyé par `POST /api/treso/pieces-jointes/upload`, le cas échéant (facultatif). */
  pieceJointeUrl?: string;
  /** Lot M : motif de l'envoi au DG (10 à 300 caractères), obligatoire seulement quand la demande part directement chez le DG. */
  motifEnvoiDG?: string;
}

const choixBeneficiaireSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("MOI") }),
    z.object({ mode: z.literal("COMPTE"), userId: z.string().min(1, "Choisissez un compte.") }),
    z.object({ mode: z.literal("NOM"), nom: z.string().trim().min(2, "Saisissez le nom du bénéficiaire.") }),
  ],
  { message: "Bénéficiaire requis" }
);

/** Nom généré par la route d'envoi : un UUID et l'extension du type autorisé (jamais un chemin saisi par le client). */
const NOM_FICHIER_PIECE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/;
const PIECES_PAR_ARTICLE_MAX = 10;

const ligneSchema = z.object({
  libelle: z.string().trim().min(1, "Libellé requis"),
  motif: z.string().trim().min(MOTIF_LIGNE_MIN, `Chaque ligne doit avoir un motif (${MOTIF_LIGNE_MIN} caractères minimum).`),
  quantite: z.coerce.number().int("Nombre entier attendu").positive("Le nombre doit être supérieur à 0"),
  prixUnitaire: z.union([z.string(), z.number()]),
  beneficiaire: choixBeneficiaireSchema.nullish(),
  dateLivraison: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      const refus = refusDateLivraison(v);
      if (refus) ctx.addIssue({ code: "custom", message: refus });
    }),
  pieceJointeUrls: z
    .array(z.string().regex(NOM_FICHIER_PIECE, "Pièce jointe invalide."))
    .max(PIECES_PAR_ARTICLE_MAX, `${PIECES_PAR_ARTICLE_MAX} pièces au plus par article.`)
    .optional(),
});

const demandeSchema = z.object({
  beneficiaire: choixBeneficiaireSchema,
  // Tâche "Aucune date dans le passé" (voir CLAUDE.md) : la date du jour
  // reste autorisée, seule une date STRICTEMENT antérieure est refusée —
  // comparaison en granularité JOUR (chaînes `YYYY-MM-DD`), même
  // convention que le retour de caisse (`dateRetourSchema`).
  dateLivraisonSouhaitee: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Date invalide")
    .refine(
      (v) => !v || v >= new Date().toISOString().slice(0, 10),
      "La date de livraison souhaitée ne peut pas être dans le passé."
    ),
  devise: z.enum(DEVISE_CODES as [string, ...string[]], { message: "Devise invalide" }),
  lignes: z.array(ligneSchema).min(1, "Ajoutez au moins une ligne d'article"),
}).superRefine((d, ctx) => {
  // Lot M : le prix unitaire est réanalysé ici avec la devise de la demande (FCFA : entiers ; EUR : deux décimales).
  d.lignes.forEach((l, i) => {
    const r = lireMontant(l.prixUnitaire, { devise: d.devise });
    if (!r.ok) ctx.addIssue({ code: "custom", path: ["lignes", i, "prixUnitaire"], message: `Prix unitaire invalide : ${r.message}` });
  });
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
  // Le service du demandeur doit avoir un responsable actif (étape « Service » du circuit de validation).
  const blocageService = messageBlocageCreationDemande(await chargerServiceDuDemandeur(prisma, session.user.id));
  if (blocageService) {
    return { status: "error", message: blocageService };
  }

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { beneficiaire: choixBeneficiaire, dateLivraisonSouhaitee, devise } = parsed.data;
  // Prix unitaires en nombres (déjà validés par le schéma ci-dessus).
  const lignes = parsed.data.lignes.map((l) => {
    const prix = lireMontant(l.prixUnitaire, { devise });
    return { ...l, prixUnitaire: prix.ok ? prix.valeur : 0 };
  });

  const montant = lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaire, 0);
  if (montant <= 0) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { lignes: "Le total général doit être supérieur à 0." },
    };
  }

  // Bénéficiaire (2026-10-09) : moi-même, un autre compte ACTIF du portail (revérifié ici), ou un nom libre. Les
  // trois champs existants sont remplis par `champsBeneficiaire` ; la garde 8 et les pièces jointes s'appliquent au
  // compte bénéficiaire, comme avant.
  // Autonomie des articles (lot A) : un article dont le bénéficiaire égale la valeur commune n'enregistre rien (il
  // hérite), même si le client en a envoyé un — règle appliquée ici aussi, jamais seulement par le formulaire.
  const choixParArticle = lignes.map((l) => choixPropreArticle({ beneficiaire: l.beneficiaire }, choixBeneficiaire, session.user.id));
  const comptesAVerifier = new Set<string>();
  for (const c of [choixBeneficiaire, ...choixParArticle]) {
    if (c?.mode === "COMPTE" && c.userId !== session.user.id) comptesAVerifier.add(c.userId);
  }
  if (comptesAVerifier.size > 0) {
    const actifs = await prisma.user.findMany({
      where: { id: { in: [...comptesAVerifier] }, isActive: true },
      select: { id: true },
    });
    const actifsIds = new Set(actifs.map((u) => u.id));
    if (choixBeneficiaire.mode === "COMPTE" && choixBeneficiaire.userId !== session.user.id && !actifsIds.has(choixBeneficiaire.userId)) {
      return {
        status: "error",
        message: "Le formulaire contient des erreurs.",
        fieldErrors: { beneficiaire: "Ce compte n'existe pas ou n'est plus actif." },
      };
    }
    const fieldErrors: Record<string, string> = {};
    choixParArticle.forEach((c, i) => {
      if (c?.mode === "COMPTE" && c.userId !== session.user.id && !actifsIds.has(c.userId)) {
        fieldErrors[`lignes.${i}.beneficiaire`] = "Ce compte n'existe pas ou n'est plus actif.";
      }
    });
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "error", message: "Le formulaire contient des erreurs.", fieldErrors };
    }
  }
  const beneficiaire = champsBeneficiaire(choixBeneficiaire, session.user.id);
  const idsLignes = lignes.map(() => randomUUID());

  // Circuit de validation : parcours selon le demandeur (règles a à d) et première étape applicable.
  const circuit = await initialiserCircuit(prisma, session.user.id, "STANDARD");
  // Lot M : une demande émise par la Finance part chez le DG — c'est un envoi Finance → DG, qui porte un motif.
  const motifEnvoiDG = nettoyerMotifEchange(input.motifEnvoiDG);
  if (circuit.envoiDirectAuDG) {
    const refusEnvoi = refusMotifEchange(motifEnvoiDG, "l'envoi de la demande au DG");
    if (refusEnvoi) {
      return { status: "error", message: "Le formulaire contient des erreurs.", fieldErrors: { motifEnvoiDG: refusEnvoi } };
    }
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reference = await generateDemandeReference();

    try {
      const demande = await prisma.$transaction(async (tx) => {
        const creee = await tx.demande.create({
          data: {
            ...circuit.data,
            ...(circuit.envoiDirectAuDG ? { motifSoumissionDG: motifEnvoiDG } : {}),
            reference,
            montant,
            // Plus de motif d'en-tête : chaque ligne porte son motif.
            description: null,
            devise,
            // Pas de categorieId ici : la catégorisation reste un travail de
            // Finance après création (voir CategorisationForm), jamais choisie
            // par le collaborateur à la création (`categorieId` est nullable).
            dateLivraisonSouhaitee: dateLivraisonSouhaitee ? new Date(dateLivraisonSouhaitee) : null,
            createurId: session.user.id,
            ...beneficiaire,
            lignes: {
              create: lignes.map((l, i) => ({
                id: idsLignes[i],
                libelle: l.libelle.trim(),
                motif: l.motif.trim(),
                quantite: l.quantite,
                prixUnitaire: l.prixUnitaire,
                // Lot G : date propre de l'article, sinon la date commune (copiée) ; vide si aucune des deux.
                dateLivraison: versDateStockee(dateLivraisonAEnregistrer(l.dateLivraison, dateLivraisonSouhaitee)),
                // Bénéficiaire propre à l'article (vide = hérite de celui de la demande).
                ...(choixParArticle[i] ? champsBeneficiaire(choixParArticle[i], session.user.id) : {}),
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
        // Pièces propres à chaque article : rattachées à la demande ET à l'article (la pièce commune n'a pas d'article).
        const piecesArticles = lignes.flatMap((l, i) =>
          [...new Set(l.pieceJointeUrls ?? [])].map((url) => ({ url, demandeId: creee.id, ligneDemandeId: idsLignes[i] }))
        );
        if (piecesArticles.length > 0) await tx.pieceJointe.createMany({ data: piecesArticles });
        return creee;
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
      await prisma.historiqueEntry.create({
        data: { entity: "Demande", entityId: demande.id, action: "circuit_initialise", detail: circuit.envoiDirectAuDG ? `${circuit.detail} Motif de l'envoi au DG : ${motifEnvoiDG}` : circuit.detail, userId: session.user.id },
      });

      publishDataChanged();
      // Première étape : notifie ceux qui doivent agir (responsable du service, Finance ou DG selon le parcours).
      await notifierEtapeCircuit(demande.id, session.user.id);

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
