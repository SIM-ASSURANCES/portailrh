// Circuit de validation des demandes (commit 3, 2026-10-06) — application en base des transitions décidées par le
// moteur pur (`circuitDemande.ts`). Toujours dans la transaction de l'appelant ; chaque changement d'étape est
// conditionné à l'étape lue (deux décisions simultanées : une seule passe) et tracé dans `HistoriqueEntry`.

import type { Prisma } from "./generated/prisma/client";
import type { EtapeCircuit, NiveauRejet } from "./generated/prisma/enums";
import {
  determinerParcours,
  etapeInitiale,
  etatLigneDG,
  LIBELLE_ETAPE_CIRCUIT,
  refusExecutionPropreDemande,
  versLigneCircuit,
  type OptionsParcours,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type Parcours,
  type ProfilDemandeur,
  type TypeDemandeCircuit,
} from "./circuitDemande";
import { refusMotifLigne } from "./motifLigne";

type Db = Prisma.TransactionClient;

/**
 * Demandes à l'étape Service dont le compte est le responsable ACTUEL du service du demandeur (jamais celles d'un
 * autre service) : page « Demandes de mon service » et compteur du menu.
 */
export function demandesServiceAValiderWhere(responsableId: string): Prisma.DemandeWhereInput {
  return { etapeCircuit: "SERVICE", createur: { service: { responsableId } } };
}

/**
 * Demandes à l'étape DG pour ce compte DG : soumises par la Finance (décision sur la demande entière) ou émises par la
 * Finance (cas b, décision ligne par ligne). Jamais les siennes (une demande du DG ne passe jamais par l'étape DG).
 */
export function demandesEtapeDGWhere(dgId: string): Prisma.DemandeWhereInput {
  return { etapeCircuit: "DG", createurId: { not: dgId } };
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
    | { demandeId: string }
    | { reglementId: string }
    | { retourCaisseId: string }
    | { depenseLigneId: string }
    | { remboursementId: string }
    | { retourExceptionnelId: string },
  userId: string
): Promise<string | null> {
  const champs = { createurId: true, beneficiaireUserId: true } as const;
  let demande: { createurId: string; beneficiaireUserId: string | null } | null | undefined = null;
  if ("demandeId" in cible) {
    demande = await db.demande.findUnique({ where: { id: cible.demandeId }, select: champs });
  } else if ("reglementId" in cible) {
    demande = (await db.reglement.findUnique({ where: { id: cible.reglementId }, select: { demande: { select: champs } } }))?.demande;
  } else if ("retourCaisseId" in cible) {
    demande = (
      await db.retourCaisse.findUnique({
        where: { id: cible.retourCaisseId },
        select: { reglement: { select: { demande: { select: champs } } } },
      })
    )?.reglement.demande;
  } else if ("depenseLigneId" in cible) {
    demande = (
      await db.depenseLigne.findUnique({
        where: { id: cible.depenseLigneId },
        select: { retourCaisse: { select: { reglement: { select: { demande: { select: champs } } } } } },
      })
    )?.retourCaisse.reglement.demande;
  } else if ("remboursementId" in cible) {
    demande = (
      await db.remboursementRetour.findUnique({
        where: { id: cible.remboursementId },
        select: { retourCaisse: { select: { reglement: { select: { demande: { select: champs } } } } } },
      })
    )?.retourCaisse.reglement.demande;
  } else {
    demande = (
      await db.retourExceptionnel.findUnique({ where: { id: cible.retourExceptionnelId }, select: { demande: { select: champs } } })
    )?.demande;
  }
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

  const r = transition(
    {
      etape: d.etapeCircuit,
      createurId: d.createurId,
      typeDemande: d.typeDemande,
      etapeServiceRequise: d.etapeServiceRequise,
      etapeFinanceRequise: d.etapeFinanceRequise,
      modeEtapeDG: d.modeEtapeDG,
      approbateurDGId: d.dgApprobateurId,
      decideurFinanceId: d.decideurFinanceId,
      lignes: d.lignes.map(versLigneCircuit),
    },
    acteur,
    action
  );
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
): Promise<ResultatCircuit & { libelles?: string[] }> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };
  const lignes = d.lignes.map(versLigneCircuit);
  const r = transition(
    { ...circuitDepuis(d), lignes },
    acteur,
    { type: "SOUMETTRE_LIGNES_DG", ligneIds }
  );
  if (!r.ok) return r;

  const maintenant = new Date();
  const choisies = lignes.filter((l) => ligneIds.includes(l.id));
  const resoumises = choisies.filter((l) => etatLigneDG(l) === "REFUSEE_DG");

  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: d.etapeCircuit },
    // Déjà à l'étape DG (soumission complémentaire) : la date d'entrée dans l'étape ne change pas (rappels inchangés).
    data: { etapeCircuit: "DG", soumiseAuDG: true, ...(d.etapeCircuit !== "DG" ? { etapeCircuitDepuis: maintenant } : {}) },
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
        `${LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit]} → DG — ${libelles.length} ligne${libelles.length > 1 ? "s" : ""} sur ` +
        `${lignes.length} soumise${libelles.length > 1 ? "s" : ""} au DG : ${listeLibelles(libelles)}` +
        (resoumises.length > 0 ? ` (resoumise${resoumises.length > 1 ? "s" : ""} après refus : ${listeLibelles(resoumises.map((l) => l.libelle))})` : ""),
      userId: acteur.userId,
    },
  });
  return { ok: true, etapeSuivante: "DG", libelles };
}

/**
 * Le DG décide une ligne soumise (2026-10-10, règle 2) : validée, ou refusée avec motif (elle revient à la Finance).
 * Quand plus aucune ligne n'attend le DG, la demande passe à la décision finale de la Finance.
 */
export async function deciderLigneDG(
  db: Db,
  ligneId: string,
  acteur: ActeurCircuit,
  decision: { valider: boolean; motif?: string }
): Promise<ResultatCircuit & { demandeId?: string; libelle?: string }> {
  const ligne = await db.ligneDemande.findUnique({ where: { id: ligneId }, select: { demandeId: true } });
  if (!ligne) return { ok: false, message: "Ligne introuvable." };
  const demandeId = ligne.demandeId;
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };
  const lignes = d.lignes.map(versLigneCircuit);
  const motif = decision.motif?.trim() ?? "";
  const r = transition(
    { ...circuitDepuis(d), lignes },
    acteur,
    { type: "DECIDER_LIGNE_DG", ligneId, valider: decision.valider, motif }
  );
  if (!r.ok) return r;

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
  if (r.etapeSuivante !== "DG") {
    const maj = await db.demande.updateMany({
      where: { id: demandeId, etapeCircuit: "DG" },
      data: { etapeCircuit: r.etapeSuivante, etapeCircuitDepuis: maintenant },
    });
    if (maj.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };
  }

  const libelle = lignes.find((l) => l.id === ligneId)!.libelle;
  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: decision.valider ? "validation_ligne_dg" : "refus_ligne_dg",
      detail:
        (decision.valider ? `DG — ligne « ${libelle} » validée` : `DG — ligne « ${libelle} » refusée — motif : ${motif}`) +
        (r.etapeSuivante !== "DG" ? ` — DG → ${LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante]}` : ""),
      userId: acteur.userId,
    },
  });
  return { ok: true, etapeSuivante: r.etapeSuivante, demandeId, libelle };
}

function circuitDepuis(d: {
  etapeCircuit: EtapeCircuit;
  createurId: string;
  typeDemande: TypeDemandeCircuit;
  etapeServiceRequise: boolean;
  etapeFinanceRequise: boolean;
  modeEtapeDG: Parcours["modeEtapeDG"];
  dgApprobateurId: string | null;
  decideurFinanceId: string | null;
}) {
  return {
    etape: d.etapeCircuit,
    createurId: d.createurId,
    typeDemande: d.typeDemande,
    etapeServiceRequise: d.etapeServiceRequise,
    etapeFinanceRequise: d.etapeFinanceRequise,
    modeEtapeDG: d.modeEtapeDG,
    approbateurDGId: d.dgApprobateurId,
    decideurFinanceId: d.decideurFinanceId,
  };
}

export interface LigneCorrigee {
  /** Ligne existante à modifier ; absente = nouvelle ligne. Une ligne existante non renvoyée est retirée. */
  id?: string;
  libelle: string;
  /** Motif de la ligne, obligatoire (2026-10-09). */
  motif: string;
  quantite: number;
  prixUnitaire: number;
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
    include: { lignes: { orderBy: { createdAt: "asc" }, include: { decidePar: { select: { fullName: true } } } } },
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
      soumiseAuDG: false,
      soumiseDGAt: null,
      soumiseDGParId: null,
      decisionDG: null,
      decisionDGAt: null,
      decisionDGParId: null,
      motifRefusDG: null,
    };
    if (l.id) {
      const avant = existantes.get(l.id)!;
      await db.ligneDemande.update({
        where: { id: l.id },
        data: {
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
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
      await db.ligneDemande.create({ data: { demandeId, libelle, motif, quantite: l.quantite, prixUnitaire: l.prixUnitaire } });
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
