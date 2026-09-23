"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify, notifyByPermission } from "@/lib/notifications";
import { prisma } from "backend";
import { calculerStatutDemande, getEcart, lignesToutesDecidees, STATUTS_VALIDATION_COMPLETE } from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

/**
 * Notifie le créateur ET les approbateurs DG qu'une demande vient
 * d'atteindre une validation ENTIÈRE (montantValide === montant demandé) —
 * factorisé car ce même évènement peut être produit par trois Server
 * Actions distinctes (validation totale, validation partielle qui
 * atteint en réalité le montant total, validation complémentaire qui
 * comble le dernier reliquat). Voir CLAUDE.md "Notifications Trésorerie".
 */
async function notifierDemandeEntierementValidee(
  demande: { id: string; reference: string; createurId: string },
  montantFinal: number,
  actorUserId: string
) {
  await notify({
    userId: demande.createurId,
    titre: "Demande validée",
    message: `Votre demande ${demande.reference} a été validée totalement (${montantFinal.toLocaleString("fr-FR")} FCFA).`,
    lien: `/treso/demandes/${demande.id}`,
    priority: "IMPORTANT",
    category: "TRESORERIE",
  });
  // Exclut l'auteur de la validation (Finance ou DG) : un rôle combiné
  // portant aussi `treso.approuver_validation_complete` ne doit pas se
  // notifier lui-même de sa propre action.
  await notifyByPermission("treso.approuver_validation_complete", {
    titre: "Demande à approuver (validation complète)",
    message: `La demande ${demande.reference} est entièrement validée et attend votre approbation avant clôture.`,
    lien: "/treso/finance/validations-attente",
    excludeUserId: actorUserId,
    priority: "IMPORTANT",
    category: "TRESORERIE",
  });
}

const categorisationSchema = z.object({
  demandeId: z.string().min(1),
  categorieId: z.string().min(1, "Catégorie requise"),
  objetId: z.string().min(1, "Objet requis"),
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
 *
 * **Catégorisation par ligne (voir CLAUDE.md)** : réservée désormais aux
 * demandes SANS ligne (`DEPENSE_DIRECTE`) — même principe exact que le
 * gate déjà posé sur les quatre actions de validation par montant
 * (`demandeAauMoinsUneLigne`, voir plus bas) : une demande `STANDARD` (au
 * moins une ligne) se catégorise désormais exclusivement via
 * `categoriserLigneAction`, ligne par ligne.
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
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, categorieId, objetId } = parsed.data;

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (await demandeAauMoinsUneLigne(demandeId)) {
    return {
      status: "error",
      message: "Cette demande contient des lignes d'article : catégorisez chaque ligne individuellement.",
    };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
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
    data: { categorieId, objetId },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "CATEGORISER",
      detail: `Catégorie « ${objet.categorie.label} », objet « ${objet.label} »`,
      userId: session.user.id,
    },
  });

  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  publishDataChanged();

  return { status: "success", message: "Catégorisation enregistrée." };
}

const categorisationLigneSchema = z.object({
  ligneId: z.string().min(1),
  categorieId: z.string().min(1, "Catégorie requise"),
  objetId: z.string().min(1, "Objet requis"),
});

/**
 * Catégorisation par ligne (voir CLAUDE.md "Catégorisation par ligne") —
 * mirroir exact de `modifierLibelleLigneAction` : même permission
 * (`treso.categoriser_demande`, inchangée), même granularité par
 * `LigneDemande` plutôt que par `Demande`. Réutilise
 * `creerCategorieInlineAction`/`creerObjetInlineAction` telles quelles
 * (aucune modification) : la création à la volée ne connaît pas la notion
 * de ligne, elle crée un catalogue partagé, peu importe qui l'appelle.
 *
 * **Garde : `ligne.statutValidation === "EN_ATTENTE"`, PAS
 * `demande.statut`** — relit la règle impérative "Catégorie/objet
 * modifiables uniquement avant validation" à l'échelle de la LIGNE : une
 * fois qu'une ligne est décidée (validée OU rejetée), sa catégorisation
 * est définitivement verrouillée, même si une autre ligne de la même
 * demande reste encore `EN_ATTENTE` (en pratique, `validerLignesAction`
 * décide toutes les lignes d'une demande en un seul geste atomique — ce
 * cas mixte ne survit donc jamais dans les faits, mais le contrôle reste
 * posé à la bonne granularité conceptuelle, jamais un raccourci sur le
 * statut de la demande entière).
 */
export async function categoriserLigneAction(
  ligneId: string,
  categorieId: string,
  objetId: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = categorisationLigneSchema.safeParse({ ligneId, categorieId, objetId });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const ligne = await prisma.ligneDemande.findUnique({ where: { id: parsed.data.ligneId } });
  if (!ligne) {
    return { status: "error", message: "Ligne introuvable." };
  }
  if (ligne.statutValidation !== "EN_ATTENTE") {
    return {
      status: "error",
      message: "Cette ligne a déjà été décidée : sa catégorisation ne peut plus être modifiée.",
    };
  }

  const objet = await prisma.objet.findUnique({
    where: { id: parsed.data.objetId },
    include: { categorie: true },
  });
  if (!objet || objet.categorieId !== parsed.data.categorieId) {
    return { status: "error", message: "Cet objet n'appartient pas à la catégorie sélectionnée." };
  }

  await prisma.$transaction([
    prisma.ligneDemande.update({
      where: { id: parsed.data.ligneId },
      data: { categorieId: parsed.data.categorieId, objetId: parsed.data.objetId },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "LigneDemande",
        entityId: parsed.data.ligneId,
        action: "categorisation_ligne",
        detail: `Ligne « ${ligne.libelle} » catégorisée : « ${objet.categorie.label} » / « ${objet.label} »`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(ligne.demandeId);

  return { status: "success", message: "Catégorisation enregistrée." };
}

const nouvelleCategorieSchema = z.object({
  label: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
});

export type CreerCategorieInlineResult =
  | { status: "success"; categorie: { id: string; label: string } }
  | { status: "error"; message: string };

/**
 * Crée une Catégorie directement depuis l'écran de catégorisation Finance
 * — Tâche "Visibilité des catégories/objets existants pendant la
 * catégorisation" (voir CLAUDE.md). Même principe et même permission
 * exactement que `creerObjetInlineAction` ci-dessous (`treso.categoriser_demande`,
 * pas `treso.gerer_categories` — cohérent avec le fait que c'est Finance
 * qui agit dans CE contexte précis, le CRUD complet de `admin/categories`
 * restant un espace distinct) : les deux actions inline (catégorie ET
 * objet) partagent désormais la même garde, jamais l'une plus permissive
 * que l'autre.
 *
 * La nouvelle Catégorie est une Catégorie ORDINAIRE (`isActive: true` par
 * défaut, aucun `budgetAlloue`) — apparaît ensuite normalement dans
 * `admin/categories`/`treso/finance/categories`, jamais une donnée cachée.
 */
export async function creerCategorieInlineAction(label: string): Promise<CreerCategorieInlineResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = nouvelleCategorieSchema.safeParse({ label });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const existante = await prisma.categorie.findUnique({ where: { label: parsed.data.label } });
  if (existante) {
    return { status: "error", message: "Une catégorie porte déjà ce libellé." };
  }

  const categorie = await prisma.categorie.create({ data: { label: parsed.data.label } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Categorie",
      entityId: categorie.id,
      action: "CREATE",
      detail: `Catégorie « ${categorie.label} » créée depuis l'écran de catégorisation`,
      userId: session.user.id,
    },
  });

  // Même revalidation que `creerObjetInlineAction`/`createCategorieAction`
  // (`admin/categories/actions.ts`) : le catalogue est partagé par
  // plusieurs écrans, jamais une donnée cachée ou différente selon l'écran
  // d'origine de la création.
  revalidatePath("/admin/categories");
  revalidatePath("/treso/finance/categories");
  revalidatePath("/treso/finance/reporting");
  publishDataChanged();

  return { status: "success", categorie: { id: categorie.id, label: categorie.label } };
}

const nouvelObjetSchema = z.object({
  categorieId: z.string().min(1, "Catégorie requise"),
  label: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
});

export type CreerObjetInlineResult =
  | { status: "success"; objet: { id: string; label: string; categorieId: string } }
  | { status: "error"; message: string };

/**
 * Crée un Objet directement depuis l'écran de catégorisation Finance, sans
 * quitter le formulaire ni recharger la page — débloque le cas où une
 * Catégorie n'a encore aucun Objet (le Select "Objet" resterait sinon
 * vide, bloquant toute catégorisation). Réservée à
 * `treso.categoriser_demande`, cohérent avec le fait que c'est Finance qui
 * agit dans CE contexte précis (le CRUD complet de `admin/categories`,
 * lui, reste réservé à `isAdmin()`, inchangé).
 *
 * Le nouvel Objet est un Objet ORDINAIRE (même modèle `Objet`, `isActive:
 * true` par défaut) — il apparaît ensuite normalement dans
 * `admin/categories` comme n'importe quel autre, jamais une donnée cachée
 * ou parallèle.
 */
export async function creerObjetInlineAction(
  categorieId: string,
  label: string
): Promise<CreerObjetInlineResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = nouvelObjetSchema.safeParse({ categorieId, label });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const categorie = await prisma.categorie.findUnique({ where: { id: parsed.data.categorieId } });
  if (!categorie) {
    return { status: "error", message: "Catégorie introuvable." };
  }
  if (!categorie.isActive) {
    return { status: "error", message: "Cette catégorie est désactivée : impossible d'y ajouter un objet." };
  }

  const objet = await prisma.objet.create({
    data: { label: parsed.data.label, categorieId: parsed.data.categorieId },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Objet",
      entityId: objet.id,
      action: "CREATE",
      detail: `Objet « ${objet.label} » créé depuis l'écran de catégorisation (catégorie « ${categorie.label} »)`,
      userId: session.user.id,
    },
  });

  // Le catalogue d'objets est aussi lu par admin/categories, son second
  // point d'entrée Finance (/treso/finance/categories, voir CLAUDE.md
  // "Gestion des Catégories/Objets ouverte à Finance") et le reporting
  // (même revalidation que createObjetAction dans admin/categories/actions.ts) :
  // le nouvel objet y est donc visible immédiatement, jamais une donnée
  // cachée ou différente.
  revalidatePath("/admin/categories");
  revalidatePath("/treso/finance/categories");
  revalidatePath("/treso/finance/reporting");
  publishDataChanged();

  return {
    status: "success",
    objet: { id: objet.id, label: objet.label, categorieId: objet.categorieId },
  };
}

type SimpleActionResult = { status: "success" | "error"; message: string };

const modifierDescriptionSchema = z.object({
  demandeId: z.string().min(1),
  description: z.string().trim().min(3, "La description doit contenir au moins 3 caractères"),
});

/**
 * Modifie la "Description du besoin" d'une demande — Tâche "Libellé de
 * demande modifiable avec traçabilité permanente" (voir CLAUDE.md).
 * Réservée au Responsable Finance ET à l'Assistant Finance, EXCLUSIVEMENT.
 *
 * **`treso.valider_demande` seule NE SUFFIT PAS à exclure le DG** (même
 * conflit de spécification déjà rencontré et tranché avec l'utilisateur
 * pour "Restreindre 'Déléguer des accès'", voir CLAUDE.md) : le rôle DG
 * possède aussi cette permission. Garde retenue, même schéma que pour les
 * délégations : **(`treso.valider_demande` ET PAS
 * `treso.approuver_validation_complete`) OU `treso.effectuer_reglement`**
 * — couvre Responsable Finance (`valider_demande`, jamais
 * `approuver_validation_complete`) et Assistant Finance
 * (`effectuer_reglement`), exclut le DG (a les deux premières, jamais la
 * troisième) et le Collaborateur (aucune des trois), sans jamais comparer
 * de nom de rôle en dur.
 *
 * **`descriptionOriginale` renseignée UNE SEULE FOIS**, à la toute
 * première modification (`?? demande.description`, jamais écrasée par
 * une modification suivante) — `description` reste la version COURANTE,
 * modifiée autant de fois que nécessaire. Les deux ne divergent qu'après
 * au moins une modification ; avant ça, `descriptionOriginale` reste
 * `null` et `description` fait office des deux versions à la fois (voir
 * le commentaire du champ dans `schema.prisma`).
 *
 * **Chaque modification tracée dans `HistoriqueEntry`** (action
 * `modification_description`, ancienne valeur dans `detail`) — cohérent
 * avec la règle impérative du projet ("toute opération importante
 * historisée"), même si l'écran n'affiche que la version initiale et la
 * version courante côte à côte, jamais chaque étape intermédiaire.
 *
 * Verrouillée une fois `CLOTUREE` — même principe que toutes les autres
 * mutations de ce module une fois le dossier fermé.
 */
export async function modifierDescriptionAction(
  demandeId: string,
  nouvelleDescription: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  const peutModifier =
    !!session &&
    ((hasPermission(session, "treso.valider_demande") &&
      !hasPermission(session, "treso.approuver_validation_complete")) ||
      hasPermission(session, "treso.effectuer_reglement"));
  if (!peutModifier) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = modifierDescriptionSchema.safeParse({ demandeId, description: nouvelleDescription });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut === "CLOTUREE") {
    return { status: "error", message: "Cette demande est clôturée : sa description ne peut plus être modifiée." };
  }
  if (parsed.data.description === demande.description) {
    return { status: "success", message: "Aucun changement à enregistrer." };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: {
        description: parsed.data.description,
        descriptionOriginale: demande.descriptionOriginale ?? demande.description,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "modification_description",
        detail: `Description modifiée par ${session.user.fullName} — ancienne version : « ${demande.description} »`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: "Description modifiée." };
}

const modifierLibelleLigneSchema = z.object({
  ligneId: z.string().min(1),
  libelle: z.string().trim().min(3, "Le libellé doit contenir au moins 3 caractères"),
});

/**
 * Modifie le libellé d'UNE ligne d'article (`LigneDemande.libelle`) — Tâche
 * "Validation ligne par ligne" (voir CLAUDE.md). Même pattern exact que
 * `modifierDescriptionAction` ci-dessus (même garde de permission, même
 * mécanique `libelleOriginal` renseignée une seule fois, même verrou
 * `CLOTUREE`, même trace `HistoriqueEntry`) — seule différence : porte sur
 * une `LigneDemande` précise, pas sur la `Demande` entière.
 *
 * Action DISTINCTE de `validerLignesAction` (qui, elle, décide
 * valider/rejeter) : modifier un libellé n'est jamais une décision de
 * validation, reste donc ouvert à l'Assistant Finance comme
 * `modifierDescriptionAction`.
 */
export async function modifierLibelleLigneAction(
  ligneId: string,
  nouveauLibelle: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  const peutModifier =
    !!session &&
    ((hasPermission(session, "treso.valider_demande") &&
      !hasPermission(session, "treso.approuver_validation_complete")) ||
      hasPermission(session, "treso.effectuer_reglement"));
  if (!peutModifier) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = modifierLibelleLigneSchema.safeParse({ ligneId, libelle: nouveauLibelle });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const ligne = await prisma.ligneDemande.findUnique({
    where: { id: parsed.data.ligneId },
    include: { demande: true },
  });
  if (!ligne) {
    return { status: "error", message: "Ligne introuvable." };
  }
  if (ligne.demande.statut === "CLOTUREE") {
    return { status: "error", message: "Cette demande est clôturée : le libellé ne peut plus être modifié." };
  }
  if (parsed.data.libelle === ligne.libelle) {
    return { status: "success", message: "Aucun changement à enregistrer." };
  }

  await prisma.$transaction([
    prisma.ligneDemande.update({
      where: { id: parsed.data.ligneId },
      data: {
        libelle: parsed.data.libelle,
        libelleOriginal: ligne.libelleOriginal ?? ligne.libelle,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "LigneDemande",
        entityId: parsed.data.ligneId,
        action: "modification_libelle_ligne",
        detail: `Libellé modifié par ${session.user.fullName} — ancienne version : « ${ligne.libelle} »`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(ligne.demandeId);

  return { status: "success", message: "Libellé modifié." };
}

function revalidateDemandePaths(demandeId: string) {
  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/demandes");
  revalidatePath(`/treso/demandes/${demandeId}`);
  // Ticket 8 : validation/rejet/clôture changent la répartition des
  // demandes VALIDEE — revalider tout l'espace Finance (dashboard + listes
  // "à décaisser"/"à régulariser") en une fois via `type: "layout"`.
  revalidatePath("/treso/finance", "layout");
  // Rafraîchissement en temps réel (voir CLAUDE.md) : publié ici une seule
  // fois pour tous les appelants de ce helper, plutôt que dupliqué à chaque
  // site d'appel.
  publishDataChanged();
}

const montantValidationSchema = z.coerce.number().positive("Le montant doit être supérieur à 0");

/**
 * Enregistre une étape de validation (initiale totale/partielle, ou
 * complémentaire) : met à jour `montantValide`, crée l'entrée d'historique
 * dédiée à CETTE étape précise (montant validé à cette occasion + cumul),
 * puis appelle `calculerStatutDemande` pour déduire le nouveau statut à
 * partir des montants réels — jamais fixé à la main ici. Partagée par les
 * trois Server Actions de validation ci-dessous.
 */
async function enregistrerValidation(
  demandeId: string,
  userId: string,
  montantValideCumule: number,
  montantCetteEtape: number,
  action: "validation" | "validation_complementaire"
): Promise<void> {
  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { montantValide: montantValideCumule },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action,
        detail: `Montant validé à cette étape : ${montantCetteEtape.toLocaleString("fr-FR")} FCFA (cumul validé : ${montantValideCumule.toLocaleString("fr-FR")} FCFA)`,
        userId,
      },
    }),
  ]);

  await calculerStatutDemande(demandeId);
}

/**
 * `true` dès qu'une demande a au moins une ligne d'article — utilisé pour
 * refuser les quatre actions de validation par montant (Option B1, voir
 * CLAUDE.md "Validation ligne par ligne") : une demande avec lignes ne peut
 * plus être décidée que via `validerLignesAction`. Une simple `count`,
 * jamais un `include: { lignes: true }` complet — ces quatre actions n'ont
 * besoin que de savoir s'il y en a, jamais de leur contenu.
 */
async function demandeAauMoinsUneLigne(demandeId: string): Promise<boolean> {
  const nombreLignes = await prisma.ligneDemande.count({ where: { demandeId } });
  return nombreLignes > 0;
}

const decisionLigneSchema = z.object({
  ligneId: z.string().min(1),
  statut: z.enum(["VALIDEE", "REJETEE"]),
  motif: z.string().trim().optional(),
});

const validerLignesSchema = z.array(decisionLigneSchema).min(1);

/**
 * Validation ligne par ligne — Tâche "Validation ligne par ligne" (voir
 * CLAUDE.md). Pour toute demande ayant AU MOINS une ligne, cette action
 * devient l'UNIQUE mécanisme de décision : elle remplace entièrement
 * `validerTotalementAction`/`validerPartiellementAction`/
 * `validerComplementaireAction`/`rejeterReliquatAction` pour ce cas (ces
 * quatre actions se refusent désormais explicitement dès qu'une demande a
 * des lignes — voir leur garde ajoutée plus bas). Décision UNIQUE ET
 * COMPLÈTE en un seul geste : jamais de notion de "reliquat" à traiter plus
 * tard une fois les lignes tranchées, jamais de dévalidation.
 *
 * **Permission : réservée au Responsable Finance UNIQUEMENT**
 * (`treso.valider_demande` ET PAS `treso.approuver_validation_complete`),
 * PAS à l'Assistant Finance (`treso.effectuer_reglement` seul ne suffit
 * jamais ici, contrairement à `modifierLibelleLigneAction`) — c'est une
 * décision de VALIDATION, cohérent avec le fait que l'Assistant Finance
 * n'a, dans tout le reste du module, jamais aucun pouvoir de décision
 * (seulement `effectuer_reglement`/`receptionner_retour`, des actions
 * d'EXÉCUTION une fois la décision déjà prise par le Responsable) — voir
 * CLAUDE.md "Séparation stricte Responsable Finance / Assistant Finance".
 *
 * Une seule transaction Prisma :
 * 1. Vérifie que la demande a au moins une ligne et est
 *    `EN_ATTENTE_VALIDATION`.
 * 2. Vérifie qu'AUCUNE ligne n'est déjà décidée — nécessaire en plus du
 *    contrôle de statut : si TOUTES les lignes sont rejetées,
 *    `montantValide` retombe à 0 et `calculerStatutDemande` (jamais
 *    modifiée ici) repasse la demande en `EN_ATTENTE_VALIDATION` alors que
 *    ses lignes sont pourtant déjà toutes décidées — sans ce second
 *    contrôle, ce cas précis permettrait à tort une seconde exécution
 *    (une forme de dévalidation par la bande, contraire au principe
 *    "décision unique et complète").
 * 3. Vérifie que TOUTES les lignes de la demande sont couvertes par les
 *    décisions reçues, ni plus ni moins (rejette si une ligne manque ou si
 *    un id étranger à la demande est reçu).
 * 4. Motif obligatoire (3 caractères minimum) pour chaque ligne `REJETEE`.
 * 5. Met à jour `statutValidation`/`motifRejet`/`decideParId`/`decideAt`
 *    sur chaque ligne, recalcule `Demande.montantValide` = Σ
 *    (quantite × prixUnitaire) des seules lignes `VALIDEE`, puis appelle
 *    `calculerStatutDemande()` exactement comme les autres actions de
 *    validation.
 * 6. Une `HistoriqueEntry` par ligne décidée (`entity: "LigneDemande"`,
 *    action `validation_ligne`/`rejet_ligne`).
 */
export async function validerLignesAction(
  demandeId: string,
  decisions: { ligneId: string; statut: "VALIDEE" | "REJETEE"; motif?: string }[]
): Promise<SimpleActionResult> {
  const session = await getSession();
  const peutValider =
    !!session &&
    hasPermission(session, "treso.valider_demande") &&
    !hasPermission(session, "treso.approuver_validation_complete");
  if (!peutValider) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedDecisions = validerLignesSchema.safeParse(decisions);
  if (!parsedDecisions.success) {
    return { status: "error", message: "Décisions invalides." };
  }

  const demande = await prisma.demande.findUnique({
    where: { id: demandeId },
    include: { lignes: true },
  });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.lignes.length === 0) {
    return {
      status: "error",
      message: "Cette demande n'a aucune ligne d'article — utilisez la validation par montant.",
    };
  }
  if (demande.lignes.some((ligne) => ligne.statutValidation !== "EN_ATTENTE")) {
    return { status: "error", message: "Les lignes de cette demande ont déjà été décidées." };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const ligneParId = new Map(demande.lignes.map((ligne) => [ligne.id, ligne]));
  const decisionIds = new Set(parsedDecisions.data.map((d) => d.ligneId));

  if (
    decisionIds.size !== parsedDecisions.data.length ||
    parsedDecisions.data.some((d) => !ligneParId.has(d.ligneId)) ||
    demande.lignes.some((ligne) => !decisionIds.has(ligne.id))
  ) {
    return {
      status: "error",
      message: "Toutes les lignes de la demande doivent être décidées, une seule fois chacune.",
    };
  }

  for (const d of parsedDecisions.data) {
    if (d.statut === "REJETEE" && (d.motif?.trim().length ?? 0) < 3) {
      return {
        status: "error",
        message: "Un motif de rejet (3 caractères minimum) est obligatoire pour chaque ligne rejetée.",
      };
    }
  }

  const decideAt = new Date();
  let montantValide = 0;

  const ligneUpdates = parsedDecisions.data.map((d) => {
    const ligne = ligneParId.get(d.ligneId)!;
    const motif = d.statut === "REJETEE" ? d.motif!.trim() : null;
    if (d.statut === "VALIDEE") {
      montantValide += ligne.quantite * Number(ligne.prixUnitaire);
    }
    return prisma.ligneDemande.update({
      where: { id: d.ligneId },
      data: {
        statutValidation: d.statut,
        motifRejet: motif,
        decideParId: session.user.id,
        decideAt,
      },
    });
  });

  const historiqueEntries = parsedDecisions.data.map((d) => {
    const ligne = ligneParId.get(d.ligneId)!;
    return prisma.historiqueEntry.create({
      data: {
        entity: "LigneDemande",
        entityId: d.ligneId,
        action: d.statut === "VALIDEE" ? "validation_ligne" : "rejet_ligne",
        detail:
          d.statut === "VALIDEE"
            ? `Ligne « ${ligne.libelle} » validée (${ligne.quantite} × ${Number(ligne.prixUnitaire).toLocaleString("fr-FR")} FCFA)`
            : `Ligne « ${ligne.libelle} » rejetée — motif : ${d.motif!.trim()}`,
        userId: session.user.id,
      },
    });
  });

  await prisma.$transaction([
    ...ligneUpdates,
    prisma.demande.update({ where: { id: demandeId }, data: { montantValide } }),
    ...historiqueEntries,
  ]);

  await calculerStatutDemande(demandeId);
  revalidateDemandePaths(demandeId);

  const montantDemande = Number(demande.montant);
  if (Math.round(montantValide * 100) >= Math.round(montantDemande * 100)) {
    await notifierDemandeEntierementValidee(demande, montantValide, session.user.id);
  } else if (montantValide > 0) {
    await notify({
      userId: demande.createurId,
      titre: "Demande validée partiellement",
      message: `Votre demande ${demande.reference} a été validée partiellement (${montantValide.toLocaleString("fr-FR")} FCFA sur ${montantDemande.toLocaleString("fr-FR")} FCFA demandés) — certaines lignes ont été rejetées.`,
      lien: `/treso/demandes/${demandeId}`,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  } else {
    await notify({
      userId: demande.createurId,
      titre: "Lignes de votre demande rejetées",
      message: `Toutes les lignes de votre demande ${demande.reference} ont été rejetées.`,
      lien: `/treso/demandes/${demandeId}`,
      priority: "CRITIQUE",
      category: "TRESORERIE",
    });
  }

  return {
    status: "success",
    message: `Décisions enregistrées pour la demande ${demande.reference} (${montantValide.toLocaleString("fr-FR")} FCFA validés).`,
  };
}

/**
 * Valide TOTALEMENT une demande `EN_ATTENTE_VALIDATION` : `montantValide`
 * est porté au montant demandé en une seule fois. Réservée à
 * `treso.valider_demande`. Défense en profondeur : le statut est revérifié
 * ici juste avant l'écriture (même principe que `categoriserDemandeAction`).
 *
 * Pas de "dévalidation" : une fois le montant entièrement validé, il n'y a
 * plus d'action pour revenir en arrière sur ce montant (seuls le rejet —
 * avant toute validation — et la clôture d'une phase ultérieure ferment le
 * dossier).
 */
export async function validerTotalementAction(demandeId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (await demandeAauMoinsUneLigne(demandeId)) {
    return {
      status: "error",
      message: "Cette demande contient des lignes d'article : utilisez la validation ligne par ligne.",
    };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const montantDemande = Number(demande.montant);
  await enregistrerValidation(demandeId, session.user.id, montantDemande, montantDemande, "validation");
  revalidateDemandePaths(demandeId);
  await notifierDemandeEntierementValidee(demande, montantDemande, session.user.id);

  return { status: "success", message: `Demande ${demande.reference} validée totalement.` };
}

/**
 * Valide PARTIELLEMENT une demande `EN_ATTENTE_VALIDATION`, pour un montant
 * inférieur au montant demandé.
 *
 * Règle impérative : le montant validé ne peut JAMAIS dépasser le montant
 * demandé — un montant strictement supérieur est **refusé** côté serveur
 * (jamais plafonné silencieusement). Cas limite documenté : un montant
 * EXACTEMENT égal au montant demandé n'est plus une validation "partielle"
 * au sens strict, mais reste accepté et appliqué comme une validation
 * TOTALE (redirection de la logique), plutôt que refusé pour une saisie par
 * ailleurs légitime — évite un aller-retour inutile entre les deux boutons
 * pour ce cas précis.
 */
export async function validerPartiellementAction(
  demandeId: string,
  montant: number
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantValidationSchema.safeParse(montant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (await demandeAauMoinsUneLigne(demandeId)) {
    return {
      status: "error",
      message: "Cette demande contient des lignes d'article : utilisez la validation ligne par ligne.",
    };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const montantDemande = Number(demande.montant);

  // Règle impérative : le montant validé ne peut JAMAIS dépasser le montant
  // demandé — un montant strictement supérieur est refusé, jamais plafonné
  // silencieusement.
  if (Math.round(parsedMontant.data * 100) > Math.round(montantDemande * 100)) {
    return {
      status: "error",
      message: `Le montant (${parsedMontant.data.toLocaleString("fr-FR")} FCFA) dépasse le montant demandé (${montantDemande.toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const estFinalementTotale = Math.round(parsedMontant.data * 100) >= Math.round(montantDemande * 100);

  await enregistrerValidation(demandeId, session.user.id, parsedMontant.data, parsedMontant.data, "validation");
  revalidateDemandePaths(demandeId);

  if (estFinalementTotale) {
    await notifierDemandeEntierementValidee(demande, parsedMontant.data, session.user.id);
  } else {
    await notify({
      userId: demande.createurId,
      titre: "Demande validée partiellement",
      message: `Votre demande ${demande.reference} a été validée partiellement (${parsedMontant.data.toLocaleString("fr-FR")} FCFA sur ${montantDemande.toLocaleString("fr-FR")} FCFA demandés).`,
      lien: `/treso/demandes/${demandeId}`,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  }

  return {
    status: "success",
    message: `Demande ${demande.reference} validée ${estFinalementTotale ? "totalement" : "partiellement"} (${parsedMontant.data.toLocaleString("fr-FR")} FCFA).`,
  };
}

/**
 * Validation COMPLÉMENTAIRE sur le reliquat d'une demande déjà
 * `PARTIELLEMENT_VALIDEE` — peut être exécutée par le même validateur ou un
 * autre habilité (`treso.valider_demande`), aucune restriction sur
 * l'auteur de la validation initiale. Le montant complémentaire ne peut
 * jamais faire dépasser le montant demandé une fois ajouté au montant déjà
 * validé (contrôle serveur, pas seulement l'UI qui plafonne déjà la saisie).
 */
export async function validerComplementaireAction(
  demandeId: string,
  montant: number
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantValidationSchema.safeParse(montant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (await demandeAauMoinsUneLigne(demandeId)) {
    return {
      status: "error",
      message: "Cette demande contient des lignes d'article : utilisez la validation ligne par ligne.",
    };
  }
  if (demande.statut !== "PARTIELLEMENT_VALIDEE") {
    return {
      status: "error",
      message: `Une validation complémentaire n'est possible que sur une demande partiellement validée (statut actuel : ${demande.statut}).`,
    };
  }
  if (demande.reliquatRejete) {
    return {
      status: "error",
      message: "Le reliquat de cette demande a été rejeté, aucune validation complémentaire n'est plus possible.",
    };
  }

  const montantDemande = Number(demande.montant);
  const montantValideActuel = Number(demande.montantValide ?? 0);
  const montantRestant = montantDemande - montantValideActuel;

  if (Math.round(parsedMontant.data * 100) > Math.round(montantRestant * 100)) {
    return {
      status: "error",
      message: `Le montant complémentaire (${parsedMontant.data.toLocaleString("fr-FR")} FCFA) dépasse le reliquat à valider (${montantRestant.toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const montantValideFinal = montantValideActuel + parsedMontant.data;
  await enregistrerValidation(
    demandeId,
    session.user.id,
    montantValideFinal,
    parsedMontant.data,
    "validation_complementaire"
  );
  revalidateDemandePaths(demandeId);

  // Notifie uniquement si cette validation complémentaire comble
  // ENTIÈREMENT le reliquat (voir la consigne : pas de notification à
  // chaque étape complémentaire partielle, seulement quand la demande
  // devient entièrement validée).
  if (Math.round(montantValideFinal * 100) >= Math.round(montantDemande * 100)) {
    await notifierDemandeEntierementValidee(demande, montantValideFinal, session.user.id);
  }

  return {
    status: "success",
    message: `Demande ${demande.reference} : validation complémentaire de ${parsedMontant.data.toLocaleString("fr-FR")} FCFA enregistrée.`,
  };
}

const motifRejetReliquatSchema = z
  .string()
  .trim()
  .min(3, "Le motif est obligatoire (3 caractères minimum)");

/**
 * Rejette le reliquat NON encore validé d'une demande `PARTIELLEMENT_VALIDEE`
 * — le seul chemin qui manquait au circuit de validation partielle
 * (jusqu'ici, une demande partiellement validée ne pouvait recevoir qu'une
 * validation complémentaire, jamais un rejet du reste). Réservée à
 * `treso.valider_demande` (Finance ET DG, même permission que la validation
 * elle-même — pas de restriction sur qui a effectué la validation initiale).
 *
 * **N'affecte JAMAIS `montantValide` ni le `statut`** : la part déjà
 * validée reste acquise et suit son cours normal (règlement, clôture),
 * exactement comme documenté pour `rejeterValidationCompleteAction` — une
 * trace de décision, pas une réécriture du montant. Seul effet concret :
 * `validerComplementaireAction` refuse désormais toute nouvelle tentative
 * sur cette demande (voir la garde ajoutée ci-dessus).
 *
 * Motif obligatoire, revalidé côté serveur. Défense en profondeur : refusée
 * si la demande n'est pas `PARTIELLEMENT_VALIDEE`, ou si son reliquat est
 * déjà rejeté (`reliquatRejete` ne peut être fixé qu'une seule fois — même
 * principe que l'absence de "dévalidation" ailleurs dans le module).
 */
export async function rejeterReliquatAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifRejetReliquatSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (await demandeAauMoinsUneLigne(demandeId)) {
    return {
      status: "error",
      message: "Cette demande contient des lignes d'article : utilisez la validation ligne par ligne.",
    };
  }
  if (demande.statut !== "PARTIELLEMENT_VALIDEE") {
    return {
      status: "error",
      message: `Le rejet du reliquat n'est possible que sur une demande partiellement validée (statut actuel : ${demande.statut}).`,
    };
  }
  if (demande.reliquatRejete) {
    return { status: "error", message: "Le reliquat de cette demande a déjà été rejeté." };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { reliquatRejete: true, motifRejetReliquat: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "rejet_reliquat",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  await notify({
    userId: demande.createurId,
    titre: "Reliquat de demande rejeté",
    message: `Le reliquat de votre demande ${demande.reference} a été rejeté. Motif : ${parsedMotif.data}`,
    lien: `/treso/demandes/${demandeId}`,
    priority: "CRITIQUE",
    category: "TRESORERIE",
  });

  return {
    status: "success",
    message: `Reliquat de la demande ${demande.reference} rejeté — le montant déjà validé suit son cours normal.`,
  };
}

const motifRejetSchema = z
  .string()
  .trim()
  .min(3, "Le motif du rejet est obligatoire (3 caractères minimum)");

/**
 * Rejette une demande. Réservée à `treso.valider_demande` (même permission
 * que valider — la décision valider/rejeter est un seul et même pouvoir).
 * Motif obligatoire (validé ici, jamais uniquement côté client) ; même
 * défense en profondeur sur le statut que les actions de validation
 * ci-dessus.
 *
 * **Choix Phase B, documenté ici et dans CLAUDE.md** : le rejet reste
 * réservé au statut `EN_ATTENTE_VALIDATION` — une demande déjà
 * `PARTIELLEMENT_VALIDEE` ne peut plus être "rejetée" au sens strict. Une
 * fois qu'un montant a été validé (donc potentiellement déjà réglé — les
 * Tickets 4+ n'attendent pas la clôture pour créer un règlement dès que le
 * statut fait partie de `STATUTS_VALIDATION_COMPLETE`), revenir en arrière
 * sur la totalité de la demande n'a plus de sens : le montant déjà validé
 * est acquis. Le seul chemin en avant pour le reliquat est une validation
 * complémentaire (`validerComplementaireAction`) ; aucune action de "rejet
 * du reliquat" n'existe à ce stade — si le validateur souhaite abandonner
 * la partie non encore validée, ce cas restera sans réponse applicative
 * tant qu'une phase ultérieure (clôture/régularisation) n'introduit pas un
 * mécanisme dédié pour l'acter explicitement.
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
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
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

  await notify({
    userId: demande.createurId,
    titre: "Demande rejetée",
    message: `Votre demande ${demande.reference} a été rejetée. Motif : ${parsedMotif.data}`,
    lien: `/treso/demandes/${demandeId}`,
    priority: "CRITIQUE",
    category: "TRESORERIE",
  });

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

  const demande = await prisma.demande.findUnique({
    where: { id: demandeId },
    include: { lignes: { select: { statutValidation: true } } },
  });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }

  // Verrou de clôture (indépendant du circuit de validation/règlement des
  // Phases B/C, qui reste inchangé — voir `validationCompleteParDG` sur
  // `Demande`) : avant tout le reste, une demande ne peut être clôturée
  // (totale ou partielle) que si le DG a donné son approbation complète,
  // même si Finance a déjà intégralement réglé.
  if (!demande.validationCompleteParDG) {
    return {
      status: "error",
      message: "La clôture nécessite l'approbation complète du DG au préalable.",
    };
  }

  // REFONTE V1 (Phase B) : `VALIDEE` seul ne suffit plus — la validation
  // totale produit désormais VALIDEE_NON_REGLEE/PARTIELLEMENT_REGLEE/REGLEE
  // selon l'avancement du règlement (voir `calculerStatutDemande`). Voir
  // `STATUTS_VALIDATION_COMPLETE` dans src/lib/tresorerie.ts.
  //
  // Tâche "Diagnostic DEM-2026-000009 bloquée" (voir CLAUDE.md) : pour une
  // demande AVEC lignes, `PARTIELLEMENT_VALIDEE` (une ligne validée, une
  // autre rejetée) n'a plus jamais vocation à évoluer vers un statut de
  // `STATUTS_VALIDATION_COMPLETE` — `validerLignesAction` décide toutes les
  // lignes en un seul geste, jamais de reliquat par ligne. Sans
  // `lignesToutesDecidees`, une telle demande ne pouvait plus jamais être
  // clôturée, alors même que son montant validé était intégralement réglé
  // et régularisé.
  if (!STATUTS_VALIDATION_COMPLETE.includes(demande.statut) && !lignesToutesDecidees(demande.lignes)) {
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
        // REFONTE V1 (temporaire) : CLOTUREE_TOTALE/CLOTUREE_PARTIELLE
        // fusionnés dans l'unique statut CLOTUREE — voir CLAUDE.md
        // "Refonte V1 en cours". La distinction totale/partielle reste
        // portée par `motifCloture` (rempli seulement pour une clôture
        // partielle avant cette refonte) en attendant la phase de
        // régularisation (EN_ATTENTE_REGULARISATION/REGULARISEE).
        statut: "CLOTUREE",
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

/**
 * Approuve la "validation complète" du DG — verrou de clôture (Ticket 7),
 * totalement indépendant du circuit de validation/règlement des Phases
 * B/C : n'affecte JAMAIS `montantValide` ni l'éligibilité au règlement
 * (`peutEffectuerReglement`, toujours basée uniquement sur `montantValide` /
 * `getResteARegler`), seulement la possibilité de clôturer ensuite. Réservée
 * à `treso.approuver_validation_complete` (DG uniquement selon le seed
 * actuel — jamais Finance, même si Finance a déjà tout réglé).
 *
 * Deux gardes métier avant l'écriture :
 * - `montantValide > 0` — une demande encore `EN_ATTENTE_VALIDATION` (rien
 *   validé) ou `REJETEE` n'a rien de significatif à approuver ici.
 * - Pas de double approbation : `validationCompleteParDG` ne peut être
 *   fixé qu'une seule fois (aucune action de "retrait" n'existe non plus,
 *   même principe que l'absence de "dévalidation").
 */
export async function approuverValidationCompleteAction(demandeId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.montantValide == null || Number(demande.montantValide) <= 0) {
    return {
      status: "error",
      message: "Cette demande n'a encore aucun montant validé — rien à approuver.",
    };
  }
  if (demande.validationCompleteParDG) {
    return { status: "error", message: "La validation complète a déjà été approuvée pour cette demande." };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: {
        validationCompleteParDG: true,
        dgApprobateurId: session.user.id,
        dgApprouveAt: new Date(),
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "validation_complete_dg",
        detail: `Validation complète approuvée par ${session.user.fullName}`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Validation complète approuvée pour la demande ${demande.reference}.` };
}

const motifValidationCompleteSchema = z
  .string()
  .trim()
  .min(3, "Le motif est obligatoire (3 caractères minimum)");

/**
 * Rejette une demande lors de l'EXAMEN du verrou de clôture (le DG regarde
 * le dossier avant d'approuver et décide qu'il n'est pas encore prêt).
 * **Ne modifie AUCUN champ de la `Demande`** — contrairement à
 * `rejeterDemandeAction` (rejet de la demande elle-même, avant toute
 * validation), ce rejet-ci porte uniquement sur l'approbation DG : la
 * demande reste dans son statut courant, toujours visible dans
 * "Validations complètes en attente" (rien n'a structurellement changé,
 * il n'y a rien à "annuler" pour la faire réapparaître). Trace purement
 * informative — une `HistoriqueEntry` supplémentaire qui vient s'ajouter,
 * jamais remplacer les précédentes, pour que Finance comprenne pourquoi le
 * dossier n'avance pas et corrige ce qui doit l'être avant un nouvel
 * examen par le DG.
 *
 * Règle impérative de traçabilité (exigence explicite : "une histoire
 * d'argent", rien n'est jamais supprimé ni écrasé) : aucune action de
 * cette fonctionnalité (approbation, rejet, annulation) ne supprime ni ne
 * modifie une `HistoriqueEntry` existante — chacune s'ajoute à la suite,
 * avec son auteur, sa date et son motif.
 */
export async function rejeterValidationCompleteAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifValidationCompleteSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.validationCompleteParDG) {
    return {
      status: "error",
      message: "Cette demande a déjà été approuvée — utilisez plutôt l'annulation de l'approbation.",
    };
  }

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "rejet_validation_complete",
      detail: parsedMotif.data,
      userId: session.user.id,
    },
  });

  revalidateDemandePaths(demandeId);
  revalidatePath("/treso/finance/validations-attente");

  // Exclut le DG lui-même (`treso.valider_demande` peut aussi être porté
  // par le DG) — il ne doit pas se notifier de sa propre décision.
  await notifyByPermission("treso.valider_demande", {
    titre: "Validation complète rejetée par le DG",
    message: `Le DG a rejeté (à l'examen) la validation complète de la demande ${demande.reference}. Motif : ${parsedMotif.data}`,
    lien: `/treso/finance/demandes/${demandeId}`,
    excludeUserId: session.user.id,
    priority: "CRITIQUE",
    category: "TRESORERIE",
  });

  // Notifier également le créateur de la demande en priorité CRITIQUE
  await notify({
    userId: demande.createurId,
    titre: "Validation complète rejetée par le DG",
    message: `Le DG a rejeté la validation complète de votre demande ${demande.reference}. Motif : ${parsedMotif.data}`,
    lien: `/treso/demandes/${demandeId}`,
    priority: "CRITIQUE",
    category: "TRESORERIE",
  });

  return {
    status: "success",
    message: `Examen de la demande ${demande.reference} : motif de rejet enregistré.`,
  };
}

/**
 * Annule une approbation DG déjà donnée (le DG s'est trompé, ou revient sur
 * sa décision). Contrairement au rejet ci-dessus, cette action modifie bien
 * la `Demande` — elle redevient éligible à la clôture uniquement après une
 * nouvelle approbation — mais **jamais en supprimant ou en réécrivant
 * l'entrée `validation_complete_dg` d'origine** : celle-ci reste intacte et
 * visible dans l'historique, la nouvelle entrée `annulation_validation_complete`
 * vient s'ajouter à la suite. L'historique complet permet ainsi de
 * reconstituer : approuvé le [date] par [DG], puis annulé le [date] par
 * [DG] avec motif [X] — jamais un état réécrit silencieusement.
 *
 * Refusée si la demande est déjà `CLOTUREE` : la clôture a été actée sur la
 * base de cette approbation (voir `cloturerDemandeAction`, qui exige
 * `validationCompleteParDG` avant d'accepter) — l'annuler après coup
 * casserait la cohérence d'une clôture déjà définitive. Aucun autre statut
 * n'est bloqué : `peutEffectuerReglement`/le circuit de règlement des
 * Phases B/C ne dépendent jamais de `validationCompleteParDG`, annuler
 * l'approbation ne défait donc aucun règlement déjà confirmé.
 */
export async function annulerValidationCompleteAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifValidationCompleteSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (!demande.validationCompleteParDG) {
    return { status: "error", message: "Cette demande n'a pas encore été approuvée." };
  }
  if (demande.statut === "CLOTUREE") {
    return {
      status: "error",
      message: "Impossible d'annuler : la demande a déjà été clôturée sur la base de cette approbation.",
    };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { validationCompleteParDG: false, dgApprobateurId: null, dgApprouveAt: null },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "annulation_validation_complete",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);
  revalidatePath("/treso/finance/validations-attente");

  await notifyByPermission("treso.valider_demande", {
    titre: "Validation complète annulée par le DG",
    message: `Le DG a annulé son approbation de validation complète sur la demande ${demande.reference}. Motif : ${parsedMotif.data}`,
    lien: `/treso/finance/demandes/${demandeId}`,
    excludeUserId: session.user.id,
    priority: "IMPORTANT",
    category: "TRESORERIE",
  });

  return {
    status: "success",
    message: `Approbation annulée pour la demande ${demande.reference} — retour en attente de validation complète.`,
  };
}
