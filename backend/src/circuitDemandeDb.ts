// Circuit de validation des demandes (commit 3, 2026-10-06) — application en base des transitions décidées par le
// moteur pur (`circuitDemande.ts`). Toujours dans la transaction de l'appelant ; chaque changement d'étape est
// conditionné à l'étape lue (deux décisions simultanées : une seule passe) et tracé dans `HistoriqueEntry`.

import type { Prisma } from "./generated/prisma/client";
import type { EtapeCircuit, NiveauRejet } from "./generated/prisma/enums";
import {
  determinerParcours,
  etapeInitiale,
  LIBELLE_ETAPE_CIRCUIT,
  refusExecutionPropreDemande,
  type OptionsParcours,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type Parcours,
  type ProfilDemandeur,
  type TypeDemandeCircuit,
} from "./circuitDemande";

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
  RESOUMETTRE_CORRECTION: "resoumission_correction",
  ABANDONNER: "abandon",
};

export type ResultatCircuit = { ok: true; etapeSuivante: EtapeCircuit } | { ok: false; message: string };

/**
 * Applique une action du circuit (hors resoumission après correction, voir `corrigerEtResoumettre`). Les décisions
 * de lignes elles-mêmes sont écrites par l'appelant (`validerLignesAction`) dans la même transaction, avant cet appel.
 */
export async function appliquerTransitionCircuit(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  action: Exclude<ActionCircuit, { type: "RESOUMETTRE_CORRECTION" }>
): Promise<ResultatCircuit> {
  const d = await db.demande.findUnique({
    where: { id: demandeId },
    select: {
      etapeCircuit: true,
      createurId: true,
      typeDemande: true,
      etapeServiceRequise: true,
      etapeFinanceRequise: true,
      modeEtapeDG: true,
      dgApprobateurId: true,
      decideurFinanceId: true,
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
      approbateurDGId: d.dgApprobateurId,
      decideurFinanceId: d.decideurFinanceId,
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
    data.dgApprobateurId = acteur.userId;
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

export interface LigneCorrigee {
  /** Ligne existante à modifier ; absente = nouvelle ligne. Une ligne existante non renvoyée est retirée. */
  id?: string;
  libelle: string;
  quantite: number;
  prixUnitaire: number;
}

export interface CorrectionDemande {
  description: string;
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

  const description = correction.description.trim();
  if (description.length < 3) return { ok: false, message: "Merci de préciser le motif de l'achat (3 caractères minimum)." };
  if (d.typeDemande === "STANDARD" && correction.lignes.length === 0) {
    return { ok: false, message: "Ajoutez au moins une ligne d'article." };
  }
  for (const l of correction.lignes) {
    if (!l.libelle.trim()) return { ok: false, message: "Chaque ligne doit avoir un libellé." };
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
      quantite: l.quantite,
      prixUnitaire: Number(l.prixUnitaire),
      decision: l.statutValidation,
      motifRejet: l.motifRejet,
      // Auteur et date de la décision : l'historique affiche une ligne retirée avec sa décision (2026-10-07).
      decidePar: l.decidePar?.fullName ?? null,
      decideAt: l.decideAt?.toISOString() ?? null,
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
      ...(description !== d.description
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
    const decisionRemiseAZero = { statutValidation: "EN_ATTENTE" as const, motifRejet: null, decideParId: null, decideAt: null };
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
        },
      });
    } else {
      await db.ligneDemande.create({ data: { demandeId, libelle, quantite: l.quantite, prixUnitaire: l.prixUnitaire } });
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
