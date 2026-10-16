// Lecture des permissions d'absence pour les écrans (Lot 4). Aucune règle ici : le moteur (`circuitAbsence.ts`,
// `permissionsAbsence.ts`) décide ; ces fonctions chargent les données et appellent le moteur pour griser les boutons.
import {
  MESSAGE_PLAFOND_ATTEINT_APPROBATION,
  actionsPossiblesAbsence,
  bornesMois,
  chargerContexteCircuit,
  colonneDateDepuisJourCivil,
  comptesActifsAvecPermission,
  decideurPourStatutAbsence,
  evaluerPlafond,
  friseAbsence,
  jourCivilDepuisColonneDate,
  PERMISSION_DG_ABSENCE,
  peutConsulterAbsence,
  prisma,
  refusDecideurAbsence,
  refusObservationDG,
  type ContexteCircuitAbsence,
  type StatutCircuitAbsence,
} from "backend";
import { hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import type { SessionPortail } from "@/lib/conges/lecture";

export async function chargerDemandePermission(id: string, session: SessionPortail) {
  const demande = await prisma.demandePermission.findUnique({
    where: { id },
    include: {
      typePermission: true,
      user: { select: { id: true, fullName: true, email: true, service: { select: { name: true, responsableId: true, responsable: { select: { fullName: true, isActive: true } } } } } },
      approuvePar: { select: { fullName: true } },
      validePar: { select: { fullName: true } },
      annulePar: { select: { fullName: true } },
    },
  });
  if (!demande) return null;

  const autorise = peutConsulterAbsence({
    nature: "PERMISSION",
    acteurId: session.user.id,
    demandeurId: demande.userId,
    responsableDuServiceId: demande.user.service?.responsableId ?? null,
    permissions: session.permissions,
  });
  if (!autorise) return null;

  const statut = demande.statut as StatutCircuitAbsence;
  const jour = jourCivilDepuisColonneDate(demande.date);
  const ctx = await chargerContexteCircuit(prisma, demande.userId, "PERMISSION");
  const decideur = decideurPourStatutAbsence(statut, ctx);
  let actions = actionsPossiblesAbsence({
    nature: "PERMISSION",
    statut,
    acteur: { id: session.user.id, rolePermissions: session.rolePermissions },
    demandeurId: demande.userId,
    decideur,
    adebute: jour <= aujourdhui(),
    peutAnnulerApresDebut: hasPermission(session, "absences.annuler"),
  });
  const frise = friseAbsence({ nature: "PERMISSION", statut, etapeResponsableRequise: demande.etapeResponsableRequise });

  // Plafond du mois pour CE type, sur les permissions déjà accordées (la règle de l'accord, `deciderPermission`).
  let derogation: { utilise: number; plafond: number } | null = null;
  if (statut === "EN_ATTENTE_RH") {
    const mois = bornesMois(jour);
    if (mois) {
      const utilise = await prisma.demandePermission.count({
        where: {
          userId: demande.userId,
          typePermissionId: demande.typePermissionId,
          date: { gte: colonneDateDepuisJourCivil(mois.debut), lte: colonneDateDepuisJourCivil(mois.fin) },
          statut: { in: ["APPROUVEE", "CONSOMMEE"] },
          id: { not: demande.id },
        },
      });
      if (evaluerPlafond({ utilise, plafond: demande.typePermission.plafondMensuel }).atteint) {
        derogation = { utilise, plafond: demande.typePermission.plafondMensuel };
      }
    }
  }
  // Le bouton « Approuver » ordinaire laisse la place à l'accord avec dérogation (motif obligatoire).
  if (derogation && actions.approuver === null) {
    actions = { ...actions, approuver: MESSAGE_PLAFOND_ATTEINT_APPROBATION(derogation.utilise, derogation.plafond) };
  }

  const historique = await prisma.historiqueEntry.findMany({
    where: { entity: "DemandePermission", entityId: demande.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { fullName: true } } },
  });

  const decideurLibelle =
    decideur === null
      ? null
      : decideur.type === "RESPONSABLE"
        ? `Le responsable du service (${demande.user.service?.responsable?.fullName ?? "—"})`
        : decideur.type === "RH"
          ? "La RH"
          : decideur.type === "DG"
            ? "Le DG (aucun autre compte RH)"
            : "Personne";

  // Observations (C3) : visibles de tous ceux qui voient la demande, demandeur compris ; ajout seul.
  const observations = await prisma.observationAbsence.findMany({
    where: { demandePermissionId: demande.id },
    orderBy: { createdAt: "asc" },
    include: { auteur: { select: { fullName: true } } },
  });

  const estDemandeur = demande.userId === session.user.id;
  const estRH = session.rolePermissions.includes("absences.valider_rh");
  const peutMarquerRetour = statut === "APPROUVEE" && jour <= aujourdhui() && (estDemandeur || estRH);

  return {
    demande,
    statut,
    jour,
    actions,
    frise,
    historique,
    decideurLibelle,
    estDemandeur,
    /** Plafond atteint à l'étape RH et l'acteur peut décider : l'accord passe par la dérogation. */
    derogation: derogation && decideur !== null && refusDecideurAbsence(decideur, { id: session.user.id, rolePermissions: session.rolePermissions }, demande.userId, "PERMISSION") === null ? derogation : null,
    peutMarquerRetour,
    observations: observations.map((o) => ({ id: o.id, etape: o.etape, texte: o.texte, createdAt: o.createdAt, auteurNom: o.auteur.fullName })),
    /** Le DG (permission du RÔLE) peut ajouter une observation, jamais sur sa propre demande. */
    peutObserverDG: refusObservationDG({ acteur: { id: session.user.id, rolePermissions: session.rolePermissions }, demandeurId: demande.userId }) === null,
  };
}

export interface PermissionFile {
  id: string;
  reference: string;
  statut: StatutCircuitAbsence;
  demandeurNom: string;
  serviceNom: string | null;
  libelleType: string;
  date: Date;
  heureDepart: string;
  heureRetourPrevue: string;
  etapeDepuis: Date;
}

/** Permissions que CE compte peut décider maintenant (responsable de service, RH, DG en repli) : le moteur tranche. */
export async function chargerFileDecisionPermissions(session: SessionPortail): Promise<PermissionFile[]> {
  const estRHouDG = session.rolePermissions.includes("absences.valider_rh") || session.rolePermissions.includes(PERMISSION_DG_ABSENCE);
  const candidates = await prisma.demandePermission.findMany({
    where: {
      OR: [
        { statut: "EN_ATTENTE_RESPONSABLE", user: { service: { responsableId: session.user.id } } },
        ...(estRHouDG ? [{ statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"] as ("EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH")[] } }] : []),
      ],
    },
    orderBy: { etapeDepuis: "asc" },
    include: {
      typePermission: { select: { label: true } },
      user: { select: { id: true, fullName: true, service: { select: { name: true, responsableId: true, responsable: { select: { isActive: true } } } } } },
    },
    take: 300,
  });
  if (candidates.length === 0) return [];

  const [comptesRH, comptesDG] = await Promise.all([
    comptesActifsAvecPermission(prisma, "absences.valider_rh"),
    comptesActifsAvecPermission(prisma, PERMISSION_DG_ABSENCE),
  ]);
  const acteur = { id: session.user.id, rolePermissions: session.rolePermissions };

  const file: PermissionFile[] = [];
  for (const d of candidates) {
    const s = d.user.service;
    const ctx: ContexteCircuitAbsence = {
      demandeurId: d.userId,
      service: s ? { name: s.name, responsableId: s.responsableId, responsableActif: s.responsable?.isActive ?? false } : null,
      comptesRH,
      comptesDG,
    };
    const statut = d.statut as StatutCircuitAbsence;
    const decideur = decideurPourStatutAbsence(statut, ctx);
    if (refusDecideurAbsence(decideur, acteur, d.userId, "PERMISSION") !== null) continue;
    file.push({
      id: d.id,
      reference: d.reference,
      statut,
      demandeurNom: d.user.fullName,
      serviceNom: s?.name ?? null,
      libelleType: d.typePermission.label,
      date: d.date,
      heureDepart: d.heureDepart,
      heureRetourPrevue: d.heureRetourPrevue,
      etapeDepuis: d.etapeDepuis,
    });
  }
  return file;
}
