// Lot K (2026-10-26) — réorientation de l'étape Service : application en base des règles de `circuitReorientation.ts`.
// Toujours dans la transaction de l'appelant ; verrou de la demande (deux réorientations simultanées : une seule passe).

import type { Prisma } from "./generated/prisma/client";
import { comptesConcernesDemande } from "./beneficiaireArticles";
import { SELECT_DEMANDE_CIRCUIT, verrouillerDemande } from "./circuitDemandeDb";
import { transition, type ActeurCircuit, versDemandeCircuit } from "./circuitDemande";
import {
  detailReorientation,
  libelleDelaiEcoule,
  refusCibleReorientation,
  responsableServiceEffectif,
  responsablesEligibles,
  type CandidatResponsable,
  type ContexteReorientation,
} from "./circuitReorientation";
import { horairesPointage, utilisateursCouvertsParAbsence } from "./pointage-utils";

type Db = Prisma.TransactionClient;

/** Comptes responsables d'au moins un service (candidats), actifs ou non — l'éligibilité les filtre ensuite. */
export async function chargerCandidatsResponsables(db: Db): Promise<CandidatResponsable[]> {
  const services = await db.service.findMany({
    where: { responsableId: { not: null } },
    orderBy: { name: "asc" },
    select: { name: true, responsable: { select: { id: true, fullName: true, isActive: true } } },
  });
  const parId = new Map<string, CandidatResponsable>();
  for (const s of services) {
    if (!s.responsable) continue;
    const c = parId.get(s.responsable.id) ?? {
      id: s.responsable.id,
      fullName: s.responsable.fullName,
      actif: s.responsable.isActive,
      services: [],
    };
    c.services.push(s.name);
    parId.set(c.id, c);
  }
  return [...parId.values()];
}

/**
 * Comptes dont la journée est entièrement couverte par une absence autorisée AUJOURD'HUI (congé, permission : table
 * `PlageAbsenceAutorisee` du Pointage, même règle que le cron des absences). C'est la SEULE connaissance d'absence du portail :
 * un responsable absent sans plage déclarée n'est pas exclu (point ouvert).
 */
export async function chargerAbsentsAujourdhui(db: Db, ids: readonly string[], maintenant: Date): Promise<string[]> {
  if (ids.length === 0) return [];
  const debut = new Date(maintenant);
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(maintenant);
  fin.setHours(23, 59, 59, 999);
  const [plages, parametrage] = await Promise.all([
    db.plageAbsenceAutorisee.findMany({
      where: { userId: { in: [...ids] }, date: { gte: debut, lte: fin } },
      select: { userId: true, heureDebut: true, heureFin: true },
    }),
    db.parametrageHoraire.findFirst({ where: { isActive: true } }),
  ]);
  return [...utilisateursCouvertsParAbsence(plages, horairesPointage(parametrage))];
}

export interface ContexteReorientationDemande {
  contexte: ContexteReorientation;
  candidats: CandidatResponsable[];
  eligibles: CandidatResponsable[];
}

/** Candidats et contexte de garde 8 d'une demande (écran : liste déroulante ; serveur : revérification de la cible). */
export async function contexteReorientationDemande(db: Db, demandeId: string, maintenant = new Date()): Promise<ContexteReorientationDemande | null> {
  const d = await db.demande.findUnique({
    where: { id: demandeId },
    select: {
      createurId: true,
      responsableEtapeServiceId: true,
      beneficiaireType: true,
      beneficiaireUserId: true,
      beneficiaireNom: true,
      createur: { select: { service: { select: { responsableId: true } } } },
      lignes: { select: { beneficiaireType: true, beneficiaireUserId: true, beneficiaireNom: true } },
    },
  });
  if (!d) return null;
  const candidats = await chargerCandidatsResponsables(db);
  const contexte: ContexteReorientation = {
    actuelId: responsableServiceEffectif(d, d.createur.service?.responsableId),
    createurId: d.createurId,
    concernesIds: comptesConcernesDemande(d, d.lignes),
    absentsIds: await chargerAbsentsAujourdhui(db, candidats.map((c) => c.id), maintenant),
  };
  return { contexte, candidats, eligibles: responsablesEligibles(candidats, contexte) };
}

export type ResultatReorientation =
  | { ok: true; de: { id: string | null; nom: string }; vers: { id: string; nom: string }; delai: string }
  | { ok: false; message: string };

/**
 * Réoriente l'étape Service de `demandeId` vers `cibleId`. Le moteur contrôle qui (demandeur ou `treso.reorienter_demande`),
 * l'étape (Service seulement) et le motif (10 caractères) ; la cible est revérifiée ici (actif, différent de l'actuel, pas
 * absent, garde 8). Effets : décideur de l'étape remplacé, chronomètre remis à zéro (`etapeCircuitDepuis`) et rappel
 * recalibré (`dernierRappelAt` effacé), historique avec le délai écoulé chez l'ancien décideur. Plusieurs réorientations
 * possibles, chacune tracée. Le service du demandeur ne change pas.
 */
export async function reorienterEtapeService(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  cibleId: string,
  motif: string,
  maintenant = new Date()
): Promise<ResultatReorientation> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };

  const r = transition(versDemandeCircuit(d), acteur, { type: "REORIENTER", motif });
  if (!r.ok) return r;

  const ctx = await contexteReorientationDemande(db, demandeId, maintenant);
  if (!ctx) return { ok: false, message: "Demande introuvable." };
  const refusCible = refusCibleReorientation(cibleId, ctx.candidats, ctx.contexte);
  if (refusCible) return { ok: false, message: refusCible };

  const ancienId = ctx.contexte.actuelId;
  const [ancien, nouveau, depuis] = await Promise.all([
    ancienId ? db.user.findUnique({ where: { id: ancienId }, select: { fullName: true } }) : null,
    db.user.findUnique({ where: { id: cibleId }, select: { fullName: true } }),
    db.demande.findUnique({ where: { id: demandeId }, select: { etapeCircuitDepuis: true } }),
  ]);
  const nomAncien = ancien?.fullName ?? "aucun responsable";
  const nomNouveau = nouveau?.fullName ?? "?";
  const delai = libelleDelaiEcoule(depuis?.etapeCircuitDepuis ?? maintenant, maintenant);

  // Écriture conditionnée à l'état lu : une réorientation ou une décision simultanée déjà passée fait échouer celle-ci.
  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: "SERVICE", responsableEtapeServiceId: d.responsableEtapeServiceId },
    data: { responsableEtapeServiceId: cibleId, etapeCircuitDepuis: maintenant, dernierRappelAt: null },
  });
  if (maj.count !== 1) return { ok: false, message: "La demande a changé entre-temps : rechargez la page." };

  await db.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "reorientation_service",
      detail: detailReorientation({ de: nomAncien, vers: nomNouveau, motif, delai, parDemandeur: acteur.userId === d.createurId }),
      userId: acteur.userId,
    },
  });
  return { ok: true, de: { id: ancienId, nom: nomAncien }, vers: { id: cibleId, nom: nomNouveau }, delai };
}


/** Pour l'écran : décideur actuel de l'étape (nom) et responsables proposables (« Nom — Service »). */
export async function chargerAffichageReorientation(
  db: Db,
  demandeId: string
): Promise<{ responsableActuel: string | null; eligibles: { id: string; label: string }[] } | null> {
  const ctx = await contexteReorientationDemande(db, demandeId);
  if (!ctx) return null;
  const actuel = ctx.contexte.actuelId ? await db.user.findUnique({ where: { id: ctx.contexte.actuelId }, select: { fullName: true } }) : null;
  return {
    responsableActuel: actuel?.fullName ?? null,
    eligibles: ctx.eligibles.map((c) => ({ id: c.id, label: `${c.fullName} — ${c.services.join(", ")}` })),
  };
}
