import {
  actionsPossiblesConge,
  chargerContexteCircuit,
  comptesActifsAvecPermission,
  colonneDateDepuisJourCivil,
  decideurPourStatutConge,
  friseConge,
  jourCivilDepuisColonneDate,
  joursPassesProteges,
  PERMISSION_DG_CONGE,
  parseJourCivil,
  peutConsulterConge,
  prisma,
  refusDecideurConge,
  type EtapeFrise,
  type NatureConge,
  type StatutCircuitConge,
} from "backend";
import type { Prisma } from "backend";
import { getSession } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";

export type SessionPortail = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function dateConge(date: Date): string {
  return jourCivilDepuisColonneDate(date);
}

export async function listerMesConges(userId: string) {
  const demandes = await prisma.demandeConge.findMany({
    where: { userId },
    orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      reference: true,
      nature: true,
      motif: true,
      dateDebut: true,
      dateFin: true,
      nbJoursOuvres: true,
      statut: true,
      saisieParRH: true,
      motifRejet: true,
      motifModification: true,
      motifAnnulation: true,
      observationRH: true,
      etapeResponsableRequise: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return demandes.map((demande) => ({
    ...demande,
    dateDebut: dateConge(demande.dateDebut),
    dateFin: dateConge(demande.dateFin),
  }));
}

export interface DemandeFile {
  id: string;
  reference: string;
  statut: StatutCircuitConge;
  nature: NatureConge;
  demandeurId: string;
  demandeurNom: string;
  serviceNom: string | null;
  dateDebut: string;
  dateFin: string;
  nbJoursOuvres: number;
  etapeDepuis: Date;
}

/**
 * Candidates are intentionally broad; the circuit engine decides which of them this session may actually decide now.
 */
export async function chargerFileDecisionConges(session: SessionPortail): Promise<DemandeFile[]> {
  const estRHouDG =
    session.rolePermissions.includes("conges.valider_rh") ||
    session.rolePermissions.includes(PERMISSION_DG_CONGE);
  const statutsEnAttente: StatutCircuitConge[] = ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"];
  const requete = {
    where: {
      OR: [
        { statut: "EN_ATTENTE_RESPONSABLE", user: { service: { responsableId: session.user.id } } },
        ...(estRHouDG ? [{ statut: { in: statutsEnAttente } }] : []),
      ],
    },
    orderBy: { etapeDepuis: "asc" },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          service: {
            select: {
              name: true,
              responsableId: true,
              responsable: { select: { isActive: true } },
            },
          },
        },
      },
    },
    take: 300,
  } satisfies Prisma.DemandeCongeFindManyArgs;
  const candidates = await prisma.demandeConge.findMany(requete);
  if (candidates.length === 0) return [];

  const [comptesRH, comptesDG] = await Promise.all([
    comptesActifsAvecPermission(prisma, "conges.valider_rh"),
    comptesActifsAvecPermission(prisma, PERMISSION_DG_CONGE),
  ]);
  const acteur = { id: session.user.id, rolePermissions: session.rolePermissions };
  const file: DemandeFile[] = [];

  for (const demande of candidates) {
    const service = demande.user.service;
    const contexte = {
      demandeurId: demande.userId,
      service: service
        ? {
            name: service.name,
            responsableId: service.responsableId,
            responsableActif: service.responsable?.isActive ?? false,
          }
        : null,
      comptesRH,
      comptesDG,
    };
    const statut = demande.statut as StatutCircuitConge;
    const decideur = decideurPourStatutConge(statut, contexte);
    if (refusDecideurConge(decideur, acteur, demande.userId) !== null) continue;

    file.push({
      id: demande.id,
      reference: demande.reference,
      statut,
      nature: demande.nature,
      demandeurId: demande.userId,
      demandeurNom: demande.user.fullName,
      serviceNom: service?.name ?? null,
      dateDebut: dateConge(demande.dateDebut),
      dateFin: dateConge(demande.dateFin),
      nbJoursOuvres: demande.nbJoursOuvres,
      etapeDepuis: demande.etapeDepuis,
    });
  }

  return file;
}

export async function chargerDetailConge(id: string, session: SessionPortail) {
  const demande = await prisma.demandeConge.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          service: {
            select: {
              name: true,
              responsableId: true,
              responsable: { select: { fullName: true, isActive: true } },
            },
          },
        },
      },
      creePar: { select: { fullName: true } },
      approuvePar: { select: { fullName: true } },
      validePar: { select: { fullName: true } },
      annulePar: { select: { fullName: true } },
    },
  });
  if (!demande) return null;

  if (
    !peutConsulterConge({
      acteurId: session.user.id,
      demandeurId: demande.userId,
      responsableDuServiceId: demande.user.service?.responsableId ?? null,
      permissions: session.permissions,
    })
  ) {
    return null;
  }

  const aujourdHui = aujourdhui();
  const statut = demande.statut as StatutCircuitConge;
  const contexte = await chargerContexteCircuit(prisma, demande.userId);
  const decideur = decideurPourStatutConge(statut, contexte);
  const acteur = { id: session.user.id, rolePermissions: session.rolePermissions };
  const actions = actionsPossiblesConge({
    statut,
    acteur,
    demandeurId: demande.userId,
    decideur,
    adebute: aujourdHui >= dateConge(demande.dateDebut),
    peutAnnulerApresDebut: session.rolePermissions.includes("conges.annuler"),
  });
  const [frise, joursPasses, historique] = await Promise.all([
    Promise.resolve(
      friseConge({
        statut,
        etapeResponsableRequise: demande.etapeResponsableRequise,
      })
    ),
    joursPassesProteges(prisma, { demandeId: demande.id, aujourdhui: aujourdHui }),
    prisma.historiqueEntry.findMany({
      where: { entity: "DemandeConge", entityId: demande.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { fullName: true } } },
    }),
  ]);

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

  const estEtapeRH = decideur?.type === "RH" || decideur?.type === "DG";
  const friseEtapes: EtapeFrise[] = frise;

  return {
    demande: {
      ...demande,
      dateDebut: dateConge(demande.dateDebut),
      dateFin: dateConge(demande.dateFin),
    },
    statut,
    decideur,
    decideurLibelle,
    estEtapeRH,
    actions,
    frise: friseEtapes,
    joursPasses,
    historique,
    estDemandeur: demande.userId === session.user.id,
  };
}

export async function listerTousConges(filtres: {
  du?: string;
  au?: string;
  statut?: StatutCircuitConge;
}) {
  const session = await getSession();
  if (
    !session ||
    (!session.rolePermissions.includes("conges.consulter_tous") &&
      !session.rolePermissions.includes("conges.valider_rh"))
  ) {
    throw new Error("Action non autorisée.");
  }

  const du = filtres.du ? parseJourCivil(filtres.du) : null;
  const au = filtres.au ? parseJourCivil(filtres.au) : null;
  if ((filtres.du && !du) || (filtres.au && !au)) {
    throw new Error("Les dates de filtre doivent être au format AAAA-MM-JJ.");
  }
  if (filtres.du && filtres.au && filtres.du > filtres.au) {
    throw new Error("La date de début du filtre ne peut pas dépasser sa date de fin.");
  }

  const demandes = await prisma.demandeConge.findMany({
    where: {
      ...(filtres.statut ? { statut: filtres.statut } : {}),
      ...(filtres.du || filtres.au
        ? {
            AND: [
              ...(filtres.au && au
                ? [{ dateDebut: { lte: colonneDateDepuisJourCivil(filtres.au) } }]
                : []),
              ...(filtres.du && du
                ? [{ dateFin: { gte: colonneDateDepuisJourCivil(filtres.du) } }]
                : []),
            ],
          }
        : {}),
    },
    orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }],
    include: {
      user: {
        select: {
          fullName: true,
          service: { select: { name: true } },
        },
      },
    },
    take: 500,
  });

  return demandes.map((demande) => ({
    ...demande,
    dateDebut: dateConge(demande.dateDebut),
    dateFin: dateConge(demande.dateFin),
  }));
}
