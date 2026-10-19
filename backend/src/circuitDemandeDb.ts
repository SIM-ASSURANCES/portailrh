// Circuit de validation des demandes (commit 3, 2026-10-06) — application en base des transitions décidées par le
// moteur pur (`circuitDemande.ts`). Toujours dans la transaction de l'appelant ; chaque changement d'étape est
// conditionné à l'étape lue (deux décisions simultanées : une seule passe) et tracé dans `HistoriqueEntry`.

import { ajoutsPourArticles, controlerBudgetValidation } from "./budgetsDb";
import { snapshotBudgetLigne, type PrevisionBudget } from "./budgets";
import { Prisma } from "./generated/prisma/client";
import type { EtapeCircuit, NiveauRejet } from "./generated/prisma/enums";
import {
  determinerParcours,
  etapeInitiale,
  etatLigneDG,
  LIBELLE_ETAPE_CIRCUIT,
  refusExecutionPropreDemande,
  refusExecutionPropreReglement,
  versDemandeCircuit,
  type OptionsParcours,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,
  type Parcours,
  type ProfilDemandeur,
  type TypeDemandeCircuit,
} from "./circuitDemande";
import { montantValideDepuisLignes } from "./etatArticles";
import { categorisationEstObligatoire } from "./parametresTresorerie";
import { refusMotifLigne } from "./motifLigne";
import { dateLivraisonAEnregistrer, jourCourant, jourDepuisDate, refusDateLivraison, versDateStockee } from "./dateLivraisonArticle";
import { champsBeneficiaire, type ChoixBeneficiaire } from "./beneficiaire";
import { beneficiaireArticle, choixDepuisStocke, choixPropreArticle } from "./beneficiaireArticles";

type Db = Prisma.TransactionClient;

/**
 * Demandes à l'étape Service dont le compte est le responsable ACTUEL du service du demandeur (jamais celles d'un
 * autre service) : page « Demandes de mon service » et compteur du menu.
 */
export function demandesServiceAValiderWhere(responsableId: string): Prisma.DemandeWhereInput {
  return { etapeCircuit: "SERVICE", createur: { service: { responsableId } } };
}

/** Étapes posées explicitement par le circuit : une demande qui y est n'attend ni la Finance ni le DG sur ses articles. */
const ETAPES_HORS_ARTICLES: EtapeCircuit[] = ["SERVICE", "A_CORRIGER", "ABANDONNEE"];

/**
 * Demandes qui attendent la décision de CE compte DG (lot B : requête sur les ARTICLES, plus sur l'étape de la colonne) :
 *  - articles soumis par la Finance et sans décision du DG (même quand la Finance a d'autres articles à traiter) ;
 *  - demande émise par la Finance (cas b, DG obligatoire) dont des articles sont encore en attente ;
 *  - demande sans article (dépense directe) à l'étape DG.
 * Jamais les demandes du DG lui-même (une demande du DG ne passe jamais par l'étape DG).
 */
export function demandesEtapeDGWhere(dgId: string): Prisma.DemandeWhereInput {
  const horsService = { etapeCircuit: { notIn: ETAPES_HORS_ARTICLES } };
  return {
    createurId: { not: dgId },
    OR: [
      { etapeCircuit: "DG", lignes: { none: {} } },
      { ...horsService, lignes: { some: { statutValidation: "EN_ATTENTE", soumiseAuDG: true, decisionDG: null } } },
      { ...horsService, modeEtapeDG: "OBLIGATOIRE", lignes: { some: { statutValidation: "EN_ATTENTE" } } },
    ],
  };
}

/**
 * Gardes de conflit d'intérêts (2026-10-07) : retrouve la demande à partir de l'objet visé (règlement, retour de
 * caisse, ligne de dépense, remboursement, retour exceptionnel) et renvoie le refus si `userId` en est le demandeur
 * ou le bénéficiaire (`refusExecutionPropreDemande`), sinon `null`. Objet introuvable : `null` (l'action le refuse
 * ensuite avec son propre message).
 */
export async function refusConflitInteret(
  db: Db,
  cible:
    | { demandeId: string; ligneDemandeId?: string | null }
    | { reglementId: string }
    | { retourCaisseId: string }
    | { depenseLigneId: string }
    | { remboursementId: string }
    | { retourExceptionnelId: string },
  userId: string
): Promise<string | null> {
  // Garde 8 étendue aux articles (lot A, 2026-10-14) : on lit aussi le bénéficiaire propre de chaque article.
  // Lot D (2026-10-16) : un règlement rattaché à un article n'écarte que le créateur et le bénéficiaire de CET article.
  const champsBenef = { beneficiaireType: true, beneficiaireUserId: true, beneficiaireNom: true } as const;
  const champs = {
    createurId: true,
    ...champsBenef,
    lignes: { select: champsBenef },
  } as const;
  const champsReglement = { demande: { select: champs }, ligneDemande: { select: champsBenef } } as const;
  type Demande = Parameters<typeof refusExecutionPropreDemande>[0];
  type Reglement = { demande: Demande; ligneDemande: Parameters<typeof refusExecutionPropreReglement>[1] };
  let demande: Demande | null | undefined = null;
  let reglement: Reglement | null | undefined = null;
  if ("demandeId" in cible) {
    // Lot E : une saisie rattachée à un article (retour exceptionnel) n'écarte que le créateur et le bénéficiaire de CET article.
    if (cible.ligneDemandeId) {
      const ligne = await db.ligneDemande.findFirst({
        where: { id: cible.ligneDemandeId, demandeId: cible.demandeId },
        select: { ...champsBenef, demande: { select: champs } },
      });
      if (ligne) reglement = { demande: ligne.demande, ligneDemande: ligne };
    }
    if (!reglement) demande = await db.demande.findUnique({ where: { id: cible.demandeId }, select: champs });
  } else if ("reglementId" in cible) {
    reglement = await db.reglement.findUnique({ where: { id: cible.reglementId }, select: champsReglement });
  } else if ("retourCaisseId" in cible) {
    reglement = (await db.retourCaisse.findUnique({ where: { id: cible.retourCaisseId }, select: { reglement: { select: champsReglement } } }))
      ?.reglement;
  } else if ("depenseLigneId" in cible) {
    reglement = (
      await db.depenseLigne.findUnique({
        where: { id: cible.depenseLigneId },
        select: { retourCaisse: { select: { reglement: { select: champsReglement } } } },
      })
    )?.retourCaisse.reglement;
  } else if ("remboursementId" in cible) {
    reglement = (
      await db.remboursementRetour.findUnique({
        where: { id: cible.remboursementId },
        select: { retourCaisse: { select: { reglement: { select: champsReglement } } } },
      })
    )?.retourCaisse.reglement;
  } else {
    const re = await db.retourExceptionnel.findUnique({
      where: { id: cible.retourExceptionnelId },
      select: { demande: { select: champs }, ligneDemande: { select: champsBenef } },
    });
    // Lot E : retour exceptionnel rattaché à un article = garde 8 de CET article ; sinon (ancien) celle de la demande.
    if (re?.ligneDemande) reglement = { demande: re.demande, ligneDemande: re.ligneDemande };
    else demande = re?.demande;
  }
  if (reglement) return refusExecutionPropreReglement(reglement.demande, reglement.ligneDemande, userId);
  return demande ? refusExecutionPropreDemande(demande, userId) : null;
}

/** Nom du service dont les membres suivent le cas (b) (décision du 2026-10-06). Un nom de SERVICE, jamais de rôle. */
export const SERVICE_FINANCE = "Finance";

const NIVEAU_LIBELLE: Record<NiveauRejet, string> = { SERVICE: "Service", FINANCE: "Finance", DG: "DG" };

/** Profil du demandeur, d'après les permissions de son RÔLE (jamais les délégations) et son service. */
export async function chargerProfilDemandeur(db: Db, userId: string): Promise<ProfilDemandeur> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
      service: { select: { name: true, responsableId: true } },
    },
  });
  const cles = new Set(user?.role.permissions.map((rp) => rp.permission.key) ?? []);
  return {
    estDG: cles.has("treso.decider_dg"),
    estFinance:
      user?.service?.name === SERVICE_FINANCE ||
      cles.has("treso.decider_finance") ||
      cles.has("treso.effectuer_reglement") ||
      cles.has("treso.receptionner_retour"),
    estResponsableDeSonService: !!user?.service && user.service.responsableId === userId,
  };
}

/** Champs `Demande` du parcours (création et resoumission). */
export function champsParcours(p: Parcours) {
  return {
    etapeServiceRequise: p.etapeServiceRequise,
    etapeFinanceRequise: p.etapeFinanceRequise,
    modeEtapeDG: p.modeEtapeDG,
    approbationClotureNonRequise: p.approbationClotureNonRequise,
  };
}

const CAS_LIBELLE: Record<Parcours["cas"], string> = {
  DG: "demande émise par le DG — étape DG et approbation de clôture non requises",
  FINANCE: "demande émise par la Finance — étapes Service et Finance non requises, le DG décide",
  RESPONSABLE: "demandeur responsable de son service — étape Service non requise",
  AUTRE: "étapes Service puis Finance",
  DEPENSE_DIRECTE: "dépense directe saisie par la Finance — étape Service non requise (exception tracée)",
  DEPENSE_DIRECTE_POUR_SOI: "dépense directe saisie par la Finance pour elle-même — le DG décide (étapes Service et Finance non requises)",
};

/** Parcours et première étape d'une nouvelle demande, avec la ligne d'historique qui l'explique. */
export async function initialiserCircuit(
  db: Db,
  createurId: string,
  type: TypeDemandeCircuit,
  options: OptionsParcours = {}
): Promise<{
  data: ReturnType<typeof champsParcours> & { etapeCircuit: EtapeCircuit; etapeCircuitDepuis: Date };
  detail: string;
}> {
  const parcours = determinerParcours(await chargerProfilDemandeur(db, createurId), type, options);
  const etape = etapeInitiale(parcours);
  return {
    data: { ...champsParcours(parcours), etapeCircuit: etape, etapeCircuitDepuis: new Date() },
    detail: `Circuit : ${CAS_LIBELLE[parcours.cas]}. Première étape : ${LIBELLE_ETAPE_CIRCUIT[etape]}.`,
  };
}

/** Acteur du circuit pour une demande : ses permissions effectives et s'il est le responsable ACTUEL du service du
 *  demandeur. */
export async function chargerActeur(
  db: Db,
  session: { user: { id: string }; permissions: readonly string[] },
  createurId: string
): Promise<ActeurCircuit> {
  const createur = await db.user.findUnique({
    where: { id: createurId },
    select: { service: { select: { responsableId: true } } },
  });
  return {
    userId: session.user.id,
    permissions: session.permissions,
    estResponsableServiceDuDemandeur: createur?.service?.responsableId === session.user.id,
  };
}

const ACTION_HISTORIQUE: Record<ActionCircuit["type"], string> = {
  VALIDER_SERVICE: "validation_service",
  REJETER: "renvoi_correction",
  SOUMETTRE_DG: "soumission_dg",
  RESOUMETTRE_DG: "resoumission_dg",
  VALIDER_DG: "validation_dg",
  REJETER_DG: "rejet_dg",
  DECIDER_LIGNES: "decision_circuit",
  SOUMETTRE_LIGNES_DG: "soumission_lignes_dg",
  DECIDER_LIGNE_DG: "decision_ligne_dg",
  RESOUMETTRE_CORRECTION: "resoumission_correction",
  ABANDONNER: "abandon",
};

export type ResultatCircuit = { ok: true; etapeSuivante: EtapeCircuit } | { ok: false; message: string };

/** Champs d'une ligne lus par le circuit (soumission au DG ligne par ligne, 2026-10-10). */
export const SELECT_LIGNE_CIRCUIT = {
  id: true,
  libelle: true,
  categorieId: true,
  statutValidation: true,
  soumiseAuDG: true,
  decisionDG: true,
  decisionDGParId: true,
  decisionDGAt: true,
  decideurFinanceId: true,
  // Bénéficiaire propre de l'article (garde « le bénéficiaire ne décide pas son article »).
  beneficiaireType: true,
  beneficiaireUserId: true,
  beneficiaireNom: true,
} as const;

/**
 * Verrou de la demande pour la durée de la transaction : deux décisions simultanées sur des lignes différentes (ou une
 * soumission et une décision finale) se succèdent, et la seconde relit l'état laissé par la première — la dernière
 * ligne décidée par le DG rend toujours la main à la Finance.
 */
async function verrouillerDemande(db: Db, demandeId: string): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "Demande" WHERE "id" = ${demandeId} FOR UPDATE`;
}

const SELECT_DEMANDE_CIRCUIT = {
  etapeCircuit: true,
  createurId: true,
  typeDemande: true,
  etapeServiceRequise: true,
  etapeFinanceRequise: true,
  modeEtapeDG: true,
  dgApprobateurId: true,
  decideurFinanceId: true,
  beneficiaireType: true,
  beneficiaireUserId: true,
  beneficiaireNom: true,
  lignes: { select: SELECT_LIGNE_CIRCUIT, orderBy: { createdAt: "asc" } },
} as const;

const listeLibelles = (libelles: string[]) => libelles.map((l) => `« ${l} »`).join(", ");

/**
 * Applique une action du circuit (hors resoumission après correction, voir `corrigerEtResoumettre`). Les décisions
 * de lignes elles-mêmes sont écrites par l'appelant (`validerLignesAction`) dans la même transaction, avant cet appel.
 */
export async function appliquerTransitionCircuit(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  action: Exclude<ActionCircuit, { type: "RESOUMETTRE_CORRECTION" | "SOUMETTRE_LIGNES_DG" | "DECIDER_LIGNE_DG" }>
): Promise<ResultatCircuit> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };

  // Une demande à articles se décide article par article (`deciderArticles`) : jamais par cette voie.
  if (action.type === "DECIDER_LIGNES" && d.lignes.length > 0) {
    return { ok: false, message: "Cette demande contient des lignes d'article : utilisez la décision article par article." };
  }
  const r = transition(await demandeCircuit(db, d), acteur, action);
  if (!r.ok) return r;

  const maintenant = new Date();
  const motif = "motif" in action ? action.motif.trim() : null;
  const data: Prisma.DemandeUncheckedUpdateManyInput = { etapeCircuit: r.etapeSuivante, etapeCircuitDepuis: maintenant };
  if (r.effets.niveauRejet) {
    data.niveauRejet = r.effets.niveauRejet;
    data.motifRejet = motif ?? "Toutes les lignes ont été rejetées.";
  }
  if (r.effets.soumiseAuDG) data.soumiseAuDG = true;
  if (r.effets.approbationClotureParDG) {
    data.validationCompleteParDG = true;
    data.validationCompleteRejeteeParDG = false;
    // Règle 5 : le DG qui a validé les lignes (décision finale), sinon l'acteur lui-même (étape DG).
    data.dgApprobateurId = r.effets.approbateurDGId ?? acteur.userId;
    data.dgApprouveAt = maintenant;
  }
  if (r.effets.decideurFinance) data.decideurFinanceId = acteur.userId;
  if (action.type === "ABANDONNER") data.statut = "ABANDONNEE";

  // Changement conditionné à l'étape lue : une décision concurrente déjà passée fait échouer celle-ci.
  const maj = await db.demande.updateMany({ where: { id: demandeId, etapeCircuit: d.etapeCircuit }, data });
  if (maj.count !== 1) {
    return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };
  }

  const morceaux: string[] = [`${LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit]} → ${LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante]}`];
  if (r.effets.niveauRejet) morceaux.push(`niveau ${NIVEAU_LIBELLE[r.effets.niveauRejet]}`);
  if (motif) morceaux.push(`motif : ${motif}`);
  if (r.effets.approbationClotureParDG) morceaux.push("vaut approbation de clôture du DG");
  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: ACTION_HISTORIQUE[action.type],
      detail: morceaux.join(" — "),
      userId: acteur.userId,
    },
  });
  if (r.effets.decisionParAuteurDepenseDirecte) {
    await db.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "exception_depense_directe",
        detail: "Dépense directe décidée par son auteur (Finance) : exception au principe « personne ne décide sa propre demande ».",
        userId: acteur.userId,
      },
    });
  }
  return { ok: true, etapeSuivante: r.etapeSuivante };
}

/**
 * La Finance soumet des lignes au DG, ou lui resoumet des lignes qu'il a refusées (2026-10-10, règle 1 et 3). La
 * demande passe (ou reste) à l'étape DG ; seules les lignes soumises sont vues et décidées par le DG.
 */
export async function soumettreLignesAuDG(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  ligneIds: readonly string[]
): Promise<ResultatCircuit & { libelles?: string[]; resoumisIds?: string[] }> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };
  const circuit = await demandeCircuit(db, d);
  const lignes = circuit.lignes!;
  const r = transition(circuit, acteur, { type: "SOUMETTRE_LIGNES_DG", ligneIds });
  if (!r.ok) return r;

  const maintenant = new Date();
  const choisies = lignes.filter((l) => ligneIds.includes(l.id));
  const resoumises = choisies.filter((l) => etatLigneDG(l) === "REFUSEE_DG");

  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: d.etapeCircuit },
    // Lot B : chaque événement d'un article remet à zéro le chronomètre de rappel de la demande (étape déduite des articles).
    data: { etapeCircuit: r.etapeSuivante, soumiseAuDG: true, etapeCircuitDepuis: maintenant },
  });
  if (maj.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };
  const majLignes = await db.ligneDemande.updateMany({
    where: {
      id: { in: [...ligneIds] },
      demandeId,
      statutValidation: "EN_ATTENTE",
      OR: [{ soumiseAuDG: false }, { decisionDG: "REFUSEE" }],
    },
    data: {
      soumiseAuDG: true,
      soumiseDGAt: maintenant,
      soumiseDGParId: acteur.userId,
      decisionDG: null,
      decisionDGAt: null,
      decisionDGParId: null,
      motifRefusDG: null,
    },
  });
  if (majLignes.count !== ligneIds.length) return { ok: false, message: "Une ligne a changé entre-temps : rechargez la page." };

  const libelles = choisies.map((l) => l.libelle);
  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: ACTION_HISTORIQUE.SOUMETTRE_LIGNES_DG,
      detail:
        `${LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit]} → ${LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante]} — ${libelles.length} ligne${libelles.length > 1 ? "s" : ""} sur ` +
        `${lignes.length} soumise${libelles.length > 1 ? "s" : ""} au DG : ${listeLibelles(libelles)}` +
        (resoumises.length > 0 ? ` (resoumise${resoumises.length > 1 ? "s" : ""} après refus : ${listeLibelles(resoumises.map((l) => l.libelle))})` : ""),
      userId: acteur.userId,
    },
  });
  return { ok: true, etapeSuivante: r.etapeSuivante, libelles, resoumisIds: resoumises.map((l) => l.id) };
}

/**
 * Le DG décide une ligne soumise (2026-10-10, règle 2) : validée, ou refusée avec motif (elle revient à la Finance).
 * Quand plus aucune ligne n'attend le DG, la demande passe à la décision finale de la Finance.
 */
export async function deciderLigneDG(
  db: Db,
  ligneId: string,
  acteur: ActeurCircuit,
  decision: { valider: boolean; motif?: string; motifDepassement?: string | null }
): Promise<ResultatCircuit & { demandeId?: string; libelle?: string; budget?: PrevisionBudget }> {
  const ligne = await db.ligneDemande.findUnique({ where: { id: ligneId }, select: { demandeId: true } });
  if (!ligne) return { ok: false, message: "Ligne introuvable." };
  const demandeId = ligne.demandeId;
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };
  const circuit = await demandeCircuit(db, d);
  const lignes = circuit.lignes!;
  const motif = decision.motif?.trim() ?? "";
  const r = transition(circuit, acteur, { type: "DECIDER_LIGNE_DG", ligneId, valider: decision.valider, motif });
  if (!r.ok) return r;

  // Lot J : la validation du DG engage le budget (global et catégorie). Seuil rouge : le DG confirme lui-même, dans ce geste.
  let budget: PrevisionBudget | undefined;
  if (decision.valider) {
    const controle = await controlerBudgetValidation(db as Prisma.TransactionClient, {
      demandeId,
      ajouts: await ajoutsPourArticles(db, demandeId, [ligneId]),
      acteurId: acteur.userId,
      acteurEstDG: acteur.permissions.includes("treso.decider_dg"),
      motifConfirmation: decision.motifDepassement,
    });
    if (!controle.ok) return { ok: false, message: controle.message };
    budget = controle.prevision;
  }

  const maintenant = new Date();
  const majLigne = await db.ligneDemande.updateMany({
    where: { id: ligneId, soumiseAuDG: true, decisionDG: null },
    data: {
      decisionDG: decision.valider ? "VALIDEE" : "REFUSEE",
      decisionDGAt: maintenant,
      decisionDGParId: acteur.userId,
      motifRefusDG: decision.valider ? null : motif,
    },
  });
  if (majLigne.count !== 1) return { ok: false, message: "Cette ligne a déjà été décidée." };
  // Lot J : photo du budget après la validation du DG (posée une seule fois, jamais recalculée).
  if (budget) {
    const cat = await db.ligneDemande.findUnique({ where: { id: ligneId }, select: { categorieId: true } });
    const snap = snapshotBudgetLigne(budget, cat?.categorieId ?? null);
    if (snap) {
      await db.ligneDemande.updateMany({ where: { id: ligneId, budgetApresValidation: { equals: Prisma.DbNull } }, data: { budgetApresValidation: snap as unknown as Prisma.InputJsonValue } });
    }
  }
  // Lot B : étape déduite des articles, chronomètre de rappel remis à zéro à chaque décision d'un article.
  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: d.etapeCircuit },
    data: { etapeCircuit: r.etapeSuivante, etapeCircuitDepuis: maintenant },
  });
  if (maj.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };

  const libelle = lignes.find((l) => l.id === ligneId)!.libelle;
  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: decision.valider ? "validation_ligne_dg" : "refus_ligne_dg",
      detail:
        (decision.valider ? `DG — ligne « ${libelle} » validée` : `DG — ligne « ${libelle} » refusée — motif : ${motif}`) +
        (r.etapeSuivante !== d.etapeCircuit ? ` — ${LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit]} → ${LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante]}` : ""),
      userId: acteur.userId,
    },
  });
  return { ok: true, etapeSuivante: r.etapeSuivante, demandeId, libelle, budget };
}

export interface DecisionArticle {
  ligneId: string;
  statut: "VALIDEE" | "REJETEE";
  /** Motif du rejet (3 caractères minimum), ignoré pour une validation. */
  motif?: string;
}

export interface ResultatDecisionArticles {
  etapeSuivante: EtapeCircuit;
  /** Somme des articles validés après ces décisions (colonne `Demande.montantValide`, tenue à jour). */
  montantValide: number;
  nbValidees: number;
  nbRejetees: number;
  /** Prévisionnel budgétaire de ces validations (lot J) ; absent quand aucun article n'est validé. */
  budget?: PrevisionBudget;
}

const formaterMontant = (n: number) => n.toLocaleString("fr-FR");

/**
 * Décision article par article (lot B, 2026-10-15) : la Finance (ou le DG pour une demande émise par la Finance, cas b)
 * valide ou rejette un SOUS-ENSEMBLE d'articles, à n'importe quel moment, sans attendre les autres ni le DG. Un article
 * décidé est définitif. Dans la transaction de l'appelant : verrou de la demande, transition du moteur (qui contrôle
 * permissions, états des articles, deux personnes, bénéficiaire), écriture des articles et du décideur Finance de
 * chacun, recalcul du montant validé (somme des articles validés), étape déduite des articles, chronomètre de rappel
 * remis à zéro, historique. La catégorie obligatoire est contrôlée par l'appelant (`refusLignesValideesSansCategorie`).
 */
export async function deciderArticles(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  decisions: readonly DecisionArticle[],
  options: { motifDepassement?: string | null } = {}
): Promise<(ResultatDecisionArticles & { ok: true }) | { ok: false; message: string }> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };
  if (d.lignes.length === 0) {
    return { ok: false, message: "Cette demande n'a aucune ligne d'article — utilisez la validation par montant." };
  }
  for (const x of decisions) {
    if (x.statut === "REJETEE" && (x.motif?.trim().length ?? 0) < 3) {
      return { ok: false, message: "Un motif de rejet (3 caractères minimum) est obligatoire pour chaque ligne rejetée." };
    }
  }

  const circuit = await demandeCircuit(db, d);
  const r = transition(circuit, acteur, {
    type: "DECIDER_LIGNES",
    decisions: decisions.map((x) => ({ ligneId: x.ligneId, statut: x.statut })),
  });
  if (!r.ok) return r;

  // Lot J : budget global et de chaque catégorie après ces validations. Orange : on valide (alerte tracée, notifiée par
  // l'appelant). Rouge : bloqué sauf accord du DG — le DG qui valide le confirme lui-même (motif), la Finance a besoin d'une
  // confirmation déjà donnée. Les articles déjà validés par le DG sont déjà engagés : non recomptés à la confirmation de la Finance.
  const validees = decisions.filter((x) => x.statut === "VALIDEE").map((x) => x.ligneId);
  let budget: PrevisionBudget | undefined;
  if (validees.length > 0) {
    const controle = await controlerBudgetValidation(db as Prisma.TransactionClient, {
      demandeId,
      ajouts: await ajoutsPourArticles(db, demandeId, validees),
      acteurId: acteur.userId,
      acteurEstDG: acteur.permissions.includes("treso.decider_dg"),
      motifConfirmation: options.motifDepassement,
    });
    if (!controle.ok) return { ok: false, message: controle.message };
    budget = controle.prevision;
  }

  const roleDG = d.modeEtapeDG === "OBLIGATOIRE";
  const maintenant = new Date();
  const detail = new Map(
    (await db.ligneDemande.findMany({ where: { demandeId }, select: { id: true, quantite: true, prixUnitaire: true } })).map((l) => [l.id, l])
  );
  const parId = new Map(d.lignes.map((l) => [l.id, l]));

  // Les articles d'abord : un article décidé entre-temps (`statutValidation` plus EN_ATTENTE) fait échouer l'ensemble.
  for (const x of decisions) {
    const l = parId.get(x.ligneId)!;
    // Un article validé par le DG garde son auteur et sa date de décision (« DG définitif »).
    const parDG = x.statut === "VALIDEE" && l.decisionDG === "VALIDEE";
    const maj = await db.ligneDemande.updateMany({
      where: { id: x.ligneId, demandeId, statutValidation: "EN_ATTENTE" },
      data: {
        statutValidation: x.statut,
        motifRejet: x.statut === "REJETEE" ? x.motif!.trim() : null,
        decideParId: parDG ? l.decisionDGParId : acteur.userId,
        decideAt: parDG ? (l.decisionDGAt ?? maintenant) : maintenant,
        // Le décideur Finance n'est enregistré que pour une VALIDATION par la Finance (rejeter n'engage pas d'argent).
        ...(!roleDG && x.statut === "VALIDEE" ? { decideurFinanceId: acteur.userId } : {}),
      },
    });
    if (maj.count !== 1) return { ok: false, message: "Un article a été décidé entre-temps : rechargez la page." };
  }

  // Lot J : photo du budget après la validation de chaque article validé (posée une seule fois : la confirmation par la
  // Finance d'un article validé par le DG ne recalcule rien).
  if (budget) {
    for (const x of decisions.filter((d) => d.statut === "VALIDEE")) {
      const snap = snapshotBudgetLigne(budget, parId.get(x.ligneId)!.categorieId ?? null);
      if (snap) {
        await db.ligneDemande.updateMany({ where: { id: x.ligneId, budgetApresValidation: { equals: Prisma.DbNull } }, data: { budgetApresValidation: snap as unknown as Prisma.InputJsonValue } });
      }
    }
  }

  const apres = await db.ligneDemande.findMany({
    where: { demandeId },
    select: { quantite: true, prixUnitaire: true, statutValidation: true },
  });
  const montantValide = montantValideDepuisLignes(
    apres.map((l) => ({ quantite: l.quantite, prixUnitaire: l.prixUnitaire.toString(), statut: l.statutValidation }))
  );

  const nbValidees = decisions.filter((x) => x.statut === "VALIDEE").length;
  const nbRejetees = decisions.length - nbValidees;
  const data: Prisma.DemandeUncheckedUpdateManyInput = {
    etapeCircuit: r.etapeSuivante,
    etapeCircuitDepuis: maintenant,
    montantValide,
  };
  if (r.effets.niveauRejet) {
    data.niveauRejet = r.effets.niveauRejet;
    data.motifRejet =
      decisions.length === 1 ? (decisions[0].motif?.trim() ?? "") : "Tous les articles ont été rejetés (voir le motif de chaque article).";
  }
  if (r.effets.approbationClotureParDG) {
    data.validationCompleteParDG = true;
    data.validationCompleteRejeteeParDG = false;
    data.dgApprobateurId = r.effets.approbateurDGId ?? acteur.userId;
    data.dgApprouveAt = maintenant;
  }
  if (r.effets.decideurFinance) data.decideurFinanceId = acteur.userId;
  const majDemande = await db.demande.updateMany({ where: { id: demandeId, etapeCircuit: d.etapeCircuit }, data });
  if (majDemande.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };

  for (const x of decisions) {
    const l = parId.get(x.ligneId)!;
    const montantLigne = detail.get(x.ligneId)!;
    await db.historiqueEntry.create({
      data: {
        entity: "LigneDemande",
        entityId: x.ligneId,
        action: x.statut === "VALIDEE" ? "validation_ligne" : "rejet_ligne",
        detail:
          x.statut === "VALIDEE"
            ? `Ligne « ${l.libelle} » validée${l.decisionDG === "VALIDEE" ? " par le DG" : ""} (${montantLigne.quantite} × ${formaterMontant(Number(montantLigne.prixUnitaire))} FCFA)`
            : `Ligne « ${l.libelle} » rejetée${l.decisionDG === "REFUSEE" ? " définitivement après refus du DG" : ""} — motif : ${x.motif!.trim()}`,
        userId: acteur.userId,
      },
    });
  }
  const morceaux = [
    `${roleDG ? "DG" : "Finance"} — ${decisions.length} article${decisions.length > 1 ? "s" : ""} décidé${decisions.length > 1 ? "s" : ""} sur ${d.lignes.length}` +
      ` (${nbValidees} validé${nbValidees > 1 ? "s" : ""}, ${nbRejetees} rejeté${nbRejetees > 1 ? "s" : ""})`,
    `montant validé : ${formaterMontant(montantValide)} FCFA`,
  ];
  if (r.etapeSuivante !== d.etapeCircuit) morceaux.push(`${LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit]} → ${LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante]}`);
  if (r.effets.niveauRejet) morceaux.push(`niveau ${NIVEAU_LIBELLE[r.effets.niveauRejet]}`);
  if (r.effets.approbationClotureParDG) morceaux.push("vaut approbation de clôture du DG");
  await db.historiqueEntry.create({
    data: { entity: "Demande", entityId: demandeId, action: ACTION_HISTORIQUE.DECIDER_LIGNES, detail: morceaux.join(" — "), userId: acteur.userId },
  });
  return { ok: true, etapeSuivante: r.etapeSuivante, montantValide, nbValidees, nbRejetees, budget };
}

/** Ligne `Demande` (champs de `SELECT_DEMANDE_CIRCUIT`) → `DemandeCircuit`, articles et bénéficiaires effectifs compris. */
async function demandeCircuit(db: Db, d: Parameters<typeof versDemandeCircuit>[0]): Promise<DemandeCircuit> {
  // Lot I : la catégorisation n'est exigée (y compris pour soumettre au DG) qu'à partir de la date fixée par la Finance.
  return versDemandeCircuit(d, await categorisationEstObligatoire(db));
}

export interface LigneCorrigee {
  /** Ligne existante à modifier ; absente = nouvelle ligne. Une ligne existante non renvoyée est retirée. */
  id?: string;
  libelle: string;
  /** Motif de la ligne, obligatoire (2026-10-09). */
  motif: string;
  quantite: number;
  prixUnitaire: number;
  /**
   * Bénéficiaire propre de l'article (autonomie des articles, lot A) : absent = inchangé (ligne existante) ou hérite
   * (nouvelle ligne) ; `null` = hérite de la demande ; un choix égal à celui de la demande n'enregistre rien.
   */
  beneficiaire?: ChoixBeneficiaire | null;
  /** Nouvelles pièces de l'article ; celles déjà jointes sont conservées. */
  pieceJointeUrls?: string[];
  /**
   * Date de livraison de l'article (lot G), « AAAA-MM-JJ » : absente = inchangée (ligne existante) ou copie de la date
   * commune de la demande (nouvelle ligne) ; chaîne vide = effacée. Une date passée n'est refusée que si elle change.
   */
  dateLivraison?: string | null;
}

export interface CorrectionDemande {
  /** Motif d'en-tête : modifiable seulement pour une dépense directe (sans ligne). Ignoré pour une demande standard,
   *  dont le motif est porté par chaque ligne (l'ancien motif d'en-tête reste en lecture seule). */
  description?: string;
  lignes: LigneCorrigee[];
  /** Nouvelle pièce jointe (les précédentes sont conservées). */
  pieceJointeUrl?: string;
}

/**
 * Correction par le demandeur puis resoumission (décisions 2 et 8) : depuis « À corriger » seulement, par le
 * demandeur seulement. Les versions précédentes (description, lignes, montants, décisions) sont recopiées dans
 * l'historique avant toute modification ; la version d'origine (`descriptionOriginale`, `libelleOriginal`) n'est
 * jamais réécrite. Le parcours est recalculé et le circuit repart de la première étape applicable.
 */
export async function corrigerEtResoumettre(
  db: Db,
  demandeId: string,
  userId: string,
  correction: CorrectionDemande
): Promise<ResultatCircuit> {
  const d = await db.demande.findUnique({
    where: { id: demandeId },
    include: {
      lignes: {
        orderBy: { createdAt: "asc" },
        include: { decidePar: { select: { fullName: true } }, beneficiaireUser: { select: { fullName: true } } },
      },
    },
  });
  if (!d) return { ok: false, message: "Demande introuvable." };

  const r = transition(
    {
      etape: d.etapeCircuit,
      createurId: d.createurId,
      typeDemande: d.typeDemande,
      etapeServiceRequise: d.etapeServiceRequise,
      etapeFinanceRequise: d.etapeFinanceRequise,
      modeEtapeDG: d.modeEtapeDG,
    },
    { userId, permissions: [], estResponsableServiceDuDemandeur: false },
    { type: "RESOUMETTRE_CORRECTION" }
  );
  if (!r.ok) return r;

  // Lot B : un article validé est définitif — une demande avec un article validé ne repart jamais en correction.
  if (d.lignes.some((l) => l.statutValidation === "VALIDEE")) {
    return { ok: false, message: "Des articles de cette demande sont déjà validés : elle ne peut plus être corrigée en entier." };
  }
  const estStandard = d.typeDemande === "STANDARD";
  const description = estStandard ? d.description : (correction.description ?? "").trim();
  if (!estStandard && (description ?? "").length < 3) {
    return { ok: false, message: "Merci de préciser le motif de l'achat (3 caractères minimum)." };
  }
  if (estStandard && correction.lignes.length === 0) {
    return { ok: false, message: "Ajoutez au moins une ligne d'article." };
  }
  for (const l of correction.lignes) {
    if (!l.libelle.trim()) return { ok: false, message: "Chaque ligne doit avoir un libellé." };
    const refusMotif = refusMotifLigne(l.motif);
    if (refusMotif) return { ok: false, message: refusMotif };
    if (!Number.isInteger(l.quantite) || l.quantite < 1) return { ok: false, message: "Chaque ligne doit avoir un nombre entier supérieur à 0." };
    if (!(l.prixUnitaire >= 0)) return { ok: false, message: "Prix unitaire invalide." };
    if (l.dateLivraison) {
      const avantDate = l.id ? d.lignes.find((x) => x.id === l.id)?.dateLivraison : null;
      // Une date inchangée (même passée) n'est pas réexaminée ; seule une date saisie ou modifiée doit être valide.
      if (!avantDate || jourDepuisDate(avantDate) !== l.dateLivraison) {
        const refus = refusDateLivraison(l.dateLivraison, jourCourant());
        if (refus) return { ok: false, message: refus };
      }
    }
  }
  // Bénéficiaire propre de chaque article après correction : le choix reçu, ramené à « hérite » (null) s'il égale celui
  // de la demande ; absent pour une ligne existante = l'actuel est conservé.
  const choixDemande = choixDepuisStocke(d, d.createurId);
  const piecesValides = (urls: string[] | undefined) => (urls ?? []).every((u) => /^[0-9a-f-]{36}\.(pdf|jpe?g|png)$/.test(u));
  if (correction.lignes.some((l) => !piecesValides(l.pieceJointeUrls))) return { ok: false, message: "Pièce jointe invalide." };
  const comptesAVerifier = new Set<string>();
  for (const l of correction.lignes) {
    const c = l.beneficiaire;
    if (c?.mode === "COMPTE" && c.userId !== d.createurId) comptesAVerifier.add(c.userId);
    if (c?.mode === "COMPTE" && !c.userId) return { ok: false, message: "Choisissez un compte bénéficiaire pour chaque article concerné." };
    if (c?.mode === "NOM" && c.nom.trim().length < 2) return { ok: false, message: "Saisissez le nom du bénéficiaire de chaque article concerné." };
  }
  if (comptesAVerifier.size > 0) {
    const actifs = await db.user.findMany({ where: { id: { in: [...comptesAVerifier] }, isActive: true }, select: { id: true } });
    if (actifs.length !== comptesAVerifier.size) return { ok: false, message: "Un compte bénéficiaire n'existe pas ou n'est plus actif." };
  }
  const existantes = new Map(d.lignes.map((l) => [l.id, l]));
  if (correction.lignes.some((l) => l.id && !existantes.has(l.id))) {
    return { ok: false, message: "Une ligne ne fait pas partie de cette demande." };
  }
  const montant =
    d.typeDemande === "STANDARD"
      ? correction.lignes.reduce((s, l) => s + l.quantite * l.prixUnitaire, 0)
      : Number(d.montant);
  if (!(montant > 0)) return { ok: false, message: "Le total général doit être supérieur à 0." };

  const parcours = determinerParcours(await chargerProfilDemandeur(db, d.createurId), d.typeDemande, {
    beneficiaireEstLeCreateur: d.beneficiaireUserId === d.createurId,
  });
  const etape = etapeInitiale(parcours);

  // Version précédente, recopiée AVANT toute modification.
  const versionPrecedente = {
    tour: d.tourCircuit,
    rejet: { niveau: d.niveauRejet, motif: d.motifRejet },
    description: d.description,
    montant: Number(d.montant),
    lignes: d.lignes.map((l) => ({
      id: l.id,
      libelle: l.libelle,
      motif: l.motif,
      quantite: l.quantite,
      prixUnitaire: Number(l.prixUnitaire),
      ...(l.dateLivraison ? { dateLivraison: jourDepuisDate(l.dateLivraison) } : {}),
      // Bénéficiaire propre de l'article, le cas échéant (absent = celui de la demande).
      ...(l.beneficiaireType ? { beneficiaire: beneficiaireArticle(l, d).libelle } : {}),
      decision: l.statutValidation,
      motifRejet: l.motifRejet,
      // Auteur et date de la décision : l'historique affiche une ligne retirée avec sa décision (2026-10-07).
      decidePar: l.decidePar?.fullName ?? null,
      decideAt: l.decideAt?.toISOString() ?? null,
      // Soumission au DG ligne par ligne (2026-10-10) : décision du DG sur la ligne, le cas échéant.
      ...(l.soumiseAuDG ? { decisionDG: l.decisionDG, motifRefusDG: l.motifRefusDG } : {}),
    })),
  };

  // Changement d'étape conditionné à « À corriger » (double envoi : une seule resoumission).
  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: "A_CORRIGER" },
    data: {
      etapeCircuit: etape,
      etapeCircuitDepuis: new Date(),
      ...champsParcours(parcours),
      soumiseAuDG: false,
      niveauRejet: null,
      motifRejet: null,
      // Nouvelle version : les décisions de l'ancienne ne valent plus (l'historique les garde).
      decideurFinanceId: null,
      validationCompleteParDG: false,
      validationCompleteRejeteeParDG: false,
      dgApprobateurId: null,
      dgApprouveAt: null,
      tourCircuit: d.tourCircuit + 1,
      montant,
      montantValide: null,
      statut: "EN_ATTENTE_VALIDATION",
      ...(!estStandard && description !== d.description
        ? { description, descriptionDemandeur: description, descriptionOriginale: d.descriptionOriginale ?? d.description }
        : {}),
    },
  });
  if (maj.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };

  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "correction_demande",
      detail: `Version du tour ${d.tourCircuit} avant correction : ${JSON.stringify(versionPrecedente)}`,
      userId,
    },
  });

  const conservees = new Set(correction.lignes.filter((l) => l.id).map((l) => l.id as string));
  const retirees = d.lignes.filter((l) => !conservees.has(l.id)).map((l) => l.id);
  if (retirees.length > 0) await db.ligneDemande.deleteMany({ where: { id: { in: retirees }, demandeId } });

  for (const l of correction.lignes) {
    const libelle = l.libelle.trim();
    const motif = l.motif.trim();
    // Nouvelle version : décision finale et soumission au DG remises à zéro (l'historique garde les précédentes).
    const decisionRemiseAZero = {
      statutValidation: "EN_ATTENTE" as const,
      motifRejet: null,
      decideParId: null,
      decideAt: null,
      decideurFinanceId: null,
      soumiseAuDG: false,
      soumiseDGAt: null,
      soumiseDGParId: null,
      decisionDG: null,
      decisionDGAt: null,
      decisionDGParId: null,
      motifRefusDG: null,
    };
    // Bénéficiaire propre : `undefined` = ne rien changer (ligne existante), `null`/choix = écrire (ou effacer).
    const choixPropre =
      l.beneficiaire === undefined ? undefined : choixPropreArticle({ beneficiaire: l.beneficiaire }, choixDemande, d.createurId);
    const champsBeneficiaireLigne =
      choixPropre === undefined
        ? {}
        : choixPropre === null
          ? { beneficiaireType: null, beneficiaireUserId: null, beneficiaireNom: null }
          : champsBeneficiaire(choixPropre, d.createurId);
    let ligneId: string;
    if (l.id) {
      ligneId = l.id;
      const avant = existantes.get(l.id)!;
      await db.ligneDemande.update({
        where: { id: l.id },
        data: {
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          ...champsBeneficiaireLigne,
          ...(l.dateLivraison !== undefined ? { dateLivraison: versDateStockee(l.dateLivraison || null) } : {}),
          ...decisionRemiseAZero,
          ...(libelle !== avant.libelle
            ? { libelle, libelleDemandeur: libelle, libelleOriginal: avant.libelleOriginal ?? avant.libelle }
            : {}),
          // Même versionnement que le libellé ; une ancienne ligne sans motif reçoit son premier motif.
          ...(motif !== avant.motif
            ? { motif, motifDemandeur: motif, motifOriginal: avant.motifOriginal ?? avant.motif }
            : {}),
        },
      });
    } else {
      const creee = await db.ligneDemande.create({
        data: {
          demandeId,
          libelle,
          motif,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          ...champsBeneficiaireLigne,
          dateLivraison: versDateStockee(dateLivraisonAEnregistrer(l.dateLivraison || null, jourDepuisDate(d.dateLivraisonSouhaitee))),
        },
      });
      ligneId = creee.id;
    }
    const nouvellesPieces = [...new Set(l.pieceJointeUrls ?? [])];
    if (nouvellesPieces.length > 0) {
      await db.pieceJointe.createMany({ data: nouvellesPieces.map((url) => ({ url, demandeId, ligneDemandeId: ligneId })) });
    }
  }
  if (correction.pieceJointeUrl) {
    await db.pieceJointe.create({ data: { url: correction.pieceJointeUrl, demandeId } });
  }

  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "resoumission_correction",
      detail: `Corrigée et resoumise (tour ${d.tourCircuit + 1}) : ${CAS_LIBELLE[parcours.cas]}. Première étape : ${LIBELLE_ETAPE_CIRCUIT[etape]}. Montant : ${montant.toLocaleString("fr-FR")}.`,
      userId,
    },
  });
  return { ok: true, etapeSuivante: etape };
}
