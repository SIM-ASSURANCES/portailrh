// Lecture des demandes de congé pour les écrans (Lot 3c). Aucune règle ici : le moteur (`circuitAbsence.ts`) décide
// qui peut quoi ; ces fonctions ne font que charger les données et appeler le moteur pour griser les boutons.
import {
  actionsPossiblesAbsence,
  chargerContexteCircuit,
  comptesActifsAvecPermission,
  decideurPourStatutAbsence,
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
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";

export type SessionPortail = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function chargerDemandeConge(id: string, session: SessionPortail) {
  const demande = await prisma.demandeConge.findUnique({
    where: { id },
    include: {
      typeConge: true,
      user: { select: { id: true, fullName: true, email: true, service: { select: { name: true, responsableId: true, responsable: { select: { fullName: true, isActive: true } } } } } },
      piecesJointes: { orderBy: { createdAt: "asc" } },
      approuvePar: { select: { fullName: true } },
      validePar: { select: { fullName: true } },
      annulePar: { select: { fullName: true } },
    },
  });
  if (!demande) return null;

  const autorise = peutConsulterAbsence({
    nature: "CONGE",
    acteurId: session.user.id,
    demandeurId: demande.userId,
    responsableDuServiceId: demande.user.service?.responsableId ?? null,
    permissions: session.permissions,
  });
  if (!autorise) return null;

  const statut = demande.statut as StatutCircuitAbsence;
  const ctx = await chargerContexteCircuit(prisma, demande.userId, "CONGE");
  const decideur = decideurPourStatutAbsence(statut, ctx);
  const actions = actionsPossiblesAbsence({
    nature: "CONGE",
    statut,
    acteur: { id: session.user.id, rolePermissions: session.rolePermissions },
    demandeurId: demande.userId,
    decideur,
    adebute: jourCivilDepuisColonneDate(demande.dateDebut) <= aujourdhui(),
    peutAnnulerApresDebut: hasPermission(session, "conges.annuler"),
  });
  const frise = friseAbsence({ nature: "CONGE", statut, etapeResponsableRequise: demande.etapeResponsableRequise });

  const historique = await prisma.historiqueEntry.findMany({
    where: { entity: "DemandeConge", entityId: demande.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { fullName: true } } },
  });

  // Observations (C3) : visibles de tous ceux qui voient la demande, demandeur compris ; ajout seul.
  const observations = await prisma.observationAbsence.findMany({
    where: { demandeCongeId: demande.id },
    orderBy: { createdAt: "asc" },
    include: { auteur: { select: { fullName: true } } },
  });
  const acteurObs = { id: session.user.id, rolePermissions: session.rolePermissions };

  const lignesDecideur =
    decideur === null
      ? null
      : decideur.type === "RESPONSABLE"
        ? `Le responsable du service (${demande.user.service?.responsable?.fullName ?? "—"})`
        : decideur.type === "RH"
          ? "La RH"
          : decideur.type === "DG"
            ? "Le DG (aucun autre compte RH)"
            : "Personne";

  return {
    demande,
    statut,
    actions,
    frise,
    historique,
    decideurLibelle: lignesDecideur,
    estDemandeur: demande.userId === session.user.id,
    observations: observations.map((o) => ({ id: o.id, etape: o.etape, texte: o.texte, createdAt: o.createdAt, auteurNom: o.auteur.fullName })),
    /** Le DG (permission du RÔLE) peut ajouter une observation, jamais sur sa propre demande. */
    peutObserverDG: refusObservationDG({ acteur: acteurObs, demandeurId: demande.userId }) === null,
  };
}

export interface DemandeFile {
  id: string;
  reference: string;
  statut: StatutCircuitAbsence;
  demandeurNom: string;
  serviceNom: string | null;
  libelleType: string;
  dateDebut: Date;
  dateFin: Date;
  nbJours: number;
  etapeDepuis: Date;
}

/**
 * Demandes que CE compte peut décider maintenant : celles de son service à l'étape responsable, et — s'il porte
 * `conges.valider_rh` (ou `treso.decider_dg`) sur son rôle — celles que le moteur lui attribue à l'étape RH ou en repli.
 * Le moteur (`decideurPourStatutAbsence` + `refusDecideurAbsence`) tranche pour chaque demande : jamais la sienne.
 */
export async function chargerFileDecisionConges(session: SessionPortail): Promise<DemandeFile[]> {
  const estRHouDG = session.rolePermissions.includes("conges.valider_rh") || session.rolePermissions.includes(PERMISSION_DG_ABSENCE);
  const candidates = await prisma.demandeConge.findMany({
    where: {
      OR: [
        { statut: "EN_ATTENTE_RESPONSABLE", user: { service: { responsableId: session.user.id } } },
        ...(estRHouDG ? [{ statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"] as ("EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH")[] } }] : []),
      ],
    },
    orderBy: { etapeDepuis: "asc" },
    include: {
      typeConge: { select: { label: true } },
      user: { select: { id: true, fullName: true, service: { select: { name: true, responsableId: true, responsable: { select: { isActive: true } } } } } },
    },
    take: 300,
  });
  if (candidates.length === 0) return [];

  const [comptesRH, comptesDG] = await Promise.all([
    comptesActifsAvecPermission(prisma, "conges.valider_rh"),
    comptesActifsAvecPermission(prisma, PERMISSION_DG_ABSENCE),
  ]);
  const acteur = { id: session.user.id, rolePermissions: session.rolePermissions };

  const file: DemandeFile[] = [];
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
    if (refusDecideurAbsence(decideur, acteur, d.userId, "CONGE") !== null) continue;
    file.push({
      id: d.id,
      reference: d.reference,
      statut,
      demandeurNom: d.user.fullName,
      serviceNom: s?.name ?? null,
      libelleType: d.typeConge.label,
      dateDebut: d.dateDebut,
      dateFin: d.dateFin,
      nbJours: d.nbJours,
      etapeDepuis: d.etapeDepuis,
    });
  }
  return file;
}
