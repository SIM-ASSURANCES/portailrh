// Permissions d'absence — application en base (Lot 4, 2026-10-15). Toujours dans la transaction de l'appelant.
//
// Même circuit que les congés (D2 = option B : responsable du service, puis RH, à défaut le DG), mêmes garanties :
//   - le plafond mensuel est compté SOUS VERROU du compte (deux demandes simultanées ne passent pas toutes les deux) ;
//   - chaque changement de statut est un `updateMany` conditionné au statut lu, sous un verrou de ligne ;
//   - la plage d'absence autorisée (lue par le Pointage) porte `demandePermissionId` : l'annulation la supprime par
//     cette clé, jamais par plage de dates ni par le texte de la description ;
//   - un dépassement du plafond ne s'accorde que par une dérogation de la RH, motif obligatoire, tracée.
// Un refus métier en cours d'écriture est une `RefusAbsence` : tout est annulé (`transactionAbsence`).

import type { Prisma } from "./generated/prisma/client";
import type { StatutDemandePermission } from "./generated/prisma/enums";
import {
  ACTION_HISTORIQUE_ABSENCE,
  decideurPourStatutAbsence,
  destinatairesEtapeAbsence,
  resoudreParcoursAbsence,
  transitionAbsence,
  type ActeurAbsence,
  type EffetTransitionAbsence,
  type StatutCircuitAbsence,
} from "./circuitAbsence";
import {
  RefusAbsence,
  chargerContexteCircuit,
  genererReferenceAbsence,
  noterHistoriqueAbsence,
  verrouillerAbsenceUtilisateur,
  type Db,
} from "./congesDb";
import {
  colonneDateDepuisJourCivil,
  comparerJours,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  type JourCivil,
} from "./congesCalcul";
import {
  MESSAGE_PLAFOND_ATTEINT_APPROBATION,
  MOTIF_EXCEPTION_MIN,
  bornesMois,
  calculerEcartRetour,
  controlerRetourReel,
  controlerSaisiePermission,
  evaluerPlafond,
  formatMinutesEnHeures,
  premierChevauchementHoraire,
  verifierDureeAutorisee,
} from "./permissionsAbsence";

/** Permissions qui comptent dans le plafond d'un MOIS une fois accordées. */
const STATUTS_ACCORDES = ["APPROUVEE", "CONSOMMEE"] as const;
/** Permissions qui occupent déjà une plage horaire ou comptent dans l'aperçu du plafond (en cours + accordées). */
const STATUTS_OCCUPANTS = ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "APPROUVEE", "CONSOMMEE"] as const;

export interface DemandePermissionEntree {
  typePermissionId: string;
  date: JourCivil;
  heureDepart: string;
  heureRetourPrevue: string;
  motif: string;
}

async function compterPermissionsDuMois(
  db: Db,
  p: { userId: string; typePermissionId: string; jour: JourCivil; statuts: readonly string[]; exclureDemandeId?: string }
): Promise<number> {
  const mois = bornesMois(p.jour);
  if (!mois) return 0;
  return db.demandePermission.count({
    where: {
      userId: p.userId,
      typePermissionId: p.typePermissionId,
      date: { gte: colonneDateDepuisJourCivil(mois.debut), lte: colonneDateDepuisJourCivil(mois.fin) },
      statut: { in: [...p.statuts] as StatutDemandePermission[] },
      ...(p.exclureDemandeId ? { id: { not: p.exclureDemandeId } } : {}),
    },
  });
}

async function congeCouvre(db: Db, userId: string, jour: JourCivil, statuts: readonly string[]): Promise<boolean> {
  const n = await db.demandeConge.count({
    where: {
      userId,
      statut: { in: [...statuts] as never },
      dateDebut: { lte: colonneDateDepuisJourCivil(jour) },
      dateFin: { gte: colonneDateDepuisJourCivil(jour) },
    },
  });
  return n > 0;
}

export interface SoumissionPermission {
  id: string;
  reference: string;
  statut: StatutCircuitAbsence;
  libelleType: string;
  dureeMinutes: number;
  destinataires: string[];
  /** Plafond mensuel déjà atteint (en comptant les demandes en cours) : la RH devra déroger pour accorder. */
  auDelaDuPlafond: { utilise: number; plafond: number } | null;
  alerteCongeRecommande: boolean;
}

export async function soumettrePermission(
  db: Db,
  p: { userId: string; entree: DemandePermissionEntree; maintenant: Date }
): Promise<SoumissionPermission> {
  await verrouillerAbsenceUtilisateur(db, p.userId);
  const user = await db.user.findUnique({ where: { id: p.userId }, select: { isActive: true } });
  if (!user || !user.isActive) throw new RefusAbsence("Compte introuvable ou désactivé.");

  const { entree } = p;
  const saisie = controlerSaisiePermission({
    date: entree.date,
    heureDepart: entree.heureDepart,
    heureRetourPrevue: entree.heureRetourPrevue,
    motif: entree.motif,
    aujourdhui: formatJourCivil(p.maintenant),
  });
  if (!saisie.ok) throw new RefusAbsence(saisie.erreur, saisie.champ);

  const type = await db.typePermission.findUnique({ where: { id: entree.typePermissionId } });
  if (!type || !type.isActive) throw new RefusAbsence("Type de permission invalide ou inactif.", "typePermissionId");

  const duree = verifierDureeAutorisee(saisie.dureeMinutes, type.dureeMaxHeures);
  if (!duree.valide) {
    throw new RefusAbsence(`La durée demandée dépasse le maximum autorisé pour ce type (${type.dureeMaxHeures} h).`, "heureRetourPrevue");
  }

  if (await congeCouvre(db, p.userId, entree.date, ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "VALIDEE"])) {
    throw new RefusAbsence("Un congé est déjà demandé ou validé à cette date : une permission ne peut pas le chevaucher.", "date");
  }

  const memeJour = await db.demandePermission.findMany({
    where: { userId: p.userId, date: colonneDateDepuisJourCivil(entree.date), statut: { in: [...STATUTS_OCCUPANTS] as never } },
    select: { reference: true, heureDepart: true, heureRetourPrevue: true },
  });
  const conflit = premierChevauchementHoraire(
    { heureDepart: entree.heureDepart, heureRetour: entree.heureRetourPrevue },
    memeJour.map((d) => ({ heureDepart: d.heureDepart, heureRetour: d.heureRetourPrevue, reference: d.reference }))
  );
  if (conflit) {
    throw new RefusAbsence(`Une permission (${conflit.reference}) couvre déjà une partie de cette plage horaire.`, "heureDepart");
  }

  // Aperçu du plafond (demandes en cours comprises) : on avertit, c'est l'accord qui tranche (dérogation de la RH).
  const utilise = await compterPermissionsDuMois(db, {
    userId: p.userId,
    typePermissionId: type.id,
    jour: entree.date,
    statuts: STATUTS_OCCUPANTS,
  });
  const plafond = evaluerPlafond({ utilise, plafond: type.plafondMensuel });

  const ctx = await chargerContexteCircuit(db, p.userId, "PERMISSION");
  const parcours = resoudreParcoursAbsence(ctx);
  if (!parcours.ok) throw new RefusAbsence(parcours.erreur);

  const reference = await genererReferenceAbsence(db, "PERMISSION", p.maintenant);
  const demande = await db.demandePermission.create({
    data: {
      reference,
      date: colonneDateDepuisJourCivil(entree.date),
      heureDepart: entree.heureDepart,
      heureRetourPrevue: entree.heureRetourPrevue,
      dureeMinutes: saisie.dureeMinutes,
      motif: saisie.motif,
      statut: parcours.premierStatut,
      etapeResponsableRequise: parcours.etapeResponsable.requise,
      etapeDepuis: p.maintenant,
      userId: p.userId,
      typePermissionId: type.id,
    },
  });
  await noterHistoriqueAbsence(db, {
    nature: "PERMISSION",
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_ABSENCE.SOUMETTRE,
    detail: `${reference} : ${type.label}, le ${entree.date} de ${entree.heureDepart} à ${entree.heureRetourPrevue} (${formatMinutesEnHeures(saisie.dureeMinutes)}).`,
    userId: p.userId,
  });
  return {
    id: demande.id,
    reference,
    statut: parcours.premierStatut,
    libelleType: type.label,
    dureeMinutes: saisie.dureeMinutes,
    destinataires: destinatairesEtapeAbsence(parcours.premierStatut, ctx),
    auDelaDuPlafond: plafond.atteint ? { utilise, plafond: type.plafondMensuel } : null,
    alerteCongeRecommande: duree.alerteCongeRecommande,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision, annulation
// ---------------------------------------------------------------------------------------------------------------------

export type ActionPermission =
  | { type: "APPROUVER"; /** Motif de la dérogation au plafond (étape RH seulement). */ exceptionPlafond?: string }
  | { type: "REJETER"; motif: string }
  | { type: "ANNULER"; motif: string };

export interface DecisionPermission {
  id: string;
  reference: string;
  demandeurId: string;
  libelleType: string;
  ancienStatut: StatutCircuitAbsence;
  statut: StatutCircuitAbsence;
  effet: EffetTransitionAbsence;
  viaRepli: boolean;
  motif?: string;
  exceptionPlafond: boolean;
  destinatairesSuivants: string[];
  date: JourCivil;
  heureDepart: string;
  heureRetourPrevue: string;
}

export async function deciderPermission(
  db: Db,
  p: {
    demandeId: string;
    acteur: ActeurAbsence;
    action: ActionPermission;
    /** L'acteur porte `absences.annuler` : il annule même après le jour de la permission. */
    peutAnnulerApresDebut: boolean;
    maintenant: Date;
  }
): Promise<DecisionPermission> {
  await db.$executeRaw`SELECT id FROM "DemandePermission" WHERE id = ${p.demandeId} FOR UPDATE`;
  const demande = await db.demandePermission.findUnique({ where: { id: p.demandeId }, include: { typePermission: true } });
  if (!demande) throw new RefusAbsence("Demande introuvable.");
  await verrouillerAbsenceUtilisateur(db, demande.userId);

  const jour = jourCivilDepuisColonneDate(demande.date);
  const ctx = await chargerContexteCircuit(db, demande.userId, "PERMISSION");
  const decideur = decideurPourStatutAbsence(demande.statut, ctx);
  const aujourdhui = formatJourCivil(p.maintenant);
  const r = transitionAbsence({
    nature: "PERMISSION",
    statut: demande.statut,
    action: p.action.type === "APPROUVER" ? { type: "APPROUVER" } : p.action,
    acteur: p.acteur,
    demandeurId: demande.userId,
    decideur,
    adebute: comparerJours(aujourdhui, jour) >= 0,
    peutAnnulerApresDebut: p.peutAnnulerApresDebut,
  });
  if (!r.ok) throw new RefusAbsence(r.erreur);

  const derogation = p.action.type === "APPROUVER" ? (p.action.exceptionPlafond ?? "").replace(/\s+/g, " ").trim() : "";
  if (derogation && r.effet !== "ACCORDER") {
    throw new RefusAbsence("Une dérogation au plafond se décide à l'étape RH, au moment de l'accord.");
  }

  let motifException: string | null = null;
  if (r.effet === "ACCORDER") {
    // Le plafond se compte sur les permissions DÉJÀ accordées : les demandes en cours ne se bloquent pas entre elles.
    const accordees = await compterPermissionsDuMois(db, {
      userId: demande.userId,
      typePermissionId: demande.typePermissionId,
      jour,
      statuts: STATUTS_ACCORDES,
      exclureDemandeId: demande.id,
    });
    const plafond = evaluerPlafond({ utilise: accordees, plafond: demande.typePermission.plafondMensuel });
    if (plafond.atteint) {
      if (derogation.length < MOTIF_EXCEPTION_MIN) {
        throw new RefusAbsence(MESSAGE_PLAFOND_ATTEINT_APPROBATION(accordees, demande.typePermission.plafondMensuel), "exceptionPlafond");
      }
      motifException = derogation;
    }
    if (await congeCouvre(db, demande.userId, jour, ["VALIDEE"])) {
      throw new RefusAbsence("Un congé validé couvre désormais cette date : la permission ne peut plus être accordée.");
    }
    await db.plageAbsenceAutorisee.create({
      data: {
        userId: demande.userId,
        // Plage lue par le Pointage : minuit LOCAL du jour de la permission (comme les plages de congé).
        date: new Date(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10))),
        heureDebut: demande.heureDepart,
        heureFin: demande.heureRetourPrevue,
        source: "PERMISSION",
        description: `Permission ${demande.reference}`,
        demandePermissionId: demande.id,
      },
    });
  }
  if (r.effet === "DEFAIRE_ACCORD") {
    await db.plageAbsenceAutorisee.deleteMany({ where: { demandePermissionId: demande.id } });
  }

  const data: Prisma.DemandePermissionUpdateManyMutationInput & Record<string, unknown> = {
    statut: r.statut as StatutDemandePermission,
    etapeDepuis: p.maintenant,
    dernierRappelAt: null,
  };
  if (r.etape === "RESPONSABLE") {
    data.approuveParId = p.acteur.id;
    data.approuveAt = p.maintenant;
  } else if (r.etape === "RH") {
    data.valideParId = p.acteur.id;
    data.valideAt = p.maintenant;
  }
  if (r.statut === "REJETEE") data.motifRejet = r.motif ?? null;
  if (r.statut === "ANNULEE") {
    data.motifAnnulation = r.motif ?? null;
    data.annuleParId = p.acteur.id;
    data.annuleAt = p.maintenant;
  }
  if (motifException) data.motifExceptionPlafond = motifException;
  const { count } = await db.demandePermission.updateMany({ where: { id: demande.id, statut: demande.statut }, data });
  if (count === 0) throw new RefusAbsence("Cette demande a déjà été traitée.");

  const action =
    p.action.type === "APPROUVER"
      ? r.statut === "EN_ATTENTE_RH"
        ? ACTION_HISTORIQUE_ABSENCE.APPROUVER_RESPONSABLE
        : r.viaRepli
          ? ACTION_HISTORIQUE_ABSENCE.ACCORDER_PAR_REPLI
          : ACTION_HISTORIQUE_ABSENCE.ACCORDER
      : p.action.type === "REJETER"
        ? ACTION_HISTORIQUE_ABSENCE.REJETER
        : ACTION_HISTORIQUE_ABSENCE.ANNULER;
  await noterHistoriqueAbsence(db, {
    nature: "PERMISSION",
    demandeId: demande.id,
    action,
    detail:
      `${demande.reference} : ${demande.statut} → ${r.statut}${r.motif ? `. Motif : ${r.motif}` : ""}` +
      `${motifException ? `. Dérogation au plafond mensuel : ${motifException}` : ""}` +
      `${r.viaRepli ? " (étape responsable remplacée : responsable indisponible)." : ""}`,
    userId: p.acteur.id,
  });

  return {
    id: demande.id,
    reference: demande.reference,
    demandeurId: demande.userId,
    libelleType: demande.typePermission.label,
    ancienStatut: demande.statut,
    statut: r.statut,
    effet: r.effet,
    viaRepli: r.viaRepli === true,
    motif: r.motif,
    exceptionPlafond: motifException !== null,
    destinatairesSuivants: destinatairesEtapeAbsence(r.statut, ctx),
    date: jour,
    heureDepart: demande.heureDepart,
    heureRetourPrevue: demande.heureRetourPrevue,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Retour (la permission devient consommée)
// ---------------------------------------------------------------------------------------------------------------------

export interface RetourPermission {
  id: string;
  reference: string;
  demandeurId: string;
  dureeReelleMinutes: number;
  depassement: boolean;
  minutesEcart: number;
}

/**
 * Marque le retour effectif. Le demandeur le fait pour sa propre permission ; la RH (`peutMarquerPourAutrui`) pour
 * celle d'un autre. Seulement pour une permission approuvée dont le jour est arrivé.
 */
export async function marquerRetourPermission(
  db: Db,
  p: { demandeId: string; acteurId: string; peutMarquerPourAutrui: boolean; heureRetourReelle: string; maintenant: Date }
): Promise<RetourPermission> {
  await db.$executeRaw`SELECT id FROM "DemandePermission" WHERE id = ${p.demandeId} FOR UPDATE`;
  const demande = await db.demandePermission.findUnique({ where: { id: p.demandeId } });
  if (!demande) throw new RefusAbsence("Demande introuvable.");
  if (demande.userId !== p.acteurId && !p.peutMarquerPourAutrui) throw new RefusAbsence("Vous ne pouvez pas marquer le retour de cette permission.");
  if (demande.statut === "CONSOMMEE") throw new RefusAbsence("Le retour de cette permission est déjà enregistré.");
  if (demande.statut !== "APPROUVEE") throw new RefusAbsence("Seule une permission approuvée peut être marquée comme retournée.");
  if (comparerJours(formatJourCivil(p.maintenant), jourCivilDepuisColonneDate(demande.date)) < 0) {
    throw new RefusAbsence("Cette permission n'a pas encore eu lieu.");
  }
  const retour = controlerRetourReel({ heureDepart: demande.heureDepart, heureRetourReelle: p.heureRetourReelle });
  if (!retour.ok) throw new RefusAbsence(retour.erreur, "heureRetourReelle");

  const { count } = await db.demandePermission.updateMany({
    where: { id: demande.id, statut: "APPROUVEE" },
    data: { statut: "CONSOMMEE", heureRetourReelle: p.heureRetourReelle, dureeReelleMinutes: retour.dureeReelleMinutes },
  });
  if (count === 0) throw new RefusAbsence("Cette permission a déjà été traitée.");

  const ecart = calculerEcartRetour(demande.heureRetourPrevue, p.heureRetourReelle);
  await noterHistoriqueAbsence(db, {
    nature: "PERMISSION",
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_ABSENCE.RETOUR_MARQUE,
    detail: `${demande.reference} : retour à ${p.heureRetourReelle} (prévu ${demande.heureRetourPrevue}${ecart.depassement ? `, ${formatMinutesEnHeures(ecart.minutesEcart)} de dépassement` : ""}).`,
    userId: p.acteurId,
  });
  return {
    id: demande.id,
    reference: demande.reference,
    demandeurId: demande.userId,
    dureeReelleMinutes: retour.dureeReelleMinutes,
    depassement: ecart.depassement,
    minutesEcart: ecart.minutesEcart,
  };
}
