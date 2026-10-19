"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import {
  libelleMotifReglement,
  motifPourModification,
  nettoyerMotifReglement,
  prisma,
  refusMotifReglement,
  refusExecutionPropreReglement,
  refusExecutionPropreSurReglement,
  type ArticleReglable,
  type Prisma,
} from "backend";
import { remettreChronoDemande } from "backend";
import {
  allocationsReglementArticle,
  calculerStatutDemande,
  getBudgetsCategoriesEnVigueur,
  getResteARegler,
  getSoldeCaisse,
  getTotalRegle,
  peutEffectuerReglement,
  verdictReglementArticle,
} from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

/** Gel du règlement après un rejet de la validation complète par le DG
 * (voir CLAUDE.md "Le rejet DG gèle le règlement") — création, modification
 * et confirmation ; l'annulation d'un règlement déjà confirmé, la
 * consultation et les retours de caisse ne sont volontairement PAS bloqués. */
const MESSAGE_GEL_REJET_DG =
  "Rejetée par le DG — en attente de resoumission par Finance : aucun règlement possible pour l'instant.";

const montantSchema = z.coerce.number().positive("Le montant doit être supérieur à 0");
const modeSchema = z.enum(["CAISSE", "BANQUE"]);
/** Articles d'une demande, vus sous l'angle du règlement (lot D : un règlement = un article). */
function articlesReglables(
  lignes: { id: string; libelle: string; quantite: number; prixUnitaire: Prisma.Decimal; statutValidation: "EN_ATTENTE" | "VALIDEE" | "REJETEE"; categorieId: string | null }[]
): ArticleReglable[] {
  return lignes.map((l) => ({
    id: l.id,
    libelle: l.libelle,
    quantite: l.quantite,
    prixUnitaire: Number(l.prixUnitaire),
    statutValidation: l.statutValidation,
    categorieId: l.categorieId,
  }));
}

function revalidateDemande(demandeId: string) {
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance/demandes");
  revalidatePath("/treso/demandes");
  // Ticket 8 : le dashboard Finance (et ses listes filtrées "à décaisser" /
  // "à régulariser") dépend du montant réglé — revalider tout l'espace
  // Finance en une fois (`type: "layout"` couvre toutes les routes sous
  // `finance/layout.tsx`) plutôt que d'énumérer chaque sous-route une à une.
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();
}

const creerReglementSchema = z.object({
  demandeId: z.string().min(1),
  /** Article réglé (lot D : un règlement = un article). Absent pour une demande sans article (dépense directe). */
  ligneDemandeId: z.string().min(1).optional(),
  montant: montantSchema,
  mode: modeSchema,
  /** Lot I : motif / nature du règlement, obligatoire (5 caractères minimum) pour tout NOUVEAU règlement. */
  motif: z.string().superRefine((v, ctx) => {
    const refus = refusMotifReglement(v);
    if (refus) ctx.addIssue({ code: "custom", message: refus });
  }),
});

/**
 * Crée un règlement en brouillon (`estConfirme: false`). Réservée à
 * `treso.effectuer_reglement`. Le montant ne peut pas dépasser le reste à
 * régler — revérifié ici même si le formulaire ne devrait normalement pas
 * le permettre (le reste à régler a pu changer depuis l'affichage de la
 * page : autre règlement confirmé entre-temps par un collègue).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : l'éligibilité
 * n'est plus liée au statut `VALIDEE` (ni à `STATUTS_VALIDATION_COMPLETE`),
 * mais à `peutEffectuerReglement` — `montantValide > 0` ET reste à régler
 * (calculé sur `montantValide`, pas le montant demandé) `> 0`. Une demande
 * `PARTIELLEMENT_VALIDEE` est donc éligible dès sa validation partielle,
 * sans attendre le reliquat (cahier des charges section 4).
 *
 * **Allocation budgétaire explicite par catégorie** (voir CLAUDE.md
 * "Catégorisation par ligne") : `construireAllocations` détermine et
 * valide la répartition (transparente si une seule catégorie concernée,
 * champs `alloc_<categorieId>` du formulaire sinon) — créée dans la MÊME
 * transaction que le `Reglement` (écriture nested Prisma), jamais en deux
 * temps séparés.
 */
export async function creerReglementAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = creerReglementSchema.safeParse({
    demandeId: formData.get("demandeId"),
    ligneDemandeId: formData.get("ligneDemandeId") || undefined,
    montant: formData.get("montant"),
    mode: formData.get("mode"),
    motif: formData.get("motif") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, ligneDemandeId, montant, mode } = parsed.data;
  const motif = nettoyerMotifReglement(parsed.data.motif);

  const demande = await prisma.demande.findUnique({ where: { id: demandeId }, include: { lignes: true, reglements: true } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.validationCompleteRejeteeParDG) {
    return { status: "error", message: MESSAGE_GEL_REJET_DG };
  }
  // Un règlement = un article (lot D) : l'article doit être validé, la demande sans règlement non rattaché, et le
  // montant tenir dans le reste à régler de CET article.
  const verdict = verdictReglementArticle({
    articles: articlesReglables(demande.lignes),
    reglements: demande.reglements,
    ligneDemandeId,
    montant,
  });
  if (!verdict.ok) {
    return {
      status: "error",
      message: verdict.champ === "montant" ? "Le formulaire contient des erreurs." : verdict.message,
      fieldErrors: verdict.champ === "montant" ? { montant: verdict.message } : undefined,
    };
  }
  const ligne = verdict.ligne ? demande.lignes.find((l) => l.id === verdict.ligne!.id)! : null;
  // Conflit d'intérêts, par article : jamais l'exécution de l'argent de sa propre demande ou de son propre article.
  const refusPropre = refusExecutionPropreReglement(demande, ligne, session.user.id);
  if (refusPropre) {
    return { status: "error", message: refusPropre };
  }

  // `demande`/`totalRegle` déjà chargés ici : transmis à `peutEffectuerReglement`/`getResteARegler` pour leur éviter de
  // refaire le même `findUnique`/`aggregate` (voir CLAUDE.md "Diagnostic de latence — requêtes redondantes").
  const totalRegle = await getTotalRegle(demandeId);
  if (!(await peutEffectuerReglement(demandeId, demande, totalRegle))) {
    return {
      status: "error",
      message: "Cette demande n'est pas éligible au règlement (aucun montant validé restant à régler).",
    };
  }
  // Demande sans article (dépense directe) : le plafond reste celui de la demande.
  if (!ligne) {
    const reste = await getResteARegler(demandeId, demande.montantValide, totalRegle);
    if (montant > reste) {
      return {
        status: "error",
        message: "Le formulaire contient des erreurs.",
        fieldErrors: { montant: `Le montant dépasse le reste à régler (${reste.toLocaleString("fr-FR")} FCFA).` },
      };
    }
  }

  await prisma.reglement.create({
    data: {
      demandeId,
      ligneDemandeId: ligne?.id ?? null,
      montant,
      mode,
      motif,
      auteurId: session.user.id,
      allocations: { create: allocationsReglementArticle(ligne, demande.categorieId, montant) },
    },
  });

  revalidateDemande(demandeId);

  return { status: "success", message: "Règlement créé (brouillon)." };
}

/**
 * Modifie le montant/mode d'un règlement NON confirmé et NON annulé. Mêmes validations que la création (l'article d'un
 * règlement ne change jamais). Appelée directement depuis un composant client (pas via `<form action={...}>`), comme
 * les actions valider/rejeter du Ticket 3.
 *
 * **Les allocations existantes sont entièrement remplacées** (jamais fusionnées) : le montant total ayant pu changer,
 * l'ancienne répartition n'a plus de sens à conserver telle quelle ; elle est recalculée (100 % vers la catégorie de
 * l'article, lot D).
 */
export async function modifierReglementAction(
  reglementId: string,
  montant: number,
  mode: "CAISSE" | "BANQUE",
  motif?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantSchema.safeParse(montant);
  const parsedMode = modeSchema.safeParse(mode);
  if (!parsedMontant.success || !parsedMode.success) {
    return { status: "error", message: "Montant ou mode invalide." };
  }

  const reglement = await prisma.reglement.findUnique({ where: { id: reglementId } });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (reglement.estConfirme || reglement.estAnnule) {
    return { status: "error", message: "Ce règlement n'est plus modifiable." };
  }
  // Lot I : un brouillon qui a un motif en garde un valide ; un brouillon antérieur (sans motif) n'est jamais bloqué.
  const verdictMotif = motifPourModification(reglement.motif, motif);
  if (!verdictMotif.ok) return { status: "error", message: verdictMotif.message };

  const demande = await prisma.demande.findUnique({ where: { id: reglement.demandeId }, include: { lignes: true, reglements: true } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.validationCompleteRejeteeParDG) {
    return { status: "error", message: MESSAGE_GEL_REJET_DG };
  }
  // L'article d'un règlement ne change jamais : seuls le montant et le mode sont modifiables.
  const verdict = verdictReglementArticle({
    articles: articlesReglables(demande.lignes),
    reglements: demande.reglements,
    ligneDemandeId: reglement.ligneDemandeId,
    montant: parsedMontant.data,
  });
  if (!verdict.ok) {
    return { status: "error", message: verdict.message };
  }
  const ligne = verdict.ligne ? demande.lignes.find((l) => l.id === verdict.ligne!.id)! : null;
  const refusPropre = refusExecutionPropreReglement(demande, ligne, session.user.id);
  if (refusPropre) return { status: "error", message: refusPropre };

  const totalRegle = await getTotalRegle(reglement.demandeId);
  if (!(await peutEffectuerReglement(reglement.demandeId, demande, totalRegle))) {
    return { status: "error", message: "Cette demande n'est plus éligible au règlement : modification impossible." };
  }
  if (!ligne) {
    const reste = await getResteARegler(reglement.demandeId, demande.montantValide, totalRegle);
    if (parsedMontant.data > reste) {
      return {
        status: "error",
        message: `Le montant dépasse le reste à régler (${reste.toLocaleString("fr-FR")} FCFA).`,
      };
    }
  }

  // Le montant total a pu changer : l'allocation budgétaire (100 % vers la catégorie de l'article) est recalculée.
  await prisma.$transaction([
    prisma.reglement.update({
      where: { id: reglementId },
      data: { montant: parsedMontant.data, mode: parsedMode.data, motif: verdictMotif.motif ?? reglement.motif },
    }),
    prisma.reglementCategorieAllocation.deleteMany({ where: { reglementId } }),
    prisma.reglementCategorieAllocation.createMany({
      data: allocationsReglementArticle(ligne, demande.categorieId, parsedMontant.data).map((a) => ({ ...a, reglementId })),
    }),
  ]);

  revalidateDemande(reglement.demandeId);

  return { status: "success", message: "Règlement modifié." };
}

/**
 * Confirme un règlement en brouillon. Réservée à `treso.effectuer_reglement`.
 *
 * Défense en profondeur : revérifie l'éligibilité au règlement
 * (`peutEffectuerReglement`, Phase C), que le règlement n'est ni déjà
 * confirmé ni annulé, et recalcule côté serveur que la confirmation ne
 * ferait pas dépasser **`montantValide`** (jamais le montant demandé, ni
 * confiance dans l'UI), puis, pour CHAQUE allocation budgétaire du
 * règlement (voir CLAUDE.md "Allocation budgétaire explicite par
 * règlement" — une par catégorie concernée, déjà fixée à la création/
 * modification, jamais recalculée ici), que sa Catégorie ne dépasserait
 * pas son budget PARTAGÉ (`budgetAlloue`, `null` = illimité). **Chaque
 * catégorie a un budget strictement indépendant** : si UNE seule catégorie
 * dépasse, la confirmation ENTIÈRE est refusée (jamais de confirmation
 * partielle catégorie par catégorie — un `Reglement` reste un évènement
 * financier atomique), avec un message nommant PRÉCISÉMENT chaque
 * catégorie en cause. Si `mode = CAISSE`, l'écriture `JournalCaisse`
 * (SORTIE) est créée dans la même transaction que la confirmation — les
 * deux réussissent ou échouent ensemble. Un règlement BANQUE n'a
 * strictement aucun effet sur `JournalCaisse`.
 *
 * `confirmeAt` (Ticket 9) enregistre la date de confirmation elle-même,
 * distincte de `createdAt` (date de création du brouillon) — c'est cette
 * date qui doit apparaître sur le reçu PDF, jamais la date du brouillon.
 *
 * Phase C, Tâche 3 : appelle `calculerStatutDemande` en fin d'action —
 * fait passer le statut à `PARTIELLEMENT_REGLEE`/`REGLEE` (ou laisse
 * `PARTIELLEMENT_VALIDEE` inchangé si la demande n'est pas encore
 * entièrement validée, voir `calculerStatutDemande`).
 */
export async function confirmerReglementAction(reglementId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const reglement = await prisma.reglement.findUnique({
    where: { id: reglementId },
    include: { allocations: { include: { categorie: true } } },
  });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (reglement.estConfirme) {
    return { status: "error", message: "Ce règlement est déjà confirmé." };
  }
  if (reglement.estAnnule) {
    return { status: "error", message: "Ce règlement est annulé, il ne peut pas être confirmé." };
  }

  // Demande + total réglé chargés UNE SEULE FOIS ici, puis transmis à `peutEffectuerReglement` (au lieu de la laisser les
  // refetcher elle-même en interne, voir CLAUDE.md "Diagnostic de latence — requêtes redondantes").
  const demande = await prisma.demande.findUniqueOrThrow({ where: { id: reglement.demandeId }, include: { lignes: true, reglements: true } });
  if (demande.validationCompleteRejeteeParDG) {
    return { status: "error", message: MESSAGE_GEL_REJET_DG };
  }
  // Un règlement = un article (lot D) : l'article reste validé, aucun règlement non rattaché sur la demande, et le total
  // confirmé de l'article + ce règlement ne dépasse pas son montant validé.
  const verdict = verdictReglementArticle({
    articles: articlesReglables(demande.lignes),
    reglements: demande.reglements,
    ligneDemandeId: reglement.ligneDemandeId,
    montant: Number(reglement.montant),
  });
  if (!verdict.ok) {
    return { status: "error", message: verdict.message };
  }
  const ligne = verdict.ligne ? demande.lignes.find((l) => l.id === verdict.ligne!.id)! : null;
  // Conflit d'intérêts, par article : jamais l'exécution de l'argent de sa propre demande ou de son propre article.
  const refusPropre = refusExecutionPropreReglement(demande, ligne, session.user.id);
  if (refusPropre) {
    return { status: "error", message: refusPropre };
  }
  const totalConfirme = await getTotalRegle(reglement.demandeId);

  if (!(await peutEffectuerReglement(reglement.demandeId, demande, totalConfirme))) {
    return { status: "error", message: "Cette demande n'est plus éligible au règlement : confirmation impossible." };
  }

  const montantReglement = Number(reglement.montant);
  if (totalConfirme + montantReglement > Number(demande.montantValide)) {
    return {
      status: "error",
      message: "Ce règlement dépasserait le montant validé de la demande — confirmation refusée.",
    };
  }

  // Allocation budgétaire explicite par catégorie (voir CLAUDE.md
  // "Allocation budgétaire explicite par règlement") : contrôle bloquant
  // au RÈGLEMENT, jamais à la validation — c'est le moment où l'argent
  // sort réellement. Aucune limite ne s'applique à une allocation dont la
  // Catégorie n'a pas de `budgetAlloue` défini (`null` = illimité). Le
  // règlement en cours d'écriture n'est encore QUE brouillon
  // (`estConfirme: false`) au moment de ce calcul — jamais besoin de
  // l'exclure explicitement de la consommation déjà existante, il n'y
  // contribue pas encore (`getMontantConsommeCategorie` filtre déjà
  // `estConfirme: true`).
  //
  // **Chaque catégorie est vérifiée INDÉPENDAMMENT** : la liste complète
  // des dépassements est collectée avant de refuser, pour que le message
  // nomme TOUTES les catégories en cause en une seule fois (jamais
  // seulement la première trouvée) — et pour que, si aucune catégorie ne
  // dépasse, aucune n'ait été touchée par un test partiel.
  // Lot J : le budget d'une catégorie est celui EN VIGUEUR (paramétrage validé par le DG, depuis sa date d'effet), plus
  // `Categorie.budgetAlloue`. Règle inchangée : consommé au règlement, confirmation refusée si l'allocation dépasse le reste.
  const budgetsEnVigueur = await getBudgetsCategoriesEnVigueur();
  const depassements: string[] = [];
  for (const allocation of reglement.allocations) {
    const enVigueur = budgetsEnVigueur[allocation.categorieId];
    if (!enVigueur) continue;
    const restantAvantCeReglement = enVigueur.restant;
    const montantAlloue = Number(allocation.montant);
    if (montantAlloue > restantAvantCeReglement) {
      depassements.push(
        `« ${allocation.categorie.label} » (${montantAlloue.toLocaleString("fr-FR")} FCFA alloués, ${Math.max(0, restantAvantCeReglement).toLocaleString("fr-FR")} FCFA restants)`
      );
    }
  }
  if (depassements.length > 0) {
    return {
      status: "error",
      message: `Ce règlement dépasse le budget disponible pour : ${depassements.join(" ; ")} — confirmation refusée pour l'ensemble du règlement. Ajustez la répartition et resoumettez.`,
    };
  }

  // Solde de caisse disponible — contrôle bloquant uniquement pour un
  // règlement CAISSE (un règlement BANQUE n'impacte jamais la caisse,
  // voir CLAUDE.md règle impérative n°3) : réutilise `getSoldeCaisse()`,
  // la même fonction que le dashboard Finance/`SoldeCaisseTrendChart`,
  // jamais un second calcul. Le règlement en cours de confirmation est
  // encore `estConfirme: false` à ce stade, donc pas encore comptabilisé
  // dans le solde retourné — comparaison directe sans avoir besoin de
  // l'exclure explicitement.
  if (reglement.mode === "CAISSE") {
    const soldeDisponible = await getSoldeCaisse();
    if (montantReglement > soldeDisponible) {
      return {
        status: "error",
        message: `Solde de caisse insuffisant : ${soldeDisponible.toLocaleString("fr-FR")} FCFA disponibles pour un règlement de ${montantReglement.toLocaleString("fr-FR")} FCFA — réalimentez la caisse (« Nouvelle alimentation de caisse ») avant de confirmer.`,
      };
    }
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.reglement.update({
      where: { id: reglementId },
      data: { estConfirme: true, confirmeAt: new Date() },
    }),
    ...(reglement.mode === "CAISSE"
      ? [
          prisma.journalCaisse.create({
            data: {
              type: "SORTIE",
              montant: reglement.montant,
              source: "reglement_caisse",
              refId: reglementId,
              // Traçabilité (section 13) : la demande concernée, et
              // l'utilisateur qui a déclenché cette SORTIE — l'auteur du
              // règlement, pas forcément celui qui le confirme (Ticket 4 :
              // aucune contrainte sur qui confirme un règlement créé par
              // un autre utilisateur Finance).
              demandeId: reglement.demandeId,
              userId: reglement.auteurId,
            },
          }),
        ]
      : [
          // Règlement BANQUE : écriture de traçabilité UNIQUEMENT (aucun solde
          // banque, aucun contrôle de disponibilité — voir CLAUDE.md "Retour
          // sur règlement Banque"), jamais dans `JournalCaisse`.
          prisma.journalBanque.create({
            data: {
              type: "SORTIE",
              montant: reglement.montant,
              reglementId,
              creeParId: reglement.auteurId,
            },
          }),
        ]),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "reglement",
        detail: `Règlement confirmé : ${montantReglement.toLocaleString("fr-FR")} FCFA (${reglement.mode})${ligne ? ` — article « ${ligne.libelle} »` : ""} — motif : ${libelleMotifReglement(reglement.motif)}`,
        userId: session.user.id,
      },
    }),
  ];
  await prisma.$transaction(operations);

  await calculerStatutDemande(reglement.demandeId);
  await remettreChronoDemande(reglement.demandeId);
  revalidateDemande(reglement.demandeId);

  // Un règlement Caisse confirmé ouvre le droit à déclarer un retour de caisse (Ticket 5) — un règlement Banque n'a pas de
  // déclaration de retour (lot G bis : la Finance enregistre son retour en retour externe), donc aucune notification.
  if (reglement.mode === "CAISSE") {
    await notify({
      userId: demande.createurId,
      titre: "Retour de caisse à déclarer",
      message: `Le règlement de ${montantReglement.toLocaleString("fr-FR")} FCFA (Caisse)${ligne ? ` pour l'article « ${ligne.libelle} »` : ""} sur votre demande ${demande.reference} est confirmé — vous pouvez déclarer le retour de caisse correspondant.`,
      lien: `/treso/demandes/${reglement.demandeId}`,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  }

  return { status: "success", message: "Règlement confirmé." };
}

const motifAnnulationSchema = z
  .string()
  .trim()
  .min(3, "Le motif de l'annulation est obligatoire (3 caractères minimum)");

/**
 * Annule un règlement confirmé.
 *
 * **Réservée au Responsable Finance UNIQUEMENT** (Tâche "Annulation d'un
 * règlement après reçu réservée au Responsable", voir CLAUDE.md) — même
 * garde exacte que `validerLignesAction` (`treso.valider_demande` ET PAS
 * `treso.approuver_validation_complete`), jamais `treso.effectuer_reglement`
 * (retiré ici volontairement). Cette action n'opère de toute façon QUE sur
 * un règlement déjà `estConfirme` (voir le contrôle plus bas) : l'Assistant
 * Finance garde tous ses droits normaux (`treso.effectuer_reglement`,
 * inchangé) sur le cycle de création/modification/confirmation d'un
 * règlement encore en cours — seule l'ANNULATION d'un règlement déjà
 * confirmé (reçu déjà généré/téléchargeable) lui est désormais retirée, au
 * profit exclusif du Responsable Finance qui a validé la dépense d'origine.
 *
 * Jamais de suppression ni d'édition silencieuse (règle impérative) :
 * l'écriture SORTIE d'origine (si `CAISSE`) n'est ni modifiée ni
 * supprimée — une écriture ENTREE compensatoire neutralise son effet sur
 * le solde, dans le grand livre immuable `JournalCaisse`. Le règlement
 * annulé reste visible dans la liste (statut "Annulé"), jamais supprimé.
 *
 * Défense en profondeur (Ticket 7) : revérifie que la demande n'est ni
 * `CLOTUREE` ni `REJETEE` — une fois clôturée, plus aucune action sur ses
 * règlements n'est possible, y compris une annulation (`estConfirme` ne
 * change jamais après clôture, ce n'était donc pas suffisant à lui seul).
 *
 * **Volontairement PAS `peutEffectuerReglement` ici** (Phase C) : cette
 * garde exigerait un reste à régler > 0 AVANT l'annulation, ce qui
 * bloquerait à tort l'annulation du tout dernier règlement d'une demande
 * `REGLEE` (reste = 0 par définition) — l'annulation est précisément le
 * mécanisme qui doit pouvoir faire repasser le reste au-dessus de 0.
 *
 * Phase C, Tâche 3 : appelle `calculerStatutDemande` en fin d'action — fait
 * revenir le statut à `PARTIELLEMENT_REGLEE`/`VALIDEE_NON_REGLEE` (ou
 * laisse `PARTIELLEMENT_VALIDEE` inchangé) selon le nouveau total réglé.
 */
export async function annulerReglementAction(
  reglementId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.annuler_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifAnnulationSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const reglement = await prisma.reglement.findUnique({ where: { id: reglementId }, include: { demande: { include: { lignes: true } } } });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (!reglement.estConfirme) {
    return { status: "error", message: "Seul un règlement confirmé peut être annulé." };
  }
  if (reglement.estAnnule) {
    return { status: "error", message: "Ce règlement est déjà annulé." };
  }
  if (reglement.demande.statut === "CLOTUREE" || reglement.demande.statut === "REJETEE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${reglement.demande.statut}).`,
    };
  }
  const refusPropre = refusExecutionPropreSurReglement(reglement, session.user.id);
  if (refusPropre) {
    return { status: "error", message: refusPropre };
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.reglement.update({
      where: { id: reglementId },
      data: { estAnnule: true, motifAnnulation: parsedMotif.data },
    }),
    ...(reglement.mode === "CAISSE"
      ? [
          prisma.journalCaisse.create({
            data: {
              type: "ENTREE",
              montant: reglement.montant,
              source: "annulation_reglement_caisse",
              refId: reglementId,
              // Traçabilité (section 13) : cette écriture compensatoire est
              // déclenchée par l'utilisateur qui annule, pas par l'auteur du
              // règlement d'origine (déjà tracé sur la SORTIE initiale).
              demandeId: reglement.demandeId,
              userId: session.user.id,
            },
          }),
        ]
      : [
          prisma.journalBanque.create({
            data: { type: "ANNULATION", montant: reglement.montant, reglementId, creeParId: session.user.id },
          }),
        ]),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "annulation_reglement",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ];
  await prisma.$transaction(operations);

  await calculerStatutDemande(reglement.demandeId);
  await remettreChronoDemande(reglement.demandeId);
  revalidateDemande(reglement.demandeId);

  return { status: "success", message: "Règlement annulé." };
}
